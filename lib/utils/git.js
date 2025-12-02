'use strict'

const path = require('path')
const crypto = require('crypto')

/**
 * Convert Windows path separators to POSIX style
 * Returns undefined on POSIX systems (no conversion needed)
 */
const posixify = path.sep === '\\' ? (p) => p.replace(/\\/g, '/') : undefined

/**
 * Generate worktree folder name (matches collector extension's algorithm)
 * This ensures we create worktrees with the same naming convention the collector uses
 *
 * @param {object} origin - Origin object with url, gitdir, refname, worktree properties
 * @param {boolean} [keepWorktrees=true] - Whether to keep worktrees between runs
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

/**
 * Check if this is a local development environment
 * Local dev: gitdir is inside worktree (e.g., worktree/.git)
 * Remote build: gitdir and worktree are in separate cache directories
 *
 * @param {string} worktree - Path to worktree directory
 * @param {string} gitdir - Path to git directory
 * @returns {boolean} True if local development environment
 */
function isLocalDevelopment (worktree, gitdir) {
  return worktree && gitdir && gitdir === path.join(worktree, '.git')
}

/**
 * Build git ref string from reftype and refname
 *
 * @param {string} reftype - Type of ref ('branch' or 'tag')
 * @param {string} refname - Name of the ref
 * @returns {string} Full ref string (e.g., 'refs/heads/main')
 */
function buildRef (reftype, refname) {
  return `refs/${reftype === 'branch' ? 'head' : reftype}s/${refname}`
}

module.exports = {
  posixify,
  generateWorktreeFolderName,
  isLocalDevelopment,
  buildRef,
}