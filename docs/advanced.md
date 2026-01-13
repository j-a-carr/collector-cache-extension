# Advanced Usage

## Hash Transforms

Normalize file content before hashing to prevent cache misses from non-deterministic content like timestamps, version numbers, or build metadata.

### The Problem

Some build systems embed non-deterministic content in source files:
- Maven `pom.xml` with SNAPSHOT versions that change frequently
- Build files with timestamps or git commit hashes
- Generated files with build dates

Without transforms, these files cause cache misses even when the "real" content hasn't changed.

### Basic Usage

Define transforms at the extension level (global) or per-entry:

```yaml
# Global transforms (in playbook)
antora:
  extensions:
    - require: '@carr-james/collector-cache-extension'
      hash_transforms:
        - pattern: "**/pom.xml"
          replace:
            - regex: "(<version>)[^<]+(</version>)"
              with: "$1NORMALIZED$2"
```

```yaml
# Per-entry transforms (in antora.yml)
ext:
  collector-cache:
    - run:
        key: build
        sources: ['pom.xml', 'src/**/*.java']
        hash-transforms:
          - pattern: "**/config.xml"
            replace:
              - regex: "<timestamp>[^<]+</timestamp>"
                with: "<timestamp>NORMALIZED</timestamp>"
        cache-dir: target/docs
        command: mvn generate-sources
```

### Transform Structure

Each transform consists of:

```yaml
hash_transforms:
  - pattern: "**/*.xml"           # Glob pattern to match files
    replace:
      - regex: "<date>[^<]+"      # JavaScript regex pattern
        with: "<date>NORMALIZED"  # Replacement (supports $1, $2, etc.)
        flags: "g"                # Optional: regex flags (default: "g")
      - regex: "..."              # Multiple replacements per pattern
        with: "..."
```

### Transform Modes

Control how per-entry transforms interact with global transforms:

| Mode | Behavior |
|------|----------|
| `extend` | Global transforms first, then entry transforms (default) |
| `replace` | Only entry transforms, ignore globals |
| `ignore` | No transforms for this entry |

```yaml
ext:
  collector-cache:
    # Use both global and entry transforms
    - run:
        key: with-extra-transforms
        hash-transforms:
          - pattern: "**/*.properties"
            replace:
              - regex: "build.date=.*"
                with: "build.date=NORMALIZED"
        # hash-transforms-mode: extend  # Default

    # Use only entry transforms
    - run:
        key: custom-only
        hash-transforms-mode: replace
        hash-transforms:
          - pattern: "**/*"
            replace:
              - regex: "timestamp=\\d+"
                with: "timestamp=0"

    # No transforms (raw file hashes)
    - run:
        key: no-transforms
        hash-transforms-mode: ignore
```

### Common Patterns

**Maven pom.xml versions:**
```yaml
hash_transforms:
  - pattern: "**/pom.xml"
    replace:
      # Normalize SNAPSHOT versions
      - regex: "(<version>)[^<]*-SNAPSHOT(</version>)"
        with: "$1SNAPSHOT$2"
      # Normalize parent version
      - regex: "(<parent>[\\s\\S]*?<version>)[^<]+(</version>)"
        with: "$1NORMALIZED$2"
```

**Gradle build files:**
```yaml
hash_transforms:
  - pattern: "**/build.gradle"
    replace:
      - regex: "version\\s*=\\s*['\"][^'\"]+['\"]"
        with: "version = 'NORMALIZED'"
```

**Build metadata:**
```yaml
hash_transforms:
  - pattern: "**/version.txt"
    replace:
      - regex: "^.*$"
        with: "NORMALIZED"
        flags: "gm"  # Multiline mode
```

**Timestamps in various formats:**
```yaml
hash_transforms:
  - pattern: "**/*.xml"
    replace:
      # ISO 8601 timestamps
      - regex: "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}"
        with: "NORMALIZED_TIMESTAMP"
      # Unix timestamps
      - regex: "timestamp=['\"]?\\d{10,13}['\"]?"
        with: "timestamp=0"
```

### Debugging Transforms

When transforms are applied, the pointer file records which files were transformed:

```json
{
  "version": 2,
  "outputDir": "abc123...",
  "sources": { "pom.xml": "def456..." },
  "transforms": {
    "applied": ["pom.xml"],
    "mode": "extend",
    "patterns": ["**/pom.xml"]
  }
}
```

Check pointer files to verify transforms are working:

```bash
cat .cache/antora/collector-cache/hashes/<component>/<key>/*.json | jq .transforms
```

### Tips

1. **Be specific with patterns**: Use specific glob patterns to avoid transforming unintended files
2. **Order matters**: When using `extend` mode, global transforms run first
3. **Test your regexes**: Use JavaScript regex syntax; test patterns before deploying
4. **Use capture groups**: Preserve surrounding content with `$1`, `$2`, etc.
5. **Consider multiline**: Use `flags: "gm"` for patterns spanning lines

## Dynamic Sources

Use `source-commands` to discover source files at runtime.

### Basic Usage

```yaml
run:
  key: generated-docs
  sources:
    - docs/**/*.md
  source-commands:
    - find src -name "*.adoc"
    - cat .extra-sources
  cache-dir: build/docs
  command: make docs
```

Commands are executed with `sh -c` in the worktree directory. Each command should output file paths separated by newlines.

### Use Cases

**Discover generated files:**
```yaml
source-commands:
  - find . -name "*.generated.c"
```

**Read from a manifest:**
```yaml
source-commands:
  - cat SOURCE_FILES.txt
```

**Complex discovery:**
```yaml
source-commands:
  - git ls-files '*.proto' | xargs -I{} dirname {} | sort -u | xargs -I{} find {} -name '*.pb.go'
```

### Error Handling

If a source command fails:
- A warning is logged
- The entry proceeds without those sources
- Build may still succeed if other sources are sufficient

## File Restoration

Use `restore-to-worktree` to restore cached files that subsequent steps need.

### Problem

The collector extension deletes scan directories before running commands. If you cache build outputs but a later step needs those files, they won't be available on cache HIT.

### Solution

```yaml
run:
  key: code-gen
  sources:
    - specs/**/*.yaml
  cache-dir: build/generated
  command: ./generate.sh
  restore-to-worktree:
    - build/generated/**/*.h
    - build/generated/**/*.c
```

On cache HIT, matching files are copied from the cache to the worktree before the collector runs.

### Common Patterns

**Restore headers for compilation:**
```yaml
restore-to-worktree:
  - build/include/**/*.h
```

**Restore intermediate build artifacts:**
```yaml
restore-to-worktree:
  - build/obj/**/*.o
  - build/lib/**/*.a
```

## Multiple Scan Directories

Scan outputs from multiple directories into different Antora locations.

```yaml
- run:
    key: full-build
    sources: [src/**/*]
    cache-dir: build
    command: make all
  scan:
    - dir: build/html
      files: '**/*.html'
      into: modules/ROOT/pages/generated
    - dir: build/api
      files: '**/*.adoc'
      into: modules/API/pages
    - dir: build/assets
      files: '**/*.{png,svg}'
      into: modules/ROOT/assets/images
```

## Custom Cache Directory

Override the default cache location.

### Per-Playbook

```yaml
# antora-playbook.yml
runtime:
  cache_dir: .my-cache
```

Cache will be at `.my-cache/collector-cache/` instead of `.cache/antora/collector-cache/`.

## Debugging

### Dry Run Mode

Test cache logic without running builds:

```bash
DRY_RUN=true npx antora playbook.yml
```

Output shows what would happen:
```
[info] Cache HIT for component/entry (content: abc123...)
[info] Cache MISS for component/other (no cache entry)
[info] DRY RUN complete - exiting
```

### Force Rebuild

Bypass cache and rebuild everything:

```bash
FORCE_COLLECTOR=true npx antora playbook.yml
```

### Log Levels

The extension uses Antora's logger:

| Level | Information |
|-------|-------------|
| `info` | Cache HIT/MISS, caching results, deduplication |
| `debug` | File resolution, hash computation, git operations |
| `warn` | Configuration issues, missing files, recoverable errors |
| `error` | Critical failures |

Increase log level in your playbook:

```yaml
runtime:
  log:
    level: debug
```

## Remote Builds

For CI/CD environments where content is fetched from remote repositories.

### Automatic Worktree Management

The extension automatically:
1. Creates worktrees for remote content sources
2. Initializes git submodules
3. Updates worktrees to the correct ref

### Git Operations

For remote builds, the extension performs:
- `git fetch` to get latest refs
- `git branch` to create/update local branches
- `git checkout` to update worktree files

These operations are skipped in local development mode.

## Integration with Collector Extension

The collector-cache extension works alongside the standard collector extension.

### Entry Transformation

On cache HIT:
- Original `run.command` replaced with `true` (no-op)
- `scan` configuration preserved
- Outputs restored from cache before scan

On cache MISS:
- Entry passed to collector unchanged
- After build, outputs cached for future use

### Mixed Entries

You can have both cached and non-cached entries:

```yaml
ext:
  # Cached entries
  collector-cache:
    - run:
        key: expensive-build
        ...

  # Non-cached entries (standard collector)
  collector:
    - run:
        command: echo "Always runs"
      scan:
        ...
```
