import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { parsePath, matchesDirectory, getBaseName, isWildcardPattern, matchesPattern, resolveHybridScriptId } from '../../api/pathParser.js';
import { translateFilesForDisplay } from '../../utils/virtualFileTranslation.js';
import { DETAILED_SCHEMA, RECURSIVE_SCHEMA, WILDCARD_MODE_SCHEMA, ACCESS_TOKEN_SCHEMA } from './shared/schemas.js';
import { SchemaFragments } from '../../utils/schemaFragments.js';
import { toResourcePath } from '../../utils/fileListCache.js';
import { executeServerCode } from '../../utils/serverSideExec.js';
import { log } from '../../utils/logger.js';
import { generateLsHints } from '../../utils/responseHints.js';
import type { ListParams, ListResult } from './shared/types.js';

/**
 * List files and directories in Google Apps Script project
 *
 * ✅ RECOMMENDED - Use for file discovery and project exploration
 * Automatically shows virtual file names for dotfiles
 */
export class LsTool extends BaseFileSystemTool {
  public name = 'ls';
  public description = '[FILE:LIST] List project files or configured projects. WHEN: browsing project contents or discovering available projects. AVOID: use find for pattern-based file search; use file_status for detailed file info. Example: ls({scriptId}) or ls({}) for project list';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      items: { type: 'array', description: 'List of files or projects' },
      total: { type: 'number', description: 'Total item count' },
      path: { type: 'string', description: 'Listed path' }
    }
  };

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
        description: 'Include Git-compatible SHA-1 checksums computed server-side via ScriptApp.getResource() (matches git hash-object output). No content download required. Adds "gitSha1" field to each file item.',
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
      examples: ['ls({})→all projects', 'ls({scriptId:"1abc2def..."})→files', 'ls({scriptId:"1abc2def...",path:"*.gs"})→pattern', 'ls({scriptId:"1abc2def...",path:"utils/*"})→subfolder', 'ls({scriptId:"1abc2def...",detailed:true})→detailed', 'ls({scriptId:"1abc2def...",checksums:true})→checksums'],
      virtualFiles: 'dotfiles (.gitignore)→virtual names not GAS storage',
      checksums: {
        whenToUse: 'verify file integrity | detect changes | compare with local Git',
        format: 'Git-compatible SHA-1: sha1("blob "+size+"\\0"+content)',
        verification: 'matches: git hash-object <file>',
        implementation: 'server-side via ScriptApp.getResource()',
        note: 'No content download - hashes computed on GAS server'
      },
      positionField: {semantics: 'actual GAS execution order (0-based), NOT filtered array index', preserved: 'position values maintained even when filtering files (e.g., filter to api/* shows position=5, not position=0)', critical: 'require@0, ConfigManager@1, __mcp_exec@2 enforced in write operations', usage: 'use for reorder operations, understanding execution dependencies'},
      antiPatterns: ['❌ ls then cat each file → use ripgrep to search content', '❌ ls for file content → use cat instead', '❌ ls without scriptId for specific project → add scriptId parameter']
    }
  };

  async execute(params: ListParams): Promise<ListResult> {
    const accessToken = await this.getAuthToken(params);

    const pathParam = params.path || '';
    const scriptId = params.scriptId || '';
    const detailed = params.detailed !== false;
    // Note: recursive parameter exists in schema but GAS has flat file structure
    // It's kept for API compatibility but doesn't change behavior
    const wildcardMode = params.wildcardMode || 'auto';
    const checksums = params.checksums === true;

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
      return await this.listProjectFiles(finalScriptId, cleanPath, detailed, wildcardMode, checksums, accessToken);
    }
  }

  private async listProjects(detailed: boolean, accessToken?: string): Promise<any> {
    const projects = await this.gasClient.listProjects(50, accessToken);

    const items = projects.map((project: any) => ({
      name: project.scriptId,
      type: 'project',
      title: project.title,
      ...(detailed && {
        createTime: project.createTime,
        updateTime: project.updateTime,
        parentId: project.parentId
      })
    }));
    const hints = generateLsHints(items.length, false);
    return {
      type: 'projects',
      path: '',
      items,
      hints
    };
  }


  private async listProjectFiles(
    scriptId: string,
    directory: string,
    detailed: boolean,
    wildcardMode: string,
    checksums: boolean,
    accessToken?: string
  ): Promise<any> {
    // Get file metadata (no content) - FAST
    const metadata = await this.gasClient.getProjectMetadata(scriptId, accessToken);

    // Apply virtual file translation for display
    const translatedFiles = translateFilesForDisplay(metadata, true);

    // Apply filtering
    const filteredFiles = this.applyFiltering(translatedFiles, directory, wildcardMode);

    // Compute server-side hashes if requested
    let serverHashes: Record<string, string | null> = {};
    let hashWarning: string | undefined;
    if (checksums) {
      // Build resource paths only for filtered files (efficiency)
      const resourcePaths = filteredFiles.map((f: any) => toResourcePath(f.name, f.type));
      const js_statement = `__mcp_computeFileHashes(${JSON.stringify(resourcePaths)})`;

      log.info(`[LsTool] Computing server-side hashes for ${resourcePaths.length} files...`);
      const execResult = await executeServerCode(this.gasClient, scriptId, js_statement, accessToken);

      if (execResult.success) {
        serverHashes = execResult.result || {};
        log.info(`[LsTool] Received ${Object.keys(serverHashes).length} hashes from server`);
      } else {
        hashWarning = `Server-side hash computation failed: ${execResult.message || 'Unknown error'}. Ensure __mcp_exec is deployed.`;
        log.error(`[LsTool] ${hashWarning}`);
      }
    }

    // Build response items
    const items = filteredFiles.map((file: any) => {
      const resourcePath = toResourcePath(file.name, file.type);
      const displayName = file.displayName || file.name;
      const isVirtualFile = file.virtualFile || false;

      return {
        name: displayName,
        type: file.type || 'SERVER_JS',
        virtualFile: isVirtualFile,
        ...(detailed && {
          position: file.position ?? 0,
          createTime: file.createTime || null,
          updateTime: file.updateTime || null,
          lastModifyUser: file.lastModifyUser || null,
          actualName: isVirtualFile ? file.name : undefined
        }),
        ...(checksums && {
          gitSha1: serverHashes[resourcePath] || null
        })
      };
    });

    const hints = generateLsHints(items.length, true);
    return {
      type: 'files',
      path: directory ? `${scriptId}/${directory}` : scriptId,
      scriptId,
      directory,
      pattern: directory,
      isWildcard: isWildcardPattern(directory),
      wildcardMode,
      matchedFiles: filteredFiles.length,
      items,
      totalFiles: metadata.length,
      ...(hashWarning && { warning: hashWarning }),
      hints
    };
  }

  /**
   * Apply filtering based on directory/pattern
   */
  private applyFiltering(files: any[], directory: string, wildcardMode: string): any[] {
    if (!directory) {
      return files;
    }

    if (isWildcardPattern(directory)) {
      return files.filter((file: any) => {
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
      return files.filter((file: any) => {
        const fileName = file.displayName || file.name;
        return matchesDirectory(fileName, directory);
      });
    }
  }
}
