/* eslint-env mocha */
'use strict'

const { expect, cleanDir } = require('../harness')
const fs = require('fs')
const os = require('os')
const ospath = require('node:path')
const { computeHashes, computeContentHash, computeHash } = require('../../lib/utils/hash')

describe('utils/hash', () => {
  let workDir

  beforeEach(() => {
    workDir = fs.mkdtempSync(ospath.join(os.tmpdir(), 'hash-test-'))
  })

  afterEach(async () => {
    await cleanDir(workDir)
  })

  describe('computeHashes', () => {
    it('should compute hashes for existing files', () => {
      fs.writeFileSync(ospath.join(workDir, 'test.txt'), 'hello world', 'utf8')
      const hashes = computeHashes(workDir, ['test.txt'])
      expect(hashes).to.be.an('object')
      expect(hashes['test.txt']).to.have.lengthOf(64)
    })

    it('should return null when file is missing', () => {
      const hashes = computeHashes(workDir, ['nonexistent.txt'])
      expect(hashes).to.be.null()
    })

    it('should log when listing worktree contents fails', () => {
      const messages = []
      const logger = { debug: (msg) => messages.push(msg) }
      const fakeWorktree = ospath.join(workDir, 'nonexistent-worktree')

      computeHashes(fakeWorktree, ['test.txt'], logger, 'comp', 'key')

      expect(messages.some((m) => m.includes('Failed to list worktree contents'))).to.be.true()
    })

    it('should log worktree contents when source file is missing', () => {
      const messages = []
      const logger = { debug: (msg) => messages.push(msg) }
      fs.writeFileSync(ospath.join(workDir, 'existing.txt'), 'content', 'utf8')
      const nestedDir = ospath.join(workDir, 'subdir')
      fs.mkdirSync(nestedDir)

      const result = computeHashes(workDir, ['nonexistent.txt'], logger, 'comp', 'key')

      expect(result).to.be.null()
      expect(messages.some((m) => m.includes('Missing:'))).to.be.true()
      expect(messages.some((m) => m.includes('Worktree contains:'))).to.be.true()
      expect(messages.some((m) => m.includes('existing.txt'))).to.be.true()
      expect(messages.some((m) => m.includes('subdir/'))).to.be.true()
    })

    it('should log found files with hash prefix', () => {
      const messages = []
      const logger = { debug: (msg) => messages.push(msg) }
      fs.writeFileSync(ospath.join(workDir, 'test.txt'), 'hello world', 'utf8')

      const hashes = computeHashes(workDir, ['test.txt'], logger, 'comp', 'key')

      expect(hashes).to.be.an('object')
      expect(messages.some((m) => m.includes('Found: test.txt'))).to.be.true()
      expect(messages.some((m) => m.includes('...'))).to.be.true()
    })
  })

  describe('computeContentHash', () => {
    it('should compute consistent hash from source hashes', () => {
      const sourceHashes = { 'file1.txt': 'abc123', 'file2.txt': 'def456' }
      const hash1 = computeContentHash(sourceHashes)
      const hash2 = computeContentHash(sourceHashes)
      expect(hash1).to.equal(hash2)
      expect(hash1).to.have.lengthOf(64)
    })
  })

  describe('computeHash', () => {
    it('should compute hash of a string', () => {
      const hash = computeHash('hello world')
      expect(hash).to.have.lengthOf(64)
    })

    it('should compute hash of a buffer', () => {
      const hash = computeHash(Buffer.from('hello world'))
      expect(hash).to.have.lengthOf(64)
    })

    it('should produce consistent hashes', () => {
      const hash1 = computeHash('test')
      const hash2 = computeHash('test')
      expect(hash1).to.equal(hash2)
    })

    it('should produce different hashes for different inputs', () => {
      const hash1 = computeHash('abc')
      const hash2 = computeHash('def')
      expect(hash1).to.not.equal(hash2)
    })
  })
})