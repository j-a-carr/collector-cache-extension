# Getting Started

## Installation

```bash
npm install @carr-james/collector-cache-extension
```

**Requirements:** Node.js >= 18.17.0

## Basic Setup

Register the extension in your Antora playbook **before** the collector extension:

```yaml
antora:
  extensions:
    - require: '@carr-james/collector-cache-extension'
    - require: '@antora/collector-extension'
```

**Important:** The collector-cache extension must be listed before the collector extension so it can intercept and cache collector operations.

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
        dir: build/output/docs
        files: '**/*.html'
        into: modules/ROOT/pages/generated
```

## How It Works

1. **Before build**: The extension computes a hash of your source files and command
2. **Cache check**: If a matching cache entry exists, outputs are restored from cache (cache HIT)
3. **Build runs**: If no cache entry exists, the command runs normally (cache MISS)
4. **After build**: New outputs are cached for future builds

Cache entries are stored in `.cache/antora/collector-cache/` relative to your playbook directory.

## Quick Example

```yaml
# antora.yml
ext:
  collector-cache:
    - run:
        key: docs
        sources:
          - src/**/*.c
          - include/**/*.h
        cache-dir: build/docs
        command: doxygen Doxyfile
      scan:
        dir: build/docs/html
        files: '**/*.html'
        into: modules/API/pages
```

This configuration:
- Watches all `.c` and `.h` files for changes
- Runs `doxygen` only when source files change
- Caches the generated HTML documentation
- Scans the output into your Antora component

## Next Steps

- [Configuration Reference](configuration.md) - All configuration options
- [Features](features.md) - Caching, deduplication, and dependencies
- [Advanced Usage](advanced.md) - Dynamic sources, file restoration, and more
