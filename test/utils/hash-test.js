/* eslint-env mocha */
'use strict'

const { expect, cleanDir } = require('../harness')
const fs = require('fs')
const os = require('os')
const ospath = require('node:path')
const proxyquire = require('proxyquire')
const { computeHashes, computeContentHash, computeHash, computeOutputHash } = require('../../lib/utils/hash')
const { compileTransforms } = require('../../lib/utils/transform')

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

    it('should apply transforms before hashing', () => {
      const transforms = compileTransforms([
        { pattern: '**/*.xml', replace: [{ regex: '<version>[^<]+</version>', with: '<version>NORMALIZED</version>' }] },
      ])
      fs.writeFileSync(ospath.join(workDir, 'pom.xml'), '<version>1.0.0</version>', 'utf8')
      fs.writeFileSync(ospath.join(workDir, 'pom2.xml'), '<version>2.0.0</version>', 'utf8')

      const hashes = computeHashes(workDir, ['pom.xml', 'pom2.xml'], null, null, null, transforms)

      // Both files should have the same hash since transforms normalize the version
      expect(hashes['pom.xml']).to.equal(hashes['pom2.xml'])
    })

    it('should produce different hash without transforms', () => {
      fs.writeFileSync(ospath.join(workDir, 'pom.xml'), '<version>1.0.0</version>', 'utf8')
      fs.writeFileSync(ospath.join(workDir, 'pom2.xml'), '<version>2.0.0</version>', 'utf8')

      const hashes = computeHashes(workDir, ['pom.xml', 'pom2.xml'])

      // Without transforms, the hashes should differ
      expect(hashes['pom.xml']).to.not.equal(hashes['pom2.xml'])
    })

    it('should work without transforms parameter', () => {
      fs.writeFileSync(ospath.join(workDir, 'test.txt'), 'content', 'utf8')
      const hashes = computeHashes(workDir, ['test.txt'])
      expect(hashes['test.txt']).to.have.lengthOf(64)
    })

    it('should work with null transforms parameter', () => {
      fs.writeFileSync(ospath.join(workDir, 'test.txt'), 'content', 'utf8')
      const hashes = computeHashes(workDir, ['test.txt'], null, null, null, null)
      expect(hashes['test.txt']).to.have.lengthOf(64)
    })

    it('should work with empty transforms array', () => {
      fs.writeFileSync(ospath.join(workDir, 'test.txt'), 'content', 'utf8')
      const hashes = computeHashes(workDir, ['test.txt'], null, null, null, [])
      expect(hashes['test.txt']).to.have.lengthOf(64)
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

  describe('computeOutputHash', () => {
    it('should compute hash for directory with single file', () => {
      fs.writeFileSync(ospath.join(workDir, 'output.txt'), 'content', 'utf8')
      const result = computeOutputHash(workDir)
      expect(result.hash).to.have.lengthOf(64)
      expect(result.files).to.have.property('output.txt')
      expect(result.files['output.txt']).to.have.lengthOf(64)
    })

    it('should produce consistent hash regardless of file creation order', () => {
      fs.writeFileSync(ospath.join(workDir, 'b.txt'), 'b content', 'utf8')
      fs.writeFileSync(ospath.join(workDir, 'a.txt'), 'a content', 'utf8')
      const hash1 = computeOutputHash(workDir).hash

      // Create in different order in new directory
      const workDir2 = fs.mkdtempSync(ospath.join(os.tmpdir(), 'hash-test2-'))
      fs.writeFileSync(ospath.join(workDir2, 'a.txt'), 'a content', 'utf8')
      fs.writeFileSync(ospath.join(workDir2, 'b.txt'), 'b content', 'utf8')
      const hash2 = computeOutputHash(workDir2).hash

      expect(hash1).to.equal(hash2)

      // Cleanup workDir2
      fs.rmSync(workDir2, { recursive: true })
    })

    it('should include nested files in hash', () => {
      const nestedDir = ospath.join(workDir, 'nested')
      fs.mkdirSync(nestedDir)
      fs.writeFileSync(ospath.join(nestedDir, 'deep.txt'), 'deep content', 'utf8')
      fs.writeFileSync(ospath.join(workDir, 'root.txt'), 'root content', 'utf8')
      const result = computeOutputHash(workDir)
      expect(result.files).to.have.property('nested/deep.txt')
      expect(result.files).to.have.property('root.txt')
    })

    it('should skip symlinks', () => {
      fs.writeFileSync(ospath.join(workDir, 'real.txt'), 'content', 'utf8')
      fs.symlinkSync(ospath.join(workDir, 'real.txt'), ospath.join(workDir, 'link.txt'))
      const result = computeOutputHash(workDir)
      expect(Object.keys(result.files)).to.have.lengthOf(1)
      expect(result.files).to.have.property('real.txt')
      expect(result.files).to.not.have.property('link.txt')
    })

    it('should handle empty directory', () => {
      const result = computeOutputHash(workDir)
      expect(result.hash).to.have.lengthOf(64)
      expect(Object.keys(result.files)).to.have.lengthOf(0)
    })

    it('should produce different hashes for different content', () => {
      fs.writeFileSync(ospath.join(workDir, 'file.txt'), 'content A', 'utf8')
      const hash1 = computeOutputHash(workDir).hash

      fs.writeFileSync(ospath.join(workDir, 'file.txt'), 'content B', 'utf8')
      const hash2 = computeOutputHash(workDir).hash

      expect(hash1).to.not.equal(hash2)
    })

    it('should log when logger is provided', () => {
      const messages = []
      const logger = { debug: (msg) => messages.push(msg) }
      fs.writeFileSync(ospath.join(workDir, 'file.txt'), 'content', 'utf8')

      computeOutputHash(workDir, logger)

      expect(messages.some((m) => m.includes('Computing output hash for 1 file(s)'))).to.be.true()
    })

    it('should use entry.path fallback when parentPath is not available (older Node)', () => {
      // Create actual file for content reading
      fs.writeFileSync(ospath.join(workDir, 'file.txt'), 'content', 'utf8')

      // Mock fs.readdirSync to return entries with only 'path' (no parentPath)
      // This simulates Node 18.17.0 - 20.11.x behavior
      const mockFs = {
        ...fs,
        readdirSync: (dir, options) => {
          if (options && options.recursive) {
            return [
              {
                name: 'file.txt',
                path: workDir, // Only path, no parentPath (older Node)
                isFile: () => true,
              },
            ]
          }
          return fs.readdirSync(dir, options)
        },
      }

      const { computeOutputHash: mockedComputeOutputHash } = proxyquire('../../lib/utils/hash', {
        fs: mockFs,
      })

      const result = mockedComputeOutputHash(workDir)
      expect(result.hash).to.have.lengthOf(64)
      expect(result.files).to.have.property('file.txt')
    })
  })
})
