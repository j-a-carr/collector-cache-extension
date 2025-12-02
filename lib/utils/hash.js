'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

/**
 * Compute SHA-256 hashes for source files
 *
 * @param {string} worktree - Path to the worktree directory
 * @param {string[]} sources - Array of relative source file paths
 * @param {object} [logger] - Optional logger instance
 * @param {string} [componentName] - Optional component name for logging
 * @param {string} [key] - Optional entry key for logging
 * @returns {object|null} Object mapping source paths to their hashes, or null if any source is missing
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
 *
 * @param {object} sourceHashes - Object mapping source paths to their hashes
 * @returns {string} SHA-256 hash of combined source hashes
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
 * Compute SHA-256 hash of a string or buffer
 *
 * @param {string|Buffer} content - Content to hash
 * @returns {string} SHA-256 hash as hex string
 */
function computeHash (content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

module.exports = {
  computeHashes,
  computeContentHash,
  computeHash,
}