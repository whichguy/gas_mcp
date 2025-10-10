import { createHash } from 'crypto';
import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { parsePath, matchesDirectory, getBaseName, isWildcardPattern, matchesPattern, resolveHybridScriptId } from '../../api/pathParser.js';
import { translateFilesForDisplay } from '../../utils/virtualFileTranslation.js';
import { DETAILED_SCHEMA, RECURSIVE_SCHEMA, WILDCARD_MODE_SCHEMA, ACCESS_TOKEN_SCHEMA } from './shared/schemas.js';
import { SchemaFragments } from '../../utils/schemaFragments.js';
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
      accessToken: {
        ...ACCESS_TOKEN_SCHEMA
      }
    },
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'Use to explore project structure and find files by pattern',
      workflow: 'List all files: ls({scriptId: "..."}), with wildcards: ls({scriptId: "...", path: "*.test*"})',
      scriptTypeCompatibility: {
        standalone: '✅ Full Support - Works identically',
        containerBound: '✅ Full Support - Works identically',
        notes: 'File listing works universally for both script types. Shows virtual names for dotfiles.'
      },
      limitations: {
        flatFileStructure: 'GAS has no real directories - uses filename prefixes like "utils/helper" to simulate folders',
        wildcardPatterns: 'Supports * and ? wildcards, but pattern matching depends on wildcardMode setting',
        virtualFileDisplay: 'Dotfiles (.gitignore, .git/config.gs) shown with virtual names, not GAS storage names'
      },
      examples: [
        'List all projects: ls({})',
        'List project files: ls({scriptId: "1abc2def..."})',
        'List with pattern: ls({scriptId: "1abc2def...", path: "*.gs"})',
        'List subfolder: ls({scriptId: "1abc2def...", path: "utils/*"})',
        'List detailed: ls({scriptId: "1abc2def...", detailed: true})',
        'List with checksums: ls({scriptId: "1abc2def...", checksums: true})',
        'List with checksums and details: ls({scriptId: "1abc2def...", detailed: true, checksums: true})'
      ],
      virtualFiles: 'Dotfiles like .gitignore appear with their virtual names, not GAS storage names',
      checksums: {
        whenToUse: 'Enable checksums to verify file integrity, detect changes without downloading, or compare with local Git files',
        format: 'Git-compatible SHA-1 using blob format: sha1("blob " + size + "\\0" + content)',
        verification: 'Matches output of: git hash-object <file>',
        integration: 'Use with git_sync tools to detect GAS ↔ Git divergence without downloading files'
      }
    }
  };

  async execute(params: ListParams): Promise<ListResult> {
    const accessToken = await this.getAuthToken(params);

    const path = params.path || '';
    const scriptId = params.scriptId || '';
    const detailed = params.detailed !== false;
    const recursive = params.recursive !== false;
    const wildcardMode = params.wildcardMode || 'auto';
    const checksums = params.checksums === true;

    // Use hybrid resolution to get scriptId and clean path
    let finalScriptId: string;
    let cleanPath: string;

    if (!path || path === '') {
      finalScriptId = '';
      cleanPath = '';
    } else {
      try {
        const resolved = resolveHybridScriptId(scriptId, path);
        finalScriptId = resolved.scriptId;
        cleanPath = resolved.cleanPath;
      } catch (error: any) {
        const parsedPath = parsePath(path);
        finalScriptId = parsedPath.scriptId || '';
        cleanPath = parsedPath.directory || parsedPath.pattern || '';
      }
    }

    if (!finalScriptId) {
      return await this.listProjects(detailed, accessToken);
    } else {
      return await this.listProjectFiles(finalScriptId, cleanPath, detailed, recursive, wildcardMode, checksums, accessToken);
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

  private async listProjectFiles(
    scriptId: string,
    directory: string,
    detailed: boolean,
    recursive: boolean,
    wildcardMode: string,
    checksums: boolean,
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

    const items = filteredFiles.map((file: any, index: number) => ({
      name: file.displayName || file.name,
      type: file.type || 'server_js',
      virtualFile: file.virtualFile || false,
      ...(detailed && {
        size: (file.source || '').length,
        position: index,
        createTime: file.createTime || null,
        updateTime: file.updateTime || null,
        lastModifyUser: file.lastModifyUser || null,
        actualName: file.virtualFile ? file.name : undefined
      }),
      ...(checksums && {
        gitSha1: this.computeGitSha1(file.source || '')
      })
    }));

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
      totalFiles: files.length
    };
  }
}
