/* eslint-env mocha */
'use strict'

const { expect, cleanDir } = require('../harness')
const fs = require('fs')
const os = require('os')
const ospath = require('node:path')
const proxyquire = require('proxyquire')
const EventEmitter = require('events')
const { resolveSources, resolveDependencySources, buildEntriesMap } = require('../../lib/utils/sources')

describe('utils/sources', () => {
  let workDir

  beforeEach(() => {
    workDir = fs.mkdtempSync(ospath.join(os.tmpdir(), 'sources-test-'))
  })

  afterEach(async () => {
    await cleanDir(workDir)
  })

  describe('resolveSources', () => {
    it('should return static sources when no commands', async () => {
      const sources = await resolveSources(workDir, ['a.txt', 'b.txt'], [])
      expect(sources).to.include('a.txt')
      expect(sources).to.include('b.txt')
    })

    it('should return static sources when commands is null', async () => {
      const sources = await resolveSources(workDir, ['a.txt'], null)
      expect(sources).to.include('a.txt')
    })

    it('should resolve sources from commands', async () => {
      const sources = await resolveSources(workDir, ['static.txt'], ['echo "dynamic.txt"'])
      expect(sources).to.include('static.txt')
      expect(sources).to.include('dynamic.txt')
    })

    it('should resolve sources from commands without logger', async () => {
      const sources = await resolveSources(workDir, ['static.txt'], ['echo "dynamic.txt"'])
      expect(sources).to.include('dynamic.txt')
    })

    it('should resolve sources with logger but without component info', async () => {
      const messages = []
      const logger = {
        debug: (msg) => messages.push({ level: 'debug', msg }),
        warn: (msg) => messages.push({ level: 'warn', msg }),
      }

      const sources = await resolveSources(workDir, ['static.txt'], ['echo "out.txt"'], logger)
      expect(sources).to.include('out.txt')
      expect(messages.some((m) => m.msg.includes('Running'))).to.be.true()
    })

    it('should handle stderr output from commands', async () => {
      const messages = []
      const logger = {
        debug: (msg) => messages.push({ level: 'debug', msg }),
        warn: (msg) => messages.push({ level: 'warn', msg }),
      }

      const sources = await resolveSources(workDir, ['static.txt'], ['echo "file.txt" >&2 && echo "out.txt"'], logger)
      expect(sources).to.include('out.txt')
    })

    it('should handle command failure gracefully', async () => {
      const messages = []
      const logger = {
        debug: (msg) => messages.push({ level: 'debug', msg }),
        warn: (msg) => messages.push({ level: 'warn', msg }),
      }

      const sources = await resolveSources(workDir, ['static.txt'], ['exit 1'], logger, 'comp', 'key')
      expect(sources).to.include('static.txt')
      expect(messages.some((m) => m.level === 'warn' && m.msg.includes('Failed to run'))).to.be.true()
    })

    it('should handle command failure without logger', async () => {
      const sources = await resolveSources(workDir, ['static.txt'], ['exit 1'])
      expect(sources).to.include('static.txt')
    })

    it('should handle spawn error event', async () => {
      const mockProc = new EventEmitter()
      mockProc.stdout = new EventEmitter()
      mockProc.stderr = new EventEmitter()

      const mockChildProcess = {
        spawn: () => {
          setImmediate(() => {
            mockProc.emit('error', new Error('spawn ENOENT'))
          })
          return mockProc
        },
      }

      const { resolveSources: resolveSourcesMocked } = proxyquire('../../lib/utils/sources', {
        child_process: mockChildProcess,
      })

      const messages = []
      const logger = {
        debug: (msg) => messages.push({ level: 'debug', msg }),
        warn: (msg) => messages.push({ level: 'warn', msg }),
      }

      await resolveSourcesMocked(workDir, ['static.txt'], ['any-command'], logger, 'comp', 'key')
      expect(messages.some((m) => m.level === 'warn' && m.msg.includes('ENOENT'))).to.be.true()
    })
  })

  describe('resolveDependencySources', () => {
    it('should return empty when no dependencies', () => {
      const result = resolveDependencySources(new Map(), [], new Set())
      expect(result.sources).to.have.lengthOf(0)
      expect(result.sourceCommands).to.have.lengthOf(0)
    })

    it('should return empty when dependsOn is null', () => {
      const result = resolveDependencySources(new Map(), null, new Set())
      expect(result.sources).to.have.lengthOf(0)
    })

    it('should resolve sources from dependencies', () => {
      const entriesMap = new Map([['dep1', { key: 'dep1', sources: ['dep1.txt'], sourceCommands: [], dependsOn: [] }]])

      const result = resolveDependencySources(entriesMap, ['dep1'], new Set())
      expect(result.sources).to.include('dep1.txt')
    })

    it('should resolve dependencies with full logging', () => {
      const messages = []
      const logger = {
        debug: (msg) => messages.push({ level: 'debug', msg }),
        warn: (msg) => messages.push({ level: 'warn', msg }),
      }

      const entriesMap = new Map([['dep1', { key: 'dep1', sources: ['dep1.txt'], sourceCommands: [], dependsOn: [] }]])

      const result = resolveDependencySources(entriesMap, ['dep1'], new Set(), logger, 'comp', 'key')
      expect(result.sources).to.include('dep1.txt')
      expect(messages.some((m) => m.msg.includes('Resolving dependencies'))).to.be.true()
      expect(messages.some((m) => m.msg.includes('Resolved'))).to.be.true()
    })

    it('should detect circular dependencies without logger', () => {
      const entriesMap = new Map([['a', { key: 'a', sources: ['a.txt'], sourceCommands: [], dependsOn: ['b'] }]])

      const result = resolveDependencySources(entriesMap, ['a'], new Set(['a']))
      expect(result.sources).to.have.lengthOf(0)
    })

    it('should warn when dependency not found without logger', () => {
      const result = resolveDependencySources(new Map(), ['nonexistent'], new Set())
      expect(result.sources).to.have.lengthOf(0)
    })

    it('should handle dependency without sources property', () => {
      const entriesMap = new Map([['dep1', { key: 'dep1', sourceCommands: ['cmd'], dependsOn: [] }]])

      const result = resolveDependencySources(entriesMap, ['dep1'], new Set())
      expect(result.sources).to.have.lengthOf(0)
      expect(result.sourceCommands).to.include('cmd')
    })

    it('should handle dependency without sourceCommands property', () => {
      const entriesMap = new Map([['dep1', { key: 'dep1', sources: ['file.txt'], dependsOn: [] }]])

      const result = resolveDependencySources(entriesMap, ['dep1'], new Set())
      expect(result.sources).to.include('file.txt')
      expect(result.sourceCommands).to.have.lengthOf(0)
    })

    it('should resolve dependencies with logger but without component info', () => {
      const messages = []
      const logger = {
        debug: (msg) => messages.push({ level: 'debug', msg }),
        warn: (msg) => messages.push({ level: 'warn', msg }),
      }

      const entriesMap = new Map([['dep1', { key: 'dep1', sources: ['dep1.txt'], sourceCommands: [], dependsOn: [] }]])

      const result = resolveDependencySources(entriesMap, ['dep1'], new Set(), logger)
      expect(result.sources).to.include('dep1.txt')
    })

    it('should detect circular dependencies', () => {
      const messages = []
      const logger = { warn: (msg) => messages.push(msg) }

      const entriesMap = new Map([
        ['a', { key: 'a', sources: ['a.txt'], sourceCommands: [], dependsOn: ['b'] }],
        ['b', { key: 'b', sources: ['b.txt'], sourceCommands: [], dependsOn: ['a'] }],
      ])

      resolveDependencySources(entriesMap, ['a'], new Set(['a']), logger)
      expect(messages.some((m) => m.includes('Circular dependency'))).to.be.true()
    })

    it('should warn when dependency not found', () => {
      const messages = []
      const logger = { warn: (msg) => messages.push(msg) }

      resolveDependencySources(new Map(), ['nonexistent'], new Set(), logger)
      expect(messages.some((m) => m.includes('not found'))).to.be.true()
    })

    it('should resolve nested dependencies', () => {
      const entriesMap = new Map([
        ['dep1', { key: 'dep1', sources: ['dep1.txt'], sourceCommands: ['cmd1'], dependsOn: ['dep2'] }],
        ['dep2', { key: 'dep2', sources: ['dep2.txt'], sourceCommands: ['cmd2'], dependsOn: [] }],
      ])

      const result = resolveDependencySources(entriesMap, ['dep1'], new Set())
      expect(result.sources).to.include('dep1.txt')
      expect(result.sources).to.include('dep2.txt')
      expect(result.sourceCommands).to.include('cmd1')
      expect(result.sourceCommands).to.include('cmd2')
    })
  })

  describe('buildEntriesMap', () => {
    it('should build map from entries array', () => {
      const entries = [
        { run: { key: 'build', sources: ['src.txt'], cachedir: 'out' } },
        { run: { key: 'test', sources: ['test.txt'], cachedir: 'out' } },
      ]

      const map = buildEntriesMap(entries)
      expect(map.has('build')).to.be.true()
      expect(map.has('test')).to.be.true()
      expect(map.get('build').sources).to.include('src.txt')
    })

    it('should skip entries without run.key', () => {
      const entries = [{ run: { key: 'valid', sources: [] } }, { run: { sources: [] } }, { scan: {} }]

      const map = buildEntriesMap(entries)
      expect(map.size).to.equal(1)
      expect(map.has('valid')).to.be.true()
    })

    it('should use empty arrays for missing sources and sourceCommands', () => {
      const entries = [{ run: { key: 'minimal' } }]

      const map = buildEntriesMap(entries)
      expect(map.get('minimal').sources).to.deep.equal([])
      expect(map.get('minimal').sourceCommands).to.deep.equal([])
      expect(map.get('minimal').dependsOn).to.deep.equal([])
    })
  })
})
