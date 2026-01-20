import * as fs from 'fs/promises';
import * as path from 'path';
import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { parsePath, matchesDirectory, getBaseName, isWildcardPattern, matchesPattern, resolveHybridScriptId } from '../../api/pathParser.js';
import { translateFilesForDisplay } from '../../utils/virtualFileTranslation.js';
import { DETAILED_SCHEMA, RECURSIVE_SCHEMA, WILDCARD_MODE_SCHEMA, ACCESS_TOKEN_SCHEMA } from './shared/schemas.js';
import { SchemaFragments } from '../../utils/schemaFragments.js';
import { getCachedContentHash } from '../../utils/gasMetadataCache.js';
import { computeGitSha1 } from '../../utils/hashUtils.js';
import type { ListParams, ListResult } from './shared/types.js';

/**
 * List files and directories in Google Apps Script project
 *
 * ✅ RECOMMENDED - Use for file discovery and project exploration
 * Automatically shows virtual file names for dotfiles
 */
export class LsTool extends BaseFileSystemTool {
  public name = 'ls';
  public description = 'List files and directories in Google Apps Script project. Shows file types, sizes, and timestamps with wildcard pattern support. Like Unix ls but works with GAS flat file structure using filename prefixes.';

  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      path: {
        type: 'string',
        description: 'Path to list with optional wildcard patterns. If scriptId parameter is provided, this should be a relative path (e.g., "utils/*"). If scriptId is empty, this should include the script ID prefix (e.g., "scriptId/utils/*"). For listing all projects, use empty string.',
        default: '',
        examples: [
          '',
          'scriptId',
          '*.gs',
          'utils/*',
          'scriptId/*.gs',
          'scriptId/utils/*',
          'scriptId/api/*.json',
          'scriptId/test?',
          'scriptId/*/config',
          'scriptId/models/User*'
        ]
      },
      detailed: {
        ...DETAILED_SCHEMA
      },
      recursive: {
        ...RECURSIVE_SCHEMA
      },
      wildcardMode: {
        ...WILDCARD_MODE_SCHEMA
      },
      checksums: {
        type: 'boolean',
        description: 'Include Git-compatible SHA-1 checksums for file contents (matches git hash-object output). When enabled, adds "gitSha1" field to each file item.',
        default: false,
        examples: [true, false]
      },
      checkSync: {
        type: 'boolean',
        description: 'Compare local vs remote hashes to detect sync status. Returns syncStatus per file (in_sync, local_stale, remote_only, local_only) and syncSummary.',
        default: false,
        examples: [true, false]
      },
      accessToken: {
        ...ACCESS_TOKEN_SCHEMA
      }
    },
    additionalProperties: false,
    llmGuidance: {
      unixLike: 'ls -la (list files) | GAS flat structure | virtual dotfiles | checksums option',
      whenToUse: 'explore structure+find by pattern',
      workflow: 'ls({scriptId:"..."}) | ls({scriptId:"...",path:"*.test*"})',
      scriptTypeCompatibility: {standalone: '✅ Full Support', containerBound: '✅ Full Support', notes: 'Universal→shows virtual dotfile names'},
      limitations: {flatFileStructure: 'no real dirs→filename prefixes ("utils/helper") simulate', wildcardPatterns: '*,? supported→matching by wildcardMode', virtualFileDisplay: 'dotfiles (.gitignore)→virtual not GAS names, .git/* files no extension change'},
      examples: ['ls({})→all projects', 'ls({scriptId:"1abc2def..."})→files', 'ls({scriptId:"1abc2def...",path:"*.gs"})→pattern', 'ls({scriptId:"1abc2def...",path:"utils/*"})→subfolder', 'ls({scriptId:"1abc2def...",detailed:true})→detailed', 'ls({scriptId:"1abc2def...",checksums:true})→checksums', 'ls({scriptId:"1abc2def...",detailed:true,checksums:true})→both'],
      virtualFiles: 'dotfiles (.gitignore)→virtual names not GAS storage',
      checksums: {whenToUse: 'verify file integrity|detect changes (no download)|compare with local Git', format: 'Git-compatible SHA-1: sha1("blob "+size+"\\0"+content)', verification: 'matches: git hash-object <file>', integration: 'rsync tool→detect GAS↔Git diverge (no download)'},
      positionField: {semantics: 'actual GAS execution order (0-based), NOT filtered array index', preserved: 'position values maintained even when filtering files (e.g., filter to api/* shows position=5, not position=0)', critical: 'require@0, ConfigManager@1, __mcp_exec@2 enforced in write operations', usage: 'use for reorder operations, understanding execution dependencies'},
      antiPatterns: ['❌ ls then cat each file → use ripgrep to search content', '❌ ls for file content → use cat instead', '❌ ls without scriptId for specific project → add scriptId parameter']
    }
  };

  async execute(params: ListParams): Promise<ListResult> {
    const accessToken = await this.getAuthToken(params);

    const pathParam = params.path || '';
    const scriptId = params.scriptId || '';
    const detailed = params.detailed !== false;
    const recursive = params.recursive !== false;
    const wildcardMode = params.wildcardMode || 'auto';
    const checksums = params.checksums === true;
    const checkSync = (params as any).checkSync === true;

    // Use hybrid resolution to get scriptId and clean path
    let finalScriptId: string;
    let cleanPath: string;

    if (!pathParam || pathParam === '') {
      finalScriptId = '';
      cleanPath = '';
    } else {
      try {
        const resolved = resolveHybridScriptId(scriptId, pathParam);
        finalScriptId = resolved.scriptId;
        cleanPath = resolved.cleanPath;
      } catch (error: any) {
        const parsedPath = parsePath(pathParam);
        finalScriptId = parsedPath.scriptId || '';
        cleanPath = parsedPath.directory || parsedPath.pattern || '';
      }
    }

    if (!finalScriptId) {
      return await this.listProjects(detailed, accessToken);
    } else {
      return await this.listProjectFiles(finalScriptId, cleanPath, detailed, recursive, wildcardMode, checksums, checkSync, accessToken);
    }
  }

  private async listProjects(detailed: boolean, accessToken?: string): Promise<any> {
    const projects = await this.gasClient.listProjects(50, accessToken);

    return {
      type: 'projects',
      path: '',
      items: projects.map((project: any) => ({
        name: project.scriptId,
        type: 'project',
        title: project.title,
        ...(detailed && {
          createTime: project.createTime,
          updateTime: project.updateTime,
          parentId: project.parentId
        })
      }))
    };
  }


  private async listProjectFiles(
    scriptId: string,
    directory: string,
    detailed: boolean,
    recursive: boolean,
    wildcardMode: string,
    checksums: boolean,
    checkSync: boolean,
    accessToken?: string
  ): Promise<any> {
    const files = await this.gasClient.getProjectContent(scriptId, accessToken);

    // Apply virtual file translation for display
    const translatedFiles = translateFilesForDisplay(files, true);

    // Enhanced filtering with wildcard support
    let filteredFiles: any[];

    if (isWildcardPattern(directory)) {
      filteredFiles = translatedFiles.filter((file: any) => {
        const fileName = file.displayName || file.name;
        switch (wildcardMode) {
          case 'filename':
            const basename = getBaseName(fileName);
            return matchesPattern(basename, getBaseName(directory));

          case 'fullpath':
            return matchesPattern(fileName, directory);

          case 'auto':
          default:
            return directory.includes('/')
              ? matchesPattern(fileName, directory)
              : matchesPattern(getBaseName(fileName), directory);
        }
      });
    } else {
      filteredFiles = directory
        ? translatedFiles.filter((file: any) => {
            const fileName = file.displayName || file.name;
            return matchesDirectory(fileName, directory);
          })
        : translatedFiles;
    }

    // Prepare sync status tracking if checkSync is enabled
    let syncSummary: {
      total: number;
      inSync: number;
      stale: number;
      localOnly: number;
      remoteOnly: number;
      hint?: string;
    } | undefined;

    if (checkSync) {
      syncSummary = { total: 0, inSync: 0, stale: 0, localOnly: 0, remoteOnly: 0 };
    }

    // Get local sync folder path
    const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
    const syncFolder = path.join(homeDir, 'gas-repos', `project-${scriptId}`);

    // Build items with optional sync status
    const items = await Promise.all(filteredFiles.map(async (file: any) => {
      const fileName = file.displayName || file.name;

      // Compute hash on WRAPPED content (full file as stored in GAS)
      // This matches `git hash-object <file>` on local synced files
      const remoteHash = computeGitSha1(file.source || '');

      // Base item properties
      const item: Record<string, any> = {
        name: fileName,
        type: file.type || 'server_js',
        virtualFile: file.virtualFile || false,
        ...(detailed && {
          size: (file.source || '').length,
          position: file.position ?? 0,
          createTime: file.createTime || null,
          updateTime: file.updateTime || null,
          lastModifyUser: file.lastModifyUser || null,
          actualName: file.virtualFile ? file.name : undefined
        }),
        ...(checksums && {
          gitSha1: remoteHash
        })
      };

      // Add sync status if checkSync is enabled
      if (checkSync && syncSummary) {
        // Construct local file path
        const localFileName = this.getLocalFileName(file.name, file.type);
        const localFilePath = path.join(syncFolder, localFileName);

        let localHash: string | null = null;
        let localFileExists = false;

        try {
          await fs.access(localFilePath);
          localFileExists = true;
          // Try to get cached hash from xattr
          localHash = await getCachedContentHash(localFilePath);
        } catch {
          // Local file doesn't exist
        }

        let syncStatus: 'in_sync' | 'local_stale' | 'remote_only' | 'local_only';
        let hint: { action: string; command: string; reason: string } | undefined;

        if (!localFileExists) {
          syncStatus = 'remote_only';
          hint = {
            action: 'pull',
            command: `rsync({operation: "plan", scriptId: "${scriptId}", direction: "pull"})`,
            reason: 'File exists in GAS but not locally'
          };
          syncSummary.remoteOnly++;
        } else if (!localHash) {
          // Local file exists but no cached hash - treat as potentially stale
          syncStatus = 'local_stale';
          hint = {
            action: 'verify',
            command: `cat({scriptId: "${scriptId}", path: "${fileName}"})`,
            reason: 'Local file has no cached hash - cat to refresh'
          };
          syncSummary.stale++;
        } else if (localHash === remoteHash) {
          syncStatus = 'in_sync';
          syncSummary.inSync++;
        } else {
          syncStatus = 'local_stale';
          hint = {
            action: 'pull',
            command: `rsync({operation: "plan", scriptId: "${scriptId}", direction: "pull"})`,
            reason: 'Local hash differs from remote'
          };
          syncSummary.stale++;
        }

        item.syncStatus = syncStatus;
        if (localHash) item.localHash = localHash;
        item.remoteHash = remoteHash;
        if (hint) item.hint = hint;

        syncSummary.total++;
      }

      return item;
    }));

    // Add sync summary hint
    if (syncSummary) {
      if (syncSummary.stale > 0 || syncSummary.remoteOnly > 0) {
        syncSummary.hint = `rsync({operation: "plan", scriptId: "${scriptId}", direction: "pull"})`;
      }
    }

    return {
      type: 'files',
      path: directory ? `${scriptId}/${directory}` : scriptId,
      scriptId: scriptId,
      directory,
      pattern: directory,
      isWildcard: isWildcardPattern(directory),
      wildcardMode: wildcardMode,
      matchedFiles: filteredFiles.length,
      items,
      totalFiles: files.length,
      ...(syncSummary && { syncSummary })
    };
  }

  /**
   * Get the local filename with appropriate extension
   */
  private getLocalFileName(gasFileName: string, fileType: string): string {
    // If the name already has an extension, use it
    if (gasFileName.includes('.')) {
      return gasFileName;
    }

    // Add extension based on file type
    switch (fileType?.toUpperCase()) {
      case 'HTML':
        return `${gasFileName}.html`;
      case 'JSON':
        return `${gasFileName}.json`;
      case 'SERVER_JS':
      default:
        return `${gasFileName}.gs`;
    }
  }
}
