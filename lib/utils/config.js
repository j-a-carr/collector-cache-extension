'use strict'

/**
 * Normalize object keys to camelCase, matching Antora's behavior.
 *
 * Algorithm (from @antora/content-aggregator):
 * 1. toLowerCase() - convert entire key to lowercase
 * 2. Replace _x or -x with X (camelCase conversion)
 *
 * Examples:
 *   hash_transforms -> hashTransforms
 *   hashTransforms -> hashtransforms
 *   cache_dir -> cacheDir
 *   cacheDir -> cachedir
 *
 * @param {object} obj - Object with keys to normalize
 * @param {string[]} [stopKeys=[]] - Keys to not recurse into
 * @returns {object} New object with normalized keys
 */
function camelCaseKeys (obj, stopKeys = []) {
  if (obj == null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map((item) => camelCaseKeys(item, stopKeys))

  const result = {}
  for (const key of Object.keys(obj)) {
    const camelKey = key.toLowerCase().replace(/[_-]([a-z0-9])/g, (_, char, idx) => (idx ? char.toUpperCase() : char))
    const value = obj[key]
    result[camelKey] = stopKeys.includes(camelKey) ? value : camelCaseKeys(value, stopKeys)
  }
  return result
}

module.exports = { camelCaseKeys }
