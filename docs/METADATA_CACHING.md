# Metadata Caching with Extended Attributes

## Overview

MCP Gas implements a **metadata caching system** using filesystem extended attributes (xattr) to dramatically improve performance of file operations. This system eliminates redundant API calls by storing GAS file metadata directly in the local filesystem.

## Architecture

### Core Components

1. **gasMetadataCache.ts** - Core caching utilities
   - `cacheGASMetadata()` - Store metadata in xattr
   - `getCachedGASMetadata()` - Retrieve cached metadata
   - `clearGASMetadata()` - Remove cached metadata
   - `hasCachedMetadata()` - Check if metadata exists

2. **fileHelpers.ts** - Integration with file operations
   - `setFileMtimeToRemote()` - Set mtime + cache metadata atomically
   - `isFileInSync()` - Check if local file matches remote (uses mtime)

3. **Extended Attributes** - OS-level metadata storage
   - `user.gas.updateTime` - ISO8601 timestamp from GAS API
   - `user.gas.fileType` - File type (SERVER_JS, HTML, JSON)

### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                     Write Operation                         │
│                                                             │
│  1. Write file content to GAS API                          │
│  2. Save file to local cache (./src/)                      │
│  3. Set mtime to match GAS updateTime                      │
│  4. Store metadata in xattr (updateTime + fileType)       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                      Read Operation (Fast Path)              │
│                                                             │
│  1. Check if local file exists                             │
│  2. Read cached metadata from xattr                        │
│  3. Compare local mtime with cached updateTime             │
│  4. If match → return local content (NO API CALL) ⚡       │
│  5. If mismatch → use slow path                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                      Read Operation (Slow Path)              │
│                                                             │
│  1. Make API call to get remote file metadata              │
│  2. Compare local vs remote updateTime                     │
│  3. Fetch remote content if needed                         │
│  4. Update local cache                                     │
│  5. Re-cache metadata in xattr                             │
└─────────────────────────────────────────────────────────────┘
```

## Performance Impact

### Benchmark Results

From integration test `metadata-cache.test.ts`:

```
Slow path (no cache):  ~800-1200ms  (API call required)
Fast path (cached):    ~5-50ms      (local filesystem only)

Speed improvement:     85-95% faster
```

### When Fast Path Applies

Fast path optimization is used when:

1. ✅ Local file exists in cache
2. ✅ Cached metadata exists in xattr
3. ✅ Local mtime matches cached updateTime (within 1 second)

If any condition fails, slow path is used (API call made).

## Tools Using Metadata Caching

### Write Operations (Cache Metadata)

1. **WriteTool** (`write`)
   - Line 403: Caches metadata after remote-first workflow
   - Line 558: Caches metadata after hook validation

2. **RawWriteTool** (`raw_write`)
   - Line 174: Caches metadata after remote write

3. **RsyncTool** (`rsync`)
   - Caches metadata when syncing files from GAS

### Read Operations (Use Cached Metadata)

1. **CatTool** (`cat`)
   - Lines 83-170: Fast path implementation
   - Line 231: Re-cache metadata after slow path

2. **RawCatTool** (`raw_cat`)
   - Line 60: Caches metadata when reading

### Utility Operations

1. **CacheClearTool** (`cache_clear`)
   - Clears cached metadata for debugging
   - Supports single file or entire project
   - Forces next operation to use slow path

## Usage Examples

### Normal Development Workflow

```typescript
// 1. Write file (metadata automatically cached)
await write({
  scriptId: '',
  path: 'projectId/utils/helper',
  content: 'function help() { return "助けて"; }',
  fileType: 'SERVER_JS'
});

// 2. First read (slow path - API call)
const result1 = await cat({
  scriptId: '',
  path: 'projectId/utils/helper'
});
// ~800ms - Makes API call, caches metadata

// 3. Second read (fast path - NO API call)
const result2 = await cat({
  scriptId: '',
  path: 'projectId/utils/helper'
});
// ~10ms - Uses cached metadata, returns local content ⚡

// 4. Third read (fast path - NO API call)
const result3 = await cat({
  scriptId: '',
  path: 'projectId/utils/helper'
});
// ~10ms - Still using cached metadata ⚡
```

### Debugging Cache Issues

```typescript
// Clear cache for single file
await cache_clear({
  path: 'projectId/utils/helper'
});

// Clear cache for entire project
await cache_clear({
  path: 'projectId'
});

// Next cat will use slow path (API call) and re-cache
await cat({
  scriptId: '',
  path: 'projectId/utils/helper'
});
```

### Sync Detection

```typescript
// File is in sync
const inSync = await isFileInSync(
  '/path/to/local/file.gs',
  '2025-01-10T12:00:00.000Z'  // Remote updateTime
);
// Returns: true (mtime matches within 1 second)

// File was modified locally (mtime changed)
await fs.utimes(filePath, newTime, newTime);

const inSync2 = await isFileInSync(
  '/path/to/local/file.gs',
  '2025-01-10T12:00:00.000Z'
);
// Returns: false (mtime mismatch detected)
```

## Implementation Details

### Extended Attributes Format

```javascript
// Attribute: user.gas.updateTime
// Value: "2025-01-10T12:34:56.789Z" (UTF-8 string)

// Attribute: user.gas.fileType
// Value: "SERVER_JS" | "HTML" | "JSON" (UTF-8 string)
```

### Mtime Synchronization

Local file modification times are set to match GAS `updateTime`:

```javascript
const remoteMtime = new Date(remoteUpdateTime);
await fs.utimes(localPath, remoteMtime, remoteMtime);
```

This allows fast sync detection using filesystem operations only.

### Cross-Platform Compatibility

Extended attributes support varies by OS:

| Platform | Support | Notes |
|----------|---------|-------|
| **macOS** | ✅ Full | Native xattr support |
| **Linux** | ✅ Full | Native xattr support (ext4, xfs, btrfs) |
| **Windows** | ⚠️ Limited | NTFS Alternate Data Streams |

**Graceful Degradation**: If xattr operations fail, code falls back to API calls without failing the operation.

## Error Handling

### Xattr Failures

```javascript
try {
  await cacheGASMetadata(path, updateTime, fileType);
} catch (error) {
  // Silent failure - logs to console.debug
  // Operation continues without cached metadata
  // Next read will use slow path
}
```

### Missing Metadata

```javascript
const metadata = await getCachedGASMetadata(path);
if (!metadata) {
  // Fall through to slow path
  // Make API call
  // Re-cache metadata
}
```

### Out of Sync Detection

```javascript
const inSync = await isFileInSync(path, remoteUpdateTime);
if (!inSync) {
  // Local file was modified
  // Use slow path to verify with API
  // Update cache if remote changed
}
```

## Testing

### Integration Tests

Location: `test/integration/metadata-cache.test.ts`

**9 comprehensive tests**:

1. ✅ Write file and cache metadata in xattr
2. ✅ Use cached metadata for fast path (no API call)
3. ✅ Verify mtime matches remote updateTime
4. ✅ Detect when file is out of sync
5. ✅ Preserve metadata through cat operations
6. ✅ Handle missing metadata gracefully (slow path)
7. ✅ Update metadata when file changes remotely
8. ✅ Work across different file types (SERVER_JS, HTML, JSON)
9. ✅ Show performance improvement with cached metadata

### Running Tests

```bash
# Set environment variables
export GAS_INTEGRATION_TEST=true
export TEST_SCRIPT_ID="your-test-project-id"

# Run integration test
npx mocha test/integration/metadata-cache.test.ts --timeout 300000
```

## Troubleshooting

### Cache Not Working

**Symptoms**: Every cat call is slow (~800ms)

**Diagnosis**:
```bash
# Check if xattr are present
xattr -l /path/to/local/file.gs

# Should show:
# user.gas.updateTime: 2025-01-10T12:34:56.789Z
# user.gas.fileType: SERVER_JS
```

**Solutions**:
1. Verify extended attributes are supported on your filesystem
2. Check file permissions (must be writable)
3. Clear cache and retry: `cache_clear({path: "projectId"})`

### Stale Cache

**Symptoms**: Local content doesn't match remote changes

**Diagnosis**:
```javascript
// Check cached metadata
const metadata = await getCachedGASMetadata(path);
console.log('Cached updateTime:', metadata.updateTime);

// Check actual mtime
const stats = await fs.stat(path);
console.log('Local mtime:', stats.mtime.toISOString());
```

**Solutions**:
1. Clear cache: `cache_clear({path: "projectId/filename"})`
2. Next cat will re-fetch and re-cache
3. For bulk reset: `cache_clear({path: "projectId"})`

### Performance Not Improving

**Symptoms**: Fast path still slow

**Possible causes**:
1. File doesn't exist locally (first read always slow)
2. Local file was modified (mtime changed)
3. Cache was cleared
4. Filesystem doesn't support xattr

**Verification**:
```javascript
// Check syncStatus in cat result
const result = await cat({scriptId: '', path: 'projectId/file'});
console.log('Sync status:', result.syncStatus);
console.log('Source:', result.source); // Should be 'local' for fast path
```

## Future Enhancements

### Potential Improvements

1. **Cache TTL** - Expire metadata after configurable time
2. **Cache Invalidation Hooks** - Auto-clear when remote changes detected
3. **Batch Metadata Caching** - Cache multiple files in single operation
4. **Stats/Metrics** - Track cache hit rate, performance gains
5. **Alternative Storage** - SQLite database for non-xattr systems

### Non-Goals

These tools intentionally **do NOT use caching**:

- **FileStatusTool** - Purpose is to get current remote status
- **LsTool** - Purpose is to list current remote state
- **CpTool** - API-only operation, no local cache interaction
- **MvTool** - API-only operation, no local cache interaction

## Related Documentation

- [File Operations](./FILE_OPERATIONS.md) - Overview of filesystem tools
- [Local Sync](./LOCAL_SYNC.md) - Git integration patterns
- [Testing Guide](./TESTING.md) - Running integration tests
- [API Reference](./API_REFERENCE.md) - Tool schemas and parameters
