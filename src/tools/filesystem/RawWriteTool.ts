import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { parsePath } from '../../api/pathParser.js';
import { ValidationError } from '../../errors/mcpErrors.js';
import { checkSyncOrThrow, setFileMtimeToRemote } from '../../utils/fileHelpers.js';
import { detectLocalGit, checkBreadcrumbExists, buildRecommendation, type GitDetection } from '../../utils/localGitDetection.js';
import { join, dirname } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { SCRIPT_ID_SCHEMA, PATH_SCHEMA, CONTENT_SCHEMA, ACCESS_TOKEN_SCHEMA, FILE_TYPE_SCHEMA } from './shared/schemas.js';

/**
 * Write raw file contents with explicit project paths
 *
 * ⚠️ ADVANCED TOOL - DANGER: Completely overwrites files without CommonJS processing or merging
 * Use write for safe CommonJS-wrapped development
 */
export class RawWriteTool extends BaseFileSystemTool {
  public name = 'raw_write';
  public description = 'Write raw file contents with explicit project paths. DANGER: Completely overwrites files without CommonJS processing or merging. Use write for safe CommonJS-wrapped development.';

  public inputSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Full path to file: scriptId/filename (WITHOUT extension). Extensions like .gs, .html, .json are AUTOMATICALLY added. Google Apps Script auto-detects file type from content. SPECIAL CASE: appsscript.json must be in project root (scriptId/appsscript), never in subfolders. REQUIRED: Must include explicit scriptId prefix (e.g., "abc123def.../filename") - current project context is not used.',
        pattern: '^[a-zA-Z0-9_-]{20,60}/[a-zA-Z0-9_.//-]+$',
        minLength: 25,
        examples: [
          'abc123def456.../fibonacci',
          'abc123def456.../utils/helpers',
          'abc123def456.../Code',
          'abc123def456.../models/User',
          'abc123def456.../appsscript'
        ],
        llmHints: {format: 'scriptId/filename (no extension)', extensions: 'Tool automatically adds .gs for JavaScript, .html for HTML, .json for JSON', organization: 'Use "/" in filename for logical organization (not real folders)', specialFiles: 'appsscript.json MUST be in root: scriptId/appsscript (never scriptId/subfolder/appsscript)', warning: 'This tool OVERWRITES the entire file - use write for safer merging', autoDetection: 'File type detected from content: JavaScript, HTML, JSON'}
      },
      content: {
        ...CONTENT_SCHEMA,
        description: 'File content to write. ⚠️ WARNING: This content will COMPLETELY REPLACE the existing file. Supports JavaScript/Apps Script, HTML, JSON. Content type automatically detected for proper file extension.',
        llmHints: {javascript: 'Apps Script functions, ES6+ syntax, Google services (SpreadsheetApp, etc.)', html: 'HTML templates for web apps, can include CSS and JavaScript', json: 'Configuration files like appsscript.json for project settings', limits: 'File size limits enforced by Google Apps Script API', encoding: 'UTF-8 encoding, supports international characters', danger: 'This content will OVERWRITE the entire remote file - existing content will be lost'}
      },
      position: {
        type: 'number',
        description: 'File execution order position (0-based). Controls order in Apps Script editor and execution sequence. Lower numbers execute first.',
        minimum: 0,
        llmHints: {execution: 'Lower numbers execute first in Apps Script runtime', organization: 'Use for dependencies: utilities first (0), main code later (1,2,3)', optional: 'Omit to append at end of file list', reordering: 'Use reorder tool to change position later'}
      },
      fileType: {
        ...FILE_TYPE_SCHEMA,
        description: 'File type for Google Apps Script. REQUIRED: Must be explicitly specified.'
      },
      skipSyncCheck: {
        type: 'boolean',
        description: 'Skip sync validation check (use with caution - for internal tools like project_init with force=true)',
        default: false
      },
      accessToken: {
        ...ACCESS_TOKEN_SCHEMA
      },
      changeReason: {
        type: 'string',
        description: 'Optional commit message for git-enabled projects. If omitted, defaults to "Update {filename}" or "Add {filename}". Tip: Call git_feature({operation: "start"}) first for meaningful branch names.',
        examples: [
          'Add user authentication',
          'Fix validation bug in form',
          'Refactor database queries',
          'Update API endpoint'
        ]
      },
      projectPath: {
        type: 'string',
        default: '',
        description: 'Optional path to nested git project within GAS (for polyrepo support). Enables independent git repositories within a single GAS project.',
        examples: ['', 'backend', 'frontend', 'libs/shared', 'api/v2']
      }
    },
    required: ['path', 'content', 'fileType'],
    additionalProperties: false,
    llmGuidance: {
      danger: '⚠️ OVERWRITES entire file without merge → data loss risk | Use write for safe merging',
      whenToUse: 'new files from scratch | replace entire contents | appsscript.json manifest',
      whenToAvoid: 'updating existing code | collaborative editing (use write/edit/aider instead)'
    }
  };

  async execute(params: any): Promise<any> {
    // SECURITY: Validate path BEFORE authentication
    const path = this.validate.filePath(params.path, 'file writing');
    const position = params.position !== undefined ? this.validate.number(params.position, 'position', 'file writing', 0) : undefined;

    const parsedPath = parsePath(path);

    if (!parsedPath.isFile) {
      throw new ValidationError('path', path, 'file path (must include filename)');
    }

    // ⚠️ SPECIAL FILE VALIDATION: appsscript.json must be in root
    let filename = parsedPath.filename!;
    if (filename.toLowerCase() === 'appsscript' || filename.toLowerCase() === 'appsscript.json') {
      // Check if appsscript is being placed in subfolder (path has directory)
      if (parsedPath.directory && parsedPath.directory !== '') {
        throw new ValidationError(
          'path',
          path,
          'appsscript.json must be in project root (scriptId/appsscript), not in subfolders'
        );
      }
    }

    // ✅ SIMPLIFIED FILE TYPE HANDLING - fileType is now REQUIRED
    const gasFileType = params.fileType as 'SERVER_JS' | 'HTML' | 'JSON';

    // Strip extensions only if they match the declared file type
    let extensionStripped = false;
    if (gasFileType === 'SERVER_JS') {
      if (filename.toLowerCase().endsWith('.js')) {
        filename = filename.slice(0, -3);
        extensionStripped = true;
      } else if (filename.toLowerCase().endsWith('.gs')) {
        filename = filename.slice(0, -3);
        extensionStripped = true;
      }
    } else if (gasFileType === 'HTML') {
      if (filename.toLowerCase().endsWith('.html')) {
        filename = filename.slice(0, -5);
        extensionStripped = true;
      } else if (filename.toLowerCase().endsWith('.htm')) {
        filename = filename.slice(0, -4);
        extensionStripped = true;
      }
    } else if (gasFileType === 'JSON') {
      if (filename.toLowerCase().endsWith('.json')) {
        filename = filename.slice(0, -5);
        extensionStripped = true;
      }
    }

    // REDUCED CONTENT VALIDATION: Only basic safety checks
    const content: string = params.content;

    // Only validate critical safety issues, not syntax
    if (content.includes('<script>') && content.includes('document.write') && gasFileType !== 'HTML') {
      // Warning only - allow operation to proceed
    }

    // After validation passes, check authentication
    const accessToken = await this.getAuthToken(params);

    // ✅ NEW: Two-phase git discovery with projectPath support
    const projectPath = params.projectPath || '';
    const { discoverGit } = await import('../../utils/gitDiscovery.js');
    const gitDiscovery = await discoverGit(parsedPath.scriptId, projectPath, this.gasClient, accessToken);

    // ✅ NEW: If git discovered, use simplified atomic workflow
    if (gitDiscovery.gitExists && !params.skipSyncCheck) {
      return await this.executeWithGitWorkflow(
        params,
        parsedPath,
        filename,
        content,
        gasFileType,
        position,
        accessToken,
        projectPath,
        gitDiscovery
      );
    }

    // ✅ Fallback: Write-protection - check sync before writing (unless skipSyncCheck is true)
    if (!params.skipSyncCheck) {
      const { LocalFileManager } = await import('../../utils/localFileManager.js');
      const localRoot = await LocalFileManager.getProjectDirectory(parsedPath.scriptId);

      if (localRoot) {
        const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
        const localPath = join(localRoot, filename + fileExtension);

        try {
          // Get remote metadata to check sync
          const remoteFiles = await this.gasClient.getProjectMetadata(parsedPath.scriptId, accessToken);
          // Allow write even if file exists remotely but not locally (user intent to write)
          await checkSyncOrThrow(localPath, filename, remoteFiles, true);
        } catch (syncError: any) {
          // Only throw if it's an actual sync conflict, not "file doesn't exist"
          if (syncError.message && syncError.message.includes('out of sync')) {
            throw syncError;
          }
          // File doesn't exist locally or remotely - that's fine for raw_write
        }
      }
    }

    const updatedFiles = await this.gasClient.updateFile(
      parsedPath.scriptId,
      filename,
      content,
      position,
      accessToken,
      gasFileType
    );

    // ✅ NEW: Sync to local cache with remote mtime (write-through cache)
    try {
      const { LocalFileManager } = await import('../../utils/localFileManager.js');
      const localRoot = await LocalFileManager.getProjectDirectory(parsedPath.scriptId);

      if (localRoot) {
        // Write to local cache
        const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
        const localPath = join(localRoot, filename + fileExtension);
        await mkdir(dirname(localPath), { recursive: true });
        await writeFile(localPath, content, 'utf-8');

        // Find remote updateTime and set local mtime to match
        const remoteFile = updatedFiles.find((f: any) => f.name === filename);
        if (remoteFile?.updateTime) {
          await setFileMtimeToRemote(localPath, remoteFile.updateTime, remoteFile.type);
        }
      }
    } catch (syncError) {
      // Don't fail the operation if local sync fails - remote write succeeded
    }

    // NEW: Detect local git and check for breadcrumb
    let gitDetection: GitDetection | undefined = undefined;
    try {
      const gitPath = await detectLocalGit(parsedPath.scriptId);

      // Get files to check for breadcrumb
      let files: any[] = [];
      try {
        files = await this.gasClient.getProjectContent(parsedPath.scriptId, accessToken);
      } catch (filesError) {
        // If we can't fetch files, we don't know breadcrumb status
        console.error('[GIT-DETECTION] Could not fetch files for breadcrumb check:', filesError);
      }

      const breadcrumbExists = files.length > 0 ? checkBreadcrumbExists(files) : null;

      if (gitPath) {
        gitDetection = {
          localGitDetected: true,
          breadcrumbExists: breadcrumbExists ?? undefined  // null becomes undefined for cleaner response
        };

        // Add recommendation ONLY if we KNOW breadcrumb is missing (not unknown)
        if (breadcrumbExists === false) {
          gitDetection.recommendation = buildRecommendation(parsedPath.scriptId, gitPath);
        }
      } else {
        gitDetection = {
          localGitDetected: false
        };
      }
    } catch (detectionError: any) {
      // Git detection is optional - log but don't fail write
      console.error('[GIT-DETECTION] Error during detection:', detectionError?.message ?? String(detectionError));
      gitDetection = {
        localGitDetected: false
      };
    }

    const result: any = {
      status: 'success',
      path,
      scriptId: parsedPath.scriptId,
      filename: filename,
      size: content.length,
      position: updatedFiles.findIndex((f: any) => f.name === filename),
      totalFiles: updatedFiles.length
    };

    // Add git detection results if available
    if (gitDetection) {
      result.git = gitDetection;
    }

    return result;
  }

  /**
   * Execute write with git workflow (feature branches + atomic commit)
   *
   * Simplified atomic workflow for raw writes:
   * 1. Ensure feature branch
   * 2. Write local file
   * 3. Run hooks and commit
   * 4. Push to remote GAS
   * 5. Rollback if remote push fails
   */
  private async executeWithGitWorkflow(
    params: any,
    parsedPath: any,
    filename: string,
    content: string,
    gasFileType: string,
    position: number | undefined,
    accessToken: string,
    projectPath: string,
    gitDiscovery: any
  ): Promise<any> {
    const { LocalFileManager } = await import('../../utils/localFileManager.js');
    const { writeLocalAndValidateWithHooks, revertGitCommit } = await import('../../utils/hookIntegration.js');
    const { ensureFeatureBranch } = await import('../../utils/gitAutoCommit.js');
    const { log } = await import('../../utils/logger.js');

    // Get project paths
    const baseProjectPath = await LocalFileManager.getProjectDirectory(parsedPath.scriptId);
    const projectRoot = projectPath ? join(baseProjectPath, projectPath) : baseProjectPath;
    const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
    const fullFilename = filename + fileExtension;
    const filePath = join(projectRoot, fullFilename);

    log.info(`[RAW_WRITE] Git discovered: ${gitDiscovery.source} at ${gitDiscovery.gitPath}`);

    // PHASE 0: Ensure feature branch
    const branchResult = await ensureFeatureBranch(projectRoot);
    log.info(
      `[RAW_WRITE] Feature branch: ${branchResult.branch}${branchResult.created ? ' (auto-created)' : ' (existing)'}`
    );

    // PHASE 1: Write local + run hooks + commit
    const hookResult = await writeLocalAndValidateWithHooks(
      content,
      filePath,
      filename,
      parsedPath.scriptId,
      projectRoot,
      params.changeReason  // Pass custom commit message
    );

    if (!hookResult.success) {
      throw new Error(`Git hooks validation failed: ${hookResult.error}`);
    }

    const finalContent = hookResult.contentAfterHooks || content;

    // PHASE 2: Push to remote GAS
    try {
      const updatedFiles = await this.gasClient.updateFile(
        parsedPath.scriptId,
        filename,
        finalContent,
        position,
        accessToken,
        gasFileType as 'SERVER_JS' | 'HTML' | 'JSON'
      );

      // Set local mtime to match remote
      const remoteFile = updatedFiles.find((f: any) => f.name === filename);
      if (remoteFile?.updateTime) {
        await setFileMtimeToRemote(filePath, remoteFile.updateTime, remoteFile.type);
      }

      // Success - return result
      return {
        status: 'success',
        path: params.path,
        scriptId: parsedPath.scriptId,
        filename,
        size: finalContent.length,
        position: updatedFiles.findIndex((f: any) => f.name === filename),
        totalFiles: updatedFiles.length,
        git: {
          enabled: true,
          source: gitDiscovery.source,
          gitPath: gitDiscovery.gitPath,
          branch: branchResult.branch,
          branchCreated: branchResult.created,
          commitHash: hookResult.commitHash,
          commitMessage: params.changeReason || `Update ${filename}`,
          hookModified: hookResult.hookModified,
          breadcrumbsPulled: gitDiscovery.breadcrumbsPulled
        }
      };

    } catch (remoteError: any) {
      // PHASE 3: Remote failed - revert git commit
      log.error(`[RAW_WRITE] Remote write failed, reverting commit: ${remoteError.message}`);

      const revertResult = await revertGitCommit(
        projectRoot,
        hookResult.commitHash!,
        filename
      );

      if (revertResult.success) {
        throw new Error(`Remote write failed after local validation - all changes reverted: ${remoteError.message}`);
      } else {
        throw new Error(
          `CRITICAL: Remote write failed AND commit revert failed.\n\n` +
          `Manual recovery required:\n` +
          `1. Navigate to: ${projectRoot}\n` +
          `2. Check git status: git status\n` +
          `3. If conflicts exist: git revert --abort\n` +
          `4. To undo commit: git reset --hard HEAD~1 (WARNING: loses commit ${hookResult.commitHash})\n\n` +
          `Original error: ${remoteError.message}\n` +
          `Revert error: ${revertResult.error || 'unknown'}`
        );
      }
    }
  }
}
