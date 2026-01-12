/* eslint-env mocha */
'use strict'

const { expect } = require('../harness')
const { camelCaseKeys } = require('../../lib/utils/config')

describe('utils/config', () => {
  describe('camelCaseKeys', () => {
    it('should convert snake_case keys to camelCase', () => {
      const input = { hash_transforms: 'value', source_commands: ['cmd'] }
      const result = camelCaseKeys(input)
      expect(result).to.deep.equal({ hashTransforms: 'value', sourceCommands: ['cmd'] })
    })

    it('should convert kebab-case keys to camelCase', () => {
      const input = { 'hash-transforms': 'value', 'depends-on': ['dep'] }
      const result = camelCaseKeys(input)
      expect(result).to.deep.equal({ hashTransforms: 'value', dependsOn: ['dep'] })
    })

    it('should lowercase already camelCase keys', () => {
      const input = { hashTransforms: 'value', cacheDir: 'dir' }
      const result = camelCaseKeys(input)
      expect(result).to.deep.equal({ hashtransforms: 'value', cachedir: 'dir' })
    })

    it('should handle nested objects', () => {
      const input = { run: { cache_dir: 'dir', source_commands: ['cmd'] } }
      const result = camelCaseKeys(input)
      expect(result).to.deep.equal({ run: { cacheDir: 'dir', sourceCommands: ['cmd'] } })
    })

    it('should handle arrays of objects', () => {
      const input = [{ hash_transforms: 'a' }, { source_commands: 'b' }]
      const result = camelCaseKeys(input)
      expect(result).to.deep.equal([{ hashTransforms: 'a' }, { sourceCommands: 'b' }])
    })

    it('should not recurse into stop keys', () => {
      const input = { asciidoc: { some_key: 'value' }, other_key: 'value' }
      const result = camelCaseKeys(input, ['asciidoc'])
      expect(result.asciidoc).to.deep.equal({ some_key: 'value' }) // Not transformed
      expect(result.otherKey).to.equal('value') // Transformed
    })

    it('should return null/undefined as-is', () => {
      expect(camelCaseKeys(null)).to.be.null()
      expect(camelCaseKeys(undefined)).to.be.undefined()
    })

    it('should return primitives as-is', () => {
      expect(camelCaseKeys('string')).to.equal('string')
      expect(camelCaseKeys(123)).to.equal(123)
      expect(camelCaseKeys(true)).to.equal(true)
    })

    it('should handle empty objects and arrays', () => {
      expect(camelCaseKeys({})).to.deep.equal({})
      expect(camelCaseKeys([])).to.deep.equal([])
    })

    it('should handle underscore at start of key', () => {
      // Edge case: underscore at position 0 - char is not uppercased
      const input = { _private: 'value' }
      const result = camelCaseKeys(input)
      // _p matches at idx 0, so 'p' stays lowercase -> 'private'
      expect(result).to.deep.equal({ private: 'value' })
    })
  })
})
