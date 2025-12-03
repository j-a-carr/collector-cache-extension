/* eslint-env mocha */
'use strict'

const { expect, cleanDir } = require('../harness')
const fs = require('fs')
const os = require('os')
const ospath = require('node:path')
const { loadPointerFile, savePointerFile, restoreFilesToWorktree } = require('../../lib/utils/cache')

describe('utils/cache', () => {
  let workDir

  beforeEach(() => {
    workDir = fs.mkdtempSync(ospath.join(os.tmpdir(), 'cache-test-'))
  })

  afterEach(async () => {
    await cleanDir(workDir)
  })

  describe('loadPointerFile', () => {
    it('should load valid JSON pointer file', () => {
      const pointerPath = ospath.join(workDir, 'pointer.json')
      const pointer = { outputDir: 'abc123', sources: {} }
      fs.writeFileSync(pointerPath, JSON.stringify(pointer), 'utf8')

      const result = loadPointerFile(pointerPath)
      expect(result).to.deep.equal(pointer)
    })

    it('should return null for non-existent file', () => {
      const result = loadPointerFile(ospath.join(workDir, 'nonexistent.json'))
      expect(result).to.be.null()
    })

    it('should return null for non-existent file with logger', () => {
      const messages = []
      const logger = { debug: (msg) => messages.push(msg) }

      const result = loadPointerFile(ospath.join(workDir, 'nonexistent.json'), logger)
      expect(result).to.be.null()
      expect(messages.some((m) => m.includes('No pointer file'))).to.be.true()
    })

    it('should return null for invalid JSON without logger', () => {
      const pointerPath = ospath.join(workDir, 'invalid.json')
      fs.writeFileSync(pointerPath, 'not valid json', 'utf8')

      const result = loadPointerFile(pointerPath)
      expect(result).to.be.null()
    })

    it('should return null and warn for invalid JSON with logger', () => {
      const pointerPath = ospath.join(workDir, 'invalid.json')
      fs.writeFileSync(pointerPath, 'not valid json', 'utf8')

      const messages = []
      const logger = { warn: (msg) => messages.push(msg) }

      const result = loadPointerFile(pointerPath, logger)
      expect(result).to.be.null()
      expect(messages.some((m) => m.includes('Failed to read'))).to.be.true()
    })
  })

  describe('savePointerFile', () => {
    it('should save pointer file to disk', () => {
      const pointerPath = ospath.join(workDir, 'pointer.json')
      const pointer = { outputDir: 'abc123', sources: {} }

      savePointerFile(pointerPath, pointer)

      expect(fs.existsSync(pointerPath)).to.be.true()
      const content = JSON.parse(fs.readFileSync(pointerPath, 'utf8'))
      expect(content).to.deep.equal(pointer)
    })

    it('should create parent directories if needed', () => {
      const pointerPath = ospath.join(workDir, 'deep', 'nested', 'pointer.json')
      savePointerFile(pointerPath, { test: true })
      expect(fs.existsSync(pointerPath)).to.be.true()
    })

    it('should log when logger is provided', () => {
      const pointerPath = ospath.join(workDir, 'logged.json')
      const messages = []
      const logger = { debug: (msg) => messages.push(msg) }

      savePointerFile(pointerPath, { test: true }, logger)
      expect(messages.some((m) => m.includes('Created pointer'))).to.be.true()
    })
  })

  describe('restoreFilesToWorktree', () => {
    it('should return 0 when patterns is empty', () => {
      expect(restoreFilesToWorktree(workDir, workDir, [])).to.equal(0)
    })

    it('should return 0 when patterns is null', () => {
      expect(restoreFilesToWorktree(workDir, workDir, null)).to.equal(0)
    })

    it('should return 0 when patterns is not an array', () => {
      expect(restoreFilesToWorktree(workDir, workDir, 'not-array')).to.equal(0)
    })

    it('should copy matching files without logger', () => {
      const cacheDir = ospath.join(workDir, 'cache')
      const worktreeDir = ospath.join(workDir, 'worktree')
      fs.mkdirSync(cacheDir)
      fs.mkdirSync(worktreeDir)
      fs.writeFileSync(ospath.join(cacheDir, 'test.txt'), 'content', 'utf8')

      const count = restoreFilesToWorktree(cacheDir, worktreeDir, ['*.txt'])
      expect(count).to.equal(1)
      expect(fs.existsSync(ospath.join(worktreeDir, 'test.txt'))).to.be.true()
    })

    it('should copy matching files with logger but without component info', () => {
      const cacheDir = ospath.join(workDir, 'cache')
      const worktreeDir = ospath.join(workDir, 'worktree')
      fs.mkdirSync(cacheDir)
      fs.mkdirSync(worktreeDir)
      fs.writeFileSync(ospath.join(cacheDir, 'test.txt'), 'content', 'utf8')

      const messages = []
      const logger = {
        debug: (msg) => messages.push({ level: 'debug', msg }),
        info: (msg) => messages.push({ level: 'info', msg }),
      }

      const count = restoreFilesToWorktree(cacheDir, worktreeDir, ['*.txt'], logger)
      expect(count).to.equal(1)
      expect(messages.some((m) => m.msg.includes('Pattern'))).to.be.true()
      expect(messages.some((m) => m.msg.includes('Restored:'))).to.be.true()
    })

    it('should copy matching files with full logging', () => {
      const cacheDir = ospath.join(workDir, 'cache')
      const worktreeDir = ospath.join(workDir, 'worktree')
      fs.mkdirSync(cacheDir)
      fs.mkdirSync(worktreeDir)
      fs.writeFileSync(ospath.join(cacheDir, 'test.txt'), 'content', 'utf8')

      const messages = []
      const logger = {
        debug: (msg) => messages.push({ level: 'debug', msg }),
        info: (msg) => messages.push({ level: 'info', msg }),
      }

      const count = restoreFilesToWorktree(cacheDir, worktreeDir, ['*.txt'], logger, 'comp', 'key')
      expect(count).to.equal(1)
      expect(messages.some((m) => m.msg.includes('Restoring files to worktree'))).to.be.true()
      expect(messages.some((m) => m.level === 'info' && m.msg.includes('Restored 1 file'))).to.be.true()
    })

    it('should create nested destination directories', () => {
      const cacheDir = ospath.join(workDir, 'cache')
      const nestedDir = ospath.join(cacheDir, 'nested', 'deep')
      const worktreeDir = ospath.join(workDir, 'worktree')
      fs.mkdirSync(nestedDir, { recursive: true })
      fs.mkdirSync(worktreeDir)
      fs.writeFileSync(ospath.join(nestedDir, 'file.txt'), 'content', 'utf8')

      const count = restoreFilesToWorktree(cacheDir, worktreeDir, ['**/*.txt'])
      expect(count).to.equal(1)
      expect(fs.existsSync(ospath.join(worktreeDir, 'nested', 'deep', 'file.txt'))).to.be.true()
    })
  })
})
