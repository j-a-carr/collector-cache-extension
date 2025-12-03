'use strict'

const fs = require('fs')
const path = require('path')
const { findFilesMatchingPattern } = require('./fs')

/**
 * Load pointer file from disk
 *
 * @param {string} pointerPath - Path to the pointer JSON file
 * @param {object} [logger] - Optional logger instance
 * @returns {object|null} Parsed pointer object or null if not found/invalid
 */
function loadPointerFile (pointerPath, logger) {
  if (!fs.existsSync(pointerPath)) {
    if (logger) logger.debug(`No pointer file: ${pointerPath}`)
    return null
  }

  try {
    const content = fs.readFileSync(pointerPath, 'utf8')
    return JSON.parse(content)
  } catch (error) {
    if (logger) logger.warn(`Failed to read pointer file ${pointerPath}: ${error.message}`)
    return null
  }
}

/**
 * Save pointer file to disk
 *
 * @param {string} pointerPath - Path to save the pointer file
 * @param {object} pointer - Pointer data to save
 * @param {object} [logger] - Optional logger instance
 */
function savePointerFile (pointerPath, pointer, logger) {
  const pointerDir = path.dirname(pointerPath)
  fs.mkdirSync(pointerDir, { recursive: true })
  fs.writeFileSync(pointerPath, JSON.stringify(pointer, null, 2), 'utf8')
  if (logger) logger.debug(`Created pointer: ${pointerPath}`)
}

/**
 * Copy files matching glob patterns from cache to worktree
 *
 * @param {string} cacheOutputDir - Source directory in cache
 * @param {string} worktreeOutputDir - Destination directory in worktree
 * @param {string[]} patterns - Array of glob patterns to match
 * @param {object} [logger] - Optional logger instance
 * @param {string} [componentName] - Optional component name for logging
 * @param {string} [key] - Optional entry key for logging
 * @returns {number} Number of files restored
 */
function restoreFilesToWorktree (cacheOutputDir, worktreeOutputDir, patterns, logger, componentName, key) {
  if (!patterns || !Array.isArray(patterns) || patterns.length === 0) {
    return 0
  }

  if (logger && componentName && key) {
    logger.debug(`Restoring files to worktree for ${componentName}/${key}`)
  }

  // Find all files matching patterns
  const filesToCopy = []

  for (const pattern of patterns) {
    const matches = findFilesMatchingPattern(cacheOutputDir, pattern)
    if (logger) logger.debug(`  Pattern "${pattern}" matched ${matches.length} file(s)`)
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
    if (logger) logger.debug(`  Restored: ${relativePath}`)
  }

  if (logger && componentName && key) {
    logger.info(`Restored ${filesToCopy.length} file(s) to worktree for ${componentName}/${key}`)
  }

  return filesToCopy.length
}

module.exports = {
  loadPointerFile,
  savePointerFile,
  restoreFilesToWorktree,
}
