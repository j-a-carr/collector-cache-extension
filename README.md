# Collector Cache Extension for Antora

Content-addressable caching extension for the Antora Collector Extension.

## Overview

This extension provides content-addressable caching for collector commands using source file hashes.
It automatically deduplicates outputs across different versions when source files match, significantly speeding up builds.

## Installation

```bash
npm install @carr-james/collector-cache-extension
```

## Usage

Register the extension in your Antora playbook:

```yaml
antora:
  extensions:
    - require: '@carr-james/collector-cache-extension'
```

Then configure caching in your component descriptor (`antora.yml`):

```yaml
ext:
  collectorCache:
    - run:
        key: my-build-step
        sources:
          - src/main.c
          - include/*.h
        cacheDir: .cache/build-output
        command: make build
      scan:
        dir: .cache/build-output
        files: '**/*.html'
```

## Configuration

Each entry in `collectorCache` supports:

| Property | Description |
|----------|-------------|
| `run.key` | Unique identifier for this cache entry |
| `run.sources` | Array of source file patterns to hash |
| `run.sourceCommands` | Optional shell commands that output additional source paths |
| `run.cacheDir` | Directory where outputs are stored |
| `run.command` | The build command to execute |
| `run.dependsOn` | Optional array of other entry keys this depends on |
| `run.restoreToWorktree` | Optional glob patterns for files to restore from cache |
| `scan` | Configuration for scanning outputs into Antora |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DRY_RUN=true` | Exit after cache check without running builds |
| `FORCE_COLLECTOR=true` | Force cache miss and rebuild |

## Development

### Prerequisites

* Node.js >= 16.0.0
* npm

### Setup

```bash
npm install
```

### Running Tests

```bash
npm test
```

### Running Linter

```bash
npm run lint
```

### Code Coverage

```bash
npm run coverage
```
