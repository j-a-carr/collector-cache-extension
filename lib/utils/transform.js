'use strict'

const picomatch = require('picomatch')

/**
 * Compile hash transforms configuration for efficient repeated use
 *
 * @param {Array} transforms - Array of transform configurations
 * @param {object} [logger] - Optional logger instance
 * @returns {Array} Compiled transforms with picomatch matchers and RegExp objects
 */
function compileTransforms (transforms, logger) {
  if (!transforms || !Array.isArray(transforms) || transforms.length === 0) {
    return []
  }

  const compiled = []

  for (const transform of transforms) {
    if (!transform.pattern || !transform.replace || !Array.isArray(transform.replace)) {
      if (logger) {
        logger.warn('Skipping invalid transform: missing pattern or replace array')
      }
      continue
    }

    const matcher = picomatch(transform.pattern)
    const replacements = []

    for (const replacement of transform.replace) {
      if (!replacement.regex || replacement.with === undefined) {
        if (logger) {
          logger.warn(`Skipping invalid replacement in pattern "${transform.pattern}": missing regex or with`)
        }
        continue
      }

      try {
        const flags = replacement.flags || 'g'
        const regex = new RegExp(replacement.regex, flags)
        replacements.push({
          regex,
          with: replacement.with,
        })
      } catch (err) {
        if (logger) {
          logger.warn(`Skipping invalid regex "${replacement.regex}" in pattern "${transform.pattern}": ${err.message}`)
        }
      }
    }

    if (replacements.length > 0) {
      compiled.push({
        matcher,
        pattern: transform.pattern,
        replacements,
      })
    }
  }

  return compiled
}

/**
 * Apply transforms to file content for hashing
 *
 * @param {string} source - Relative file path
 * @param {Buffer} content - Original file content
 * @param {Array} compiledTransforms - Pre-compiled transforms from compileTransforms()
 * @param {object} [logger] - Optional logger instance
 * @returns {Buffer|string} Transformed content (or original if no transforms match)
 */
function applyTransforms (source, content, compiledTransforms, logger) {
  if (!compiledTransforms || compiledTransforms.length === 0) {
    return content
  }

  // Find all matching transforms
  const matchingTransforms = compiledTransforms.filter((t) => t.matcher(source))

  if (matchingTransforms.length === 0) {
    return content
  }

  // Convert Buffer to string for transformation
  let transformed = content.toString('utf8')
  let transformApplied = false

  for (const transform of matchingTransforms) {
    for (const replacement of transform.replacements) {
      const before = transformed
      transformed = transformed.replace(replacement.regex, replacement.with)
      if (transformed !== before) {
        transformApplied = true
      }
    }
  }

  if (transformApplied && logger) {
    logger.debug(`Applied hash transforms to: ${source}`)
  }

  return transformApplied ? transformed : content
}

module.exports = {
  compileTransforms,
  applyTransforms,
}
