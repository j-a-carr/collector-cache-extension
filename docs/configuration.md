# Configuration Reference

## Entry Structure

Each cache entry has two parts: `run` (build configuration) and `scan` (output configuration).

```yaml
ext:
  collector-cache:
    - run:
        # Build configuration
      scan:
        # Output configuration
```

## Run Configuration

| Property | Required | Description |
|----------|----------|-------------|
| `key` | Yes | Unique identifier for this cache entry |
| `sources` | Yes | Array of source file paths or glob patterns |
| `cache-dir` | Yes | Directory where build outputs are stored |
| `command` | Yes | The build command to execute |
| `depends-on` | No | Array of other entry keys this depends on |
| `source-commands` | No | Shell commands that output additional source paths |
| `restore-to-worktree` | No | Glob patterns for files to restore from cache |

### key

Unique identifier used for:
- Cache directory organization
- Dependency references from other entries
- Logging and debugging

```yaml
run:
  key: firmware-build
```

### sources

Source files to track for changes. Supports glob patterns.

```yaml
run:
  sources:
    - src/main.c           # Single file
    - include/**/*.h       # Glob pattern
    - config.json          # Any file type
```

Glob patterns use [fast-glob](https://github.com/mrmlnc/fast-glob) syntax:
- `*` - Match any characters except `/`
- `**` - Match any characters including `/`
- `?` - Match single character
- `[abc]` - Match any character in brackets
- `{a,b}` - Match any pattern in braces

### cache-dir

Directory containing build outputs, relative to worktree.

```yaml
run:
  cache-dir: build/output
```

### command

Shell command to execute. The command is included in the cache hash, so changing the command invalidates the cache.

```yaml
run:
  command: make build RELEASE=1
```

### depends-on

Reference other cache entries by their `key`. Sources from dependencies are combined for hash calculation.

```yaml
run:
  key: app
  depends-on:
    - library
    - utils
```

See [Dependencies](features.md#dependencies) for details.

### source-commands

Shell commands that output source file paths (one per line). Useful for dynamic source discovery.

```yaml
run:
  source-commands:
    - find . -name "*.generated.c"
    - cat .source-files
```

See [Dynamic Sources](advanced.md#dynamic-sources) for details.

### restore-to-worktree

Glob patterns for files to restore from cache to worktree on cache HIT. Useful when subsequent build steps need these files.

```yaml
run:
  restore-to-worktree:
    - build/generated/**/*.h
    - build/generated/**/*.c
```

See [File Restoration](advanced.md#file-restoration) for details.

## Scan Configuration

Defines how outputs are scanned into Antora. Can be a single entry or an array.

| Property | Description |
|----------|-------------|
| `dir` | Source directory containing generated files |
| `files` | Glob pattern for files to include |
| `into` | Destination path within the Antora component |

### Single Scan Entry

```yaml
scan:
  dir: build/docs
  files: '**/*.html'
  into: modules/ROOT/pages/generated
```

### Multiple Scan Entries

```yaml
scan:
  - dir: build/docs
    files: '**/*.html'
    into: modules/ROOT/pages/generated
  - dir: build/api
    files: '**/*.md'
    into: modules/API/pages
```

## Environment Variables

| Variable | Effect |
|----------|--------|
| `DRY_RUN=true` | Exit after cache check without running builds |
| `FORCE_COLLECTOR=true` | Force cache miss and rebuild all entries |

```bash
# Test cache logic without building
DRY_RUN=true npx antora playbook.yml

# Force rebuild everything
FORCE_COLLECTOR=true npx antora playbook.yml
```

## Configuration Formats

### Array Format (recommended)

```yaml
ext:
  collector-cache:
    - run: { ... }
      scan: { ... }
    - run: { ... }
      scan: { ... }
```

### Object Format

```yaml
ext:
  collector-cache:
    entries:
      - run: { ... }
        scan: { ... }
```

## Key Casing

YAML keys are normalized to lowercase by Antora. Both forms work:

| Canonical | Also Accepted |
|-----------|---------------|
| `cache-dir` | `cachedir`, `cacheDir` |
| `source-commands` | `sourcecommands`, `sourceCommands` |
| `depends-on` | `dependson`, `dependsOn` |
| `restore-to-worktree` | `restoretoworktree`, `restoreToWorktree` |
