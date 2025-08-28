import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { parsePath, matchesDirectory, getDirectory, getBaseName, joinPath, isWildcardPattern, matchesPattern, resolveHybridScriptId } from '../api/pathParser.js';
import { ValidationError, FileOperationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { ProjectResolver } from '../utils/projectResolver.js';
import { LocalFileManager } from '../utils/localFileManager.js';
import { wrapModuleContent, unwrapModuleContent, shouldWrapContent, getModuleName } from '../utils/moduleWrapper.js';
import { 
  virtualToGASName, 
  gasNameToVirtual, 
  translateFilesForDisplay, 
  translatePathForOperation,
  isVirtualDotfile,
  isTranslatedVirtualFile 
} from '../utils/virtualFileTranslation.js';

/**
 * Read file contents with smart local/remote fallback (RECOMMENDED)
 * 
 * ✅ RECOMMENDED - Use for normal development workflow
 * Automatically reads from local ./src/ if current project is set, otherwise reads from remote
 */
export class GASCatTool extends BaseTool {
  public name = 'gas_cat';
  public description = '📖 RECOMMENDED: Smart file reader with automatic CommonJS unwrapping - shows clean user code for editing while preserving access to require(), module, and exports when executed';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID (44 characters)',
        pattern: '^[a-zA-Z0-9_-]{44}$',
        minLength: 44,
        maxLength: 44,
        examples: [
          '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789'
        ]
      },
      path: {
        type: 'string',
        description: 'File path (filename only, or scriptId/filename if scriptId parameter is empty). For SERVER_JS files, CommonJS wrapper will be automatically removed to show clean user code for editing while preserving access to require(), module, and exports when executed.',
        pattern: '^([a-zA-Z0-9_-]{5,60}/[a-zA-Z0-9_.//-]+|[a-zA-Z0-9_.//-]+)$',
        minLength: 1,
        examples: [
          'utils.gs',                    // Uses scriptId parameter
          'models/User.gs',              // Uses scriptId parameter  
          'abc123def456.../helpers.gs'   // Overrides scriptId parameter if provided
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
        description: 'Access token for stateless operation (optional)',
        pattern: '^ya29\\.[a-zA-Z0-9_-]+$'
      }
    },
    required: ['scriptId', 'path'],
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'Use for normal file reading. Automatically handles local/remote logic.',
      workflow: 'Use with explicit scriptId: gas_cat({scriptId: "abc123...", path: "utils.gs"})',
      alternatives: 'Use gas_raw_cat only when you need explicit project ID control',
      pathRequirement: 'Provide scriptId parameter and simple filename in path, or embed scriptId in path and leave scriptId parameter empty.',
      commonJsIntegration: 'All SERVER_JS files are automatically integrated with the CommonJS module system (see CommonJS.js). When reading files, the outer _main() wrapper is removed to show clean user code for editing. The code still has access to require(), module, and exports when executed - these are provided by the CommonJS system.',
      moduleAccess: 'Your code can use require("ModuleName") to import other user modules, module.exports = {...} to export functionality, and exports.func = ... as shorthand. The CommonJS system handles all module loading, caching, and dependency resolution.',
      editingWorkflow: 'Files are unwrapped for editing convenience and will be automatically re-wrapped with CommonJS structure when saved via gas_write.',
      examples: [
        'Read a module file: gas_cat({scriptId: "1abc2def...", path: "Utils.gs"})',
        'Read with embedded ID: gas_cat({scriptId: "", path: "1abc2def.../Calculator.gs"})',
        'Read HTML template: gas_cat({scriptId: "1abc2def...", path: "sidebar.html"})',
        'Read manifest: gas_cat({scriptId: "1abc2def...", path: "appsscript.json"})'
      ]
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

    // Apply virtual file translation for user-provided path
    const translatedPath = translatePathForOperation(params.path, true);
    
    // Use hybrid script ID resolution with translated path
    const hybridResolution = resolveHybridScriptId(params.scriptId, translatedPath);
    const fullPath = `${hybridResolution.scriptId}/${hybridResolution.cleanPath}`;

    // SECURITY: Validate path BEFORE authentication
    const path = this.validate.filePath(fullPath, 'file reading');
    const parsedPath = parsePath(path);
    
    if (!parsedPath.isFile) {
      throw new ValidationError('path', path, 'file path (must include filename)');
    }

    const scriptId = parsedPath.scriptId;
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
            path: fullPath,
            scriptId: scriptId,
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
        path: fullPath,
        scriptId: scriptId,
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

    // 🔧 COMMONJS INTEGRATION: Unwrap CommonJS structure for user transparency
    let finalContent = result.content;
    let commonJsInfo: any = null;
    
    if (shouldWrapContent(result.fileType || 'SERVER_JS', filename)) {
      const unwrapped = unwrapModuleContent(finalContent);
      
      if (unwrapped !== finalContent) {
        finalContent = unwrapped;
        
        // Analyze the unwrapped content for CommonJS features
        const { analyzeCommonJsUsage } = await import('../utils/moduleWrapper.js');
        const featureAnalysis = analyzeCommonJsUsage(unwrapped);
        
        commonJsInfo = {
          moduleUnwrapped: true,
          originalLength: result.content.length,
          unwrappedLength: finalContent.length,
          commonJsFeatures: {
            hasRequireFunction: true,  // Always available when executed
            hasModuleObject: true,     // Always available when executed
            hasExportsObject: true,    // Always available when executed
            userRequireCalls: featureAnalysis.requireCalls,
            userModuleExports: featureAnalysis.moduleExports,
            userExportsUsage: featureAnalysis.exportsUsage
          },
          systemNote: 'When executed, this code has access to require(), module, and exports via the CommonJS system',
          editingNote: 'CommonJS wrapper removed for editing convenience - will be re-applied automatically on gas_write'
        };
        
        console.error(`📖 [GAS_CAT] Unwrapped CommonJS structure - showing inner code for editing`);
        if (featureAnalysis.hasModuleDependencies) {
          console.error(`🔗 [GAS_CAT] Code uses require() - dependencies will be resolved by CommonJS system when executed`);
        }
        if (featureAnalysis.moduleExports || featureAnalysis.exportsUsage.length > 0) {
          console.error(`📤 [GAS_CAT] Code exports functionality - available to other modules via require()`);
        }
      } else {
        console.error(`📖 [GAS_CAT] No CommonJS wrapper detected - showing content as-is`);
        commonJsInfo = {
          moduleUnwrapped: false,
          reason: 'No CommonJS wrapper structure found in content'
        };
      }
    } else {
      console.error(`⏭️ [GAS_CAT] Skipping CommonJS processing for ${result.fileType || 'unknown'} file: ${filename}`);
      commonJsInfo = {
        moduleUnwrapped: false,
        reason: `${result.fileType || 'unknown'} files don't use the CommonJS module system`
      };
    }

    // Update result with processed content and CommonJS info
    result.content = finalContent;
    result.commonJsInfo = commonJsInfo;

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
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID (44 characters)',
        pattern: '^[a-zA-Z0-9_-]{44}$',
        minLength: 44,
        maxLength: 44,
        examples: [
          '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789'
        ]
      },
      path: {
        type: 'string',
        description: 'File path (filename only, or scriptId/filename if scriptId parameter is empty). For writing files with automatic CommonJS integration.',
        pattern: '^([a-zA-Z0-9_-]{5,60}/[a-zA-Z0-9_.//-]+|[a-zA-Z0-9_.//-]+)$',
        minLength: 1,
        examples: [
          'utils',                       // Uses scriptId parameter → utils.gs
          'models/User',                 // Uses scriptId parameter → models/User.gs  
          'abc123def456.../helpers',     // Overrides scriptId parameter → helpers.gs
          'appsscript'                   // Uses scriptId parameter → appsscript.json
        ]
      },
      content: {
        type: 'string',
        description: 'Raw user JavaScript content. The CommonJS module system will automatically wrap your code in a _main() function, making the require() function, module object, and exports object available to all your code. Do NOT manually include _main() function or __defineModule__ calls - they are generated automatically by the CommonJS system (see CommonJS.js for implementation details).',
        examples: [
          'function calculateTax(amount) { return amount * 0.08; }\nreturn { calculateTax };',
          'const utils = require("Utils");\nfunction process(data) { return utils.clean(data); }\nmodule.exports = { process };',
          'const config = require("Config");\nexports.apiKey = config.getKey();'
        ]
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
        description: 'Access token for stateless operation (optional)',
        pattern: '^ya29\\.[a-zA-Z0-9_-]+$'
      }
    },
    required: ['scriptId', 'path', 'content'],
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'Use for normal file writing with explicit scriptId parameter. Remote-first workflow ensures safety.',
      workflow: 'Use with explicit scriptId: gas_write({scriptId: "abc123...", path: "filename", content: "..."})',
      alternatives: 'Use gas_raw_write when you need single-destination writes or advanced file positioning',
      commonJsIntegration: 'All SERVER_JS files are automatically integrated with the CommonJS module system (see CommonJS.js). This provides: (1) require() function for importing other modules, (2) module object for module metadata and exports, (3) exports object as shorthand for module.exports. Users write plain JavaScript - the module wrapper is transparent.',
      moduleAccess: 'Code can use require("ModuleName") to import other user modules, module.exports = {...} to export functionality, and exports.func = ... as shorthand. The CommonJS system handles all module loading, caching, and dependency resolution.',
      wrapperHandling: 'Any accidentally included _main() or __defineModule__ calls are automatically cleaned and replaced with proper CommonJS structure. Never manually add module wrappers.',
      systemFiles: 'System files (CommonJS, __mcp_gas_run, appsscript) are never wrapped and provide the underlying infrastructure.',
      examples: [
        'Write JS module: gas_write({scriptId: "1abc2def...", path: "utils", content: "function helper() {...}"})',
        'Write with exports: gas_write({scriptId: "1abc2def...", path: "api/client", content: "module.exports = {...}"})',
        'Write HTML: gas_write({scriptId: "1abc2def...", path: "sidebar", content: "<html>...", fileType: "HTML"})',
        'Write config: gas_write({scriptId: "1abc2def...", path: "appsscript", content: "{...}", fileType: "JSON"})',
        'Local only: gas_write({scriptId: "1abc2def...", path: "test", content: "...", localOnly: true})'
      ]
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

    // Apply virtual file translation for user-provided path
    const translatedPath = translatePathForOperation(params.path, true);
    
    // Use hybrid script ID resolution with translated path
    const hybridResolution = resolveHybridScriptId(params.scriptId, translatedPath);
    const fullPath = `${hybridResolution.scriptId}/${hybridResolution.cleanPath}`;

    // SECURITY: Validate path BEFORE authentication (like gas_raw_write)
    const path = this.validate.filePath(fullPath, 'file writing');
    
    const parsedPath = parsePath(path);
    
    if (!parsedPath.isFile) {
      throw new ValidationError('path', path, 'file path (must include filename)');
    }

    const scriptId = parsedPath.scriptId;
    const filename = parsedPath.filename;
    
    if (!filename) {
      throw new ValidationError('path', path, 'file path must include a filename');
    }
    
    const projectName = scriptId; // Use scriptId as project name
    const originalContent = params.content;

    // 🔧 COMMONJS INTEGRATION: Process content for CommonJS module system
    let processedContent = originalContent;
    let commonJsProcessing: any = {};
    const fileType = params.fileType || this.determineFileType(filename, originalContent);
    
    if (shouldWrapContent(fileType, filename)) {
      console.error(`📦 [GAS_WRITE] Integrating ${filename} with CommonJS module system...`);
      
      // Step 1: Analyze CommonJS feature usage in original content
      const { analyzeCommonJsUsage, detectAndCleanContent } = await import('../utils/moduleWrapper.js');
      const commonJsAnalysis = analyzeCommonJsUsage(originalContent);
      
      // Step 2: Clean accidentally included wrappers
      const cleaned = detectAndCleanContent(originalContent, filename);
      processedContent = cleaned.cleanedContent;
      
      if (cleaned.hadWrappers) {
        console.error(`🧹 [GAS_WRITE] Removed redundant CommonJS wrappers - the CommonJS system handles this automatically`);
      }
      
      // Step 3: Apply standard CommonJS wrapper (provides require, module, exports)
      const moduleName = getModuleName(path);
      processedContent = wrapModuleContent(processedContent, moduleName);
      
      console.error(`✅ [GAS_WRITE] Applied CommonJS wrapper - require(), module, and exports now available to your code`);
      
      commonJsProcessing = {
        wrapperApplied: true,
        cleanedWrappers: cleaned.hadWrappers,
        warnings: cleaned.warnings,
        commonJsFeatures: {
          requireFunction: true, // Always available via CommonJS
          moduleObject: true,    // Always available via CommonJS  
          exportsObject: true,   // Always available via CommonJS
          userRequireCalls: commonJsAnalysis.requireCalls,
          userModuleExports: commonJsAnalysis.moduleExports,
          userExportsUsage: commonJsAnalysis.exportsUsage
        },
        systemNote: 'require(), module, and exports are provided by the CommonJS module system (see CommonJS.js)'
      };
      
      // Provide user guidance based on features detected
      if (commonJsAnalysis.hasModuleDependencies) {
        console.error(`🔗 [GAS_WRITE] Code uses require() calls - dependencies will be resolved by CommonJS system when executed`);
      }
      if (commonJsAnalysis.moduleExports || commonJsAnalysis.exportsUsage.length > 0) {
        console.error(`📤 [GAS_WRITE] Code exports functionality - will be available to other modules via require()`);
      }
    } else {
      console.error(`⏭️ [GAS_WRITE] Skipping CommonJS integration for ${fileType} file: ${filename}`);
      commonJsProcessing = {
        wrapperApplied: false,
        reason: `${fileType} files don't use the CommonJS module system`
      };
    }

    const content = processedContent; // Use processed content for all subsequent operations

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
      scriptId: scriptId,
      filename,
      size: content.length,
      workflow: 'remote-first-git',
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
      commonJsProcessing,
      summary: `Successfully ${gitCommitResult?.committed ? 'committed and ' : ''}${localOnly ? 'wrote locally' : remoteOnly ? 'pushed to remote' : 'synchronized local and remote'}${commonJsProcessing.wrapperApplied ? ' with CommonJS integration' : ''}`
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
  public description = 'List files and directories in a Google Apps Script project with wildcard pattern support. SPECIAL FILE: Always shows appsscript.json if present - this manifest file must exist in project root and contains essential project metadata.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID (optional - can also be embedded in path)',
        pattern: '^[a-zA-Z0-9_-]{25,60}$',
        minLength: 25,
        maxLength: 60,
        examples: [
          '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789',
          '1arGk_0LU7E12afUFkp5ABrQdb0kLgOqwJR0OF__FbXN3G2gev7oix7XJ'
        ]
      },
      path: {
        type: 'string',
        description: 'Path to list with optional wildcard patterns. If scriptId parameter is provided, this should be a relative path (e.g., "utils/*"). If scriptId is empty, this should include the script ID prefix (e.g., "scriptId/utils/*"). For listing all projects, use empty string.',
        default: '',
        examples: [
          '',                              // All projects
          'scriptId',                     // All files in project (if no scriptId param)
          '*.gs',                        // All .gs files (if scriptId param provided)
          'utils/*',                     // All files in utils/ (if scriptId param provided)
          'scriptId/*.gs',               // All .gs files (if no scriptId param)
          'scriptId/utils/*',            // All files in utils/ (if no scriptId param)
          'scriptId/api/*.json',         // All JSON files in api/ folder  
          'scriptId/test?',              // Files like test1, test2, testA
          'scriptId/*/config',           // All config files in any subfolder
          'scriptId/models/User*'        // Files starting with "models/User"
        ]
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
      wildcardMode: {
        type: 'string',
        enum: ['filename', 'fullpath', 'auto'],
        default: 'auto',
        description: 'Wildcard matching mode: filename (match basename only), fullpath (match full path), auto (detect from pattern)'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)',
        pattern: '^ya29\\.[a-zA-Z0-9_-]+$'
      }
    },
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'Use to explore project structure and find files by pattern',
      workflow: 'List all files: gas_ls({scriptId: "..."}), with wildcards: gas_ls({scriptId: "...", path: "*.test*"})',
      examples: [
        'List all projects: gas_ls({})',
        'List project files: gas_ls({scriptId: "1abc2def..."})',
        'List with pattern: gas_ls({scriptId: "1abc2def...", path: "*.gs"})',
        'List subfolder: gas_ls({scriptId: "1abc2def...", path: "utils/*"})',
        'List detailed: gas_ls({scriptId: "1abc2def...", detailed: true})'
      ],
      virtualFiles: 'Dotfiles like .gitignore appear with their virtual names, not GAS storage names'
    }
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    const { resolveHybridScriptId } = await import('../api/pathParser.js');
    
    const path = params.path || '';
    const scriptId = params.scriptId || '';
    const detailed = params.detailed !== false;  // ✅ Default to true, only false if explicitly set
    const recursive = params.recursive !== false;
    const wildcardMode = params.wildcardMode || 'auto';
    
    // Use hybrid resolution to get scriptId and clean path
    let finalScriptId: string;
    let cleanPath: string;
    
    if (!path || path === '') {
      // Empty path = list all projects (ignore scriptId)
      finalScriptId = '';
      cleanPath = '';
    } else {
      try {
        const resolved = resolveHybridScriptId(scriptId, path);
        finalScriptId = resolved.scriptId;
        cleanPath = resolved.cleanPath;
      } catch (error: any) {
        // If hybrid resolution fails, fall back to original parsePath logic
        const parsedPath = parsePath(path);
        finalScriptId = parsedPath.scriptId || '';
        cleanPath = parsedPath.directory || parsedPath.pattern || '';
      }
    }

    if (!finalScriptId) {
      return await this.listProjects(detailed, accessToken);
    } else {
      return await this.listProjectFiles(finalScriptId, cleanPath, detailed, recursive, wildcardMode, accessToken);
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
    accessToken?: string
  ): Promise<any> {
    const files = await this.gasClient.getProjectContent(scriptId, accessToken);
    
    // Apply virtual file translation to the files for display
    const translatedFiles = translateFilesForDisplay(files, true);
    
    // Enhanced filtering with wildcard support
    let filteredFiles: any[];
    
    if (isWildcardPattern(directory)) {
      // Wildcard pattern matching - use displayName if present, otherwise name
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
            // Auto-detect: use fullpath if pattern contains '/', else filename
            return directory.includes('/') 
              ? matchesPattern(fileName, directory)
              : matchesPattern(getBaseName(fileName), directory);
        }
      });
    } else {
      // Simple directory prefix matching (existing behavior)
      filteredFiles = directory 
        ? translatedFiles.filter((file: any) => {
            const fileName = file.displayName || file.name;
            return matchesDirectory(fileName, directory);
          })
        : translatedFiles;
    }

    const items = filteredFiles.map((file: any, index: number) => ({
      name: file.displayName || file.name,  // Show virtual name if translated
      type: file.type || 'server_js',
      virtualFile: file.virtualFile || false,  // Mark if it's a virtual file
      ...(detailed && {
        size: (file.source || '').length,
        position: index,
        // ✅ NEW: Return actual API timestamps instead of hardcoded null
        createTime: file.createTime || null,
        updateTime: file.updateTime || null,
        lastModifyUser: file.lastModifyUser || null,
        actualName: file.virtualFile ? file.name : undefined  // Show actual GAS name if virtual
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
        description: 'Full path to file: scriptId/path/to/filename_WITHOUT_EXTENSION (supports virtual paths, extensions auto-detected). REQUIRED: Must include explicit scriptId prefix (e.g., "abc123def.../filename") - current project context is not used.'
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

    const files = await this.gasClient.getProjectContent(parsedPath.scriptId, accessToken);
    const file = files.find((f: any) => f.name === parsedPath.filename);

    if (!file) {
      throw new FileOperationError('read', path, 'file not found');
    }

    return {
      path,
      scriptId: parsedPath.scriptId,
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
        description: 'Full path to file: scriptId/filename (WITHOUT extension). LLM CRITICAL: Extensions like .gs, .html, .json are AUTOMATICALLY added. Google Apps Script auto-detects file type from content. SPECIAL CASE: appsscript.json must be in project root (scriptId/appsscript), never in subfolders. REQUIRED: Must include explicit scriptId prefix (e.g., "abc123def.../filename") - current project context is not used.',
        pattern: '^[a-zA-Z0-9_-]{20,60}/[a-zA-Z0-9_.//-]+$',
        minLength: 25,
        examples: [
          'abc123def456.../fibonacci',    // → fibonacci.gs
          'abc123def456.../utils/helpers', // → utils/helpers.gs  
          'abc123def456.../Code',         // → Code.gs
          'abc123def456.../models/User',  // → models/User.gs
          'abc123def456.../appsscript'    // → appsscript.json (MUST be root level)
        ],
        llmHints: {
          format: 'scriptId/filename (no extension)',
          extensions: 'Tool automatically adds .gs for JavaScript, .html for HTML, .json for JSON',
          organization: 'Use "/" in filename for logical organization (not real folders)',
          specialFiles: 'appsscript.json MUST be in root: scriptId/appsscript (never scriptId/subfolder/appsscript)',
          warning: 'This tool OVERWRITES the entire file - use gas_write for safer merging',
          autoDetection: 'File type detected from content: JavaScript, HTML, JSON'
        }
      },
      content: {
        type: 'string',
        description: 'File content to write. ⚠️ WARNING: This content will COMPLETELY REPLACE the existing file. LLM FLEXIBILITY: Supports JavaScript/Apps Script, HTML, JSON. Content type automatically detected for proper file extension.',
        minLength: 0,
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
          limits: 'File size limits enforced by Google Apps Script API',
          encoding: 'UTF-8 encoding, supports international characters',
          danger: 'This content will OVERWRITE the entire remote file - existing content will be lost'
        }
      },
      position: {
        type: 'number',
        description: 'File execution order position (0-based). LLM USE: Controls order in Apps Script editor and execution sequence. Lower numbers execute first.',
        minimum: 0,
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
          'appsscript.json must be in project root (scriptId/appsscript), not in subfolders'
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
      parsedPath.scriptId,
      filename,
      content,
      position,
      accessToken,
      gasFileType
    );

    return {
      status: 'success',
      path,
      scriptId: parsedPath.scriptId,
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
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID (44 characters)',
        pattern: '^[a-zA-Z0-9_-]{44}$',
        minLength: 44,
        maxLength: 44,
        examples: [
          '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789'
        ]
      },
      path: {
        type: 'string',
        description: 'File path (filename only, or scriptId/filename if scriptId parameter is empty). Extensions are auto-detected and should not be included.'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['scriptId', 'path']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    // Use hybrid script ID resolution
    const hybridResolution = resolveHybridScriptId(params.scriptId, params.path);
    const fullPath = `${hybridResolution.scriptId}/${hybridResolution.cleanPath}`;

    // SECURITY: Validate path BEFORE authentication
    const path = this.validate.filePath(fullPath, 'file operation');
    const parsedPath = parsePath(path);
    
    if (!parsedPath.isFile) {
      throw new ValidationError('path', path, 'file path (must include filename)');
    }
    
    // After validation passes, check authentication
    const accessToken = await this.getAuthToken(params);

    const updatedFiles = await this.gasClient.deleteFile(parsedPath.scriptId, parsedPath.filename!, accessToken);

    return {
      status: 'deleted',
      path,
      scriptId: parsedPath.scriptId,
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
  public description = 'Move or rename a file in a Google Apps Script project (supports cross-project moves)';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID (44 characters) - used as default, can be overridden by embedded project IDs in paths',
        pattern: '^[a-zA-Z0-9_-]{44}$',
        minLength: 44,
        maxLength: 44,
        examples: [
          '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789'
        ]
      },
      from: {
        type: 'string',
        description: 'Source path: filename OR scriptId/filename (without extension). If embedded script ID provided, overrides scriptId parameter.',
        examples: [
          'utils.gs',                           // Uses scriptId
          'ai_tools/helper.gs',                // Uses scriptId with subdirectory
          '1abc2def.../utils.gs'               // Overrides scriptId
        ]
      },
      to: {
        type: 'string',
        description: 'Destination path: filename OR scriptId/filename (without extension). If embedded script ID provided, overrides scriptId parameter.',
        examples: [
          'renamed.gs',                        // Same project (uses scriptId)
          'backup/utils.gs',                   // Same project with subdirectory
          '1xyz9abc.../utils.gs'              // Different project (cross-project move)
        ]
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['scriptId', 'from', 'to']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    // SECURITY: Validate parameters BEFORE authentication
    const accessToken = await this.getAuthToken(params);
    
    // Resolve script IDs using hybrid approach (supports cross-project moves)
    const fromResolution = resolveHybridScriptId(params.scriptId, params.from, 'move operation (from)');
    const toResolution = resolveHybridScriptId(params.scriptId, params.to, 'move operation (to)');
    
    const fromProjectId = fromResolution.scriptId;
    const toProjectId = toResolution.scriptId;
    const fromFilename = fromResolution.cleanPath;
    const toFilename = toResolution.cleanPath;
    
    // Validate that we have actual filenames
    if (!fromFilename || !toFilename) {
      throw new ValidationError('path', 'from/to', 'valid filenames (cannot be empty)');
    }

    // Get source file content
    const sourceFiles = await this.gasClient.getProjectContent(fromProjectId, accessToken);
    const sourceFile = sourceFiles.find((f: any) => f.name === fromFilename);

    if (!sourceFile) {
      throw new FileOperationError('move', params.from, 'source file not found');
    }

    // For cross-project moves, we copy then delete. For same-project, we can rename in place.
    if (fromProjectId === toProjectId) {
      // Same project: rename/move file
      await this.gasClient.updateFile(toProjectId, toFilename, sourceFile.source || '', undefined, accessToken);
      const updatedFiles = await this.gasClient.deleteFile(fromProjectId, fromFilename, accessToken);
      
      return {
        status: 'moved',
        from: params.from,
        to: params.to,
        fromProjectId,
        toProjectId,
        isCrossProject: false,
        totalFiles: updatedFiles.length,
        message: `Moved ${fromFilename} to ${toFilename} within project ${fromProjectId.substring(0, 8)}...`
      };
    } else {
      // Cross-project: copy to destination, then delete from source
      await this.gasClient.updateFile(toProjectId, toFilename, sourceFile.source || '', undefined, accessToken);
      const updatedSourceFiles = await this.gasClient.deleteFile(fromProjectId, fromFilename, accessToken);
      
      // Get destination file count
      const destFiles = await this.gasClient.getProjectContent(toProjectId, accessToken);
      
      return {
        status: 'moved',
        from: params.from,
        to: params.to,
        fromProjectId,
        toProjectId,
        isCrossProject: true,
        sourceFilesRemaining: updatedSourceFiles.length,
        destFilesTotal: destFiles.length,
        message: `Moved ${fromFilename} from project ${fromProjectId.substring(0, 8)}... to ${toFilename} in project ${toProjectId.substring(0, 8)}...`
      };
    }
  }
}

/**
 * Copy a file in a Google Apps Script project
 */
export class GASCopyTool extends BaseTool {
  public name = 'gas_cp';
  public description = 'Copy file with CommonJS processing - unwraps source, rewraps destination (like gas_cat + gas_write)';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID (44 characters) - used as default, can be overridden by embedded project IDs in paths',
        pattern: '^[a-zA-Z0-9_-]{44}$',
        minLength: 44,
        maxLength: 44,
        examples: [
          '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789'
        ]
      },
      from: {
        type: 'string',
        description: 'Source path: filename OR scriptId/filename (without extension). If embedded script ID provided, overrides scriptId parameter.',
        examples: [
          'utils.gs',                           // Uses scriptId
          'ai_tools/helper.gs',                // Uses scriptId with subdirectory
          '1abc2def.../utils.gs'               // Overrides scriptId
        ]
      },
      to: {
        type: 'string',
        description: 'Destination path: filename OR scriptId/filename (without extension). If embedded script ID provided, overrides scriptId parameter.',
        examples: [
          'utils-copy.gs',                     // Same project (uses scriptId)
          'backup/utils.gs',                   // Same project with subdirectory
          '1xyz9abc.../utils.gs'              // Different project (cross-project copy)
        ]
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)',
        pattern: '^ya29\\.[a-zA-Z0-9_-]+$'
      }
    },
    required: ['scriptId', 'from', 'to'],
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'Use to copy files with proper CommonJS module handling',
      workflow: 'Copy within project: gas_cp({scriptId: "...", from: "utils", to: "utils-backup"})',
      commonJsProcessing: 'Unwraps source module wrapper, applies new wrapper for destination with correct module name',
      examples: [
        'Copy within project: gas_cp({scriptId: "1abc2def...", from: "utils", to: "utils-backup"})',
        'Cross-project copy: gas_cp({scriptId: "1abc2def...", from: "utils", to: "1xyz9abc.../utils"})',
        'Copy to subfolder: gas_cp({scriptId: "1abc2def...", from: "main", to: "archive/main-v1"})',
        'Copy with rename: gas_cp({scriptId: "1abc2def...", from: "Calculator", to: "CalcBackup"})'
      ],
      vsRawCp: 'Use gas_raw_cp for bulk operations that need exact file preservation without CommonJS processing'
    }
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    // SECURITY: Validate parameters BEFORE authentication
    const accessToken = await this.getAuthToken(params);
    
    // Apply virtual file translation for user-provided paths
    const translatedFrom = translatePathForOperation(params.from, true);
    const translatedTo = translatePathForOperation(params.to, true);
    
    // Resolve script IDs using hybrid approach (supports cross-project copies)
    const fromResolution = resolveHybridScriptId(params.scriptId, translatedFrom, 'copy operation (from)');
    const toResolution = resolveHybridScriptId(params.scriptId, translatedTo, 'copy operation (to)');
    
    const fromProjectId = fromResolution.scriptId;
    const toProjectId = toResolution.scriptId;
    const fromFilename = fromResolution.cleanPath;
    const toFilename = toResolution.cleanPath;
    
    // Validate that we have actual filenames
    if (!fromFilename || !toFilename) {
      throw new ValidationError('path', 'from/to', 'valid filenames (cannot be empty)');
    }

    // Get source file content
    const sourceFiles = await this.gasClient.getProjectContent(fromProjectId, accessToken);
    const sourceFile = sourceFiles.find((f: any) => f.name === fromFilename);

    if (!sourceFile) {
      throw new FileOperationError('copy', params.from, 'source file not found');
    }

    // COMMONJS PROCESSING: Unwrap source content (like gas_cat)
    let processedContent = sourceFile.source || '';
    const fileType = sourceFile.type || 'SERVER_JS';
    
    if (shouldWrapContent(fileType, fromFilename)) {
      // Unwrap CommonJS from source (like gas_cat does)
      const unwrapped = unwrapModuleContent(processedContent);
      if (unwrapped !== processedContent) {
        console.error(`📖 [GAS_CP] Unwrapped CommonJS from source: ${fromFilename}`);
        processedContent = unwrapped;
      }
      
      // Re-wrap for destination (like gas_write does)
      const moduleName = getModuleName(toFilename);
      processedContent = wrapModuleContent(processedContent, moduleName);
      console.error(`✅ [GAS_CP] Re-wrapped CommonJS for destination: ${toFilename}`);
    } else {
      console.error(`⏭️ [GAS_CP] No CommonJS processing for ${fileType} file: ${fromFilename}`);
    }

    // Create copy in destination with processed content
    const updatedFiles = await this.gasClient.updateFile(
      toProjectId,
      toFilename,
      processedContent,
      undefined,
      accessToken,
      fileType as 'SERVER_JS' | 'HTML' | 'JSON'
    );

    return {
      status: 'copied',
      from: params.from,
      to: params.to,
      fromProjectId,
      toProjectId,
      isCrossProject: fromProjectId !== toProjectId,
      commonJsProcessed: shouldWrapContent(fileType, fromFilename),
      size: processedContent.length,
      totalFiles: updatedFiles.length,
      message: fromProjectId === toProjectId 
        ? `Copied ${fromFilename} to ${toFilename} with CommonJS processing within project ${fromProjectId.substring(0, 8)}...`
        : `Copied ${fromFilename} from project ${fromProjectId.substring(0, 8)}... to ${toFilename} in project ${toProjectId.substring(0, 8)}... with CommonJS processing`
    };
  }
}

/**
 * Copy files from one remote project to another with merge capabilities
 * This is a remote-to-remote operation that doesn't touch local files
 */
export class GASRawCpTool extends BaseTool {
  public name = 'gas_raw_cp';
  public description = 'Copy files exactly without CommonJS processing - bulk copy preserving all wrappers';
  
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
        description: 'Access token for stateless operation (optional)',
        pattern: '^ya29\\.[a-zA-Z0-9_-]+$'
      }
    },
    required: ['sourceScriptId', 'destinationScriptId'],
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'Use for bulk copying between projects without CommonJS processing',
      workflow: 'Copy all files: gas_raw_cp({sourceScriptId: "...", destinationScriptId: "..."})',
      preservesWrappers: 'Copies files exactly as they are, preserving all CommonJS wrappers and system code',
      examples: [
        'Copy all files: gas_raw_cp({sourceScriptId: "1abc2def...", destinationScriptId: "1xyz9abc..."})',
        'Copy specific files: gas_raw_cp({sourceScriptId: "1abc2def...", destinationScriptId: "1xyz9abc...", includeFiles: ["Utils", "Config"]})',
        'Exclude files: gas_raw_cp({sourceScriptId: "1abc2def...", destinationScriptId: "1xyz9abc...", excludeFiles: ["Test", "Debug"]})',
        'Overwrite mode: gas_raw_cp({sourceScriptId: "1abc2def...", destinationScriptId: "1xyz9abc...", mergeStrategy: "overwrite-destination"})',
        'Dry run: gas_raw_cp({sourceScriptId: "1abc2def...", destinationScriptId: "1xyz9abc...", dryRun: true})'
      ],
      mergeStrategies: {
        'preserve-destination': 'Keep existing files in destination (default)',
        'overwrite-destination': 'Replace existing files with source versions',
        'skip-conflicts': 'Only copy files that don\'t exist in destination'
      }
    }
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