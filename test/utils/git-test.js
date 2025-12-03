/* eslint-env mocha */
'use strict'

const { expect } = require('../harness')
const ospath = require('node:path')
const proxyquire = require('proxyquire')
const { posixify, generateWorktreeFolderName, isLocalDevelopment, buildRef } = require('../../lib/utils/git')

describe('utils/git', () => {
  describe('posixify', () => {
    it('should be undefined on POSIX or convert backslashes on Windows', () => {
      if (ospath.sep === '\\') {
        expect(posixify).to.be.a('function')
        expect(posixify('a\\b\\c')).to.equal('a/b/c')
      } else {
        expect(posixify).to.be.undefined()
      }
    })

    it('should convert backslashes when mocking Windows path.sep', () => {
      const mockPath = {
        sep: '\\',
        basename: ospath.basename,
        join: ospath.join,
      }

      const { posixify: windowsPosixify } = proxyquire('../../lib/utils/git', {
        path: mockPath,
      })

      expect(windowsPosixify).to.be.a('function')
      expect(windowsPosixify('a\\b\\c')).to.equal('a/b/c')
      expect(windowsPosixify('C:\\Users\\test')).to.equal('C:/Users/test')
    })
  })

  describe('generateWorktreeFolderName', () => {
    it('should generate folder name when worktree is undefined', () => {
      const origin = { gitdir: '/path/to/repo-abc123.git', refname: 'main', worktree: undefined }
      const name = generateWorktreeFolderName(origin, true)
      expect(name).to.include('@main')
    })

    it('should default keepWorktrees to true when not provided', () => {
      const origin = { gitdir: '/path/to/repo-abc123.git', refname: 'main', worktree: undefined }
      const name = generateWorktreeFolderName(origin)
      expect(name).to.include('@main')
    })

    it('should generate folder name without qualifier when keepWorktrees is false', () => {
      const origin = { gitdir: '/path/to/repo-abc123.git', refname: 'main', worktree: undefined }
      const name = generateWorktreeFolderName(origin, false)
      expect(name).to.not.include('@')
    })

    it('should generate folder name without qualifier when keepWorktrees is false and worktree is defined', () => {
      const origin = {
        url: 'https://github.com/example/test-repo.git',
        gitdir: '/path/to/gitdir',
        refname: 'main',
        worktree: '/path/to/worktree',
      }
      const name = generateWorktreeFolderName(origin, false)
      expect(name).to.include('test-repo-')
      expect(name).to.not.include('@')
      expect(name).to.match(/-[a-f0-9]{40}$/)
    })

    it('should generate folder name with hash when worktree is defined', () => {
      const origin = {
        url: 'https://github.com/example/test-repo.git',
        gitdir: '/path/to/gitdir',
        refname: 'main',
        worktree: '/path/to/worktree',
      }
      const name = generateWorktreeFolderName(origin, true)
      expect(name).to.include('test-repo@main-')
      expect(name).to.match(/-[a-f0-9]{40}$/)
    })

    it('should use gitdir when url is not provided', () => {
      const origin = { gitdir: '/path/to/my-repo', refname: 'develop', worktree: '/path/to/worktree' }
      const name = generateWorktreeFolderName(origin, true)
      expect(name).to.include('my-repo@develop-')
    })

    it('should handle refnames with slashes', () => {
      const origin = {
        url: 'https://github.com/example/repo.git',
        gitdir: '/path/to/gitdir',
        refname: 'feature/test',
        worktree: '/path/to/worktree',
      }
      const name = generateWorktreeFolderName(origin, true)
      expect(name).to.include('@feature-test')
    })

    it('should use posixify on Windows paths when generating folder name', () => {
      const mockPath = {
        sep: '\\',
        basename: ospath.basename,
        join: ospath.join,
      }

      const { generateWorktreeFolderName: windowsGenerateWorktreeFolderName } = proxyquire('../../lib/utils/git', {
        path: mockPath,
      })

      const origin = {
        url: 'C:\\repos\\test-repo.git',
        gitdir: 'C:\\cache\\gitdir',
        refname: 'main',
        worktree: 'C:\\cache\\worktree',
      }
      const name = windowsGenerateWorktreeFolderName(origin, true)
      expect(name).to.include('test-repo@main-')
      expect(name).to.match(/-[a-f0-9]{40}$/)
    })
  })

  describe('isLocalDevelopment', () => {
    it('should return true when gitdir is worktree/.git', () => {
      expect(isLocalDevelopment('/work/project', '/work/project/.git')).to.be.true()
    })

    it('should return false when gitdir is outside worktree', () => {
      expect(isLocalDevelopment('/work/project', '/cache/gitdir')).to.be.false()
    })

    it('should return falsy when worktree is undefined', () => {
      expect(isLocalDevelopment(undefined, '/cache/gitdir')).to.not.be.ok()
    })

    it('should return falsy when gitdir is undefined', () => {
      expect(isLocalDevelopment('/work/project', undefined)).to.not.be.ok()
    })
  })

  describe('buildRef', () => {
    it('should build ref for branch', () => {
      expect(buildRef('branch', 'main')).to.equal('refs/heads/main')
    })

    it('should build ref for tag', () => {
      expect(buildRef('tag', 'v1.0.0')).to.equal('refs/tags/v1.0.0')
    })
  })
})
