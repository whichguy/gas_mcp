import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';

/**
 * Cache clear tool — no-op after xattr metadata cache removal.
 *
 * The per-file xattr metadata cache (user.gas.updateTime, user.gas.fileType,
 * user.gas.contentHash) has been replaced by the local git repo as the
 * content cache. This tool is retained to avoid breaking existing callers
 * but performs no operation.
 *
 * To force a fresh remote fetch, use: cat({..., preferLocal: false})
 * To pull all files from remote, use: rsync({operation: 'pull', scriptId})
 */
export class CacheClearTool extends BaseFileSystemTool {
  public name = 'cache_clear';
  public description = '[FILE:CACHE] No-op: xattr metadata cache removed. Use preferLocal:false on cat for forced remote refresh, or rsync pull for bulk refresh.';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      status: { type: 'string', description: 'Operation status' },
      message: { type: 'string', description: 'Migration message' }
    }
  };

  public inputSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Previously: path to clear. Now unused — this tool is a no-op.',
      },
      accessToken: {
        type: 'string',
        description: 'Access token (unused)'
      }
    },
    required: ['path'],
  };

  public annotations = {
    title: 'Clear Cache (no-op)',
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false
  };

  async execute(_params: any): Promise<any> {
    return {
      status: 'no_op',
      message: 'xattr metadata cache removed; use preferLocal: false on cat for forced remote refresh, or rsync pull for bulk refresh.'
    };
  }
}
