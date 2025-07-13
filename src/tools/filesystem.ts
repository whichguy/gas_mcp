import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { parsePath, matchesDirectory, getDirectory, getBaseName, joinPath } from '../api/pathParser.js';
import { ValidationError, FileOperationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { ProjectResolver } from '../utils/projectResolver.js';
import { LocalFileManager } from '../utils/localFileManager.js';

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

    // Try to resolve path with current project context
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
        throw new ValidationError('path', filePath, 'filename or projectId/filename (set current project with gas_project_set)');
      }
    }

    const parsedPath = parsePath(filePath);
    const filename = parsedPath.filename!;

    // Try local file first if preferred and current project is set
    if (preferLocal) {
      try {
        const localContent = await LocalFileManager.readLocalFile(filename, workingDir);
        if (localContent) {
          return {
            path: filePath,
            filename,
            source: 'local',
            content: localContent,
            size: localContent.length,
            localPath: LocalFileManager.getLocalFilePath(filename, workingDir)
          };
        }
      } catch (error) {
        // Local file doesn't exist, fall back to remote
      }
    }

    // Fall back to remote read
    const accessToken = await this.getAuthToken(params);
    const files = await this.gasClient.getProjectContent(parsedPath.projectId, accessToken);
    const file = files.find((f: any) => f.name === filename);

    if (!file) {
      throw new FileOperationError('read', filePath, 'file not found in local or remote');
    }

    return {
      path: filePath,
      projectId: parsedPath.projectId,
      filename,
      source: 'remote',
      type: file.type,
      content: file.source || '',
      size: (file.source || '').length
    };
  }
}

/**
 * Write file with automatic local and remote sync (RECOMMENDED)
 * 
 * ✅ RECOMMENDED - Use for normal development workflow
 * Automatically writes to both local ./src/ and remote project when current project is set
 */
export class GASWriteTool extends BaseTool {
  public name = 'gas_write';
  public description = '✍️ RECOMMENDED: Smart file writer - auto-syncs to local and remote when current project set';
  
  public inputSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path (filename only if current project set, or full projectId/filename WITHOUT extension)',
        examples: [
          'utils',                       // Uses current project → utils.gs
          'models/User',                 // Uses current project → models/User.gs
          'abc123def456.../helpers'      // Explicit project ID → helpers.gs
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
      whenToUse: 'Use for normal file writing. Automatically syncs to both local and remote.',
      workflow: 'Set project with gas_project_set, then write: gas_write({path: "utils", content: "..."})',
      alternatives: 'Use gas_raw_write only when you need explicit project ID control or single-destination writes'
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
    let filePath = params.path;
    const content = params.content;

    if (localOnly && remoteOnly) {
      throw new ValidationError('localOnly/remoteOnly', 'both true', 'only one can be true');
    }

    // Try to resolve path with current project context
    let scriptId: string | undefined;
    let filename: string;
    
    try {
      const parsedPath = parsePath(filePath);
      
      if (parsedPath.isFile) {
        // Complete path provided
        scriptId = parsedPath.projectId;
        filename = parsedPath.filename!;
      } else {
        throw new Error('Incomplete path');
      }
    } catch (error) {
      // Path doesn't have project ID, try to use current project
      try {
        scriptId = await ProjectResolver.getCurrentProjectId(workingDir);
        filename = filePath;
        filePath = `${scriptId}/${filePath}`;
      } catch (currentProjectError) {
        throw new ValidationError('path', filePath, 'filename or projectId/filename (set current project with gas_project_set)');
      }
    }

    const results = {
      path: filePath,
      filename,
      content,
      localWritten: false,
      remoteWritten: false,
      size: content.length
    };

    // Write to local ./src/ 
    if (!remoteOnly) {
      try {
        await LocalFileManager.writeLocalFile(filename, content, params.fileType, workingDir);
        results.localWritten = true;
      } catch (error: any) {
        console.error(`Failed to write local file: ${error.message}`);
      }
    }

    // Write to remote project
    if (!localOnly && scriptId) {
      try {
        const accessToken = await this.getAuthToken(params);
        
        // Use improved file type detection from GASRawWriteTool
        let fileType: 'SERVER_JS' | 'HTML' | 'JSON';
        if (params.fileType) {
          fileType = params.fileType as 'SERVER_JS' | 'HTML' | 'JSON';
        } else {
          // Use same detection logic as gas_raw_write for consistency
          if (filename.toLowerCase() === 'appsscript') {
            fileType = 'JSON';
          } else if (filename.toLowerCase().endsWith('.html') || filename.toLowerCase().endsWith('.htm')) {
            fileType = 'HTML';
          } else if (filename.toLowerCase().endsWith('.json')) {
            fileType = 'JSON';
          } else if (filename.toLowerCase().endsWith('.js') || filename.toLowerCase().endsWith('.gs')) {
            fileType = 'SERVER_JS';
          } else {
            // Content-based detection as fallback
            const trimmed = content.trim();
            if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html>')) {
              fileType = 'HTML';
            } else if (trimmed.startsWith('{') && trimmed.endsWith('}') && filename === 'appsscript') {
              fileType = 'JSON';
            } else {
              fileType = 'SERVER_JS';
            }
          }
        }
        
        // Use the improved updateFile method with explicit file type
        await this.gasClient.updateFile(scriptId, filename, content, undefined, accessToken, fileType);
        results.remoteWritten = true;
        (results as any).detectedType = fileType;
      } catch (error: any) {
        console.error(`Failed to write remote file: ${error.message}`);
        // If local write succeeded but remote failed, this is still a partial success
      }
    }

    const syncStatus = localOnly ? 'local-only' : 
                      remoteOnly ? 'remote-only' : 
                      (results.localWritten && results.remoteWritten) ? 'synced' :
                      results.localWritten ? 'local-only' :
                      results.remoteWritten ? 'remote-only' : 'failed';

    return {
      ...results,
      syncStatus,
      message: `File ${syncStatus === 'synced' ? 'synced to local and remote' : 
                      syncStatus === 'local-only' ? 'written to local only' :
                      syncStatus === 'remote-only' ? 'written to remote only' : 'write failed'}`
    };
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
        default: false,
        description: 'Include detailed file information (size, type, etc.)'
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
    const detailed = params.detailed || false;
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
        lastModified: file.lastModified || null
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
 * This tool requires explicit project IDs and paths for direct API access
 */
export class GASRawWriteTool extends BaseTool {
  public name = 'gas_raw_write';
  public description = '🔧 ADVANCED: Write files with explicit project ID path. Use gas_write for normal workflow. SPECIAL FILE: appsscript.json must always reside in project root (no subfolders allowed) and contains essential project metadata.';
  
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
          specialFiles: 'appsscript.json MUST be in root: projectId/appsscript (never projectId/subfolder/appsscript)'
        }
      },
      content: {
        type: 'string',
        description: 'File content to write. LLM FLEXIBILITY: Supports JavaScript/Apps Script, HTML, JSON. Content type automatically detected for proper file extension.',
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
          encoding: 'UTF-8 encoding, supports international characters'
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
        '2. Project exists: Have scriptId from gas_project_create or gas_ls'
      ],
      useCases: {
        newFunction: 'Add JavaScript functions to existing project',
        htmlTemplate: 'Create web app HTML interface files',
        configuration: 'Modify appsscript.json project settings',
        utilities: 'Add helper functions and shared code'
      },
      fileTypes: {
        javascript: 'Content with functions → .gs file (SERVER_JS type)',
        html: 'Content with HTML tags → .html file (HTML type)', 
        json: 'Content with JSON format → .json file (JSON type)'
      },
      bestPractices: [
        'Use descriptive filenames that indicate purpose',
        'Organize related functions in same file',
        'Put utility functions in separate files at position 0',
        'Use logical "/" paths for organization: utils/helpers, models/User'
      ],
      afterWriting: [
        'Use gas_run to execute functions from this file',
        'Use gas_cat to verify file was written correctly',
        'Use gas_ls to see file in project structure'
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