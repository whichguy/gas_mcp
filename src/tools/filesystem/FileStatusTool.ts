import { createHash } from 'crypto';
import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { parsePath, matchesDirectory, getBaseName, isWildcardPattern, matchesPattern, resolveHybridScriptId } from '../../api/pathParser.js';
import { translateFilesForDisplay } from '../../utils/virtualFileTranslation.js';
import { ACCESS_TOKEN_SCHEMA } from './shared/schemas.js';
import { SchemaFragments } from '../../utils/schemaFragments.js';

/**
 * Get comprehensive file status with SHA checksums and metadata
 *
 * ✅ RECOMMENDED - Use for file verification, integrity checking, and Git comparison
 * Supports Git-compatible SHA-1, SHA-256, MD5 hashes with rich metadata
 */
export class FileStatusTool extends BaseFileSystemTool {
  public name = 'file_status';
  public description = 'Get comprehensive file status with SHA checksums and metadata. Supports pattern matching for multiple files, Git-compatible SHA-1, SHA-256, MD5 hashes, and rich file metadata including line counts, encoding, and timestamps.';

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
      whenToUse: 'SHA checksums|verify integrity|detect changes (no download)|compare with local Git',
      workflow: 'file_status({scriptId:"...",path:"utils.gs"}) | file_status({scriptId:"...",path:"utils/*"})',
      pathResolution: {explicitScriptId: 'file_status({scriptId:"1abc...",path:"utils.gs"})', embeddedScriptId: 'file_status({path:"1abc.../utils.gs"})', wildcards: '*,? wildcards: "utils/*","*.test.gs","*Controller*"', pseudoDirectories: 'GAS filename prefixes: "utils/helper"=single filename not folder'},
      gitIntegration: {purpose: 'Git SHA-1→efficient change detect (no download)', format: 'sha1("blob "+<size>+"\\0"+<content>)→matches git hash-object', verification: 'echo -n "content"|git hash-object --stdin', workflow: ['1.file_status git-sha1 from GAS', '2.compare local git hash-object', '3.detect diverge (no download)', '4.local_sync tools sync']},
      examples: ['file_status({scriptId:"...",path:"utils.gs"})', 'file_status({scriptId:"...",path:"utils/*"})', 'file_status({scriptId:"...",path:"utils.gs",hashTypes:["git-sha1","sha256","md5"]})', 'file_status({scriptId:"...",path:"*.gs",includeMetadata:false})', 'file_status({path:"1abc.../utils/*"})'],
      useCases: {verification: "verify file unchanged since sync", gitComparison: 'GAS vs local Git repo', changeDetection: 'changed files (no download all)', integrity: 'integrity during sync', bulkStatus: 'multiple files by pattern'},
      hashTypes: {'git-sha1': 'Git SHA-1 blob format→matches git hash-object', 'sha256': 'SHA-256 (64 hex)', 'md5': 'MD5 legacy (32 hex)'},
      metadata: {lines: 'line count', size: 'bytes', encoding: 'detected (UTF-8 typical)', createTime: 'ISO 8601 create', updateTime: 'ISO 8601 modify', lastModifyUser: 'user name+email'},
      performance: {default: '50 files default', maximum: '200 max per request', optimization: 'specific patterns→reduce count', recommendation: 'large projects→specific patterns not wildcards'},
      scriptTypeCompatibility: {standalone: '✅ Full Support', containerBound: '✅ Full Support', notes: 'Universal→Git checksums'}
    }
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
   * Compute Git-compatible SHA-1 checksum for file content
   *
   * Uses Git's blob format: sha1("blob " + <size> + "\0" + <content>)
   * This matches the output of `git hash-object <file>`
   *
   * @param content - File content as string
   * @returns Git-compatible SHA-1 hash as hex string
   */
  private computeGitSha1(content: string): string {
    const size = Buffer.byteLength(content, 'utf8');
    const header = `blob ${size}\0`;
    return createHash('sha1')
      .update(header)
      .update(content, 'utf8')
      .digest('hex');
  }

  /**
   * Compute multiple hash types for file content
   *
   * @param content - File content as string
   * @param types - Array of hash types to compute
   * @returns Object mapping hash type to hex string
   */
  private computeHashes(content: string, types: string[]): Record<string, string> {
    const hashes: Record<string, string> = {};

    for (const type of types) {
      if (type === 'git-sha1') {
        hashes['git-sha1'] = this.computeGitSha1(content);
      } else if (type === 'sha256' || type === 'md5') {
        hashes[type] = createHash(type)
          .update(content, 'utf8')
          .digest('hex');
      }
    }

    return hashes;
  }
}
