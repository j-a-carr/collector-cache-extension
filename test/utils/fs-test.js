/* eslint-env mocha */
'use strict'

const { expect, cleanDir } = require('../harness')
const fs = require('fs')
const os = require('os')
const ospath = require('node:path')
const proxyquire = require('proxyquire')
const { checkDirectoryHasFiles, checkOutputsExist, copyDirectory, findFilesMatchingPattern } = require('../../lib/utils/fs')

describe('utils/fs', () => {
  let workDir

  beforeEach(() => {
    workDir = fs.mkdtempSync(ospath.join(os.tmpdir(), 'fs-test-'))
  })

  afterEach(async () => {
    await cleanDir(workDir)
  })

  describe('checkDirectoryHasFiles', () => {
    it('should return true when directory has files', () => {
      fs.writeFileSync(ospath.join(workDir, 'test.txt'), 'content', 'utf8')
      expect(checkDirectoryHasFiles(workDir)).to.be.true()
    })

    it('should return false when directory is empty', () => {
      const emptyDir = ospath.join(workDir, 'empty')
      fs.mkdirSync(emptyDir)
      expect(checkDirectoryHasFiles(emptyDir)).to.be.false()
    })

    it('should find files in nested directories', () => {
      const nestedDir = ospath.join(workDir, 'nested', 'deep')
      fs.mkdirSync(nestedDir, { recursive: true })
      fs.writeFileSync(ospath.join(nestedDir, 'file.txt'), 'content', 'utf8')
      expect(checkDirectoryHasFiles(workDir)).to.be.true()
    })

    it('should return false for nested empty directories', () => {
      const nestedDir = ospath.join(workDir, 'nested', 'deep', 'empty')
      fs.mkdirSync(nestedDir, { recursive: true })
      expect(checkDirectoryHasFiles(workDir)).to.be.false()
    })

    it('should skip symlinks when checking for files', () => {
      const targetFile = ospath.join(workDir, 'target.txt')
      fs.writeFileSync(targetFile, 'content', 'utf8')

      const subDir = ospath.join(workDir, 'sub')
      fs.mkdirSync(subDir)
      fs.symlinkSync(targetFile, ospath.join(subDir, 'link.txt'))

      // subDir only contains a symlink, no actual files
      expect(checkDirectoryHasFiles(subDir)).to.be.false()
    })
  })

  describe('checkOutputsExist', () => {
    it('should return false when path does not exist', () => {
      expect(checkOutputsExist(ospath.join(workDir, 'nonexistent'))).to.be.false()
    })

    it('should return false when path does not exist with logger', () => {
      const messages = []
      const logger = { debug: (msg) => messages.push(msg) }
      expect(checkOutputsExist(ospath.join(workDir, 'nonexistent'), logger)).to.be.false()
      expect(messages.some((m) => m.includes('does not exist'))).to.be.true()
    })

    it('should return false when path is a file without logger', () => {
      const filePath = ospath.join(workDir, 'file2.txt')
      fs.writeFileSync(filePath, 'content', 'utf8')
      expect(checkOutputsExist(filePath)).to.be.false()
    })

    it('should return false when directory is empty without logger', () => {
      const emptyDir = ospath.join(workDir, 'empty2')
      fs.mkdirSync(emptyDir)
      expect(checkOutputsExist(emptyDir)).to.be.false()
    })

    it('should return false when path is a file not directory', () => {
      const filePath = ospath.join(workDir, 'file.txt')
      fs.writeFileSync(filePath, 'content', 'utf8')
      const messages = []
      const logger = { debug: (msg) => messages.push(msg) }

      expect(checkOutputsExist(filePath, logger)).to.be.false()
      expect(messages.some((m) => m.includes('not a directory'))).to.be.true()
    })

    it('should return false when directory is empty', () => {
      const emptyDir = ospath.join(workDir, 'empty')
      fs.mkdirSync(emptyDir)
      const messages = []
      const logger = { debug: (msg) => messages.push(msg) }

      expect(checkOutputsExist(emptyDir, logger)).to.be.false()
      expect(messages.some((m) => m.includes('empty'))).to.be.true()
    })

    it('should return true when directory has files', () => {
      fs.writeFileSync(ospath.join(workDir, 'test.txt'), 'content', 'utf8')
      expect(checkOutputsExist(workDir)).to.be.true()
    })

    it('should handle statSync errors gracefully', () => {
      const mockFs = {
        existsSync: () => true,
        statSync: () => {
          throw new Error('Simulated stat error')
        },
      }

      const { checkOutputsExist: checkOutputsExistMocked } = proxyquire('../../lib/utils/fs', {
        fs: mockFs,
      })

      const messages = []
      const logger = { debug: (msg) => messages.push(msg) }

      const result = checkOutputsExistMocked('/fake/path', logger)
      expect(result).to.be.false()
      expect(messages.some((m) => m.includes('Error checking output directory'))).to.be.true()
    })

    it('should handle statSync errors without logger', () => {
      const mockFs = {
        existsSync: () => true,
        statSync: () => {
          throw new Error('Simulated stat error')
        },
      }

      const { checkOutputsExist: checkOutputsExistMocked } = proxyquire('../../lib/utils/fs', {
        fs: mockFs,
      })

      const result = checkOutputsExistMocked('/fake/path')
      expect(result).to.be.false()
    })
  })

  describe('copyDirectory', () => {
    it('should copy directory contents', () => {
      const srcDir = ospath.join(workDir, 'src')
      const destDir = ospath.join(workDir, 'dest')
      fs.mkdirSync(srcDir)
      fs.writeFileSync(ospath.join(srcDir, 'test.txt'), 'content', 'utf8')

      copyDirectory(srcDir, destDir)

      expect(fs.existsSync(ospath.join(destDir, 'test.txt'))).to.be.true()
      expect(fs.readFileSync(ospath.join(destDir, 'test.txt'), 'utf8')).to.equal('content')
    })

    it('should copy nested directories', () => {
      const srcDir = ospath.join(workDir, 'src')
      const nestedDir = ospath.join(srcDir, 'nested')
      const destDir = ospath.join(workDir, 'dest')

      fs.mkdirSync(nestedDir, { recursive: true })
      fs.writeFileSync(ospath.join(nestedDir, 'deep.txt'), 'deep content', 'utf8')

      copyDirectory(srcDir, destDir)

      expect(fs.existsSync(ospath.join(destDir, 'nested', 'deep.txt'))).to.be.true()
    })

    it('should overwrite existing destination', () => {
      const srcDir = ospath.join(workDir, 'src')
      const destDir = ospath.join(workDir, 'dest')

      fs.mkdirSync(srcDir)
      fs.mkdirSync(destDir)
      fs.writeFileSync(ospath.join(srcDir, 'new.txt'), 'new', 'utf8')
      fs.writeFileSync(ospath.join(destDir, 'old.txt'), 'old', 'utf8')

      copyDirectory(srcDir, destDir)

      expect(fs.existsSync(ospath.join(destDir, 'new.txt'))).to.be.true()
      expect(fs.existsSync(ospath.join(destDir, 'old.txt'))).to.be.false()
    })

    it('should log when logger is provided', () => {
      const srcDir = ospath.join(workDir, 'src')
      const destDir = ospath.join(workDir, 'dest')
      fs.mkdirSync(srcDir)
      fs.writeFileSync(ospath.join(srcDir, 'test.txt'), 'content', 'utf8')

      const messages = []
      const logger = { debug: (msg) => messages.push(msg) }

      copyDirectory(srcDir, destDir, logger)
      expect(messages.some((m) => m.includes('Copied directory'))).to.be.true()
    })

    it('should skip symlinks (not file or directory)', () => {
      const srcDir = ospath.join(workDir, 'src')
      const destDir = ospath.join(workDir, 'dest')
      fs.mkdirSync(srcDir)
      fs.writeFileSync(ospath.join(srcDir, 'file.txt'), 'content', 'utf8')
      fs.symlinkSync(ospath.join(srcDir, 'file.txt'), ospath.join(srcDir, 'link.txt'))

      copyDirectory(srcDir, destDir)

      expect(fs.existsSync(ospath.join(destDir, 'file.txt'))).to.be.true()
      expect(fs.existsSync(ospath.join(destDir, 'link.txt'))).to.be.false()
    })
  })

  describe('findFilesMatchingPattern', () => {
    it('should find files matching glob pattern', () => {
      fs.writeFileSync(ospath.join(workDir, 'test.txt'), 'content', 'utf8')
      fs.writeFileSync(ospath.join(workDir, 'test.js'), 'code', 'utf8')

      const txtFiles = findFilesMatchingPattern(workDir, '*.txt')
      expect(txtFiles).to.include('test.txt')
      expect(txtFiles).to.not.include('test.js')
    })

    it('should return empty array when directory does not exist', () => {
      const result = findFilesMatchingPattern(ospath.join(workDir, 'nonexistent'), '*.txt')
      expect(result).to.have.lengthOf(0)
    })

    it('should find files in nested directories with **', () => {
      const nestedDir = ospath.join(workDir, 'nested')
      fs.mkdirSync(nestedDir)
      fs.writeFileSync(ospath.join(nestedDir, 'deep.txt'), 'content', 'utf8')

      const files = findFilesMatchingPattern(workDir, '**/*.txt')
      expect(files).to.include('nested/deep.txt')
    })
  })
})