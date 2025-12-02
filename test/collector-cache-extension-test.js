/* eslint-env mocha */
'use strict'

const { expect, cleanDir, spy } = require('./harness')
const { name: packageName } = require('#package')
const fs = require('fs')
const os = require('os')
const ospath = require('node:path')
const crypto = require('crypto')
const { EventEmitter } = require('events')

describe('collector-cache-extension', () => {
  const ext = require(packageName)

  // Mock for isomorphic-git
  const createMockGit = (overrides = {}) => ({
    clone: spy(async () => {}),
    fetch: spy(async () => {}),
    listBranches: spy(async () => ['main']),
    branch: spy(async () => {}),
    checkout: spy(async () => {}),
    ...overrides,
  })

  // Mock for child_process.spawn
  const createMockSpawn = (exitCode = 0, stdout = '', stderr = '') => {
    return spy(() => {
      const proc = new EventEmitter()
      proc.stdout = new EventEmitter()
      proc.stderr = new EventEmitter()
      // Emit events asynchronously
      setImmediate(() => {
        if (stdout) proc.stdout.emit('data', Buffer.from(stdout))
        if (stderr) proc.stderr.emit('data', Buffer.from(stderr))
        proc.emit('close', exitCode)
      })
      return proc
    })
  }

  // Mock for child_process module
  const createMockChildProcess = (spawnMock) => ({
    spawn: spawnMock || createMockSpawn(),
  })

  const createGeneratorContext = (mocks = {}) => {
    const mockGit = mocks.git || createMockGit()
    const mockChildProcess = mocks.childProcess || createMockChildProcess()

    return {
      messages: [],
      mockGit,
      mockChildProcess,
      once (eventName, fn) {
        this[eventName] = fn
      },
      on (eventName, fn) {
        this[eventName] = fn
      },
      require (moduleName) {
        if (moduleName === '@antora/content-aggregator/git') {
          return mockGit
        }
        if (moduleName === 'child_process') {
          return mockChildProcess
        }
        return require(moduleName)
      },
      getLogger (name) {
        const messages = this.messages
        return {
          info: (msg) => messages.push({ level: 'info', msg }),
          debug: (msg) => messages.push({ level: 'debug', msg }),
          warn: (msg) => messages.push({ level: 'warn', msg }),
          error: (msg) => messages.push({ level: 'error', msg }),
        }
      },
    }
  }

  const tempDir = (prefix) => fs.mkdtempSync(ospath.join(os.tmpdir(), prefix))

  const createSourceFile = (dir, filename, content) => {
    const filePath = ospath.join(dir, filename)
    fs.mkdirSync(ospath.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content, 'utf8')
    return filePath
  }

  const computeFileHash = (content) => crypto.createHash('sha256').update(content).digest('hex')

  let generatorContext
  let workDir
  let playbookDir
  let worktreeDir
  let cacheDir
  let playbook

  beforeEach(() => {
    workDir = tempDir('collector-cache-extension-test-')
    playbookDir = ospath.join(workDir, 'playbook')
    worktreeDir = ospath.join(workDir, 'worktree')
    cacheDir = ospath.join(playbookDir, '.cache/antora')
    fs.mkdirSync(playbookDir, { recursive: true })
    fs.mkdirSync(worktreeDir, { recursive: true })
    generatorContext = createGeneratorContext()
    playbook = {
      dir: playbookDir,
      runtime: { cacheDir: '.cache/antora' }, // Relative to playbook.dir
    }
  })

  afterEach(async () => {
    await cleanDir(workDir)
  })

  describe('bootstrap', () => {
    it('should be able to require extension', () => {
      expect(ext).to.be.instanceOf(Object)
      expect(ext.register).to.be.instanceOf(Function)
    })

    it('should be able to call register function exported by extension', () => {
      ext.register.call(generatorContext, { playbook })
      expect(generatorContext.contentAggregated).to.be.instanceOf(Function)
      expect(generatorContext.beforePublish).to.be.instanceOf(Function)
    })
  })

  describe('contentAggregated', () => {
    describe('no collector-cache config', () => {
      it('should skip origins without collectorCache config', async () => {
        const contentAggregate = [
          {
            name: 'test-component',
            origins: [
              {
                descriptor: { ext: {} },
                worktree: worktreeDir,
                gitdir: ospath.join(worktreeDir, '.git'),
              },
            ],
          },
        ]

        ext.register.call(generatorContext, { playbook })
        await generatorContext.contentAggregated({ playbook, contentAggregate })

        const debugMessages = generatorContext.messages.filter((m) => m.level === 'debug')
        expect(debugMessages.some((m) => m.msg.includes('No collector-cache configuration'))).to.be.true()
      })

      it('should skip origins with empty descriptor', async () => {
        const contentAggregate = [
          {
            name: 'test-component',
            origins: [
              {
                descriptor: {},
                worktree: worktreeDir,
              },
            ],
          },
        ]

        ext.register.call(generatorContext, { playbook })
        await generatorContext.contentAggregated({ playbook, contentAggregate })

        // Should not throw and should have no errors
        const errorMessages = generatorContext.messages.filter((m) => m.level === 'error')
        expect(errorMessages).to.have.lengthOf(0)
      })
    })

    describe('invalid config', () => {
      it('should warn when collectorCache is not an array', async () => {
        const contentAggregate = [
          {
            name: 'test-component',
            origins: [
              {
                descriptor: {
                  ext: {
                    collectorCache: { notAnArray: true },
                  },
                },
                worktree: worktreeDir,
                gitdir: ospath.join(worktreeDir, '.git'),
              },
            ],
          },
        ]

        ext.register.call(generatorContext, { playbook })
        await generatorContext.contentAggregated({ playbook, contentAggregate })

        const warnMessages = generatorContext.messages.filter((m) => m.level === 'warn')
        expect(warnMessages.some((m) => m.msg.includes('must be an array'))).to.be.true()
      })

      it('should warn when entry is missing required fields', async () => {
        const contentAggregate = [
          {
            name: 'test-component',
            origins: [
              {
                descriptor: {
                  ext: {
                    collectorCache: [
                      {
                        run: {
                          // missing key, sources, cacheDir
                        },
                      },
                    ],
                  },
                },
                worktree: worktreeDir,
                gitdir: ospath.join(worktreeDir, '.git'),
              },
            ],
          },
        ]

        ext.register.call(generatorContext, { playbook })
        await generatorContext.contentAggregated({ playbook, contentAggregate })

        const warnMessages = generatorContext.messages.filter((m) => m.level === 'warn')
        expect(warnMessages.some((m) => m.msg.includes('missing run.key'))).to.be.true()
      })
    })

    describe('local development detection', () => {
      it('should detect local development when gitdir is inside worktree', async () => {
        fs.mkdirSync(ospath.join(worktreeDir, '.git'), { recursive: true })
        createSourceFile(worktreeDir, 'src/main.c', 'int main() { return 0; }')

        const contentAggregate = [
          {
            name: 'test-component',
            origins: [
              {
                descriptor: {
                  ext: {
                    collectorCache: [
                      {
                        run: {
                          key: 'build',
                          sources: ['src/main.c'],
                          cachedir: 'build/output',
                          command: 'echo "building"',
                        },
                      },
                    ],
                  },
                },
                worktree: worktreeDir,
                gitdir: ospath.join(worktreeDir, '.git'),
              },
            ],
          },
        ]

        ext.register.call(generatorContext, { playbook })
        await generatorContext.contentAggregated({ playbook, contentAggregate })

        const infoMessages = generatorContext.messages.filter((m) => m.level === 'info')
        expect(infoMessages.some((m) => m.msg.includes('Local development detected'))).to.be.true()
      })
    })

    describe('cache operations', () => {
      it('should report cache MISS when source files not found', async () => {
        // Don't create the source file
        const contentAggregate = [
          {
            name: 'test-component',
            origins: [
              {
                descriptor: {
                  ext: {
                    collectorCache: [
                      {
                        run: {
                          key: 'build',
                          sources: ['src/nonexistent.c'],
                          cachedir: 'build/output',
                          command: 'echo "building"',
                        },
                      },
                    ],
                  },
                },
                worktree: worktreeDir,
                gitdir: ospath.join(worktreeDir, '.git'),
              },
            ],
          },
        ]

        ext.register.call(generatorContext, { playbook })
        await generatorContext.contentAggregated({ playbook, contentAggregate })

        const debugMessages = generatorContext.messages.filter((m) => m.level === 'debug')
        expect(debugMessages.some((m) => m.msg.includes('cache MISS'))).to.be.true()
      })

      it('should compute hash and check cache for existing source files', async () => {
        const sourceContent = 'int main() { return 0; }'
        createSourceFile(worktreeDir, 'src/main.c', sourceContent)

        const contentAggregate = [
          {
            name: 'test-component',
            origins: [
              {
                descriptor: {
                  ext: {
                    collectorCache: [
                      {
                        run: {
                          key: 'build',
                          sources: ['src/main.c'],
                          cachedir: 'build/output',
                          command: 'echo "building"',
                        },
                      },
                    ],
                  },
                },
                worktree: worktreeDir,
                gitdir: ospath.join(worktreeDir, '.git'),
              },
            ],
          },
        ]

        ext.register.call(generatorContext, { playbook })
        await generatorContext.contentAggregated({ playbook, contentAggregate })

        // Should report cache MISS (no cache entry yet)
        const infoMessages = generatorContext.messages.filter((m) => m.level === 'info')
        expect(infoMessages.some((m) => m.msg.includes('Cache MISS'))).to.be.true()
      })

      it('should report cache HIT when pointer file and outputs exist', async () => {
        const sourceContent = 'int main() { return 0; }'
        createSourceFile(worktreeDir, 'src/main.c', sourceContent)

        // Compute expected hash
        const sourceHash = computeFileHash(sourceContent)
        const contentHash = crypto.createHash('sha256').update(sourceHash).digest('hex')

        // Create cache structure
        const hashDir = ospath.join(playbookDir, '.cache/antora/collector-cache/hashes/test-component/build')
        const outputDir = ospath.join(playbookDir, '.cache/antora/collector-cache/outputs', contentHash, 'build/output')
        fs.mkdirSync(hashDir, { recursive: true })
        fs.mkdirSync(outputDir, { recursive: true })

        // Create pointer file
        const pointer = {
          outputDir: contentHash,
          scanDir: 'build/output',
          sources: { 'src/main.c': sourceHash },
          timestamp: new Date().toISOString(),
        }
        fs.writeFileSync(ospath.join(hashDir, `${contentHash}.json`), JSON.stringify(pointer), 'utf8')

        // Create a file in outputs
        createSourceFile(outputDir, 'result.txt', 'build output')

        const contentAggregate = [
          {
            name: 'test-component',
            origins: [
              {
                descriptor: {
                  ext: {
                    collectorCache: [
                      {
                        run: {
                          key: 'build',
                          sources: ['src/main.c'],
                          cachedir: 'build/output',
                          command: 'echo "building"',
                        },
                        scan: {
                          dir: 'build/output',
                          files: '**/*',
                        },
                      },
                    ],
                  },
                },
                worktree: worktreeDir,
                gitdir: ospath.join(worktreeDir, '.git'),
              },
            ],
          },
        ]

        ext.register.call(generatorContext, { playbook })
        await generatorContext.contentAggregated({ playbook, contentAggregate })

        const infoMessages = generatorContext.messages.filter((m) => m.level === 'info')
        expect(infoMessages.some((m) => m.msg.includes('Cache HIT'))).to.be.true()
      })
    })

    describe('dependency resolution', () => {
      it('should resolve sources from dependencies', async () => {
        createSourceFile(worktreeDir, 'src/main.c', 'int main() {}')
        createSourceFile(worktreeDir, 'lib/helper.c', 'void helper() {}')

        const contentAggregate = [
          {
            name: 'test-component',
            origins: [
              {
                descriptor: {
                  ext: {
                    collectorCache: [
                      {
                        run: {
                          key: 'lib',
                          sources: ['lib/helper.c'],
                          cachedir: 'build/lib',
                          command: 'echo "building lib"',
                        },
                      },
                      {
                        run: {
                          key: 'main',
                          sources: ['src/main.c'],
                          dependson: ['lib'],
                          cachedir: 'build/main',
                          command: 'echo "building main"',
                        },
                      },
                    ],
                  },
                },
                worktree: worktreeDir,
                gitdir: ospath.join(worktreeDir, '.git'),
              },
            ],
          },
        ]

        ext.register.call(generatorContext, { playbook })
        await generatorContext.contentAggregated({ playbook, contentAggregate })

        const debugMessages = generatorContext.messages.filter((m) => m.level === 'debug')
        expect(debugMessages.some((m) => m.msg.includes('Resolving dependencies'))).to.be.true()
      })

      it('should detect circular dependencies', async () => {
        createSourceFile(worktreeDir, 'src/a.c', 'void a() {}')
        createSourceFile(worktreeDir, 'src/b.c', 'void b() {}')

        const contentAggregate = [
          {
            name: 'test-component',
            origins: [
              {
                descriptor: {
                  ext: {
                    collectorCache: [
                      {
                        run: {
                          key: 'a',
                          sources: ['src/a.c'],
                          dependson: ['b'],
                          cachedir: 'build/a',
                          command: 'echo "a"',
                        },
                      },
                      {
                        run: {
                          key: 'b',
                          sources: ['src/b.c'],
                          dependson: ['a'],
                          cachedir: 'build/b',
                          command: 'echo "b"',
                        },
                      },
                    ],
                  },
                },
                worktree: worktreeDir,
                gitdir: ospath.join(worktreeDir, '.git'),
              },
            ],
          },
        ]

        ext.register.call(generatorContext, { playbook })
        await generatorContext.contentAggregated({ playbook, contentAggregate })

        const warnMessages = generatorContext.messages.filter((m) => m.level === 'warn')
        expect(warnMessages.some((m) => m.msg.includes('Circular dependency'))).to.be.true()
      })

      it('should warn when dependency not found', async () => {
        createSourceFile(worktreeDir, 'src/main.c', 'int main() {}')

        const contentAggregate = [
          {
            name: 'test-component',
            origins: [
              {
                descriptor: {
                  ext: {
                    collectorCache: [
                      {
                        run: {
                          key: 'main',
                          sources: ['src/main.c'],
                          dependson: ['nonexistent'],
                          cachedir: 'build/main',
                          command: 'echo "main"',
                        },
                      },
                    ],
                  },
                },
                worktree: worktreeDir,
                gitdir: ospath.join(worktreeDir, '.git'),
              },
            ],
          },
        ]

        ext.register.call(generatorContext, { playbook })
        await generatorContext.contentAggregated({ playbook, contentAggregate })

        const warnMessages = generatorContext.messages.filter((m) => m.level === 'warn')
        expect(warnMessages.some((m) => m.msg.includes('Dependency not found'))).to.be.true()
      })
    })

    describe('FORCE_COLLECTOR environment variable', () => {
      afterEach(() => {
        delete process.env.FORCE_COLLECTOR
      })

      it('should force cache MISS when FORCE_COLLECTOR=true', async () => {
        process.env.FORCE_COLLECTOR = 'true'

        const sourceContent = 'int main() { return 0; }'
        createSourceFile(worktreeDir, 'src/main.c', sourceContent)

        // Set up cache that would normally HIT
        const sourceHash = computeFileHash(sourceContent)
        const contentHash = crypto.createHash('sha256').update(sourceHash).digest('hex')

        const hashDir = ospath.join(playbookDir, '.cache/antora/collector-cache/hashes/test-component/build')
        const outputDir = ospath.join(playbookDir, '.cache/antora/collector-cache/outputs', contentHash, 'build/output')
        fs.mkdirSync(hashDir, { recursive: true })
        fs.mkdirSync(outputDir, { recursive: true })

        const pointer = {
          outputDir: contentHash,
          scanDir: 'build/output',
          sources: { 'src/main.c': sourceHash },
        }
        fs.writeFileSync(ospath.join(hashDir, `${contentHash}.json`), JSON.stringify(pointer), 'utf8')
        createSourceFile(outputDir, 'result.txt', 'cached output')

        const contentAggregate = [
          {
            name: 'test-component',
            origins: [
              {
                descriptor: {
                  ext: {
                    collectorCache: [
                      {
                        run: {
                          key: 'build',
                          sources: ['src/main.c'],
                          cachedir: 'build/output',
                          command: 'echo "building"',
                        },
                      },
                    ],
                  },
                },
                worktree: worktreeDir,
                gitdir: ospath.join(worktreeDir, '.git'),
              },
            ],
          },
        ]

        ext.register.call(generatorContext, { playbook })
        await generatorContext.contentAggregated({ playbook, contentAggregate })

        const infoMessages = generatorContext.messages.filter((m) => m.level === 'info')
        expect(infoMessages.some((m) => m.msg.includes('FORCE_COLLECTOR=true'))).to.be.true()
      })
    })
  })

  describe('beforePublish', () => {
    it('should update cache with new outputs', async () => {
      const sourceContent = 'int main() { return 0; }'
      createSourceFile(worktreeDir, 'src/main.c', sourceContent)

      // Create output directory with build results
      const buildOutputDir = ospath.join(worktreeDir, 'build/output')
      fs.mkdirSync(buildOutputDir, { recursive: true })
      fs.writeFileSync(ospath.join(buildOutputDir, 'result.txt'), 'build output', 'utf8')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: worktreeDir,
              gitdir: ospath.join(worktreeDir, '.git'),
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })
      await generatorContext.beforePublish({ playbook })

      const infoMessages = generatorContext.messages.filter((m) => m.level === 'info')
      expect(infoMessages.some((m) => m.msg.includes('Cached outputs'))).to.be.true()

      // Verify cache was created
      const hashDir = ospath.join(playbookDir, '.cache/antora/collector-cache/hashes/test-component/build')
      expect(fs.existsSync(hashDir)).to.be.true()
    })

    it('should warn when output directory not found', async () => {
      const sourceContent = 'int main() { return 0; }'
      createSourceFile(worktreeDir, 'src/main.c', sourceContent)

      // Don't create build output directory

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: worktreeDir,
              gitdir: ospath.join(worktreeDir, '.git'),
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })
      await generatorContext.beforePublish({ playbook })

      const warnMessages = generatorContext.messages.filter((m) => m.level === 'warn')
      expect(warnMessages.some((m) => m.msg.includes('Output directory not found'))).to.be.true()
    })
  })

  describe('multiple sources', () => {
    it('should compute hash from multiple source files', async () => {
      createSourceFile(worktreeDir, 'src/main.c', 'int main() {}')
      createSourceFile(worktreeDir, 'src/helper.c', 'void helper() {}')
      createSourceFile(worktreeDir, 'include/helper.h', '#pragma once')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c', 'src/helper.c', 'include/helper.h'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: worktreeDir,
              gitdir: ospath.join(worktreeDir, '.git'),
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      // Should process without errors
      const errorMessages = generatorContext.messages.filter((m) => m.level === 'error')
      expect(errorMessages).to.have.lengthOf(0)
    })
  })

  describe('scan configuration', () => {
    it('should handle array of scan entries', async () => {
      const sourceContent = 'int main() { return 0; }'
      createSourceFile(worktreeDir, 'src/main.c', sourceContent)

      // Set up cache HIT
      const sourceHash = computeFileHash(sourceContent)
      const contentHash = crypto.createHash('sha256').update(sourceHash).digest('hex')

      const hashDir = ospath.join(playbookDir, '.cache/antora/collector-cache/hashes/test-component/build')
      const outputDir = ospath.join(playbookDir, '.cache/antora/collector-cache/outputs', contentHash, 'build/output')
      fs.mkdirSync(hashDir, { recursive: true })
      fs.mkdirSync(outputDir, { recursive: true })

      const pointer = {
        outputDir: contentHash,
        scanDir: 'build/output',
        sources: { 'src/main.c': sourceHash },
      }
      fs.writeFileSync(ospath.join(hashDir, `${contentHash}.json`), JSON.stringify(pointer), 'utf8')
      createSourceFile(outputDir, 'result.txt', 'cached output')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                      scan: [
                        { dir: 'build/output', files: '**/*.txt', into: 'pages' },
                        { dir: 'build/output', files: '**/*.html', into: 'partials' },
                      ],
                    },
                  ],
                },
              },
              worktree: worktreeDir,
              gitdir: ospath.join(worktreeDir, '.git'),
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      const infoMessages = generatorContext.messages.filter((m) => m.level === 'info')
      expect(infoMessages.some((m) => m.msg.includes('Cache HIT'))).to.be.true()
    })
  })

  describe('sourceCommands', () => {
    it('should resolve dynamic sources from shell commands', async () => {
      createSourceFile(worktreeDir, 'src/main.c', 'int main() {}')
      createSourceFile(worktreeDir, 'src/generated.c', 'void generated() {}')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        sourcecommands: ['echo "src/generated.c"'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: worktreeDir,
              gitdir: ospath.join(worktreeDir, '.git'),
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      const debugMessages = generatorContext.messages.filter((m) => m.level === 'debug')
      expect(debugMessages.some((m) => m.msg.includes('Resolving dynamic sources'))).to.be.true()
    })

    it('should handle failing sourceCommands gracefully', async () => {
      createSourceFile(worktreeDir, 'src/main.c', 'int main() {}')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        sourcecommands: ['exit 1'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: worktreeDir,
              gitdir: ospath.join(worktreeDir, '.git'),
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      const warnMessages = generatorContext.messages.filter((m) => m.level === 'warn')
      expect(warnMessages.some((m) => m.msg.includes('Failed to run sourceCommand'))).to.be.true()
    })

    it('should handle empty sourceCommands array', async () => {
      createSourceFile(worktreeDir, 'src/main.c', 'int main() {}')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        sourcecommands: [],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: worktreeDir,
              gitdir: ospath.join(worktreeDir, '.git'),
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      // Should process without errors
      const errorMessages = generatorContext.messages.filter((m) => m.level === 'error')
      expect(errorMessages).to.have.lengthOf(0)
    })
  })

  describe('restoreToWorktree', () => {
    it('should restore files from cache to worktree on cache HIT', async () => {
      const sourceContent = 'int main() { return 0; }'
      createSourceFile(worktreeDir, 'src/main.c', sourceContent)

      // Compute expected hash
      const sourceHash = computeFileHash(sourceContent)
      const contentHash = crypto.createHash('sha256').update(sourceHash).digest('hex')

      // Create cache structure with files to restore
      const hashDir = ospath.join(playbookDir, '.cache/antora/collector-cache/hashes/test-component/build')
      const outputDir = ospath.join(playbookDir, '.cache/antora/collector-cache/outputs', contentHash, 'build/output')
      fs.mkdirSync(hashDir, { recursive: true })
      fs.mkdirSync(outputDir, { recursive: true })

      // Create pointer file
      const pointer = {
        outputDir: contentHash,
        scanDir: 'build/output',
        sources: { 'src/main.c': sourceHash },
      }
      fs.writeFileSync(ospath.join(hashDir, `${contentHash}.json`), JSON.stringify(pointer), 'utf8')

      // Create files in cache to be restored
      createSourceFile(outputDir, 'generated.h', '#pragma once\nvoid generated();')
      createSourceFile(outputDir, 'subdir/nested.h', '#pragma once')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                        restoretoworktree: ['**/*.h'],
                      },
                      scan: {
                        dir: 'build/output',
                        files: '**/*',
                      },
                    },
                  ],
                },
              },
              worktree: worktreeDir,
              gitdir: ospath.join(worktreeDir, '.git'),
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      const infoMessages = generatorContext.messages.filter((m) => m.level === 'info')
      expect(infoMessages.some((m) => m.msg.includes('Restored'))).to.be.true()

      // Verify files were restored to worktree
      expect(fs.existsSync(ospath.join(worktreeDir, 'build/output/generated.h'))).to.be.true()
      expect(fs.existsSync(ospath.join(worktreeDir, 'build/output/subdir/nested.h'))).to.be.true()
    })

    it('should handle empty restoreToWorktree patterns', async () => {
      const sourceContent = 'int main() { return 0; }'
      createSourceFile(worktreeDir, 'src/main.c', sourceContent)

      const sourceHash = computeFileHash(sourceContent)
      const contentHash = crypto.createHash('sha256').update(sourceHash).digest('hex')

      const hashDir = ospath.join(playbookDir, '.cache/antora/collector-cache/hashes/test-component/build')
      const outputDir = ospath.join(playbookDir, '.cache/antora/collector-cache/outputs', contentHash, 'build/output')
      fs.mkdirSync(hashDir, { recursive: true })
      fs.mkdirSync(outputDir, { recursive: true })

      const pointer = { outputDir: contentHash, scanDir: 'build/output', sources: { 'src/main.c': sourceHash } }
      fs.writeFileSync(ospath.join(hashDir, `${contentHash}.json`), JSON.stringify(pointer), 'utf8')
      createSourceFile(outputDir, 'result.txt', 'output')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                        restoretoworktree: [],
                      },
                      scan: { dir: 'build/output', files: '**/*' },
                    },
                  ],
                },
              },
              worktree: worktreeDir,
              gitdir: ospath.join(worktreeDir, '.git'),
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      // Should not restore anything but should not error
      const infoMessages = generatorContext.messages.filter((m) => m.level === 'info')
      expect(infoMessages.some((m) => m.msg.includes('Cache HIT'))).to.be.true()
    })
  })

  describe('edge cases', () => {
    it('should handle invalid JSON in pointer file', async () => {
      const sourceContent = 'int main() { return 0; }'
      createSourceFile(worktreeDir, 'src/main.c', sourceContent)

      const sourceHash = computeFileHash(sourceContent)
      const contentHash = crypto.createHash('sha256').update(sourceHash).digest('hex')

      // Create invalid pointer file
      const hashDir = ospath.join(playbookDir, '.cache/antora/collector-cache/hashes/test-component/build')
      fs.mkdirSync(hashDir, { recursive: true })
      fs.writeFileSync(ospath.join(hashDir, `${contentHash}.json`), 'not valid json {{{', 'utf8')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: worktreeDir,
              gitdir: ospath.join(worktreeDir, '.git'),
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      const warnMessages = generatorContext.messages.filter((m) => m.level === 'warn')
      expect(warnMessages.some((m) => m.msg.includes('Failed to read pointer file'))).to.be.true()
    })

    it('should handle empty output directory (no files)', async () => {
      const sourceContent = 'int main() { return 0; }'
      createSourceFile(worktreeDir, 'src/main.c', sourceContent)

      const sourceHash = computeFileHash(sourceContent)
      const contentHash = crypto.createHash('sha256').update(sourceHash).digest('hex')

      // Create cache structure with empty output directory
      const hashDir = ospath.join(playbookDir, '.cache/antora/collector-cache/hashes/test-component/build')
      const outputDir = ospath.join(playbookDir, '.cache/antora/collector-cache/outputs', contentHash, 'build/output')
      fs.mkdirSync(hashDir, { recursive: true })
      fs.mkdirSync(outputDir, { recursive: true }) // Empty directory

      const pointer = { outputDir: contentHash, scanDir: 'build/output', sources: { 'src/main.c': sourceHash } }
      fs.writeFileSync(ospath.join(hashDir, `${contentHash}.json`), JSON.stringify(pointer), 'utf8')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: worktreeDir,
              gitdir: ospath.join(worktreeDir, '.git'),
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      // Should be cache MISS because outputs are empty
      const infoMessages = generatorContext.messages.filter((m) => m.level === 'info')
      expect(infoMessages.some((m) => m.msg.includes('Cache MISS') && m.msg.includes('cached outputs missing'))).to.be
        .true()
    })

    it('should handle output path that is a file not directory', async () => {
      const sourceContent = 'int main() { return 0; }'
      createSourceFile(worktreeDir, 'src/main.c', sourceContent)

      const sourceHash = computeFileHash(sourceContent)
      const contentHash = crypto.createHash('sha256').update(sourceHash).digest('hex')

      // Create cache structure where output path is a file
      const hashDir = ospath.join(playbookDir, '.cache/antora/collector-cache/hashes/test-component/build')
      const outputParent = ospath.join(playbookDir, '.cache/antora/collector-cache/outputs', contentHash)
      fs.mkdirSync(hashDir, { recursive: true })
      fs.mkdirSync(outputParent, { recursive: true })
      // Create a file where directory is expected
      fs.writeFileSync(ospath.join(outputParent, 'build'), 'this is a file', 'utf8')

      const pointer = { outputDir: contentHash, scanDir: 'build/output', sources: { 'src/main.c': sourceHash } }
      fs.writeFileSync(ospath.join(hashDir, `${contentHash}.json`), JSON.stringify(pointer), 'utf8')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: worktreeDir,
              gitdir: ospath.join(worktreeDir, '.git'),
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      // Should be cache MISS
      const infoMessages = generatorContext.messages.filter((m) => m.level === 'info')
      expect(infoMessages.some((m) => m.msg.includes('Cache MISS'))).to.be.true()
    })

    it('should handle nested empty directories', async () => {
      const sourceContent = 'int main() { return 0; }'
      createSourceFile(worktreeDir, 'src/main.c', sourceContent)

      const sourceHash = computeFileHash(sourceContent)
      const contentHash = crypto.createHash('sha256').update(sourceHash).digest('hex')

      // Create cache structure with nested empty directories
      const hashDir = ospath.join(playbookDir, '.cache/antora/collector-cache/hashes/test-component/build')
      const outputDir = ospath.join(playbookDir, '.cache/antora/collector-cache/outputs', contentHash, 'build/output')
      fs.mkdirSync(hashDir, { recursive: true })
      fs.mkdirSync(ospath.join(outputDir, 'subdir/nested'), { recursive: true }) // Nested empty dirs

      const pointer = { outputDir: contentHash, scanDir: 'build/output', sources: { 'src/main.c': sourceHash } }
      fs.writeFileSync(ospath.join(hashDir, `${contentHash}.json`), JSON.stringify(pointer), 'utf8')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: worktreeDir,
              gitdir: ospath.join(worktreeDir, '.git'),
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      // Should be cache MISS because no files in nested dirs
      const infoMessages = generatorContext.messages.filter((m) => m.level === 'info')
      expect(infoMessages.some((m) => m.msg.includes('Cache MISS'))).to.be.true()
    })

    it('should handle worktree that does not exist', async () => {
      const nonExistentWorktree = ospath.join(workDir, 'nonexistent-worktree')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: nonExistentWorktree,
              gitdir: ospath.join(nonExistentWorktree, '.git'),
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      const debugMessages = generatorContext.messages.filter((m) => m.level === 'debug')
      expect(debugMessages.some((m) => m.msg.includes('cache MISS'))).to.be.true()
    })
  })

  describe('copyDirectory in beforePublish', () => {
    it('should copy nested directory structure to cache', async () => {
      const sourceContent = 'int main() { return 0; }'
      createSourceFile(worktreeDir, 'src/main.c', sourceContent)

      // Create complex output directory structure
      const buildOutputDir = ospath.join(worktreeDir, 'build/output')
      createSourceFile(buildOutputDir, 'index.html', '<html></html>')
      createSourceFile(buildOutputDir, 'css/styles.css', 'body {}')
      createSourceFile(buildOutputDir, 'js/app.js', 'console.log("hi")')
      createSourceFile(buildOutputDir, 'images/logo.png', 'fake png data')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: worktreeDir,
              gitdir: ospath.join(worktreeDir, '.git'),
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })
      await generatorContext.beforePublish({ playbook })

      const infoMessages = generatorContext.messages.filter((m) => m.level === 'info')
      expect(infoMessages.some((m) => m.msg.includes('Cached outputs'))).to.be.true()

      // Find the cache directory and verify structure
      const cacheOutputsDir = ospath.join(playbookDir, '.cache/antora/collector-cache/outputs')
      expect(fs.existsSync(cacheOutputsDir)).to.be.true()

      const hashDirs = fs.readdirSync(cacheOutputsDir)
      expect(hashDirs.length).to.be.greaterThan(0)

      const cachedDir = ospath.join(cacheOutputsDir, hashDirs[0], 'build/output')
      expect(fs.existsSync(ospath.join(cachedDir, 'index.html'))).to.be.true()
      expect(fs.existsSync(ospath.join(cachedDir, 'css/styles.css'))).to.be.true()
      expect(fs.existsSync(ospath.join(cachedDir, 'js/app.js'))).to.be.true()
    })

    it('should overwrite existing cache directory', async () => {
      const sourceContent = 'int main() { return 0; }'
      createSourceFile(worktreeDir, 'src/main.c', sourceContent)

      // Create output
      const buildOutputDir = ospath.join(worktreeDir, 'build/output')
      createSourceFile(buildOutputDir, 'new.txt', 'new content')

      // Pre-create cache with old content
      const sourceHash = computeFileHash(sourceContent)
      const contentHash = crypto.createHash('sha256').update(sourceHash).digest('hex')
      const existingCacheDir = ospath.join(
        playbookDir,
        '.cache/antora/collector-cache/outputs',
        contentHash,
        'build/output'
      )
      createSourceFile(existingCacheDir, 'old.txt', 'old content')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: worktreeDir,
              gitdir: ospath.join(worktreeDir, '.git'),
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })
      await generatorContext.beforePublish({ playbook })

      // Old file should be gone, new file should exist
      expect(fs.existsSync(ospath.join(existingCacheDir, 'old.txt'))).to.be.false()
      expect(fs.existsSync(ospath.join(existingCacheDir, 'new.txt'))).to.be.true()
    })
  })

  describe('alternative config key casing', () => {
    it('should handle cacheDir with capital D', async () => {
      createSourceFile(worktreeDir, 'src/main.c', 'int main() {}')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cacheDir: 'build/output', // Capital D
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: worktreeDir,
              gitdir: ospath.join(worktreeDir, '.git'),
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      // Should process without errors
      const errorMessages = generatorContext.messages.filter((m) => m.level === 'error')
      expect(errorMessages).to.have.lengthOf(0)
    })

    it('should handle sourceCommands with capital C', async () => {
      createSourceFile(worktreeDir, 'src/main.c', 'int main() {}')
      createSourceFile(worktreeDir, 'src/extra.c', 'void extra() {}')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        sourceCommands: ['echo "src/extra.c"'], // Capital C
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: worktreeDir,
              gitdir: ospath.join(worktreeDir, '.git'),
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      const debugMessages = generatorContext.messages.filter((m) => m.level === 'debug')
      expect(debugMessages.some((m) => m.msg.includes('Resolving dynamic sources'))).to.be.true()
    })

    it('should handle dependsOn with capital O', async () => {
      createSourceFile(worktreeDir, 'src/main.c', 'int main() {}')
      createSourceFile(worktreeDir, 'lib/helper.c', 'void helper() {}')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'lib',
                        sources: ['lib/helper.c'],
                        cachedir: 'build/lib',
                        command: 'echo "lib"',
                      },
                    },
                    {
                      run: {
                        key: 'main',
                        sources: ['src/main.c'],
                        dependsOn: ['lib'], // Capital O
                        cachedir: 'build/main',
                        command: 'echo "main"',
                      },
                    },
                  ],
                },
              },
              worktree: worktreeDir,
              gitdir: ospath.join(worktreeDir, '.git'),
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      const debugMessages = generatorContext.messages.filter((m) => m.level === 'debug')
      expect(debugMessages.some((m) => m.msg.includes('Resolving dependencies'))).to.be.true()
    })

    it('should handle restoreToWorktree with capitals', async () => {
      const sourceContent = 'int main() { return 0; }'
      createSourceFile(worktreeDir, 'src/main.c', sourceContent)

      const sourceHash = computeFileHash(sourceContent)
      const contentHash = crypto.createHash('sha256').update(sourceHash).digest('hex')

      const hashDir = ospath.join(playbookDir, '.cache/antora/collector-cache/hashes/test-component/build')
      const outputDir = ospath.join(playbookDir, '.cache/antora/collector-cache/outputs', contentHash, 'build/output')
      fs.mkdirSync(hashDir, { recursive: true })
      fs.mkdirSync(outputDir, { recursive: true })

      const pointer = { outputDir: contentHash, scanDir: 'build/output', sources: { 'src/main.c': sourceHash } }
      fs.writeFileSync(ospath.join(hashDir, `${contentHash}.json`), JSON.stringify(pointer), 'utf8')
      createSourceFile(outputDir, 'generated.h', '#pragma once')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                        restoreToWorktree: ['**/*.h'], // Capital T and W
                      },
                      scan: { dir: 'build/output', files: '**/*' },
                    },
                  ],
                },
              },
              worktree: worktreeDir,
              gitdir: ospath.join(worktreeDir, '.git'),
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      expect(fs.existsSync(ospath.join(worktreeDir, 'build/output/generated.h'))).to.be.true()
    })
  })

  describe('DRY_RUN mode', () => {
    let originalExit
    let exitCode

    beforeEach(() => {
      originalExit = process.exit
      exitCode = null
      process.exit = (code) => {
        exitCode = code
      }
    })

    afterEach(() => {
      process.exit = originalExit
      delete process.env.DRY_RUN
    })

    it('should exit early when DRY_RUN=true after cache check', async () => {
      process.env.DRY_RUN = 'true'

      createSourceFile(worktreeDir, 'src/main.c', 'int main() {}')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: worktreeDir,
              gitdir: ospath.join(worktreeDir, '.git'),
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      const infoMessages = generatorContext.messages.filter((m) => m.level === 'info')
      expect(infoMessages.some((m) => m.msg.includes('DRY RUN'))).to.be.true()
      expect(exitCode).to.equal(0)
    })
  })

  describe('remote build scenarios', () => {
    const git = require('isomorphic-git')

    const initBareRepo = async (repoDir) => {
      fs.mkdirSync(repoDir, { recursive: true })
      await git.init({ fs, dir: repoDir, bare: false })
      // Create initial commit
      fs.writeFileSync(ospath.join(repoDir, 'README.md'), '# Test Repo', 'utf8')
      await git.add({ fs, dir: repoDir, filepath: 'README.md' })
      await git.commit({
        fs,
        dir: repoDir,
        message: 'Initial commit',
        author: { name: 'Test', email: 'test@test.com' },
      })
    }

    it('should detect remote build when gitdir is outside worktree', async () => {
      // Set up a remote-style build (gitdir separate from worktree)
      const remoteGitdir = ospath.join(workDir, 'remote-gitdir')
      const remoteWorktree = ospath.join(workDir, 'remote-worktree')
      fs.mkdirSync(remoteGitdir, { recursive: true })
      fs.mkdirSync(remoteWorktree, { recursive: true })

      createSourceFile(remoteWorktree, 'src/main.c', 'int main() {}')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: remoteWorktree,
              gitdir: remoteGitdir, // Different from worktree
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      const debugMessages = generatorContext.messages.filter((m) => m.level === 'debug')
      expect(debugMessages.some((m) => m.msg.includes('Remote build detected'))).to.be.true()
    })

    it('should find existing worktree in collector cache', async () => {
      // Set up collector cache with existing worktree (relative to playbookDir)
      const collectorCacheDir = ospath.join(playbookDir, '.cache/antora/collector')
      const existingWorktree = ospath.join(collectorCacheDir, 'test-repo@main-abc123')
      fs.mkdirSync(existingWorktree, { recursive: true })
      createSourceFile(existingWorktree, 'src/main.c', 'int main() {}')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              // No worktree provided - should find it
              worktree: undefined,
              url: 'https://github.com/example/test-repo.git',
              gitdir: ospath.join(workDir, 'gitdir'),
              refname: 'main',
              reftype: 'branch',
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      const debugMessages = generatorContext.messages.filter((m) => m.level === 'debug')
      expect(debugMessages.some((m) => m.msg.includes('Found worktree'))).to.be.true()
    })

    it('should update worktree via git operations for remote builds', async () => {
      // Create a real git repo to test git operations
      const repoDir = ospath.join(workDir, 'repo')
      await initBareRepo(repoDir)

      createSourceFile(repoDir, 'src/main.c', 'int main() {}')
      await git.add({ fs, dir: repoDir, filepath: 'src/main.c' })
      await git.commit({
        fs,
        dir: repoDir,
        message: 'Add source file',
        author: { name: 'Test', email: 'test@test.com' },
      })

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: repoDir,
              gitdir: ospath.join(repoDir, '.git'),
              refname: 'main',
              reftype: 'branch',
              url: 'file://' + repoDir,
              remote: 'origin',
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      // Should process without errors (git operations happen for remote builds)
      const errorMessages = generatorContext.messages.filter((m) => m.level === 'error')
      expect(errorMessages).to.have.lengthOf(0)
    })

    it('should handle git fetch errors gracefully', async () => {
      // Create a context with a git mock that throws on fetch
      const mockGit = createMockGit({
        fetch: spy(async () => {
          throw new Error('Fetch failed: could not resolve host')
        }),
      })
      const context = createGeneratorContext({ git: mockGit })

      // Create repo with gitdir OUTSIDE worktree to trigger remote build code path
      const repoDir = ospath.join(workDir, 'repo-no-remote')
      const separateGitdir = ospath.join(workDir, 'separate-gitdir')
      await initBareRepo(repoDir)
      createSourceFile(repoDir, 'src/main.c', 'int main() {}')
      // Copy .git to separate location
      fs.cpSync(ospath.join(repoDir, '.git'), separateGitdir, { recursive: true })

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: repoDir,
              gitdir: separateGitdir, // Outside worktree to trigger remote build path
              refname: 'main',
              reftype: 'branch',
              url: 'https://invalid.example.com/nonexistent.git', // Invalid URL
              remote: 'origin',
            },
          ],
        },
      ]

      ext.register.call(context, { playbook })
      await context.contentAggregated({ playbook, contentAggregate })

      // Should warn about fetch failure but not crash
      const warnMessages = context.messages.filter((m) => m.level === 'warn')
      expect(warnMessages.some((m) => m.msg.includes('Failed to update worktree'))).to.be.true()
    })

    it('should handle tag reftype correctly', async () => {
      const repoDir = ospath.join(workDir, 'repo-tag')
      await initBareRepo(repoDir)
      createSourceFile(repoDir, 'src/main.c', 'int main() {}')
      await git.add({ fs, dir: repoDir, filepath: 'src/main.c' })
      await git.commit({
        fs,
        dir: repoDir,
        message: 'Add source',
        author: { name: 'Test', email: 'test@test.com' },
      })
      await git.tag({ fs, dir: repoDir, ref: 'v1.0.0' })

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: repoDir,
              gitdir: ospath.join(repoDir, '.git'),
              refname: 'v1.0.0',
              reftype: 'tag', // Tag instead of branch
              tag: 'v1.0.0',
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      // Should process tags without error
      const errorMessages = generatorContext.messages.filter((m) => m.level === 'error')
      expect(errorMessages).to.have.lengthOf(0)
    })

    it('should create worktree when none exists for remote build', async () => {
      // This tests the worktree creation path when no worktree is found
      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              // No worktree, and it can't be found
              worktree: undefined,
              url: 'https://github.com/example/new-repo.git',
              gitdir: ospath.join(workDir, 'new-gitdir'),
              refname: 'main',
              reftype: 'branch',
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      const infoMessages = generatorContext.messages.filter((m) => m.level === 'info')
      expect(infoMessages.some((m) => m.msg.includes('No worktree found'))).to.be.true()
    })
  })

  describe('collector array initialization', () => {
    it('should initialize collector array if not present', async () => {
      createSourceFile(worktreeDir, 'src/main.c', 'int main() {}')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                  // No collector array initially
                },
              },
              worktree: worktreeDir,
              gitdir: ospath.join(worktreeDir, '.git'),
            },
          ],
        },
      ]

      ext.register.call(generatorContext, { playbook })
      await generatorContext.contentAggregated({ playbook, contentAggregate })

      // Collector array should be initialized
      expect(contentAggregate[0].origins[0].descriptor.ext.collector).to.be.an('array')
    })
  })

  describe('mocked remote build scenarios', () => {
    it('should clone repository when no worktree exists', async () => {
      const mockGit = createMockGit()
      const mockSpawn = createMockSpawn(0, '', '')
      const context = createGeneratorContext({
        git: mockGit,
        childProcess: createMockChildProcess(mockSpawn),
      })

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: undefined,
              url: 'https://github.com/example/test-repo.git',
              gitdir: ospath.join(workDir, 'gitdir'),
              refname: 'main',
              reftype: 'branch',
            },
          ],
        },
      ]

      ext.register.call(context, { playbook })
      await context.contentAggregated({ playbook, contentAggregate })

      // Git clone should have been called
      expect(mockGit.clone).to.have.been.called()

      const infoMessages = context.messages.filter((m) => m.level === 'info')
      expect(infoMessages.some((m) => m.msg.includes('No worktree found'))).to.be.true()
    })

    it('should initialize submodules after cloning', async () => {
      const mockGit = createMockGit()
      const context = createGeneratorContext({ git: mockGit })

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: undefined,
              url: 'https://github.com/example/test-repo.git',
              gitdir: ospath.join(workDir, 'gitdir'),
              refname: 'main',
              reftype: 'branch',
            },
          ],
        },
      ]

      ext.register.call(context, { playbook })
      await context.contentAggregated({ playbook, contentAggregate })

      // Git clone should have been called (spawn for submodules uses direct require, can't mock)
      expect(mockGit.clone).to.have.been.called()

      // Should log that submodule init is being attempted
      const debugMessages = context.messages.filter((m) => m.level === 'debug')
      expect(debugMessages.some((m) => m.msg.includes('Initializing submodules'))).to.be.true()
    })

    it('should handle submodule init failure gracefully', async () => {
      const mockGit = createMockGit()
      const mockSpawn = createMockSpawn(1, '', 'submodule error')
      const context = createGeneratorContext({
        git: mockGit,
        childProcess: createMockChildProcess(mockSpawn),
      })

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: undefined,
              url: 'https://github.com/example/test-repo.git',
              gitdir: ospath.join(workDir, 'gitdir'),
              refname: 'main',
              reftype: 'branch',
            },
          ],
        },
      ]

      ext.register.call(context, { playbook })
      await context.contentAggregated({ playbook, contentAggregate })

      // Should not error even if submodule init fails
      const errorMessages = context.messages.filter((m) => m.level === 'error')
      expect(errorMessages.filter((m) => m.msg.includes('submodule'))).to.have.lengthOf(0)
    })

    it('should handle git clone failure', async () => {
      const mockGit = createMockGit({
        clone: spy(async () => {
          throw new Error('Clone failed: network error')
        }),
      })
      const context = createGeneratorContext({ git: mockGit })

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: undefined,
              url: 'https://github.com/example/test-repo.git',
              gitdir: ospath.join(workDir, 'gitdir'),
              refname: 'main',
              reftype: 'branch',
            },
          ],
        },
      ]

      ext.register.call(context, { playbook })
      await context.contentAggregated({ playbook, contentAggregate })

      // Should log error but not crash
      const errorMessages = context.messages.filter((m) => m.level === 'error')
      expect(errorMessages.some((m) => m.msg.includes('Failed to create worktree'))).to.be.true()
    })

    it('should call git fetch for remote build with existing worktree', async () => {
      const mockGit = createMockGit()
      const context = createGeneratorContext({ git: mockGit })

      // Create worktree directory
      const remoteWorktree = ospath.join(workDir, 'remote-worktree')
      fs.mkdirSync(remoteWorktree, { recursive: true })
      createSourceFile(remoteWorktree, 'src/main.c', 'int main() {}')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: remoteWorktree,
              gitdir: ospath.join(workDir, 'remote-gitdir'),
              refname: 'main',
              reftype: 'branch',
              url: 'https://github.com/example/test-repo.git',
              remote: 'origin',
            },
          ],
        },
      ]

      ext.register.call(context, { playbook })
      await context.contentAggregated({ playbook, contentAggregate })

      // Git fetch should have been called for remote builds
      expect(mockGit.fetch).to.have.been.called()
    })

    it('should call git branch and checkout for remote build', async () => {
      const mockGit = createMockGit()
      const context = createGeneratorContext({ git: mockGit })

      const remoteWorktree = ospath.join(workDir, 'remote-worktree')
      fs.mkdirSync(remoteWorktree, { recursive: true })
      createSourceFile(remoteWorktree, 'src/main.c', 'int main() {}')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: remoteWorktree,
              gitdir: ospath.join(workDir, 'remote-gitdir'),
              refname: 'main',
              reftype: 'branch',
              url: 'https://github.com/example/test-repo.git',
              remote: 'origin',
            },
          ],
        },
      ]

      ext.register.call(context, { playbook })
      await context.contentAggregated({ playbook, contentAggregate })

      // Git branch and checkout should have been called
      expect(mockGit.branch).to.have.been.called()
      expect(mockGit.checkout).to.have.been.called()
    })

    it('should handle git fetch error gracefully with mocks', async () => {
      const mockGit = createMockGit({
        fetch: spy(async () => {
          throw new Error('Fetch failed: network error')
        }),
      })
      const context = createGeneratorContext({ git: mockGit })

      const remoteWorktree = ospath.join(workDir, 'remote-worktree')
      fs.mkdirSync(remoteWorktree, { recursive: true })
      createSourceFile(remoteWorktree, 'src/main.c', 'int main() {}')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: remoteWorktree,
              gitdir: ospath.join(workDir, 'remote-gitdir'),
              refname: 'main',
              reftype: 'branch',
              url: 'https://github.com/example/test-repo.git',
              remote: 'origin',
            },
          ],
        },
      ]

      ext.register.call(context, { playbook })
      await context.contentAggregated({ playbook, contentAggregate })

      // Should warn but not crash
      const warnMessages = context.messages.filter((m) => m.level === 'warn')
      expect(warnMessages.some((m) => m.msg.includes('Failed to update worktree'))).to.be.true()
    })

    it('should handle spawn error event', async () => {
      const mockGit = createMockGit()
      const errorSpawn = spy(() => {
        const proc = new EventEmitter()
        proc.stdout = new EventEmitter()
        proc.stderr = new EventEmitter()
        setImmediate(() => {
          proc.emit('error', new Error('spawn ENOENT'))
        })
        return proc
      })
      const context = createGeneratorContext({
        git: mockGit,
        childProcess: createMockChildProcess(errorSpawn),
      })

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: undefined,
              url: 'https://github.com/example/test-repo.git',
              gitdir: ospath.join(workDir, 'gitdir'),
              refname: 'main',
              reftype: 'branch',
            },
          ],
        },
      ]

      ext.register.call(context, { playbook })
      await context.contentAggregated({ playbook, contentAggregate })

      // Should handle spawn error gracefully
      const debugMessages = context.messages.filter((m) => m.level === 'debug')
      expect(debugMessages.some((m) => m.msg.includes('Failed to run git submodule'))).to.be.true()
    })
  })

  describe('beforePublish with mocked remote builds', () => {
    it('should find worktree in collector cache during beforePublish', async () => {
      const mockGit = createMockGit()
      const context = createGeneratorContext({ git: mockGit })

      // Set up collector cache with worktree
      const collectorCacheDir = ospath.join(playbookDir, '.cache/antora/collector')
      const worktreeName = 'test-repo@main-abc123'
      const collectorWorktree = ospath.join(collectorCacheDir, worktreeName)
      fs.mkdirSync(collectorWorktree, { recursive: true })
      createSourceFile(collectorWorktree, 'src/main.c', 'int main() {}')
      createSourceFile(collectorWorktree, 'build/output/result.txt', 'build result')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: undefined,
              url: 'https://github.com/example/test-repo.git',
              gitdir: ospath.join(workDir, 'gitdir'),
              refname: 'main',
              reftype: 'branch',
            },
          ],
        },
      ]

      ext.register.call(context, { playbook })
      await context.contentAggregated({ playbook, contentAggregate })
      await context.beforePublish({ playbook })

      // Should find worktree and cache outputs
      const debugMessages = context.messages.filter((m) => m.level === 'debug')
      expect(debugMessages.some((m) => m.msg.includes('Found worktree'))).to.be.true()
    })

    it('should warn when worktree not found in beforePublish', async () => {
      const mockGit = createMockGit()
      const context = createGeneratorContext({ git: mockGit })

      // Don't create the worktree
      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: undefined,
              url: 'https://github.com/example/test-repo.git',
              gitdir: ospath.join(workDir, 'gitdir'),
              refname: 'main',
              reftype: 'branch',
            },
          ],
        },
      ]

      ext.register.call(context, { playbook })
      await context.contentAggregated({ playbook, contentAggregate })
      await context.beforePublish({ playbook })

      const warnMessages = context.messages.filter((m) => m.level === 'warn')
      expect(warnMessages.some((m) => m.msg.includes('Worktree not found'))).to.be.true()
    })

    it('should compute hashes during beforePublish for remote builds', async () => {
      const mockGit = createMockGit()
      const context = createGeneratorContext({ git: mockGit })

      // Set up collector cache with worktree and outputs
      const collectorCacheDir = ospath.join(playbookDir, '.cache/antora/collector')
      const worktreeName = 'test-repo@main-abc123'
      const collectorWorktree = ospath.join(collectorCacheDir, worktreeName)
      fs.mkdirSync(collectorWorktree, { recursive: true })
      createSourceFile(collectorWorktree, 'src/main.c', 'int main() {}')
      createSourceFile(collectorWorktree, 'build/output/result.txt', 'build result')

      const contentAggregate = [
        {
          name: 'test-component',
          origins: [
            {
              descriptor: {
                ext: {
                  collectorCache: [
                    {
                      run: {
                        key: 'build',
                        sources: ['src/main.c'],
                        cachedir: 'build/output',
                        command: 'echo "building"',
                      },
                    },
                  ],
                },
              },
              worktree: undefined,
              url: 'https://github.com/example/test-repo.git',
              gitdir: ospath.join(workDir, 'gitdir'),
              refname: 'main',
              reftype: 'branch',
            },
          ],
        },
      ]

      ext.register.call(context, { playbook })
      await context.contentAggregated({ playbook, contentAggregate })
      await context.beforePublish({ playbook })

      // Should have cached outputs
      const infoMessages = context.messages.filter((m) => m.level === 'info')
      expect(infoMessages.some((m) => m.msg.includes('Cached outputs'))).to.be.true()
    })
  })
})