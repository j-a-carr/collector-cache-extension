'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { applyTransforms } = require('./transform')

/**
 * Compute SHA-256 hashes for source files
 *
 * @param {string} worktree - Path to the worktree directory
 * @param {string[]} sources - Array of relative source file paths
 * @param {object} [logger] - Optional logger instance
 * @param {string} [componentName] - Optional component name for logging
 * @param {string} [key] - Optional entry key for logging
 * @param {Array} [compiledTransforms] - Optional compiled transforms to apply before hashing
 * @returns {object|null} Object mapping source paths to their hashes, or null if any source is missing
 */
function computeHashes (worktree, sources, logger, componentName, key, compiledTransforms) {
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

    let content = fs.readFileSync(filePath)

    // Apply transforms if configured
    if (compiledTransforms && compiledTransforms.length > 0) {
      content = applyTransforms(source, content, compiledTransforms, logger)
    }

    const hash = crypto.createHash('sha256').update(content).digest('hex')
    hashes[source] = hash

    if (logger && componentName && key) {
      logger.debug(`  ✓ Found: ${source} (${hash.substring(0, 12)}...)`)
    }
  }

  return hashes
}

/**
 * Compute content hash from source file hashes and command
 *
 * @param {object} sourceHashes - Object mapping source paths to their hashes
 * @param {string} [command] - Optional command string to include in hash
 * @returns {string} SHA-256 hash of combined source hashes and command
 */
function computeContentHash (sourceHashes, command) {
  // Sort keys for consistent ordering
  const sortedKeys = Object.keys(sourceHashes).sort()

  // Concatenate hashes in sorted order
  let combined = sortedKeys.map((key) => sourceHashes[key]).join('')

  // Include command in hash if provided (important: different commands = different outputs)
  if (command) {
    combined += command
  }

  // Hash the combined string
  return crypto.createHash('sha256').update(combined).digest('hex')
}

/**
 * Compute SHA-256 hash of a string or buffer
 *
 * @param {string|Buffer} content - Content to hash
 * @returns {string} SHA-256 hash as hex string
 */
function computeHash (content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

/**
 * Compute SHA-256 hash of all files in an output directory
 *
 * @param {string} outputDir - Path to the output directory
 * @param {object} [logger] - Optional logger instance
 * @returns {{ hash: string, files: object }} Combined hash and per-file hashes
 */
function computeOutputHash (outputDir, logger) {
  const files = {}

  // Recursively enumerate all files
  const entries = fs.readdirSync(outputDir, { withFileTypes: true, recursive: true })

  // Filter to regular files only (skip symlinks, directories)
  const fileEntries = entries.filter((entry) => entry.isFile())

  // Build relative paths and sort alphabetically for deterministic ordering
  // Note: entry.path is available in Node 18.17.0+ (required for recursive: true)
  // entry.parentPath was added in Node 20.12.0/18.20.0 as a preferred alias
  const relativePaths = fileEntries
    .map((entry) => {
      const parentPath = entry.parentPath || entry.path
      return path.relative(outputDir, path.join(parentPath, entry.name))
    })
    .sort()

  if (logger) {
    logger.debug(`Computing output hash for ${relativePaths.length} file(s) in ${outputDir}`)
  }

  // Compute hash for each file
  for (const relativePath of relativePaths) {
    const filePath = path.join(outputDir, relativePath)
    const content = fs.readFileSync(filePath)
    const hash = crypto.createHash('sha256').update(content).digest('hex')
    files[relativePath] = hash
  }

  // Concatenate all hashes in sorted order and compute combined hash
  const combined = relativePaths.map((p) => files[p]).join('')
  const hash = crypto.createHash('sha256').update(combined).digest('hex')

  return { hash, files }
}

module.exports = {
  computeHashes,
  computeContentHash,
  computeHash,
  computeOutputHash,
}
