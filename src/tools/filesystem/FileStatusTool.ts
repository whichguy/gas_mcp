import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { parsePath, matchesDirectory, getBaseName, isWildcardPattern, matchesPattern, resolveHybridScriptId } from '../../api/pathParser.js';
import { translateFilesForDisplay } from '../../utils/virtualFileTranslation.js';
import { ACCESS_TOKEN_SCHEMA } from './shared/schemas.js';
import { SchemaFragments } from '../../utils/schemaFragments.js';
import { computeGitSha1, computeSha256, computeMd5 } from '../../utils/hashUtils.js';

/**
 * Get comprehensive file status with SHA checksums and metadata
 *
 * ✅ RECOMMENDED - Use for file verification, integrity checking, and Git comparison
 * Supports Git-compatible SHA-1, SHA-256, MD5 hashes with rich metadata
 */
export class FileStatusTool extends BaseFileSystemTool {
  public name = 'file_status';
  public description = '[FILE:STATUS] Get comprehensive file metadata — checksums (git-sha1, SHA-256, MD5), size, type, modification status, and sync state. WHEN: verifying file integrity, checking sync status, or comparing versions. AVOID: use cat to read content; use ls for simple file listing. Example: file_status({scriptId, path: "Utils.gs", hashTypes: ["git-sha1"]})';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      path: { type: 'string' },
      type: { type: 'string', enum: ['server_js', 'html', 'json'] },
      size: { type: 'number' },
      checksums: { type: 'object', description: 'Hash values keyed by algorithm' },
      syncStatus: { type: 'string', description: 'Local vs remote sync state' }
    }
  };

  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      path: {
        type: 'string',
        description: 'File path or pattern with wildcard support. Supports both explicit scriptId parameter and embedded scriptId in path (e.g., "scriptId/utils/*"). Use wildcards to match multiple files.',
        examples: [
          'utils.gs',
          'utils/*',
          '*.gs',
          '*test*',
          'scriptId/utils.gs',
          'scriptId/utils/*',
          'scriptId/*.test.gs'
        ],
        minLength: 1
      },
      hashTypes: {
        type: 'array',
        description: 'Hash types to compute. Defaults to ["git-sha1"]. Available: git-sha1 (Git-compatible), sha256, md5.',
        items: {
          type: 'string',
          enum: ['git-sha1', 'sha256', 'md5']
        },
        default: ['git-sha1'],
        examples: [
          ['git-sha1'],
          ['git-sha1', 'sha256'],
          ['git-sha1', 'sha256', 'md5']
        ]
      },
      includeMetadata: {
        type: 'boolean',
        description: 'Include rich metadata (lines, encoding, timestamps, user). Default: true',
        default: true
      },
      maxFiles: {
        type: 'number',
        description: 'Maximum number of files to process (default: 50, max: 200)',
        default: 50,
        minimum: 1,
        maximum: 200
      },
      accessToken: {
        ...ACCESS_TOKEN_SCHEMA
      }
    },
    required: ['path'],
    additionalProperties: false,
    llmGuidance: {
      gitIntegration: 'Git SHA-1 no-download change detection: sha1("blob "+size+"\\0"+content)→matches git hash-object. get hash→compare local→detect diverge→rsync.',
      hashTypes: 'git-sha1 (Git blob format); sha256 (64 hex); md5 (legacy 32 hex)',
      performance: '50 default, 200 max. Large projects→use specific patterns not broad wildcards.'
    }
  };

  public annotations = {
    title: 'File Status',
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true
  };

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);

    // Extract parameters
    const path = params.path;
    const scriptId = params.scriptId || '';
    const hashTypes = params.hashTypes || ['git-sha1'];
    const includeMetadata = params.includeMetadata !== false;
    const maxFiles = Math.min(params.maxFiles || 50, 200);

    // Resolve hybrid scriptId (explicit or embedded in path)
    let finalScriptId: string;
    let cleanPath: string;

    try {
      const resolved = resolveHybridScriptId(scriptId, path);
      finalScriptId = resolved.scriptId;
      cleanPath = resolved.cleanPath;
    } catch (error: any) {
      const parsedPath = parsePath(path);
      finalScriptId = parsedPath.scriptId || scriptId;
      cleanPath = parsedPath.filename || parsedPath.directory || parsedPath.pattern || path;
    }

    if (!finalScriptId) {
      throw new Error('scriptId is required either as parameter or embedded in path');
    }

    // Fetch all files from project
    const files = await this.gasClient.getProjectContent(finalScriptId, accessToken);
    const translatedFiles = translateFilesForDisplay(files, true);

    // Filter files based on path pattern
    let matchedFiles: any[];

    if (isWildcardPattern(cleanPath)) {
      // Wildcard pattern matching
      matchedFiles = translatedFiles.filter((file: any) => {
        const fileName = file.displayName || file.name;
        return cleanPath.includes('/')
          ? matchesPattern(fileName, cleanPath)
          : matchesPattern(getBaseName(fileName), cleanPath);
      });
    } else {
      // Exact or directory match
      matchedFiles = translatedFiles.filter((file: any) => {
        const fileName = file.displayName || file.name;
        return fileName === cleanPath || matchesDirectory(fileName, cleanPath);
      });
    }

    // Limit to maxFiles
    matchedFiles = matchedFiles.slice(0, maxFiles);

    // Compute hashes and metadata for each file
    const fileStatuses = matchedFiles.map((file: any) => {
      const content = file.source || '';
      const hashes = this.computeHashes(content, hashTypes);

      const status: any = {
        name: file.displayName || file.name,
        type: file.type || 'SERVER_JS',
        hashes
      };

      if (includeMetadata) {
        status.metadata = {
          size: Buffer.byteLength(content, 'utf8'),
          lines: content ? content.split('\n').length : 0,
          encoding: 'UTF-8',
          ...(file.createTime && { createTime: file.createTime }),
          ...(file.updateTime && { updateTime: file.updateTime }),
          ...(file.lastModifyUser && { lastModifyUser: file.lastModifyUser })
        };
      }

      return status;
    });

    return {
      status: 'success',
      scriptId: finalScriptId,
      pattern: cleanPath,
      isPattern: isWildcardPattern(cleanPath),
      matchedFiles: fileStatuses.length,
      totalFiles: files.length,
      hashTypes,
      files: fileStatuses
    };
  }

  /**
   * Compute multiple hash types for file content using centralized hashUtils
   * (includes CRLF normalization and UTF-8 BOM stripping for consistency)
   */
  private computeHashes(content: string, types: string[]): Record<string, string> {
    const hashes: Record<string, string> = {};

    for (const type of types) {
      if (type === 'git-sha1') {
        hashes['git-sha1'] = computeGitSha1(content);
      } else if (type === 'sha256') {
        hashes['sha256'] = computeSha256(content);
      } else if (type === 'md5') {
        hashes['md5'] = computeMd5(content);
      }
    }

    return hashes;
  }
}
