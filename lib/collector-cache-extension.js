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
const crypto = require('crypto')
const { globSync } = require('fast-glob')

const EXTENSION_NAME = 'collector-cache-extension'
const DEFAULT_CACHE_DIR = '.cache/antora/collector-cache'
const posixify = path.sep === '\\' ? (p) => p.replace(/\\/g, '/') : undefined

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
        const isLocalDevelopment =
          origin.worktree && origin.gitdir && origin.gitdir === path.join(origin.worktree, '.git')
        logger.debug(
          `isLocalDevelopment check: ${isLocalDevelopment} (gitdir: ${origin.gitdir}, expected: ${path.join(
            origin.worktree || '',
            '.git'
          )})`
        )
        if (isLocalDevelopment) {
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
        const entriesMap = new Map()
        for (const entry of entries) {
          const { run } = entry
          if (run && run.key) {
            entriesMap.set(run.key, {
              key: run.key,
              sources: run.sources || [],
              sourceCommands: run.sourcecommands || run.sourceCommands || [],
              dependsOn: run.dependson || run.dependsOn || [],
            })
          }
        }

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
            logger.debug(`Initializing submodules in ${worktree}`)
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
            if (!isLocalDevelopment && origin.gitdir && origin.refname && origin.reftype && origin.url) {
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

            // Initialize submodules (works for both local and remote builds)
            try {
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
 * Resolve source files by running sourceCommands and combining with static sources
 */
async function resolveSources (worktree, staticSources, sourceCommands, logger, componentName, key) {
  const sourcesSet = new Set(staticSources)

  // If no sourceCommands, just return static sources
  if (!sourceCommands || !Array.isArray(sourceCommands) || sourceCommands.length === 0) {
    return Array.from(sourcesSet)
  }

  logger.debug(`Resolving dynamic sources for ${componentName}/${key}`)

  const { spawn } = require('child_process')

  for (const command of sourceCommands) {
    try {
      logger.debug(`  Running: ${command}`)

      const output = await new Promise((resolve, reject) => {
        const proc = spawn('sh', ['-c', command], { cwd: worktree })
        let stdout = ''
        let stderr = ''

        proc.stdout.on('data', (data) => {
          stdout += data
        })
        proc.stderr.on('data', (data) => {
          stderr += data
        })

        proc.on('close', (code) => {
          if (code === 0) {
            resolve(stdout)
          } else {
            reject(new Error(`Command exited with code ${code}: ${stderr}`))
          }
        })

        proc.on('error', (err) => {
          reject(err)
        })
      })

      // Parse output (newline-separated paths)
      const paths = output
        .trim()
        .split('\n')
        .filter((line) => line.trim().length > 0)

      logger.debug(`  Found ${paths.length} source(s)`)
      paths.forEach((p) => sourcesSet.add(p.trim()))
    } catch (err) {
      logger.warn(`Failed to run sourceCommand "${command}" for ${componentName}/${key}: ${err.message}`)
    }
  }

  const resolvedSources = Array.from(sourcesSet)
  logger.debug(`Total sources for ${componentName}/${key}: ${resolvedSources.length}`)

  return resolvedSources
}

/**
 * Resolve sources from dependencies recursively
 *
 * @param {object} entriesMap - Map of key -> entry config for looking up dependencies
 * @param {string[]} dependsOn - Array of dependency keys
 * @param {Set} visited - Set of visited keys to detect circular dependencies
 * @param {object} logger - Logger instance
 * @param {string} componentName - Component name for logging
 * @param {string} key - Current entry key for logging
 * @returns {object} Object with sources and sourceCommands arrays from all dependencies
 */
function resolveDependencySources (entriesMap, dependsOn, visited, logger, componentName, key) {
  const allSources = []
  const allSourceCommands = []

  if (!dependsOn || !Array.isArray(dependsOn) || dependsOn.length === 0) {
    return { sources: allSources, sourceCommands: allSourceCommands }
  }

  logger.debug(`Resolving dependencies for ${componentName}/${key}: ${dependsOn.join(', ')}`)

  for (const depKey of dependsOn) {
    // Check for circular dependency
    if (visited.has(depKey)) {
      logger.warn(`Circular dependency detected: ${key} -> ${depKey}`)
      continue
    }

    // Find the dependency entry
    const depEntry = entriesMap.get(depKey)
    if (!depEntry) {
      logger.warn(`Dependency not found: ${depKey} (required by ${key})`)
      continue
    }

    // Mark as visited
    const newVisited = new Set(visited)
    newVisited.add(depKey)

    // Add dependency's sources
    if (depEntry.sources) {
      allSources.push(...depEntry.sources)
    }

    // Add dependency's sourceCommands
    if (depEntry.sourceCommands) {
      allSourceCommands.push(...depEntry.sourceCommands)
    }

    // Recursively resolve the dependency's dependencies
    if (depEntry.dependsOn && depEntry.dependsOn.length > 0) {
      const recursive = resolveDependencySources(
        entriesMap,
        depEntry.dependsOn,
        newVisited,
        logger,
        componentName,
        depKey
      )
      allSources.push(...recursive.sources)
      allSourceCommands.push(...recursive.sourceCommands)
    }
  }

  logger.debug(`Resolved ${allSources.length} sources and ${allSourceCommands.length} sourceCommands from dependencies`)

  return { sources: allSources, sourceCommands: allSourceCommands }
}

/**
 * Compute SHA-256 hashes for source files
 */
function computeHashes (worktree, sources, logger, componentName, key) {
  const hashes = {}

  if (logger && componentName && key) {
    logger.debug(`Checking source files for ${componentName}/${key} in worktree: ${worktree}`)
  }

  for (const source of sources) {
    const filePath = path.join(worktree, source)

    if (!fs.existsSync(filePath)) {
      if (logger && componentName && key) {
        logger.debug(`  ✗ Missing: ${source}`)
        // List what's actually in the worktree
        try {
          const worktreeContents = fs.readdirSync(worktree, { withFileTypes: true })
          const files = worktreeContents.filter((e) => e.isFile()).map((e) => e.name)
          const dirs = worktreeContents.filter((e) => e.isDirectory()).map((e) => e.name + '/')
          logger.debug(`  Worktree contains: ${[...dirs, ...files].join(', ') || '(empty)'}`)
        } catch (err) {
          logger.debug(`  Failed to list worktree contents: ${err.message}`)
        }
      }
      return null
    }

    const content = fs.readFileSync(filePath)
    const hash = crypto.createHash('sha256').update(content).digest('hex')
    hashes[source] = hash

    if (logger && componentName && key) {
      logger.debug(`  ✓ Found: ${source} (${hash.substring(0, 12)}...)`)
    }
  }

  return hashes
}

/**
 * Compute content hash from source file hashes
 */
function computeContentHash (sourceHashes) {
  // Sort keys for consistent ordering
  const sortedKeys = Object.keys(sourceHashes).sort()

  // Concatenate hashes in sorted order
  const combined = sortedKeys.map((key) => sourceHashes[key]).join('')

  // Hash the combined string
  return crypto.createHash('sha256').update(combined).digest('hex')
}

/**
 * Load pointer file from disk
 */
function loadPointerFile (pointerPath, logger) {
  if (!fs.existsSync(pointerPath)) {
    logger.debug(`No pointer file: ${pointerPath}`)
    return null
  }

  try {
    const content = fs.readFileSync(pointerPath, 'utf8')
    return JSON.parse(content)
  } catch (error) {
    logger.warn(`Failed to read pointer file ${pointerPath}: ${error.message}`)
    return null
  }
}

/**
 * Check if output directory exists and contains files
 */
function checkOutputsExist (outputPath, logger) {
  if (!fs.existsSync(outputPath)) {
    logger.debug(`Output directory does not exist: ${outputPath}`)
    return false
  }

  try {
    const stat = fs.statSync(outputPath)
    if (!stat.isDirectory()) {
      logger.debug(`Output path is not a directory: ${outputPath}`)
      return false
    }

    const hasFiles = checkDirectoryHasFiles(outputPath)
    if (!hasFiles) {
      logger.debug(`Output directory is empty: ${outputPath}`)
      return false
    }

    return true
  } catch (error) {
    logger.debug(`Error checking output directory ${outputPath}: ${error.message}`)
    return false
  }
}

/**
 * Recursively check if directory contains files
 */
function checkDirectoryHasFiles (dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.isFile()) {
      return true
    }
    if (entry.isDirectory()) {
      const hasFiles = checkDirectoryHasFiles(path.join(dirPath, entry.name))
      if (hasFiles) return true
    }
  }

  return false
}

/**
 * Recursively copy directory contents
 */
function copyDirectory (source, destination, logger) {
  // Remove destination if it exists
  if (fs.existsSync(destination)) {
    fs.rmSync(destination, { recursive: true, force: true })
  }

  // Create destination directory
  fs.mkdirSync(destination, { recursive: true })

  // Copy contents
  const entries = fs.readdirSync(source, { withFileTypes: true })

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name)
    const destPath = path.join(destination, entry.name)

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destPath, logger)
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destPath)
    }
  }

  logger.debug(`Copied directory from ${source} to ${destination}`)
}

/**
 * Copy files matching glob patterns from cache to worktree
 *
 * @param {string} cacheOutputDir - Source directory in cache
 * @param {string} worktreeOutputDir - Destination directory in worktree
 * @param {string[]} patterns - Array of glob patterns to match
 * @param {object} logger - Logger instance
 * @param {string} componentName - Component name for logging
 * @param {string} key - Entry key for logging
 */
function restoreFilesToWorktree (cacheOutputDir, worktreeOutputDir, patterns, logger, componentName, key) {
  if (!patterns || !Array.isArray(patterns) || patterns.length === 0) {
    return
  }

  logger.debug(`Restoring files to worktree for ${componentName}/${key}`)

  // Find all files matching patterns
  const filesToCopy = []

  for (const pattern of patterns) {
    const matches = findFilesMatchingPattern(cacheOutputDir, pattern)
    logger.debug(`  Pattern "${pattern}" matched ${matches.length} file(s)`)
    filesToCopy.push(...matches)
  }

  // Copy files to worktree
  for (const relativePath of filesToCopy) {
    const sourcePath = path.join(cacheOutputDir, relativePath)
    const destPath = path.join(worktreeOutputDir, relativePath)

    // Ensure destination directory exists
    const destDir = path.dirname(destPath)
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
    }

    // Copy file
    fs.copyFileSync(sourcePath, destPath)
    logger.debug(`  Restored: ${relativePath}`)
  }

  logger.info(`Restored ${filesToCopy.length} file(s) to worktree for ${componentName}/${key}`)
}

/**
 * Find files matching a glob pattern using fast-glob
 *
 * @param {string} dir - Directory to search
 * @param {string} pattern - Glob pattern (supports ** and *)
 * @returns {string[]} Array of relative paths matching the pattern
 */
function findFilesMatchingPattern (dir, pattern) {
  if (!fs.existsSync(dir)) {
    return []
  }

  return globSync(pattern, {
    cwd: dir,
    onlyFiles: true,
    dot: true,
  })
}

/**
 * Generate worktree folder name (copied from collector extension)
 * This ensures we create worktrees with the same naming convention the collector uses
 *
 * @param {object} origin - Origin object with url, gitdir, refname, worktree properties
 * @param {boolean} keepWorktrees - Whether to keep worktrees between runs
 * @returns {string} Worktree folder name
 */
function generateWorktreeFolderName ({ url, gitdir, refname, worktree }, keepWorktrees = true) {
  const refnameQualifier = keepWorktrees ? '@' + refname.replace(/[/]/g, '-') : undefined
  if (worktree === undefined) {
    const folderName = path.basename(gitdir, '.git')
    if (!refnameQualifier) return folderName
    const lastHyphenIdx = folderName.lastIndexOf('-')
    return `${folderName.slice(0, lastHyphenIdx)}${refnameQualifier}${folderName.slice(lastHyphenIdx)}`
  }
  let normalizedUrl = (url || gitdir).toLowerCase()
  if (posixify) normalizedUrl = posixify(normalizedUrl)
  normalizedUrl = normalizedUrl.replace(/(?:[/]?\.git|[/])$/, '')
  const slug = path.basename(normalizedUrl) + (refnameQualifier || '')
  const hash = crypto.createHash('sha1').update(normalizedUrl).digest('hex')
  return `${slug}-${hash}`
}
