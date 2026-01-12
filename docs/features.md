# Features

## Content-Addressable Caching

Outputs are stored by hash, enabling efficient caching and automatic deduplication.

### How Caching Works

1. **Source hash**: SHA-256 hash of each source file's content
2. **Content hash**: SHA-256 of (sorted source hashes + command)
3. **Output hash**: SHA-256 of the actual build output files

The content hash determines whether to use cached outputs. The output hash determines where outputs are stored.

### Cache HIT

When a cache entry exists and outputs are available:

1. Cached outputs are restored to the worktree
2. The build command is skipped (replaced with no-op)
3. Scan proceeds normally from restored outputs

```
[info] Cache HIT for my-component/build (content: a1b2c3d4e5f6...)
```

### Cache MISS

When no matching cache entry exists:

1. Build command runs normally
2. After build, outputs are cached
3. Pointer file created mapping content hash to output location

```
[info] Cache MISS for my-component/build (no cache entry)
[info] Cached outputs for my-component/build → f6e5d4c3b2a1...
```

## Deduplication

When different source files produce identical outputs, they share the same cached files.

### How It Works

After a build completes:
1. Output files are hashed
2. If identical outputs already exist in cache, no copy is made
3. A new pointer file is created referencing the existing outputs

```
[info] Deduplicated: my-component/build → a1b2c3d4... (already cached)
```

### Benefits

- Reduced disk usage when multiple versions produce same output
- Faster cache updates (skip copy when outputs match)
- Automatic without configuration

## Dependencies

Entries can depend on other entries, combining their sources for hash calculation.

### Basic Usage

```yaml
ext:
  collector-cache:
    - run:
        key: library
        sources:
          - lib/**/*.c
          - lib/**/*.h
        cache-dir: build/lib
        command: make lib

    - run:
        key: application
        sources:
          - src/**/*.c
        depends-on:
          - library
        cache-dir: build/app
        command: make app
```

The `application` entry's cache hash includes sources from both itself AND `library`.

### Recursive Dependencies

Dependencies are resolved recursively:

```yaml
- run:
    key: base
    sources: [base/**/*]
    ...

- run:
    key: utils
    sources: [utils/**/*]
    depends-on: [base]
    ...

- run:
    key: app
    sources: [app/**/*]
    depends-on: [utils]  # Also includes base sources
    ...
```

### Circular Dependency Detection

Circular dependencies are detected and logged:

```
[warn] Circular dependency detected: app -> utils -> app
```

The circular reference is skipped, and the build continues.

## Local Development Protection

When working locally, the extension protects uncommitted changes.

### Detection

Local development is detected when the git directory is inside the worktree:
- Local: `worktree/.git` (gitdir inside worktree)
- Remote: gitdir and worktree in separate cache directories

### Behavior

In local development mode:
- Git fetch/checkout operations are skipped
- Uncommitted changes are preserved
- Caching still works normally

```
[info] Local development detected for my-component - skipping git operations
```

## Cache Structure

```
.cache/antora/collector-cache/
├── hashes/
│   └── <component>/
│       └── <key>/
│           └── <content-hash>.json    # Pointer files
└── outputs/
    └── <output-hash>/
        └── <cache-dir>/               # Cached outputs
```

### Pointer Files

JSON files mapping content hash to output location:

```json
{
  "version": 2,
  "outputDir": "<output-hash>",
  "scanDir": "build/output",
  "sources": {
    "src/main.c": "<file-hash>",
    "include/header.h": "<file-hash>"
  },
  "command": "make build",
  "timestamp": "2025-01-12T10:30:00.000Z"
}
```

### Backwards Compatibility

Pointer files without a `version` field are treated as version 1 (legacy format). The extension handles both formats transparently.
