'use strict'

/**
 * Collector Cache Extension for Antora - Content-Addressable Storage
 *
 * Provides content-addressable caching for collector commands using source file hashes.
 * Automatically deduplicates outputs across different versions when source files match.
 *
 * @see https://docs.antora.org/antora/latest/extend/extension-tutorial/
 * @see https://docs.antora.org/collector-extension/latest/
 */

const fs = require('fs')
const path = require('path')

// Import utilities
const { computeHashes, computeContentHash } = require('./utils/hash')
const { checkOutputsExist, copyDirectory } = require('./utils/fs')
const { loadPointerFile, restoreFilesToWorktree } = require('./utils/cache')
const { generateWorktreeFolderName, isLocalDevelopment } = require('./utils/git')
const { resolveSources, resolveDependencySources, buildEntriesMap } = require('./utils/sources')

const EXTENSION_NAME = 'collector-cache-extension'
const DEFAULT_CACHE_DIR = '.cache/antora/collector-cache'

/**
 * Register the collector cache extension
 */
module.exports.register = function () {
  const logger = this.getLogger(EXTENSION_NAME)

  // Track entries for cache updates after build
  const cacheEntries = []

  /**
   * Main event: Process collector-cache configuration before collector runs
   */
  this.once('contentAggregated', async ({ contentAggregate, playbook }) => {
    const dryRun = process.env.DRY_RUN === 'true'
    logger.info('Processing collector-cache configuration')
    if (dryRun) {
      logger.info('DRY RUN MODE - will exit after cache check')
    }

    // Get git module for updating worktrees
    const git = this.require('@antora/content-aggregator/git')
    const http = require('isomorphic-git/http/node')

    for (const { name: componentName, origins } of contentAggregate) {
      for (const origin of origins) {
        const cacheConfig = origin.descriptor.ext?.collectorCache

        if (!cacheConfig) {
          logger.debug(`No collector-cache configuration for ${componentName}`)
          continue
        }

        // SAFETY: Detect local development to avoid destructive git operations
        // For local sources, gitdir is worktree/.git (e.g., /work/.git is inside /work)
        // For remote builds, gitdir and worktree are in separate cache directories
        logger.debug(`Origin properties: worktree=${origin.worktree}, gitdir=${origin.gitdir}, url=${origin.url}`)
        const isLocalDev = isLocalDevelopment(origin.worktree, origin.gitdir)
        logger.debug(
          `isLocalDevelopment check: ${isLocalDev} (gitdir: ${origin.gitdir}, expected: ${path.join(
            origin.worktree || '',
            '.git'
          )})`
        )
        if (isLocalDev) {
          logger.info(
            `Local development detected for ${componentName} - skipping git operations to protect uncommitted changes`
          )
        } else {
          logger.debug(`Remote build detected for ${componentName} - git operations will run normally`)
        }

        // Determine worktree path
        let worktree = origin.worktree

        if (!worktree) {
          // For remote builds: find collector worktree directory
          const collectorCacheDir = path.join(playbook.dir, playbook.runtime.cacheDir || '.cache/antora', 'collector')
          const refname = origin.refname || origin.branch || origin.tag || 'HEAD'

          // Extract repository name from URL for worktree prefix
          const url = origin.url || ''
          const repoName = path.basename(url, '.git')
          const worktreePrefix = `${repoName}@${refname}-`

          if (fs.existsSync(collectorCacheDir)) {
            const entries = fs.readdirSync(collectorCacheDir)
            const matchingEntries = entries.filter((e) => e.startsWith(worktreePrefix))

            if (matchingEntries.length > 0) {
              const worktreeDirName = matchingEntries[matchingEntries.length - 1]
              worktree = path.join(collectorCacheDir, worktreeDirName)
              origin.worktree = worktree // Tell collector this worktree exists
              logger.debug(`Found worktree: ${worktree}`)
            }
          }
        }

        // Initialize collector array if needed
        if (!origin.descriptor.ext.collector) {
          origin.descriptor.ext.collector = []
        }

        // Handle both array and object formats
        const entries = Array.isArray(cacheConfig) ? cacheConfig : cacheConfig.entries

        if (!entries || !Array.isArray(entries)) {
          logger.warn('collector-cache configuration must be an array of entries')
          continue
        }

        // Get cache directory
        const cacheDir = cacheConfig.cacheDir || DEFAULT_CACHE_DIR
        const componentHashDir = path.join(playbook.dir, cacheDir, 'hashes', componentName)

        // Build entries map for dependency resolution (needed for both paths)
        const entriesMap = buildEntriesMap(entries)

        // If no worktree, create one with submodules initialized for the collector to use
        if (!worktree) {
          logger.info(`No worktree found for ${componentName} - creating worktree with submodules`)
          logger.info(`Adding ${entries.length} collector entries for ${componentName}`)

          // Determine worktree location that collector will use
          const collectorCacheDir = path.join(playbook.dir, playbook.runtime.cacheDir || '.cache/antora', 'collector')
          const refname = origin.refname || origin.branch || origin.tag || 'HEAD'

          // Extract repository name from URL for worktree prefix
          const url = origin.url || ''
          const repoName = path.basename(url, '.git')
          const worktreePrefix = `${repoName}@${refname}-`

          // Create the worktree using git clone
          try {
            // Ensure collector cache directory exists
            if (!fs.existsSync(collectorCacheDir)) {
              fs.mkdirSync(collectorCacheDir, { recursive: true })
            }

            // Clone the repository using collector's naming convention
            if (origin.url) {
              // Generate worktree folder name using collector's algorithm
              const worktreeDirName = generateWorktreeFolderName(origin, true)
              worktree = path.join(collectorCacheDir, worktreeDirName)

              logger.debug(`Creating worktree at ${worktree}`)
              logger.debug(`Cloning from ${origin.url}`)

              await git.clone({
                fs,
                http,
                dir: worktree,
                url: origin.url,
                ref: origin.refname,
                singleBranch: true,
                depth: 1,
              })

              logger.debug(`Successfully created worktree: ${worktreeDirName}`)
            } else if (origin.worktree) {
              // Local build: use existing worktree
              worktree = origin.worktree
            } else {
              logger.warn(`No URL or worktree available for ${componentName}`)
              continue
            }

            // Initialize submodules (critical for collector commands and hash calculations)
            await initializeSubmodules(worktree, logger)

            logger.info(`✓ Created worktree with submodules at ${worktree}`)

            // IMPORTANT: Set origin.worktree so collector knows the worktree exists
            // This prevents collector from recreating/removing the worktree
            origin.worktree = worktree
          } catch (err) {
            logger.error(`Failed to create worktree for ${componentName}: ${err.message}`)
            logger.debug(`Error stack: ${err.stack}`)
            continue
          }

          for (const entry of entries) {
            const { run } = entry

            // Note: Antora normalizes YAML keys to lowercase, so cacheDir becomes cachedir
            const cachedir = run?.cachedir || run?.cacheDir
            if (!run || !run.key || !run.sources || !cachedir) {
              logger.warn('Skipping invalid entry (missing run.key, run.sources, or run.cachedir)')
              logger.debug(`Entry structure: ${JSON.stringify(entry)}`)
              continue
            }

            // Add to collector to run
            origin.descriptor.ext.collector.push(entry)

            // Resolve dependencies to get combined sources
            const dependsOn = run.dependson || run.dependsOn || []
            const depSources = resolveDependencySources(
              entriesMap,
              dependsOn,
              new Set([run.key]),
              logger,
              componentName,
              run.key
            )

            // Combine entry's own sources with dependency sources
            const allSources = [...run.sources, ...depSources.sources]
            const allSourceCommands = [
              ...(run.sourcecommands || run.sourceCommands || []),
              ...depSources.sourceCommands,
            ]

            // Track for caching after build (with resolved sources)
            cacheEntries.push({
              componentName,
              componentHashDir,
              key: run.key,
              sources: allSources, // Store combined sources (incl. dependencies)
              sourceCommands: allSourceCommands, // Store combined sourceCommands (incl. dependencies)
              collectorCacheDir,
              worktreePrefix,
              outputDir: cachedir,
              sourceHashes: null,
              contentHash: null,
            })
          }
          continue
        }

        logger.debug(`Processing ${entries.length} entries for ${componentName}`)

        for (const entry of entries) {
          const { run, scan } = entry

          // Note: Antora normalizes YAML keys to lowercase, so cacheDir becomes cachedir
          const cachedir = run?.cachedir || run?.cacheDir
          if (!run || !run.key || !run.sources || !cachedir) {
            logger.warn('Skipping invalid entry (missing run.key, run.sources, or run.cachedir)')
            continue
          }

          const { key, sources } = run
          const outputDir = cachedir

          try {
            // Check if worktree exists
            if (!fs.existsSync(worktree)) {
              logger.debug(`Worktree does not exist yet for ${componentName}/${key} - cache MISS`)
              origin.descriptor.ext.collector.push(entry)
              cacheEntries.push({
                componentName,
                componentHashDir,
                key,
                sources,
                sourceCommands: run.sourcecommands || run.sourceCommands,
                worktree,
                outputDir,
                sourceHashes: null,
                contentHash: null,
              })
              continue
            }

            // Update worktree to current commit before checking files (remote builds only)
            // SAFETY: Skip git operations for local development to avoid destroying uncommitted changes
            if (!isLocalDev && origin.gitdir && origin.refname && origin.reftype && origin.url) {
              await updateWorktree(git, http, worktree, origin, logger, componentName, key)
            }

            // Initialize submodules (works for both local and remote builds)
            try {
              await initializeSubmodules(worktree, logger)
            } catch (err) {
              logger.debug(`Submodule initialization error: ${err.message}`)
            }

            // Resolve sources from dependencies first
            const dependsOn = run.dependson || run.dependsOn || []
            const depSources = resolveDependencySources(
              entriesMap,
              dependsOn,
              new Set([key]),
              logger,
              componentName,
              key
            )

            // Combine entry's own sources with dependency sources
            const allSources = [...sources, ...depSources.sources]
            const allSourceCommands = [
              ...(run.sourcecommands || run.sourceCommands || []),
              ...depSources.sourceCommands,
            ]

            // Resolve dynamic sources from sourceCommands (including dependencies)
            const resolvedSources = await resolveSources(
              worktree,
              allSources,
              allSourceCommands,
              logger,
              componentName,
              key
            )

            // Compute source file hashes
            const sourceHashes = computeHashes(worktree, resolvedSources, logger, componentName, key)

            if (sourceHashes === null) {
              logger.debug(`Source files not found for ${componentName}/${key} - cache MISS`)
              origin.descriptor.ext.collector.push(entry)
              cacheEntries.push({
                componentName,
                componentHashDir,
                key,
                sources,
                sourceCommands: run.sourcecommands || run.sourceCommands,
                worktree,
                outputDir,
                sourceHashes: null,
                contentHash: null,
              })
              continue
            }

            // Compute content hash from source hashes
            const contentHash = computeContentHash(sourceHashes)

            // Look up pointer file
            const pointerPath = path.join(componentHashDir, key, `${contentHash}.json`)
            const pointer = loadPointerFile(pointerPath, logger)

            // Check if cached outputs exist
            const forceRun = process.env.FORCE_COLLECTOR === 'true'
            let cachedOutputsExist = false

            if (pointer) {
              const cachedOutputPath = path.join(playbook.dir, cacheDir, 'outputs', pointer.outputDir, outputDir)
              cachedOutputsExist = checkOutputsExist(cachedOutputPath, logger)
            }

            const shouldSkip = !forceRun && pointer && cachedOutputsExist

            if (shouldSkip) {
              logger.info(`Cache HIT for ${componentName}/${key} (content: ${contentHash.substring(0, 12)}...)`)

              // Restore files from cache to worktree if specified
              const restorePatterns = run.restoretoworktree || run.restoreToWorktree
              if (restorePatterns && Array.isArray(restorePatterns) && restorePatterns.length > 0) {
                const cacheOutputPath = path.join(playbook.dir, cacheDir, 'outputs', pointer.outputDir, outputDir)
                const worktreeOutputPath = path.join(worktree, outputDir)
                restoreFilesToWorktree(cacheOutputPath, worktreeOutputPath, restorePatterns, logger, componentName, key)
              }

              // Scan from cached outputs
              if (scan) {
                // Handle scan as array or single object
                const scanEntries = Array.isArray(scan) ? scan : [scan]
                const scanConfigs = scanEntries.map((scanEntry) => ({
                  dir: path.join(playbook.dir, cacheDir, 'outputs', pointer.outputDir, scanEntry.dir),
                  files: scanEntry.files,
                  into: scanEntry.into,
                }))

                origin.descriptor.ext.collector.push({
                  run: {
                    command: 'true', // No-op
                  },
                  scan: scanConfigs,
                })
              }
            } else {
              const reason = forceRun ? 'FORCE_COLLECTOR=true' : !pointer ? 'no cache entry' : 'cached outputs missing'
              logger.info(`Cache MISS for ${componentName}/${key} (${reason})`)

              // Run collector
              origin.descriptor.ext.collector.push({ run, scan })

              // Track for cache update (store resolved sources with dependencies)
              cacheEntries.push({
                componentName,
                componentHashDir,
                key,
                sources: allSources, // Store combined sources (incl. dependencies)
                sourceCommands: allSourceCommands, // Store combined sourceCommands (incl. dependencies)
                worktree,
                outputDir,
                sourceHashes,
                contentHash,
              })
            }
          } catch (error) {
            logger.error(`Error processing entry ${componentName}/${key}: ${error.message}`)
            logger.debug(error.stack)
            origin.descriptor.ext.collector.push({ run, scan })
          }
        }
      }
    }

    if (dryRun) {
      logger.info('DRY RUN complete - exiting')
      process.exit(0)
    }
  })

  /**
   * After build: Update cache with new outputs
   */
  this.on('beforePublish', async ({ playbook }) => {
    logger.info(`Updating cache for ${cacheEntries.length} entries`)

    const cacheDir = DEFAULT_CACHE_DIR

    for (const entry of cacheEntries) {
      try {
        // Determine worktree path if not set
        let worktree = entry.worktree
        if (!worktree && entry.collectorCacheDir && entry.worktreePrefix) {
          // Find the worktree created by collector
          if (fs.existsSync(entry.collectorCacheDir)) {
            const entries = fs.readdirSync(entry.collectorCacheDir)
            const matchingEntries = entries.filter((e) => e.startsWith(entry.worktreePrefix))

            if (matchingEntries.length > 0) {
              const worktreeDirName = matchingEntries[matchingEntries.length - 1]
              worktree = path.join(entry.collectorCacheDir, worktreeDirName)
              logger.debug(`Found worktree for caching: ${worktree}`)
            }
          }

          if (!worktree) {
            logger.warn(`Worktree not found for ${entry.componentName}/${entry.key}`)
            continue
          }
        }

        // Compute hashes if not done yet
        let sourceHashes = entry.sourceHashes
        let contentHash = entry.contentHash

        if (!sourceHashes) {
          // Resolve sources (including dynamic sources from sourceCommands)
          // Note: Submodules are already initialized during contentAggregated
          const resolvedSources = await resolveSources(
            worktree,
            entry.sources,
            entry.sourceCommands,
            logger,
            entry.componentName,
            entry.key
          )

          sourceHashes = computeHashes(worktree, resolvedSources, logger, entry.componentName, entry.key)
          if (!sourceHashes) {
            logger.warn(`Source files still not found for ${entry.componentName}/${entry.key}`)
            continue
          }
          contentHash = computeContentHash(sourceHashes)
        }

        // Create pointer file
        const pointerDir = path.join(entry.componentHashDir, entry.key)
        fs.mkdirSync(pointerDir, { recursive: true })

        const pointer = {
          outputDir: contentHash,
          scanDir: entry.outputDir,
          sources: sourceHashes,
          timestamp: new Date().toISOString(),
        }

        const pointerPath = path.join(pointerDir, `${contentHash}.json`)
        fs.writeFileSync(pointerPath, JSON.stringify(pointer, null, 2), 'utf8')
        logger.debug(`Created pointer: ${pointerPath}`)

        // Copy outputs to content-addressed directory
        const sourceOutputPath = path.join(worktree, entry.outputDir)
        const cachedOutputPath = path.join(playbook.dir, cacheDir, 'outputs', contentHash, entry.outputDir)

        if (fs.existsSync(sourceOutputPath)) {
          copyDirectory(sourceOutputPath, cachedOutputPath, logger)
          logger.info(`Cached outputs for ${entry.componentName}/${entry.key} → ${contentHash.substring(0, 12)}...`)
        } else {
          logger.warn(`Output directory not found: ${sourceOutputPath}`)
        }
      } catch (error) {
        logger.error(`Failed to update cache for ${entry.componentName}/${entry.key}: ${error.message}`)
      }
    }
  })
}

/**
 * Initialize git submodules in a worktree
 *
 * @param {string} worktree - Path to the worktree
 * @param {object} logger - Logger instance
 */
async function initializeSubmodules (worktree, logger) {
  logger.debug('Initializing submodules in worktree')
  const { spawn } = require('child_process')
  await new Promise((resolve, reject) => {
    const proc = spawn('git', ['submodule', 'update', '--init', '--recursive'], { cwd: worktree })
    let stderr = ''
    proc.stderr.on('data', (data) => {
      stderr += data
    })
    proc.on('close', (code) => {
      if (code === 0) {
        logger.debug('Submodules initialized successfully')
        resolve()
      } else {
        logger.debug(`git submodule exited with code ${code}: ${stderr}`)
        resolve() // Don't fail - repo might not have submodules
      }
    })
    proc.on('error', (err) => {
      logger.debug(`Failed to run git submodule: ${err.message}`)
      resolve() // Don't fail - git might not be available
    })
  })
}

/**
 * Update worktree to current commit for remote builds
 *
 * @param {object} git - isomorphic-git instance
 * @param {object} http - HTTP module for git operations
 * @param {string} worktree - Path to the worktree
 * @param {object} origin - Origin object with git info
 * @param {object} logger - Logger instance
 * @param {string} componentName - Component name for logging
 * @param {string} key - Entry key for logging
 */
async function updateWorktree (git, http, worktree, origin, logger, componentName, key) {
  try {
    // Match collector extension's ref construction (line 128)
    const ref = `refs/${origin.reftype === 'branch' ? 'head' : origin.reftype}s/${origin.refname}`
    const remote = origin.remote || 'origin'
    const bare = false // worktree exists from cache
    const cache = {} // Empty cache object

    logger.debug(`Updating worktree to ${origin.reftype}:${origin.refname}`)

    // Build repo object matching collector extension's prepareWorktree call (line 130)
    const repo = { fs, cache, dir: worktree, gitdir: origin.gitdir, ref, remote, bare }

    // Delete remote from repo before git operations (prepareWorktree line 236)
    delete repo.remote

    // Fetch remote refs first to get latest commits
    logger.debug(`Fetching remote refs for ${remote} from ${origin.url}`)
    await git.fetch({ ...repo, http, url: origin.url, remote, singleBranch: false, tags: false })

    // Create/update local branch to point to remote tracking branch (prepareWorktree line 255-260)
    if (ref.startsWith('refs/heads/')) {
      const branchName = ref.slice(11)
      const branches = await git.listBranches(repo)
      if (bare || !branches.includes(branchName)) {
        logger.debug(`Creating local branch ${branchName} -> refs/remotes/${remote}/${branchName}`)
        await git.branch({
          ...repo,
          ref: branchName,
          object: `refs/remotes/${remote}/${branchName}`,
          force: true,
        })
      } else {
        logger.debug(`Updating local branch ${branchName} -> refs/remotes/${remote}/${branchName}`)
        await git.branch({
          ...repo,
          ref: branchName,
          object: `refs/remotes/${remote}/${branchName}`,
          force: true,
        })
      }
    }

    // Checkout to update worktree files (prepareWorktree line 264)
    await git.checkout({ ...repo, force: true, noUpdateHead: true, track: false })
  } catch (err) {
    logger.warn(`Failed to update worktree for ${componentName}/${key}: ${err.message}`)
  }
}