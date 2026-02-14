# Write Operation Locking

Filesystem-based per-project write locks prevent concurrent modification collisions.

## Why Necessary

Google Apps Script API provides NO server-side concurrency control:
- No ETags, If-Match headers, or version checking
- No conflict detection or error codes
- **Last-write-wins** behavior with complete project replacement
- Client-side locking required to prevent data loss

**Collision Example Without Locking:**
```
Client A: read → modify file 1 → write
Client B: read → modify file 2 → write ← OVERWRITES Client A's changes!
Result: File 1 changes lost
```

## Lock Behavior

- **Concurrent writes to different projects**: Allowed (no blocking)
- **Concurrent writes to same project**: Queued (second waits for first)
- **Timeout**: 30s default (configurable via `MCP_GAS_LOCK_TIMEOUT`)
- **Lock location**: `~/.auth/mcp-gas/locks/{scriptId}.lock`
- **Stale detection**: Automatic cleanup of locks from dead processes

## Protected Operations

All write operations that call `updateProjectContent`:
- write, raw_write, edit, aider, sed
- rm, mv, cp
- deploy operations

## Error Handling

- `LockTimeoutError`: Thrown after 30s waiting for lock
- Indicates: Another operation in progress or stuck process
- Resolution: Retry operation or check for orphaned locks
- Error message includes current lock holder info (PID, hostname, operation)

## Automatic Recovery

- **Startup cleanup**: Removes stale locks from dead processes
- **Shutdown cleanup**: Releases all locks on SIGINT/SIGTERM
- **Exception safety**: Locks released even on write errors (try/finally)
- **No manual intervention**: System self-heals automatically

## Performance Impact

- **Uncontended locks**: ~2-10ms overhead (file create/delete)
- **Contended locks**: Wait time = first operation duration (100ms min, 30s max timeout)
  - Example: If operation 1 takes 5s, operation 2 waits ~5s + lock overhead
  - Operations to different projects run in parallel (no waiting)
- Network latency (100-500ms) typically dominates in uncontended case
- No impact on read operations (cat, ls, grep remain unlocked)

## Debugging

```typescript
// Check lock status
await lockManager.getLockStatus(scriptId)
// Returns: { locked: boolean, info?: { pid, hostname, operation, timestamp } }

// Manual cleanup if needed (rare)
await lockManager.cleanupStaleLocks()

// Get lock usage metrics
const metrics = lockManager.getMetrics();
// Returns: { acquisitions, contentions, timeouts, staleRemoved, currentlyHeld }
```

## Environment Variables

- `MCP_GAS_LOCK_TIMEOUT=60000` - Override default 30s timeout (minimum 1000ms)
- Lock directory: `~/.auth/mcp-gas/locks/` (consistent with token storage)

## Limitations

- **Single-user per machine**: Locks stored in user home directory — won't coordinate between different OS user accounts
- **Local filesystem required**: Lock atomicity requires local filesystem (ext4, APFS, NTFS). May fail on NFS, SMB/CIFS
- **Cross-machine coordination**: Different hostnames rely on timestamp-based stale detection with 5-minute threshold
