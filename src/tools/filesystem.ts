import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { parsePath, matchesDirectory, getDirectory, getBaseName, joinPath } from '../api/pathParser.js';
import { ValidationError, FileOperationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { ProjectResolver } from '../utils/projectResolver.js';
import { LocalFileManager } from '../utils/localFileManager.js';
import { wrapModuleContent, unwrapModuleContent, shouldWrapContent, getModuleName } from '../utils/moduleWrapper.js';

/**
 * Read file contents with smart local/remote fallback (RECOMMENDED)
 * 
 * ✅ RECOMMENDED - Use for normal development workflow
 * Automatically reads from local ./src/ if current project is set, otherwise reads from remote
 */
export class GASCatTool extends BaseTool {
  public name = 'gas_cat';
  public description = '📖 RECOMMENDED: Smart file reader - uses local files when available, otherwise reads from remote';
  
  public inputSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path (filename only if current project set, or full projectId/filename)',
        pattern: '^([a-zA-Z0-9_-]{5,60}/[a-zA-Z0-9_.//-]+|[a-zA-Z0-9_.//-]+)$',
        minLength: 1,
        maxLength: 200,
        examples: [
          'utils.gs',                    // Uses current project
          'models/User.gs',              // Uses current project  
          'abc123def456.../helpers.gs'   // Explicit project ID
        ]
      },
      preferLocal: {
        type: 'boolean',
        description: 'Prefer local file over remote when both exist',
        default: true
      },
      workingDir: {
        type: 'string',
        description: 'Working directory (defaults to current directory)'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['path'],
    llmGuidance: {
      whenToUse: 'Use for normal file reading. Automatically handles local/remote logic.',
      workflow: 'Set project with gas_project_set, then just use filename: gas_cat({path: "utils.gs"})',
      alternatives: 'Use gas_raw_cat only when you need explicit project ID control'
    }
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const { LocalFileManager } = await import('../utils/localFileManager.js');
    const workingDir = params.workingDir || LocalFileManager.getResolvedWorkingDirectory();
    const preferLocal = params.preferLocal !== false;
    let filePath = params.path;

    // Try to resolve path with current project context if needed
    try {
      const parsedPath = parsePath(filePath);
      
      if (!parsedPath.isFile) {
        // Path doesn't have project ID, try to use current project
        const currentProjectId = await ProjectResolver.getCurrentProjectId(workingDir);
        filePath = `${currentProjectId}/${filePath}`;
      }
    } catch (error) {
      // If no current project, the path must be complete
      const parsedPath = parsePath(filePath);
      if (!parsedPath.isFile) {
        throw new ValidationError('path', filePath, 'complete project-id/filename path or set current project with gas_project_set');
      }
    }

    // SECURITY: Validate path BEFORE authentication
    const path = this.validate.filePath(filePath, 'file reading');
    const parsedPath = parsePath(path);
    
    if (!parsedPath.isFile) {
      throw new ValidationError('path', path, 'file path (must include filename)');
    }

    const scriptId = parsedPath.projectId;
    const filename = parsedPath.filename;
    
    if (!filename) {
      throw new ValidationError('path', path, 'file path must include a filename');
    }
    
    const projectName = scriptId; // Use scriptId as project name

    // 🎯 GIT INTEGRATION: Ensure project has git repository
    const gitStatus = await LocalFileManager.ensureProjectGitRepo(projectName, workingDir);
    if (gitStatus.isNewRepo) {
      console.error(`🔧 [GAS_CAT] Initialized new git repository for project: ${projectName}`);
    }

    // After path validation passes, check authentication
    const accessToken = await this.getAuthToken(params);

    // 🔍 SYNC VERIFICATION: Check if local and remote are in sync
    let syncStatus: {
      inSync: boolean;
      differences: {
        onlyLocal: string[];
        onlyRemote: string[];
        contentDiffers: string[];
      };
      summary: string;
    } | null = null;
    let remoteFiles: any[] = [];
    
    try {
      console.error(`🔍 [GAS_CAT] Verifying sync status with remote...`);
      remoteFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
      syncStatus = await LocalFileManager.verifySyncStatus(projectName, remoteFiles, workingDir);
      
      console.error(`📊 [GAS_CAT] ${syncStatus.summary}`);
      
      // 🎯 AUTO-SYNC: Handle first-time access and major sync issues
      const shouldAutoSync = (this as any).shouldAutoSync(syncStatus, remoteFiles.length);
      
      if (shouldAutoSync.pull) {
        console.error(`🔄 [GAS_CAT] ${shouldAutoSync.reason} - Auto-pulling all remote files...`);
        
        try {
          const pullResult = await LocalFileManager.copyRemoteToLocal(projectName, remoteFiles, workingDir);
          console.error(`✅ [GAS_CAT] Auto-pulled ${pullResult.filesWritten} files to establish local baseline`);
          
          // Create initial git commit for baseline
          if (gitStatus.gitInitialized && pullResult.filesWritten > 0) {
            const commitResult = await LocalFileManager.autoCommitChanges(
              projectName,
              pullResult.filesList,
              `Initial sync: pulled ${pullResult.filesWritten} files from remote`,
              workingDir
            );
            
            if (commitResult.committed) {
              console.error(`🎯 [GAS_CAT] Created baseline commit: ${commitResult.commitHash}`);
            }
          }
          
          // Re-verify sync status after pull
          syncStatus = await LocalFileManager.verifySyncStatus(projectName, remoteFiles, workingDir);
          console.error(`📊 [GAS_CAT] After auto-sync: ${syncStatus.summary}`);
          
        } catch (pullError: any) {
          console.error(`⚠️ [GAS_CAT] Auto-pull failed: ${pullError.message} - continuing with manual operation`);
        }
      } else if (!syncStatus.inSync) {
        console.error(`⚠️ [GAS_CAT] Sync differences detected:`);
        if (syncStatus.differences.onlyLocal.length > 0) {
          console.error(`   📁 Local-only files: ${syncStatus.differences.onlyLocal.join(', ')}`);
        }
        if (syncStatus.differences.onlyRemote.length > 0) {
          console.error(`   ☁️ Remote-only files: ${syncStatus.differences.onlyRemote.join(', ')}`);
        }
        if (syncStatus.differences.contentDiffers.length > 0) {
          console.error(`   📝 Content differs: ${syncStatus.differences.contentDiffers.join(', ')}`);
        }
        console.error(`💡 [GAS_CAT] Use gas_pull to sync local with remote, or gas_push to sync remote with local`);
      }
    } catch (syncError: any) {
      console.error(`⚠️ [GAS_CAT] Sync verification failed: ${syncError.message}`);
      // Continue with operation even if sync check fails
    }

    let result: any;
    let source: 'local' | 'remote' = 'remote';

        if (preferLocal) {
      // Try to read from local first
      try {
        const localContent = await LocalFileManager.readFileFromProject(projectName, filename, workingDir);
        if (localContent) {
          result = {
            path: filePath,
            projectId: scriptId,
            filename,
            content: localContent,
            source: 'local',
            fileExtension: LocalFileManager.getFileExtensionFromName(filename),
            syncStatus: syncStatus ? {
              inSync: syncStatus.inSync,
              differences: syncStatus.differences,
              message: syncStatus.summary
            } : null,
            gitRepository: {
              initialized: gitStatus.gitInitialized,
              path: gitStatus.repoPath,
              isNewRepo: gitStatus.isNewRepo
            }
          };
          source = 'local';
          console.error(`📖 [GAS_CAT] Successfully read from local file: ${filename}`);
        }
      } catch (localError: any) {
        console.error(`⚠️ [GAS_CAT] Local file not found, falling back to remote: ${localError.message}`);
        // Fall back to remote
      }
    }

    // Read from remote if local failed or not preferred
    if (!result || source !== 'local') {
      const remoteFile = remoteFiles.find((file: any) => file.name === filename);
      
      if (!remoteFile) {
        throw new ValidationError('filename', filename, 'existing file in the project');
      }

      result = {
        path: filePath,
        projectId: scriptId,
        filename,
        content: remoteFile.source || remoteFile.content || '',
        source: 'remote',
        fileType: remoteFile.type,
        fileExtension: LocalFileManager.getFileExtensionFromName(filename),
        syncStatus: syncStatus ? {
          inSync: syncStatus.inSync,
          differences: syncStatus.differences,
          message: syncStatus.summary
        } : null,
        gitRepository: {
          initialized: gitStatus.gitInitialized,
          path: gitStatus.repoPath,
          isNewRepo: gitStatus.isNewRepo
        }
      };
      source = 'remote';
      console.error(`☁️ [GAS_CAT] Successfully read from remote file: ${filename}`);
    }

    return result;
  }

  /**
   * Determine if auto-sync should be triggered based on sync status.
   * Conservative logic to avoid losing local changes.
   */
  private shouldAutoSync(syncStatus: {
    inSync: boolean;
    differences: {
      onlyLocal: string[];
      onlyRemote: string[];
      contentDiffers: string[];
    };
    summary: string;
  } | null, totalRemoteFiles: number): { pull: boolean; reason: string } {
    if (!syncStatus) {
      return { pull: false, reason: 'No sync status available' };
    }

    // Check for first-time access: no local files but remote files exist
    const hasNoLocalFiles = syncStatus.differences.onlyLocal.length === 0 && 
                            syncStatus.differences.contentDiffers.length === 0;
    const hasRemoteFiles = syncStatus.differences.onlyRemote.length > 0;
    
    if (hasNoLocalFiles && hasRemoteFiles) {
      return { pull: true, reason: 'First-time project access (no local files)' };
    }

    // Check for major out of sync: many remote-only files
    if (syncStatus.differences.onlyRemote.length >= 3) {
      return { pull: true, reason: `Missing ${syncStatus.differences.onlyRemote.length} remote files locally` };
    }

    // Don't auto-pull if there are local changes that could be lost
    if (syncStatus.differences.onlyLocal.length > 0 || syncStatus.differences.contentDiffers.length > 0) {
      return { pull: false, reason: 'Local changes detected - manual sync required' };
    }

    return { pull: false, reason: 'Sync status acceptable' };
  }
}

/**
 * Write file with automatic local and remote sync (RECOMMENDED)
 * 
 * ✅ RECOMMENDED - Use for normal development workflow
 * Automatically writes to both local ./src/ and remote project when explicit project path provided
 */
export class GASWriteTool extends BaseTool {
  public name = 'gas_write';
  public description = '✍️ RECOMMENDED: Smart file writer - remote-first workflow with auto-sync to local';
  
  public inputSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Full path to file: projectId/filename (WITHOUT extension). Same format as gas_raw_write for consistency.',
        pattern: '^[a-zA-Z0-9_-]{20,60}/[a-zA-Z0-9_.//-]+$',
        minLength: 25,
        maxLength: 200,
        examples: [
          'abc123def456.../utils',                // → utils.gs
          'abc123def456.../models/User',          // → models/User.gs  
          'abc123def456.../helpers',              // → helpers.gs
          'abc123def456.../appsscript'            // → appsscript.json
        ]
      },
      content: {
        type: 'string',
        description: 'File content to write. Content type automatically detected for proper file extension.',
        maxLength: 100000
      },
      fileType: {
        type: 'string',
        description: 'Explicit file type for Google Apps Script (optional). If not provided, auto-detected from content.',
        enum: ['SERVER_JS', 'HTML', 'JSON'],
        examples: ['SERVER_JS', 'HTML', 'JSON']
      },
      localOnly: {
        type: 'boolean',
        description: 'Write only to local ./src/ directory (skip remote sync)',
        default: false
      },
      remoteOnly: {
        type: 'boolean',
        description: 'Write only to remote project (skip local sync)',
        default: false
      },
      workingDir: {
        type: 'string',
        description: 'Working directory (defaults to current directory)'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['path', 'content'],
    llmGuidance: {
      whenToUse: 'Use for normal file writing with explicit project paths. Remote-first workflow ensures safety.',
      workflow: 'Use with explicit paths: gas_write({path: "projectId/filename", content: "..."}) - writes to remote first, then commits to git, then updates local file',
      alternatives: 'Use gas_raw_write when you need single-destination writes or advanced file positioning'
    }
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const { LocalFileManager } = await import('../utils/localFileManager.js');
    const workingDir = params.workingDir || LocalFileManager.getResolvedWorkingDirectory();
    const localOnly = params.localOnly || false;
    const remoteOnly = params.remoteOnly || false;

    if (localOnly && remoteOnly) {
      throw new ValidationError('localOnly/remoteOnly', 'both true', 'only one can be true');
    }

    // SECURITY: Validate path BEFORE authentication (like gas_raw_write)
    const path = this.validate.filePath(params.path, 'file writing');
    
    const parsedPath = parsePath(path);
    
    if (!parsedPath.isFile) {
      throw new ValidationError('path', path, 'file path (must include filename)');
    }

    const scriptId = parsedPath.projectId;
    const filename = parsedPath.filename;
    
    if (!filename) {
      throw new ValidationError('path', path, 'file path must include a filename');
    }
    
    const projectName = scriptId; // Use scriptId as project name
    const content = params.content;

    // 🎯 REMOTE-FIRST WORKFLOW: Step 1 - Ensure git repository
    console.error(`🎯 [GAS_WRITE] Starting remote-first workflow for: ${projectName}/${filename}`);
    const gitStatus = await LocalFileManager.ensureProjectGitRepo(projectName, workingDir);
    
    if (gitStatus.isNewRepo) {
      console.error(`🔧 [GAS_WRITE] Initialized new git repository: ${gitStatus.repoPath}`);
    } else {
      console.error(`✅ [GAS_WRITE] Using existing git repository: ${gitStatus.repoPath}`);
    }

    // After path validation passes, check authentication
    const accessToken = await this.getAuthToken(params);

    // 🔍 REMOTE-FIRST WORKFLOW: Step 2 - Verify sync status with remote
    let syncStatus: {
      inSync: boolean;
      differences: {
        onlyLocal: string[];
        onlyRemote: string[];
        contentDiffers: string[];
      };
      summary: string;
    } | null = null;
    let remoteFiles: any[] = [];
    
    if (!localOnly) {
      try {
        console.error(`🔍 [GAS_WRITE] Verifying sync status with remote...`);
        remoteFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
        syncStatus = await LocalFileManager.verifySyncStatus(projectName, remoteFiles, workingDir);
        
        console.error(`📊 [GAS_WRITE] ${syncStatus.summary}`);
        
        // 🎯 AUTO-SYNC: Handle first-time access and major sync issues  
        const shouldAutoSync = (this as any).shouldAutoSync(syncStatus, remoteFiles.length);
        
        if (shouldAutoSync.pull) {
          console.error(`🔄 [GAS_WRITE] ${shouldAutoSync.reason} - Auto-pulling all remote files before write...`);
          
          try {
            const pullResult = await LocalFileManager.copyRemoteToLocal(projectName, remoteFiles, workingDir);
            console.error(`✅ [GAS_WRITE] Auto-pulled ${pullResult.filesWritten} files to establish baseline`);
            
            // Create initial git commit for baseline
            if (gitStatus.gitInitialized && pullResult.filesWritten > 0) {
              const commitResult = await LocalFileManager.autoCommitChanges(
                projectName,
                pullResult.filesList,
                `Initial baseline: pulled ${pullResult.filesWritten} files from remote`,
                workingDir
              );
              
              if (commitResult.committed) {
                console.error(`🎯 [GAS_WRITE] Created baseline commit: ${commitResult.commitHash}`);
              }
            }
            
            // Re-verify sync status after pull
            syncStatus = await LocalFileManager.verifySyncStatus(projectName, remoteFiles, workingDir);
            console.error(`📊 [GAS_WRITE] After auto-sync: ${syncStatus.summary}`);
            
          } catch (pullError: any) {
            console.error(`⚠️ [GAS_WRITE] Auto-pull failed: ${pullError.message} - continuing with write operation`);
          }
        } else if (!syncStatus.inSync) {
          console.error(`⚠️ [GAS_WRITE] Sync differences detected - proceeding with write:`);
          if (syncStatus.differences.onlyLocal.length > 0) {
            console.error(`   📁 Local-only files: ${syncStatus.differences.onlyLocal.join(', ')}`);
          }
          if (syncStatus.differences.onlyRemote.length > 0) {
            console.error(`   ☁️ Remote-only files: ${syncStatus.differences.onlyRemote.join(', ')}`);
          }
          if (syncStatus.differences.contentDiffers.length > 0) {
            console.error(`   📝 Content differs: ${syncStatus.differences.contentDiffers.join(', ')}`);
          }
          
          if (shouldAutoSync.reason === 'Local changes detected - manual sync required') {
            console.error(`💡 [GAS_WRITE] Recommendation: Review local changes and use gas_pull/gas_push to sync manually before writing`);
          }
        }
        
        if (!syncStatus.inSync) {
          // Enhanced warning for users about potential conflicts
          console.error(`⚠️ [GAS_WRITE] NOTICE: Writing to out-of-sync project. Your changes will be committed to git for safety.`);
        }
      } catch (syncError: any) {
        console.error(`⚠️ [GAS_WRITE] Sync verification failed: ${syncError.message} - proceeding anyway`);
      }
    }

    // 📝 REMOTE-FIRST WORKFLOW: Step 3 - Read current local content for comparison
    let previousLocalContent: string | null = null;
    try {
      previousLocalContent = await LocalFileManager.readFileFromProject(projectName, filename, workingDir);
      if (previousLocalContent) {
        console.error(`📖 [GAS_WRITE] Read current local content (${previousLocalContent.length} chars)`);
      } else {
        console.error(`📄 [GAS_WRITE] No existing local file - creating new file`);
      }
    } catch (error: any) {
      console.error(`📄 [GAS_WRITE] No existing local file found - creating new: ${error.message}`);
    }

    // Handle appsscript.json special case validation
    if (filename.toLowerCase() === 'appsscript' || filename.toLowerCase() === 'appsscript.json') {
      // Special handling logic can be added here if needed
      console.error(`🔧 [GAS_WRITE] Writing manifest file: ${filename}`);
    }

    // 🚀 REMOTE-FIRST WORKFLOW: Step 4 - Push to remote FIRST
    let results: any = {};
    
    if (!localOnly) {
      try {
        console.error(`🚀 [GAS_WRITE] REMOTE-FIRST: Pushing to remote: ${scriptId}/${filename}`);
        
        // Use gas_raw_write logic for remote push
        const currentFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
        
        // Find existing file or determine file type
        const existingFile = currentFiles.find((f: any) => f.name === filename);
        const fileType = existingFile?.type || this.determineFileType(filename, content);
        
        // Create new file object
        const newFile = {
          name: filename,
          type: fileType as any,
          source: content
        };
        
        let updatedFiles: any[];
        
        if (existingFile) {
          // Update existing file
          updatedFiles = currentFiles.map((f: any) => 
            f.name === filename ? newFile : f
          );
        } else {
          // Add new file
          updatedFiles = [...currentFiles, newFile];
        }
        
        // Push to remote
        const remoteResult = await this.gasClient.updateProjectContent(scriptId, updatedFiles, accessToken);
        
        console.error(`✅ [GAS_WRITE] Remote push successful - proceeding with local operations`);
        
        results.remoteFile = {
          scriptId,
          filename,
          type: fileType,
          content,
          size: content.length,
          updated: true
        };
        
      } catch (remoteError: any) {
        console.error(`❌ [GAS_WRITE] Remote push failed: ${remoteError.message}`);
        throw new Error(`Remote write failed - aborting local operations: ${remoteError.message}`);
      }
    }

    // 🎯 REMOTE-FIRST WORKFLOW: Step 5 - Generate smart commit message (after remote success)
    let commitMessage = `Update ${filename}`;
    
    if (previousLocalContent !== null) {
      const isNewFile = previousLocalContent === null;
      const contentChanged = previousLocalContent !== content;
      
      if (isNewFile) {
        commitMessage = `Add ${filename}`;
      } else if (contentChanged) {
        const prevLength = previousLocalContent.length;
        const newLength = content.length;
        const sizeDiff = newLength - prevLength;
        
        if (Math.abs(sizeDiff) > 100) {
          commitMessage = `Update ${filename} (${sizeDiff > 0 ? '+' : ''}${sizeDiff} chars)`;
        } else {
          commitMessage = `Update ${filename}`;
        }
        
        // Try to detect function changes for smarter messages
        try {
          const prevFunctions = (previousLocalContent.match(/function\s+(\w+)/g) || []).map((f: string) => f.replace('function ', ''));
          const newFunctions = (content.match(/function\s+(\w+)/g) || []).map((f: string) => f.replace('function ', ''));
          
          const addedFunctions = newFunctions.filter((f: string) => !prevFunctions.includes(f));
          const removedFunctions = prevFunctions.filter((f: string) => !newFunctions.includes(f));
          
          if (addedFunctions.length > 0 || removedFunctions.length > 0) {
            const changes = [];
            if (addedFunctions.length > 0) changes.push(`add ${addedFunctions.join(', ')}`);
            if (removedFunctions.length > 0) changes.push(`remove ${removedFunctions.join(', ')}`);
            commitMessage = `${changes.join(', ')} in ${filename}`;
          }
        } catch (functionAnalysisError) {
          // Fallback to simple message if function analysis fails
          console.error(`⚠️ [GAS_WRITE] Function analysis failed, using simple commit message`);
        }
      }
    } else {
      commitMessage = `Add ${filename}`;
    }

    // 🔄 REMOTE-FIRST WORKFLOW: Step 6 - Auto-commit to git (only after remote success)
    let gitCommitResult: any = null;
    
    if (!remoteOnly && gitStatus.gitInitialized) {
      try {
        console.error(`🔄 [GAS_WRITE] Remote succeeded - committing to git: "${commitMessage}"`);
        
        // First write the local file temporarily for git commit
        const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
        const fullFilename = filename + fileExtension;
        const projectPath = await LocalFileManager.getProjectDirectory(projectName, workingDir);
        const path = await import('path');
        const filePath = path.join(projectPath, fullFilename);
        
        await import('fs').then(fs => fs.promises.writeFile(filePath, content, 'utf-8'));
        
        gitCommitResult = await LocalFileManager.autoCommitChanges(
          projectName, 
          [filename], 
          commitMessage, 
          workingDir
        );
        
        if (gitCommitResult.committed) {
          console.error(`✅ [GAS_WRITE] Git commit successful: ${gitCommitResult.commitHash}`);
        } else {
          console.error(`ℹ️ [GAS_WRITE] ${gitCommitResult.message}`);
        }
      } catch (commitError: any) {
        console.error(`⚠️ [GAS_WRITE] Git commit failed: ${commitError.message} - but remote write succeeded`);
        gitCommitResult = {
          committed: false,
          message: `Git commit failed: ${commitError.message}`
        };
      }
    }

    // 💾 REMOTE-FIRST WORKFLOW: Step 7 - Write local file (final step)
    if (!remoteOnly) {
      try {
        console.error(`💾 [GAS_WRITE] Final step - ensuring local file is written: ${projectName}/${filename}`);
        
        // Write to local project directory (might be redundant from git step above, but ensures consistency)
        const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
        const fullFilename = filename + fileExtension;
        const projectPath = await LocalFileManager.getProjectDirectory(projectName, workingDir);
        const path = await import('path');
        const filePath = path.join(projectPath, fullFilename);
        
        await import('fs').then(fs => fs.promises.writeFile(filePath, content, 'utf-8'));
        
        console.error(`✅ [GAS_WRITE] Local file finalized: ${filePath}`);
        
        results.localFile = {
          path: filePath,
          content: content,
          size: content.length,
          updated: true
        };
      } catch (writeError: any) {
        console.error(`⚠️ [GAS_WRITE] Local file write failed: ${writeError.message} - but remote and git operations succeeded`);
        results.localFile = {
          error: writeError.message,
          updated: false
        };
      }
    }

    // 📊 Return comprehensive results
    return {
      path: path,
      projectId: scriptId,
      filename,
      content,
      size: content.length,
      workflow: 'local-first-git',
      results,
      gitRepository: {
        initialized: gitStatus.gitInitialized,
        path: gitStatus.repoPath,
        isNewRepo: gitStatus.isNewRepo,
        commitResult: gitCommitResult
      },
      syncStatus: syncStatus ? {
        inSync: syncStatus.inSync,
        differences: syncStatus.differences,
        message: syncStatus.summary
      } : null,
      operations: {
        localWrite: !remoteOnly,
        remoteWrite: !localOnly,
        gitCommit: gitCommitResult?.committed || false,
        syncVerification: !!syncStatus
      },
      summary: `Successfully ${gitCommitResult?.committed ? 'committed and ' : ''}${localOnly ? 'wrote locally' : remoteOnly ? 'pushed to remote' : 'synchronized local and remote'}`
    };
  }

  /**
   * Determine file type from filename and content
   */
  private determineFileType(filename: string, content: string): string {
    if (filename.toLowerCase() === 'appsscript') {
      return 'JSON';
    }
    
    const trimmed = content.trim();
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html>')) {
      return 'HTML';
    } else if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return 'JSON';
    } else {
      return 'SERVER_JS';
    }
  }
}

/**
 * List files and directories in a Google Apps Script project
 */
export class GASListTool extends BaseTool {
  public name = 'gas_ls';
  public description = 'List files and directories in a Google Apps Script project. SPECIAL FILE: Always shows appsscript.json if present - this manifest file must exist in project root and contains essential project metadata.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to list: empty for all projects, projectId for project files, projectId/prefix for logical grouping (no real folders in GAS). NOTE: appsscript.json will always be included in listings if present in the project.',
        default: ''
      },
      detailed: {
        type: 'boolean',
        default: true,
        description: 'Include detailed file information (size, type, timestamps, last modifier, etc.) - defaults to true'
      },
      recursive: {
        type: 'boolean',
        default: true,
        description: 'List files with matching filename prefixes (no real directories exist in GAS)'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    }
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    const path = params.path || '';
    const detailed = params.detailed !== false;  // ✅ Default to true, only false if explicitly set
    const recursive = params.recursive !== false;
    
    const parsedPath = parsePath(path);

    if (!parsedPath.projectId) {
      return await this.listProjects(detailed, accessToken);
    } else if (parsedPath.isProject) {
      return await this.listProjectFiles(parsedPath.projectId, parsedPath.directory || '', detailed, recursive, accessToken);
    } else {
      throw new ValidationError('path', path, 'valid project or directory path');
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
    projectId: string, 
    directory: string, 
    detailed: boolean,
    recursive: boolean,
    accessToken?: string
  ): Promise<any> {
    const files = await this.gasClient.getProjectContent(projectId, accessToken);
    
    // Filter by filename prefix if specified (GAS has no real directories)
    const filteredFiles = directory 
      ? files.filter((file: any) => matchesDirectory(file.name, directory))
      : files;

    const items = filteredFiles.map((file: any, index: number) => ({
      name: file.name,
      type: file.type || 'server_js',
      ...(detailed && {
        size: (file.source || '').length,
        position: index,
        // ✅ NEW: Return actual API timestamps instead of hardcoded null
        createTime: file.createTime || null,
        updateTime: file.updateTime || null,
        lastModifyUser: file.lastModifyUser || null
      })
    }));

    return {
      type: 'files',
      path: directory ? `${projectId}/${directory}` : projectId,
      projectId,
      directory,
      items,
      totalFiles: files.length,
      filteredFiles: items.length
    };
  }
}

/**
 * Read file contents from a Google Apps Script project (RAW/ADVANCED)
 * 
 * ⚠️  ADVANCED TOOL - Use gas_cat for normal development workflow
 * This tool requires explicit project IDs and paths for direct API access
 */
export class GASRawCatTool extends BaseTool {
  public name = 'gas_raw_cat';
  public description = '🔧 ADVANCED: Read file contents with explicit project ID path. Use gas_cat for normal workflow.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Full path to file: projectId/path/to/filename_WITHOUT_EXTENSION (supports virtual paths, extensions auto-detected)'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['path']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    // SECURITY: Validate path BEFORE authentication to prevent malicious path logging
    const path = this.validate.filePath(params.path, 'file reading');
    const parsedPath = parsePath(path);
    
    if (!parsedPath.isFile) {
      throw new ValidationError('path', path, 'file path (must include filename)');
    }
    
    // After path validation passes, check authentication
    const accessToken = await this.getAuthToken(params);

    const files = await this.gasClient.getProjectContent(parsedPath.projectId, accessToken);
    const file = files.find((f: any) => f.name === parsedPath.filename);

    if (!file) {
      throw new FileOperationError('read', path, 'file not found');
    }

    return {
      path,
      projectId: parsedPath.projectId,
      filename: parsedPath.filename,
      type: file.type,
      content: file.source || '',
      size: (file.source || '').length
    };
  }
}

/**
 * Write content to a file in a Google Apps Script project (RAW/ADVANCED)
 * 
 * ⚠️  ADVANCED TOOL - Use gas_write for normal development workflow
 * ⚠️  DANGER: This tool COMPLETELY OVERWRITES remote files without merging
 * 
 * ## CRITICAL WARNING
 * gas_raw_write CLOBBERS (completely replaces) the entire remote file content.
 * Any existing content in the remote file will be PERMANENTLY LOST.
 * 
 * ## RECOMMENDED ALTERNATIVE
 * Use gas_write instead - it provides intelligent merging of local and remote files,
 * preserving existing content while applying your changes safely.
 * 
 * ## When to Use gas_raw_write
 * Only use this tool when you explicitly intend to:
 * - Replace entire file contents completely
 * - Create new files from scratch
 * - Perform bulk operations where clobbering is intended
 * 
 * ## Safe Alternative: gas_write
 * - ✅ Merges local and remote file content intelligently
 * - ✅ Preserves existing code while adding new content
 * - ✅ Safer for collaborative development
 * - ✅ Same path format but with merge protection
 * 
 * This tool requires explicit project IDs and paths for direct API access
 */
export class GASRawWriteTool extends BaseTool {
  public name = 'gas_raw_write';
  public description = '🔧 ADVANCED: Write files with explicit project ID path. ⚠️ DANGER: CLOBBERS remote files - use gas_write for safe merging. SPECIAL FILE: appsscript.json must always reside in project root (no subfolders allowed) and contains essential project metadata.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Full path to file: projectId/filename (WITHOUT extension). LLM CRITICAL: Extensions like .gs, .html, .json are AUTOMATICALLY added. Google Apps Script auto-detects file type from content. SPECIAL CASE: appsscript.json must be in project root (projectId/appsscript), never in subfolders.',
        pattern: '^[a-zA-Z0-9_-]{20,60}/[a-zA-Z0-9_.//-]+$',
        minLength: 25,
        maxLength: 200,
        examples: [
          'abc123def456.../fibonacci',
          'abc123def456.../utils/helpers',
          'abc123def456.../Code',
          'abc123def456.../models/User',
          'abc123def456.../appsscript'
        ],
        llmHints: {
          format: 'projectId/filename (no extension)',
          extensions: 'Tool automatically adds .gs for JavaScript, .html for HTML, .json for JSON',
          organization: 'Use "/" in filename for logical organization (not real folders)',
          autoDetection: 'File type detected from content: JavaScript, HTML, JSON',
          specialFiles: 'appsscript.json MUST be in root: projectId/appsscript (never projectId/subfolder/appsscript)',
          warning: 'This tool OVERWRITES the entire file - use gas_write for safer merging'
        }
      },
      content: {
        type: 'string',
        description: 'File content to write. ⚠️ WARNING: This content will COMPLETELY REPLACE the existing file. LLM FLEXIBILITY: Supports JavaScript/Apps Script, HTML, JSON. Content type automatically detected for proper file extension.',
        minLength: 0,
        maxLength: 100000,
        examples: [
          'function fibonacci(n) { return n <= 1 ? n : fibonacci(n-1) + fibonacci(n-2); }',
          '<!DOCTYPE html><html><body><h1>My Web App</h1></body></html>',
          '{"timeZone": "America/New_York", "dependencies": {}}',
          'const API_KEY = "your-key"; function processData() { /* code */ }'
        ],
        llmHints: {
          javascript: 'Apps Script functions, ES6+ syntax, Google services (SpreadsheetApp, etc.)',
          html: 'HTML templates for web apps, can include CSS and JavaScript',
          json: 'Configuration files like appsscript.json for project settings',
          limits: 'Maximum 100KB per file (Google Apps Script limit)',
          encoding: 'UTF-8 encoding, supports international characters',
          danger: 'This content will OVERWRITE the entire remote file - existing content will be lost'
        }
      },
      position: {
        type: 'number',
        description: 'File execution order position (0-based). LLM USE: Controls order in Apps Script editor and execution sequence. Lower numbers execute first.',
        minimum: 0,
        maximum: 100,
        llmHints: {
          execution: 'Lower numbers execute first in Apps Script runtime',
          organization: 'Use for dependencies: utilities first (0), main code later (1,2,3)',
          optional: 'Omit to append at end of file list',
          reordering: 'Use gas_reorder tool to change position later'
        }
      },
      fileType: {
        type: 'string',
        enum: ['SERVER_JS', 'HTML', 'JSON'],
        description: 'File type for Google Apps Script. REQUIRED: Must be explicitly specified.',
        examples: ['SERVER_JS', 'HTML', 'JSON'],
        llmHints: {
          serverJs: 'Use SERVER_JS for JavaScript/Apps Script code (.gs files)',
          html: 'Use HTML for web app templates (.html files)',
          json: 'Use JSON for configuration files (.json files like appsscript.json)'
        }
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation. LLM TYPICAL: Omit - tool uses session authentication.',
        pattern: '^ya29\\.[a-zA-Z0-9_-]+$',
        llmHints: {
          typical: 'Usually omitted - uses session auth from gas_auth',
          stateless: 'Only for token-based operations'
        }
      }
    },
    required: ['path', 'content', 'fileType'],
    additionalProperties: false,
    llmWorkflowGuide: {
      prerequisites: [
        '1. Authentication: gas_auth({mode: "status"}) → gas_auth({mode: "start"}) if needed',
        '2. Project exists: Have scriptId from gas_project_create or gas_ls',
        '3. ⚠️ VERIFY: You intend to COMPLETELY OVERWRITE the target file'
      ],
      dangerWarning: {
        behavior: 'This tool CLOBBERS (completely overwrites) remote files without merging',
        consequence: 'Any existing content in the target file will be PERMANENTLY LOST',
        recommendation: 'Use gas_write instead for safe merging of local and remote content',
        useCase: 'Only use gas_raw_write when you explicitly intend to replace entire file contents'
      },
      saferAlternative: {
        tool: 'gas_write',
        benefits: [
          'Intelligent merging of local and remote file content',
          'Preserves existing code while adding new content',  
          'Safer for collaborative development',
          'Same path format but with merge protection'
        ],
        when: 'Use gas_write for most file writing operations unless you specifically need to clobber files'
      },
      useCases: {
        newFile: 'Creating completely new files from scratch',
        replace: 'Intentionally replacing entire file contents',
        bulk: 'Bulk operations where clobbering is intended',
        config: 'Replacing configuration files like appsscript.json',
        avoid: '⚠️ AVOID for: Updating existing files, collaborative editing, preserving content'
      },
      fileTypes: {
        javascript: 'Content with functions → .gs file (SERVER_JS type)',
        html: 'Content with HTML tags → .html file (HTML type)', 
        json: 'Content with JSON format → .json file (JSON type)'
      },
      bestPractices: [
        '⚠️ CRITICAL: Only use when you intend to completely replace file contents',
        'Consider gas_write for safer merging operations',
        'Use descriptive filenames that indicate purpose',
        'Organize related functions in same file',
        'Put utility functions in separate files at position 0',
        'Use logical "/" paths for organization: utils/helpers, models/User'
      ],
      afterWriting: [
        'Use gas_run to execute functions from this file',
        'Use gas_cat to verify file was written correctly',
        'Use gas_ls to see file in project structure',
        '⚠️ Verify that file clobbering was intentional'
      ]
    }
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

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
          'appsscript.json must be in project root (projectId/appsscript), not in subfolders'
        );
      }
      console.error(`✅ Special file appsscript.json validated - correctly placed in project root`);
    }

    // ✅ SIMPLIFIED FILE TYPE HANDLING - fileType is now REQUIRED
    const gasFileType = params.fileType as 'SERVER_JS' | 'HTML' | 'JSON';
    
    console.error(`🎯 Using required fileType: ${gasFileType} for ${filename}`);
    
    // Strip extensions only if they match the declared file type
    let extensionStripped = false;
    if (gasFileType === 'SERVER_JS') {
      if (filename.toLowerCase().endsWith('.js')) {
        const originalFilename = filename;
        filename = filename.slice(0, -3);
        console.error(`✂️  JS extension stripped: ${originalFilename} → ${filename}`);
        extensionStripped = true;
      } else if (filename.toLowerCase().endsWith('.gs')) {
        const originalFilename = filename;
        filename = filename.slice(0, -3);
        console.error(`✂️  GS extension stripped: ${originalFilename} → ${filename}`);
        extensionStripped = true;
      }
    } else if (gasFileType === 'HTML') {
      if (filename.toLowerCase().endsWith('.html')) {
        const originalFilename = filename;
        filename = filename.slice(0, -5);
        console.error(`✂️  HTML extension stripped: ${originalFilename} → ${filename}`);
        extensionStripped = true;
      } else if (filename.toLowerCase().endsWith('.htm')) {
        const originalFilename = filename;
        filename = filename.slice(0, -4);
        console.error(`✂️  HTM extension stripped: ${originalFilename} → ${filename}`);
        extensionStripped = true;
      }
    } else if (gasFileType === 'JSON') {
      if (filename.toLowerCase().endsWith('.json')) {
        const originalFilename = filename;
        filename = filename.slice(0, -5);
        console.error(`✂️  JSON extension stripped: ${originalFilename} → ${filename}`);
        extensionStripped = true;
      }
    }
    
    if (!extensionStripped) {
      console.error(`✅ No extension stripping needed for ${gasFileType} type`);
    }

    // REDUCED CONTENT VALIDATION: Only basic safety checks
    const content: string = params.content;
    
    // Let Google Apps Script API be the authority for size validation
    // Remove arbitrary client-side limits and let the API return its own errors
    
    // Only validate critical safety issues, not syntax
    if (content.includes('<script>') && content.includes('document.write') && gasFileType !== 'HTML') {
      console.error(`⚠️  Warning: Potential script injection detected - but allowing since you explicitly chose ${gasFileType} type`);
    }
    
    console.error(`✅ File type determined: ${gasFileType} for ${filename}`);

    // After validation passes, check authentication
    const accessToken = await this.getAuthToken(params);

    console.error(`📝 Writing file: ${filename} with type: ${gasFileType}`);
    
    const updatedFiles = await this.gasClient.updateFile(
      parsedPath.projectId,
      filename,
      content,
      position,
      accessToken,
      gasFileType
    );

    return {
      status: 'success',
      path,
      projectId: parsedPath.projectId,
      filename: filename,
      size: content.length,
      position: updatedFiles.findIndex((f: any) => f.name === filename),
      totalFiles: updatedFiles.length
    };
  }
}

/**
 * Remove a file from a Google Apps Script project
 */
export class GASRemoveTool extends BaseTool {
  public name = 'gas_rm';
  public description = 'Remove a file from a Google Apps Script project';
  
  public inputSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Full path to file: projectId/path/to/filename_WITHOUT_EXTENSION (supports virtual paths, extensions auto-detected)'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['path']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    // SECURITY: Validate path BEFORE authentication
    const path = this.validate.filePath(params.path, 'file operation');
    const parsedPath = parsePath(path);
    
    if (!parsedPath.isFile) {
      throw new ValidationError('path', path, 'file path (must include filename)');
    }
    
    // After validation passes, check authentication
    const accessToken = await this.getAuthToken(params);

    const updatedFiles = await this.gasClient.deleteFile(parsedPath.projectId, parsedPath.filename!, accessToken);

    return {
      status: 'deleted',
      path,
      projectId: parsedPath.projectId,
      filename: parsedPath.filename,
      remainingFiles: updatedFiles.length
    };
  }
}

/**
 * Move/rename a file in a Google Apps Script project
 */
export class GASMoveTool extends BaseTool {
  public name = 'gas_mv';
  public description = 'Move or rename a file in a Google Apps Script project';
  
  public inputSchema = {
    type: 'object',
    properties: {
      from: {
        type: 'string',
        description: 'Source path: projectId/path/to/filename_WITHOUT_EXTENSION (supports virtual paths, extensions auto-detected)'
      },
      to: {
        type: 'string',
        description: 'Destination path: projectId/path/to/filename_WITHOUT_EXTENSION (supports virtual paths, extensions auto-added)'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['from', 'to']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    // SECURITY: Validate paths BEFORE authentication
    const fromPath = this.validate.filePath(params.from, 'file operation');
    const toPath = this.validate.filePath(params.to, 'file operation');
    
    const parsedFrom = parsePath(fromPath);
    const parsedTo = parsePath(toPath);
    
    if (!parsedFrom.isFile || !parsedTo.isFile) {
      throw new ValidationError('path', 'from/to', 'file paths (must include filename)');
    }

    if (parsedFrom.projectId !== parsedTo.projectId) {
      throw new FileOperationError('move', fromPath, 'cannot move files between projects');
    }
    
    // After validation passes, check authentication
    const accessToken = await this.getAuthToken(params);

    // Get current file content
    const files = await this.gasClient.getProjectContent(parsedFrom.projectId, accessToken);
    const sourceFile = files.find((f: any) => f.name === parsedFrom.filename);

    if (!sourceFile) {
      throw new FileOperationError('move', fromPath, 'source file not found');
    }

    // Create file with new name and delete old one
    await this.gasClient.updateFile(parsedTo.projectId, parsedTo.filename!, sourceFile.source || '', undefined, accessToken);
    const updatedFiles = await this.gasClient.deleteFile(parsedFrom.projectId, parsedFrom.filename!, accessToken);

    return {
      status: 'moved',
      from: fromPath,
      to: toPath,
      projectId: parsedFrom.projectId,
      totalFiles: updatedFiles.length
    };
  }
}

/**
 * Copy a file in a Google Apps Script project
 */
export class GASCopyTool extends BaseTool {
  public name = 'gas_cp';
  public description = 'Copy a file in a Google Apps Script project';
  
  public inputSchema = {
    type: 'object',
    properties: {
      from: {
        type: 'string',
        description: 'Source path: projectId/path/to/filename_WITHOUT_EXTENSION (supports virtual paths, extensions auto-detected)'
      },
      to: {
        type: 'string',
        description: 'Destination path: projectId/path/to/filename_WITHOUT_EXTENSION (supports virtual paths, extensions auto-added)'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['from', 'to']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    // SECURITY: Validate paths BEFORE authentication
    const fromPath = this.validate.filePath(params.from, 'file operation');
    const toPath = this.validate.filePath(params.to, 'file operation');
    
    const parsedFrom = parsePath(fromPath);
    const parsedTo = parsePath(toPath);
    
    if (!parsedFrom.isFile || !parsedTo.isFile) {
      throw new ValidationError('path', 'from/to', 'file paths (must include filename)');
    }
    
    // After validation passes, check authentication
    const accessToken = await this.getAuthToken(params);

    // Get source file content
    const files = await this.gasClient.getProjectContent(parsedFrom.projectId, accessToken);
    const sourceFile = files.find((f: any) => f.name === parsedFrom.filename);

    if (!sourceFile) {
      throw new FileOperationError('copy', fromPath, 'source file not found');
    }

    // Create copy in destination
    const updatedFiles = await this.gasClient.updateFile(
      parsedTo.projectId,
      parsedTo.filename!,
      sourceFile.source || '',
      undefined,
      accessToken
    );

    return {
      status: 'copied',
      from: fromPath,
      to: toPath,
      sourceProject: parsedFrom.projectId,
      destProject: parsedTo.projectId,
      size: (sourceFile.source || '').length,
      totalFiles: updatedFiles.length
    };
  }
}

/**
 * Copy files from one remote project to another with merge capabilities
 * This is a remote-to-remote operation that doesn't touch local files
 */
export class GASRawCopyTool extends BaseTool {
  public name = 'gas_raw_copy';
  public description = 'Copy files from source remote project to destination remote project with merge options';
  
  public inputSchema = {
    type: 'object',
    properties: {
      sourceScriptId: {
        type: 'string',
        description: 'Source Google Apps Script project ID (44 characters) to copy files FROM',
        pattern: '^[a-zA-Z0-9_-]{44}$',
        minLength: 44,
        maxLength: 44
      },
      destinationScriptId: {
        type: 'string', 
        description: 'Destination Google Apps Script project ID (44 characters) to copy files TO',
        pattern: '^[a-zA-Z0-9_-]{44}$',
        minLength: 44,
        maxLength: 44
      },
      mergeStrategy: {
        type: 'string',
        enum: ['preserve-destination', 'overwrite-destination', 'skip-conflicts'],
        default: 'preserve-destination',
        description: 'How to handle files that exist in both projects: preserve-destination (default), overwrite-destination, or skip-conflicts'
      },
      includeFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: Only copy specific files (by name, without extensions). If omitted, copies all files.'
      },
      excludeFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: Exclude specific files (by name, without extensions) from copying.'
      },
      dryRun: {
        type: 'boolean',
        description: 'Show what would be copied without actually copying',
        default: false
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['sourceScriptId', 'destinationScriptId']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const { 
      sourceScriptId, 
      destinationScriptId, 
      mergeStrategy = 'preserve-destination',
      includeFiles = [],
      excludeFiles = [],
      dryRun = false
    } = params;

    const accessToken = await this.getAuthToken(params);

    // Get source project files
    const sourceFiles = await this.gasClient.getProjectContent(sourceScriptId, accessToken);
    
    // Get destination project files  
    const destinationFiles = await this.gasClient.getProjectContent(destinationScriptId, accessToken);

    // Create maps for easier lookup
    const sourceFileMap = new Map(sourceFiles.map((f: any) => [f.name, f]));
    const destinationFileMap = new Map(destinationFiles.map((f: any) => [f.name, f]));

    // Filter source files based on include/exclude lists
    let filesToProcess = sourceFiles.filter((file: any) => {
      const fileName = file.name;
      
      // Apply include filter if specified
      if (includeFiles.length > 0 && !includeFiles.includes(fileName)) {
        return false;
      }
      
      // Apply exclude filter if specified
      if (excludeFiles.length > 0 && excludeFiles.includes(fileName)) {
        return false;
      }
      
      return true;
    });

    // Analyze what will happen with each file
    const analysis = {
      newFiles: [] as string[],
      conflictFiles: [] as string[],
      identicalFiles: [] as string[],
      excludedFiles: [] as string[]
    };

    const filesToCopy: Array<{name: string; content: string; type: string; action: string}> = [];

    for (const sourceFile of filesToProcess) {
      const fileName = sourceFile.name;
      const destinationFile = destinationFileMap.get(fileName);

      if (!destinationFile) {
        // File doesn't exist in destination - always copy
        analysis.newFiles.push(fileName);
        filesToCopy.push({
          name: fileName,
          content: sourceFile.source || '',
          type: sourceFile.type || 'SERVER_JS',
          action: 'new'
        });
      } else if (sourceFile.source === destinationFile.source) {
        // Files are identical - skip
        analysis.identicalFiles.push(fileName);
      } else {
        // Files are different - apply merge strategy
        analysis.conflictFiles.push(fileName);
        
        switch (mergeStrategy) {
          case 'preserve-destination':
            // Skip copying - keep destination version
            analysis.excludedFiles.push(`${fileName} (preserved destination)`);
            break;
          case 'overwrite-destination':
            // Copy source over destination
            filesToCopy.push({
              name: fileName,
              content: sourceFile.source || '',
              type: sourceFile.type || 'SERVER_JS',
              action: 'overwrite'
            });
            break;
          case 'skip-conflicts':
            // Skip all conflicting files
            analysis.excludedFiles.push(`${fileName} (skipped conflict)`);
            break;
        }
      }
    }

    if (dryRun) {
      return {
        dryRun: true,
        sourceScriptId,
        destinationScriptId,
        mergeStrategy,
        analysis: {
          totalSourceFiles: sourceFiles.length,
          filteredSourceFiles: filesToProcess.length,
          newFiles: analysis.newFiles.length,
          conflictFiles: analysis.conflictFiles.length,
          identicalFiles: analysis.identicalFiles.length,
          excludedFiles: analysis.excludedFiles.length,
          wouldCopy: filesToCopy.length
        },
        details: {
          newFiles: analysis.newFiles,
          conflictFiles: analysis.conflictFiles,
          identicalFiles: analysis.identicalFiles,
          excludedFiles: analysis.excludedFiles,
          filesToCopy: filesToCopy.map(f => ({ name: f.name, action: f.action }))
        },
        message: `Would copy ${filesToCopy.length} files from source to destination`
      };
    }

    // Actually copy the files
    const copyResults = [];
    let successCount = 0;
    let errorCount = 0;

    for (const file of filesToCopy) {
      try {
        await this.gasClient.updateFile(
          destinationScriptId,
          file.name,
          file.content,
          undefined, // position
          accessToken,
          file.type as 'SERVER_JS' | 'HTML' | 'JSON' // ✅ Pass the original file type
        );
        copyResults.push({ name: file.name, action: file.action, status: 'success' });
        successCount++;
      } catch (error: any) {
        copyResults.push({ 
          name: file.name, 
          action: file.action, 
          status: 'error', 
          error: error.message 
        });
        errorCount++;
      }
    }

    return {
      success: errorCount === 0,
      sourceScriptId,
      destinationScriptId,
      mergeStrategy,
      summary: {
        totalSourceFiles: sourceFiles.length,
        filteredSourceFiles: filesToProcess.length,
        attemptedCopy: filesToCopy.length,
        successfulCopies: successCount,
        errors: errorCount,
        newFiles: analysis.newFiles.length,
        conflictFiles: analysis.conflictFiles.length,
        identicalFiles: analysis.identicalFiles.length,
        excludedFiles: analysis.excludedFiles.length
      },
      details: {
        newFiles: analysis.newFiles,
        conflictFiles: analysis.conflictFiles,
        identicalFiles: analysis.identicalFiles,
        excludedFiles: analysis.excludedFiles
      },
      copyResults: copyResults.filter(r => r.status === 'error'), // Only show errors
      message: errorCount === 0 
        ? `Successfully copied ${successCount} files from source to destination`
        : `Copied ${successCount} files with ${errorCount} errors. See copyResults for details.`
    };
  }
} 