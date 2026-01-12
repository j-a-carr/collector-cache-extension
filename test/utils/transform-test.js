/* eslint-env mocha */
'use strict'

const { expect } = require('../harness')
const { compileTransforms, applyTransforms } = require('../../lib/utils/transform')

describe('utils/transform', () => {
  describe('compileTransforms', () => {
    it('should return empty array for null input', () => {
      const result = compileTransforms(null)
      expect(result).to.be.an('array').that.is.empty()
    })

    it('should return empty array for undefined input', () => {
      const result = compileTransforms(undefined)
      expect(result).to.be.an('array').that.is.empty()
    })

    it('should return empty array for empty array input', () => {
      const result = compileTransforms([])
      expect(result).to.be.an('array').that.is.empty()
    })

    it('should compile valid transforms', () => {
      const transforms = [
        {
          pattern: '**/pom.xml',
          replace: [{ regex: '<version>[^<]+</version>', with: '<version>NORMALIZED</version>' }],
        },
      ]
      const result = compileTransforms(transforms)
      expect(result).to.have.lengthOf(1)
      expect(result[0]).to.have.property('matcher')
      expect(result[0]).to.have.property('pattern', '**/pom.xml')
      expect(result[0].replacements).to.have.lengthOf(1)
      expect(result[0].replacements[0].regex).to.be.instanceOf(RegExp)
    })

    it('should skip transform with missing pattern', () => {
      const messages = []
      const logger = { warn: (msg) => messages.push(msg) }
      const transforms = [{ replace: [{ regex: 'test', with: 'replaced' }] }]
      const result = compileTransforms(transforms, logger)
      expect(result).to.be.an('array').that.is.empty()
      expect(messages.some((m) => m.includes('missing pattern'))).to.be.true()
    })

    it('should skip transform with missing pattern without logger', () => {
      const transforms = [{ replace: [{ regex: 'test', with: 'replaced' }] }]
      const result = compileTransforms(transforms)
      expect(result).to.be.an('array').that.is.empty()
    })

    it('should skip transform with missing replace array', () => {
      const messages = []
      const logger = { warn: (msg) => messages.push(msg) }
      const transforms = [{ pattern: '**/*.xml' }]
      const result = compileTransforms(transforms, logger)
      expect(result).to.be.an('array').that.is.empty()
      expect(messages.some((m) => m.includes('missing pattern or replace'))).to.be.true()
    })

    it('should skip replacement with missing regex', () => {
      const messages = []
      const logger = { warn: (msg) => messages.push(msg) }
      const transforms = [{ pattern: '**/*.xml', replace: [{ with: 'replaced' }] }]
      const result = compileTransforms(transforms, logger)
      expect(result).to.be.an('array').that.is.empty()
      expect(messages.some((m) => m.includes('missing regex or with'))).to.be.true()
    })

    it('should skip replacement with missing regex without logger', () => {
      const transforms = [{ pattern: '**/*.xml', replace: [{ with: 'replaced' }] }]
      const result = compileTransforms(transforms)
      expect(result).to.be.an('array').that.is.empty()
    })

    it('should skip replacement with missing with', () => {
      const messages = []
      const logger = { warn: (msg) => messages.push(msg) }
      const transforms = [{ pattern: '**/*.xml', replace: [{ regex: 'test' }] }]
      const result = compileTransforms(transforms, logger)
      expect(result).to.be.an('array').that.is.empty()
      expect(messages.some((m) => m.includes('missing regex or with'))).to.be.true()
    })

    it('should allow empty string for with', () => {
      const transforms = [{ pattern: '**/*.xml', replace: [{ regex: 'remove-me', with: '' }] }]
      const result = compileTransforms(transforms)
      expect(result).to.have.lengthOf(1)
      expect(result[0].replacements[0].with).to.equal('')
    })

    it('should warn and skip invalid regex patterns', () => {
      const messages = []
      const logger = { warn: (msg) => messages.push(msg) }
      const transforms = [{ pattern: '**/*.xml', replace: [{ regex: '[invalid', with: 'replaced' }] }]
      const result = compileTransforms(transforms, logger)
      expect(result).to.be.an('array').that.is.empty()
      expect(messages.some((m) => m.includes('invalid regex'))).to.be.true()
    })

    it('should skip invalid regex patterns without logger', () => {
      const transforms = [{ pattern: '**/*.xml', replace: [{ regex: '[invalid', with: 'replaced' }] }]
      const result = compileTransforms(transforms)
      expect(result).to.be.an('array').that.is.empty()
    })

    it('should use default "g" flag when not specified', () => {
      const transforms = [{ pattern: '**/*.xml', replace: [{ regex: 'test', with: 'replaced' }] }]
      const result = compileTransforms(transforms)
      expect(result[0].replacements[0].regex.flags).to.equal('g')
    })

    it('should use specified flags', () => {
      const transforms = [{ pattern: '**/*.xml', replace: [{ regex: 'test', with: 'replaced', flags: 'gi' }] }]
      const result = compileTransforms(transforms)
      expect(result[0].replacements[0].regex.flags).to.equal('gi')
    })

    it('should compile multiple transforms', () => {
      const transforms = [
        { pattern: '**/pom.xml', replace: [{ regex: 'version', with: 'NORMALIZED' }] },
        { pattern: '**/*.properties', replace: [{ regex: 'value', with: 'NORMALIZED' }] },
      ]
      const result = compileTransforms(transforms)
      expect(result).to.have.lengthOf(2)
    })

    it('should compile multiple replacements per transform', () => {
      const transforms = [
        {
          pattern: '**/pom.xml',
          replace: [
            { regex: 'pattern1', with: 'replaced1' },
            { regex: 'pattern2', with: 'replaced2' },
          ],
        },
      ]
      const result = compileTransforms(transforms)
      expect(result[0].replacements).to.have.lengthOf(2)
    })
  })

  describe('applyTransforms', () => {
    it('should return original content when no transforms provided', () => {
      const content = Buffer.from('original content')
      const result = applyTransforms('file.txt', content, null)
      expect(result.content).to.equal(content)
      expect(result.transformed).to.be.false()
    })

    it('should return original content when transforms array is empty', () => {
      const content = Buffer.from('original content')
      const result = applyTransforms('file.txt', content, [])
      expect(result.content).to.equal(content)
      expect(result.transformed).to.be.false()
    })

    it('should return original content when no transforms match', () => {
      const transforms = compileTransforms([{ pattern: '**/pom.xml', replace: [{ regex: 'test', with: 'replaced' }] }])
      const content = Buffer.from('original content')
      const result = applyTransforms('file.txt', content, transforms)
      expect(result.content).to.equal(content)
      expect(result.transformed).to.be.false()
    })

    it('should apply matching transform', () => {
      const transforms = compileTransforms([
        { pattern: '**/*.xml', replace: [{ regex: '<version>[^<]+</version>', with: '<version>NORMALIZED</version>' }] },
      ])
      const content = Buffer.from('<project><version>1.0.0</version></project>')
      const result = applyTransforms('pom.xml', content, transforms)
      expect(result.content).to.equal('<project><version>NORMALIZED</version></project>')
      expect(result.transformed).to.be.true()
    })

    it('should apply multiple replacements in order', () => {
      const transforms = compileTransforms([
        {
          pattern: '**/*.txt',
          replace: [
            { regex: 'first', with: 'FIRST' },
            { regex: 'second', with: 'SECOND' },
          ],
        },
      ])
      const content = Buffer.from('first then second')
      const result = applyTransforms('test.txt', content, transforms)
      expect(result.content).to.equal('FIRST then SECOND')
      expect(result.transformed).to.be.true()
    })

    it('should apply multiple matching transforms in order', () => {
      const transforms = compileTransforms([
        { pattern: '**/*.txt', replace: [{ regex: 'hello', with: 'HELLO' }] },
        { pattern: '**/test.txt', replace: [{ regex: 'world', with: 'WORLD' }] },
      ])
      const content = Buffer.from('hello world')
      const result = applyTransforms('test.txt', content, transforms)
      expect(result.content).to.equal('HELLO WORLD')
      expect(result.transformed).to.be.true()
    })

    it('should support capture groups ($1, $2, etc.)', () => {
      const transforms = compileTransforms([
        { pattern: '**/*.xml', replace: [{ regex: '(<version>)[^<]+(</version>)', with: '$1NORMALIZED$2' }] },
      ])
      const content = Buffer.from('<version>1.0.0</version>')
      const result = applyTransforms('pom.xml', content, transforms)
      expect(result.content).to.equal('<version>NORMALIZED</version>')
      expect(result.transformed).to.be.true()
    })

    it('should handle multiline content with appropriate regex', () => {
      const transforms = compileTransforms([
        {
          pattern: '**/pom.xml',
          replace: [{ regex: '(<parent>[\\s\\S]*?<version>)[^<]+(</version>)', with: '$1NORMALIZED$2' }],
        },
      ])
      const content = Buffer.from(`<parent>
  <groupId>com.example</groupId>
  <artifactId>parent</artifactId>
  <version>1.0.0</version>
</parent>`)
      const result = applyTransforms('pom.xml', content, transforms)
      expect(result.content).to.include('<version>NORMALIZED</version>')
      expect(result.content).to.not.include('1.0.0')
      expect(result.transformed).to.be.true()
    })

    it('should match glob patterns correctly', () => {
      const transforms = compileTransforms([{ pattern: '**/src/**/*.xml', replace: [{ regex: 'test', with: 'TEST' }] }])
      const content = Buffer.from('test content')

      // Should match
      let result = applyTransforms('src/main/file.xml', content, transforms)
      expect(result.content).to.equal('TEST content')
      expect(result.transformed).to.be.true()

      // Should not match
      result = applyTransforms('other/file.xml', content, transforms)
      expect(result.content).to.equal(content)
      expect(result.transformed).to.be.false()
    })

    it('should log when transforms are applied', () => {
      const messages = []
      const logger = { debug: (msg) => messages.push(msg) }
      const transforms = compileTransforms([{ pattern: '**/*.txt', replace: [{ regex: 'hello', with: 'HELLO' }] }])
      const content = Buffer.from('hello world')

      applyTransforms('test.txt', content, transforms, logger)

      expect(messages.some((m) => m.includes('Applied hash transforms to: test.txt'))).to.be.true()
    })

    it('should not log when no transforms are applied', () => {
      const messages = []
      const logger = { debug: (msg) => messages.push(msg) }
      const transforms = compileTransforms([{ pattern: '**/*.txt', replace: [{ regex: 'nomatch', with: 'REPLACED' }] }])
      const content = Buffer.from('hello world')

      applyTransforms('test.txt', content, transforms, logger)

      expect(messages).to.be.empty()
    })

    it('should return original buffer when regex matches but produces same content', () => {
      const transforms = compileTransforms([{ pattern: '**/*.txt', replace: [{ regex: 'hello', with: 'hello' }] }])
      const content = Buffer.from('hello world')
      const result = applyTransforms('test.txt', content, transforms)
      expect(result.content).to.equal(content)
      expect(result.transformed).to.be.false()
    })
  })
})
