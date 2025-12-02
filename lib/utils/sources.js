'use strict'

/**
 * Resolve source files by running sourceCommands and combining with static sources
 *
 * @param {string} worktree - Path to the worktree directory
 * @param {string[]} staticSources - Array of static source file paths
 * @param {string[]} sourceCommands - Array of shell commands that output source paths
 * @param {object} [logger] - Optional logger instance
 * @param {string} [componentName] - Optional component name for logging
 * @param {string} [key] - Optional entry key for logging
 * @returns {Promise<string[]>} Array of resolved source file paths
 */
async function resolveSources (worktree, staticSources, sourceCommands, logger, componentName, key) {
  const sourcesSet = new Set(staticSources)

  // If no sourceCommands, just return static sources
  if (!sourceCommands || !Array.isArray(sourceCommands) || sourceCommands.length === 0) {
    return Array.from(sourcesSet)
  }

  if (logger && componentName && key) {
    logger.debug(`Resolving dynamic sources for ${componentName}/${key}`)
  }

  const { spawn } = require('child_process')

  for (const command of sourceCommands) {
    try {
      if (logger) logger.debug(`  Running: ${command}`)

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

      if (logger) logger.debug(`  Found ${paths.length} source(s)`)
      paths.forEach((p) => sourcesSet.add(p.trim()))
    } catch (err) {
      if (logger) {
        logger.warn(`Failed to run sourceCommand "${command}" for ${componentName}/${key}: ${err.message}`)
      }
    }
  }

  const resolvedSources = Array.from(sourcesSet)
  if (logger && componentName && key) {
    logger.debug(`Total sources for ${componentName}/${key}: ${resolvedSources.length}`)
  }

  return resolvedSources
}

/**
 * Resolve sources from dependencies recursively
 *
 * @param {Map} entriesMap - Map of key -> entry config for looking up dependencies
 * @param {string[]} dependsOn - Array of dependency keys
 * @param {Set} visited - Set of visited keys to detect circular dependencies
 * @param {object} [logger] - Optional logger instance
 * @param {string} [componentName] - Optional component name for logging
 * @param {string} [key] - Optional current entry key for logging
 * @returns {object} Object with sources and sourceCommands arrays from all dependencies
 */
function resolveDependencySources (entriesMap, dependsOn, visited, logger, componentName, key) {
  const allSources = []
  const allSourceCommands = []

  if (!dependsOn || !Array.isArray(dependsOn) || dependsOn.length === 0) {
    return { sources: allSources, sourceCommands: allSourceCommands }
  }

  if (logger && componentName && key) {
    logger.debug(`Resolving dependencies for ${componentName}/${key}: ${dependsOn.join(', ')}`)
  }

  for (const depKey of dependsOn) {
    // Check for circular dependency
    if (visited.has(depKey)) {
      if (logger) logger.warn(`Circular dependency detected: ${key} -> ${depKey}`)
      continue
    }

    // Find the dependency entry
    const depEntry = entriesMap.get(depKey)
    if (!depEntry) {
      if (logger) logger.warn(`Dependency not found: ${depKey} (required by ${key})`)
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

  if (logger && componentName && key) {
    logger.debug(`Resolved ${allSources.length} sources and ${allSourceCommands.length} sourceCommands from dependencies`)
  }

  return { sources: allSources, sourceCommands: allSourceCommands }
}

/**
 * Build entries map for dependency resolution from config entries
 *
 * @param {object[]} entries - Array of entry configurations
 * @returns {Map} Map of key -> entry config
 */
function buildEntriesMap (entries) {
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
  return entriesMap
}

module.exports = {
  resolveSources,
  resolveDependencySources,
  buildEntriesMap,
}