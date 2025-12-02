'use strict'

const fs = require('fs')
const path = require('path')
const { globSync } = require('fast-glob')

/**
 * Recursively check if directory contains any files
 *
 * @param {string} dirPath - Directory path to check
 * @returns {boolean} True if directory contains at least one file
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
 * Check if output directory exists and contains files
 *
 * @param {string} outputPath - Path to output directory
 * @param {object} [logger] - Optional logger instance
 * @returns {boolean} True if directory exists and contains files
 */
function checkOutputsExist (outputPath, logger) {
  if (!fs.existsSync(outputPath)) {
    if (logger) logger.debug(`Output directory does not exist: ${outputPath}`)
    return false
  }

  try {
    const stat = fs.statSync(outputPath)
    if (!stat.isDirectory()) {
      if (logger) logger.debug(`Output path is not a directory: ${outputPath}`)
      return false
    }

    const hasFiles = checkDirectoryHasFiles(outputPath)
    if (!hasFiles) {
      if (logger) logger.debug(`Output directory is empty: ${outputPath}`)
      return false
    }

    return true
  } catch (error) {
    if (logger) logger.debug(`Error checking output directory ${outputPath}: ${error.message}`)
    return false
  }
}

/**
 * Recursively copy directory contents
 *
 * @param {string} source - Source directory path
 * @param {string} destination - Destination directory path
 * @param {object} [logger] - Optional logger instance
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

  if (logger) logger.debug(`Copied directory from ${source} to ${destination}`)
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

module.exports = {
  checkDirectoryHasFiles,
  checkOutputsExist,
  copyDirectory,
  findFilesMatchingPattern,
}
