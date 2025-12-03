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
  collector-cache:
    - run:
        key: firmware
        sources:
          - src/main.c
          - include/**/*.h
        cache-dir: build/output
        command: make build
      scan:
        - dir: build/output/docs
          files: '**/*.html'
          into: modules/ROOT/pages/generated
```

## Configuration

Each entry in `collector-cache` supports:

### Run Configuration

| Property | Description |
|----------|-------------|
| `run.key` | Unique identifier for this cache entry |
| `run.sources` | Array of source file paths or glob patterns (e.g., `src/*.c`, `include/**/*.h`) |
| `run.source-commands` | Optional shell commands that output additional source paths |
| `run.cache-dir` | Directory where build outputs are stored |
| `run.command` | The build command to execute |
| `run.depends-on` | Optional array of other entry keys this depends on |
| `run.restore-to-worktree` | Optional glob patterns for files to restore from cache to worktree |

### Scan Configuration

The `scan` property defines how outputs are scanned into Antora. It can be a single entry or an array:

| Property | Description |
|----------|-------------|
| `scan.dir` | Source directory containing generated files |
| `scan.files` | Glob pattern for files to include |
| `scan.into` | Destination path within the Antora component |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DRY_RUN=true` | Exit after cache check without running builds |
| `FORCE_COLLECTOR=true` | Force cache miss and rebuild |

## Development

### Prerequisites

* Node.js >= 18.0.0
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
