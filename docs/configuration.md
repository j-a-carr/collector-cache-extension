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
| `hash-transforms` | No | Per-entry transforms to normalize content before hashing |
| `hash-transforms-mode` | No | How entry transforms interact with globals (`extend`, `replace`, `ignore`) |

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

### hash-transforms

Per-entry transforms to normalize file content before hashing. This allows files with non-deterministic content (timestamps, version numbers) to produce consistent cache keys.

```yaml
run:
  hash-transforms:
    - pattern: "**/pom.xml"
      replace:
        - regex: "(<version>)[^<]+(</version>)"
          with: "$1NORMALIZED$2"
```

Each transform has:
- `pattern`: Glob pattern to match source files
- `replace`: Array of regex replacements to apply
  - `regex`: Regular expression pattern (JavaScript syntax)
  - `with`: Replacement string (supports `$1`, `$2` capture groups)
  - `flags`: Optional regex flags (default: `g`)

See [Hash Transforms](advanced.md#hash-transforms) for detailed usage.

### hash-transforms-mode

Controls how per-entry transforms interact with global transforms defined at the extension level.

| Mode | Behavior |
|------|----------|
| `extend` | Entry transforms applied AFTER global transforms (default) |
| `replace` | Only entry transforms used, globals ignored |
| `ignore` | No transforms applied to this entry |

```yaml
run:
  hash-transforms-mode: replace  # Only use entry-level transforms
  hash-transforms:
    - pattern: "**/*.xml"
      replace:
        - regex: "<timestamp>[^<]+</timestamp>"
          with: "<timestamp>NORMALIZED</timestamp>"
```

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

## Extension Configuration

Global settings defined at the playbook level apply to all components.

### hash_transforms

Global transforms applied to all entries across all components. Define at the extension level:

```yaml
antora:
  extensions:
    - require: '@carr-james/collector-cache-extension'
      hash_transforms:
        - pattern: "**/pom.xml"
          replace:
            - regex: "(<parent>[\\s\\S]*?<version>)[^<]+(</version>)"
              with: "$1NORMALIZED$2"
        - pattern: "**/build.gradle"
          replace:
            - regex: "version\\s*=\\s*['\"][^'\"]+['\"]"
              with: "version = 'NORMALIZED'"
```

Global transforms are applied BEFORE per-entry transforms (when using `extend` mode).

## Key Casing

Antora normalizes YAML keys using `camelCaseKeys()` from `@antora/content-aggregator`. The algorithm:
1. Convert the entire key to lowercase
2. Replace `_x` or `-x` with `X` (camelCase conversion)

**The result depends on what you write in YAML:**

| YAML Input | Normalized Result |
|------------|-------------------|
| `cache-dir` | `cacheDir` |
| `cache_dir` | `cacheDir` |
| `cacheDir` | `cachedir` |

Since users may write either `snake_case`/`kebab-case` or `camelCase`, the extension accepts both normalized forms:

| Recommended | Also Works |
|-------------|------------|
| `cache-dir` | `cacheDir`, `cache_dir` |
| `source-commands` | `sourceCommands`, `source_commands` |
| `depends-on` | `dependsOn`, `depends_on` |
| `restore-to-worktree` | `restoreToWorktree`, `restore_to_worktree` |
| `hash-transforms` | `hashTransforms`, `hash_transforms` |
| `hash-transforms-mode` | `hashTransformsMode`, `hash_transforms_mode` |

**Recommendation:** Use `kebab-case` (e.g., `cache-dir`) in YAML for consistency with Antora conventions.
