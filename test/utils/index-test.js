/* eslint-env mocha */
'use strict'

const { expect } = require('../harness')
const utils = require('../../lib/utils')

describe('utils/index', () => {
  it('should re-export hash utilities', () => {
    expect(utils.computeHashes).to.be.a('function')
    expect(utils.computeContentHash).to.be.a('function')
    expect(utils.computeHash).to.be.a('function')
  })

  it('should re-export fs utilities', () => {
    expect(utils.checkDirectoryHasFiles).to.be.a('function')
    expect(utils.checkOutputsExist).to.be.a('function')
    expect(utils.copyDirectory).to.be.a('function')
    expect(utils.findFilesMatchingPattern).to.be.a('function')
  })

  it('should re-export cache utilities', () => {
    expect(utils.loadPointerFile).to.be.a('function')
    expect(utils.savePointerFile).to.be.a('function')
    expect(utils.restoreFilesToWorktree).to.be.a('function')
  })

  it('should re-export git utilities', () => {
    expect(utils.generateWorktreeFolderName).to.be.a('function')
    expect(utils.isLocalDevelopment).to.be.a('function')
    expect(utils.buildRef).to.be.a('function')
  })

  it('should re-export sources utilities', () => {
    expect(utils.resolveSources).to.be.a('function')
    expect(utils.resolveDependencySources).to.be.a('function')
    expect(utils.buildEntriesMap).to.be.a('function')
  })
})