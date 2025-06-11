import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { parsePath, matchesDirectory, getDirectory, getBaseName, joinPath } from '../api/pathParser.js';
import { ValidationError, FileOperationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';

/**
 * List files and directories in a Google Apps Script project
 */
export class GASListTool extends BaseTool {
  public name = 'gas_ls';
  public description = 'List files and directories in a Google Apps Script project';
  
  public inputSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to list: empty for all projects, projectId for project files, projectId/prefix for logical grouping (no real folders in GAS)',
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
 * Read file contents from a Google Apps Script project
 */
export class GASCatTool extends BaseTool {
  public name = 'gas_cat';
  public description = 'Read the contents of a file in a Google Apps Script project';
  
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
 * Write content to a file in a Google Apps Script project
 */
export class GASWriteTool extends BaseTool {
  public name = 'gas_write';
  public description = 'Write content to a file in a Google Apps Script project';
  
  public inputSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Full path to file: projectId/path/to/filename_WITHOUT_EXTENSION (CRITICAL: Known extensions .gs, .html, .json, .js will be INTENTIONALLY STRIPPED to prevent double extensions. GAS auto-detects file type: SERVER_JS, HTML, JSON based on content)'
      },
      content: {
        type: 'string',
        description: 'Content to write to the file'
      },
      position: {
        type: 'number',
        description: 'Position in file order (0-based, optional)'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['path', 'content']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    // SECURITY: Validate path and content BEFORE authentication
    const path = this.validate.filePath(params.path, 'file writing');
    const content = this.validate.code(params.content, 'file writing');
    const position = params.position !== undefined ? this.validate.number(params.position, 'position', 'file writing', 0) : undefined;
    
    const parsedPath = parsePath(path);
    
    if (!parsedPath.isFile) {
      throw new ValidationError('path', path, 'file path (must include filename)');
    }

    // INTENTIONAL EXTENSION STRIPPING based on Google Apps Script File Type Enums
    // Reference: https://developers.google.com/apps-script/api/reference/rest/v1/projects.deployments#EntryPointType
    //
    // Google Apps Script File Types:
    // - ENUM_TYPE_UNSPECIFIED: Undetermined file type; never actually used.
    // - SERVER_JS: An Apps Script server-side code file (.gs, .js)
    // - HTML: A file containing client-side HTML (.html)
    // - JSON: A file in JSON format (.json) - only used for manifest (appsscript)
    //
    // Strategy: Strip known extensions (.json, .html, .gs, .js) unless type is unknown
    
    let filename = parsedPath.filename!;
    let extensionStripped = false;
    let strippedExtension = '';
    
    // PRIORITY 1: Handle special manifest file case first
    if (filename.toLowerCase() === 'appsscript.json') {
      filename = 'appsscript';
      extensionStripped = true;
      strippedExtension = '.json';
      console.log(`📋 MANIFEST CONVERSION: appsscript.json → appsscript (JSON type for manifest)`);
    } else {
      // PRIORITY 2: Handle general known GAS extensions
      const GAS_EXTENSIONS = {
        '.json': 'JSON',      // JSON files (non-manifest)
        '.html': 'HTML',      // Client-side HTML files  
        '.gs': 'SERVER_JS',   // Apps Script server-side code
        '.js': 'SERVER_JS'    // Alternative JavaScript extension
      };
      
      // Check if filename ends with any known GAS extension
      for (const [ext, gasFileType] of Object.entries(GAS_EXTENSIONS)) {
        if (filename.toLowerCase().endsWith(ext)) {
          console.log(`🔧 INTENTIONAL EXTENSION STRIPPING: Found '${ext}' extension (maps to ${gasFileType} type)`);
          
          // Strip the extension - GAS will auto-detect type and add appropriate extension
          const strippedFilename = filename.slice(0, -ext.length);
          console.log(`✂️  Stripping: ${filename} → ${strippedFilename}`);
          
          filename = strippedFilename;
          extensionStripped = true;
          strippedExtension = ext;
          break;
        }
      }
    }
    
    // Log the final result
    if (extensionStripped) {
      console.log(`✅ Extension stripping complete. File will be created as: ${filename}`);
      console.log(`🎯 Google Apps Script will auto-detect type and add appropriate extension`);
      console.log(`📄 Original extension '${strippedExtension}' removed to prevent double extensions`);
    } else {
      console.log(`📝 No known extension found in filename: ${filename}`);
      console.log(`🎯 Will default to SERVER_JS type (Apps Script server-side code)`);
    }

    // Validate content size (50KB limit)
    if (content.length > 50 * 1024) {
      throw new FileOperationError('write', path, 'content exceeds 50KB limit');
    }
    
    // After validation passes, check authentication
    const accessToken = await this.getAuthToken(params);

    console.log(`📝 Writing file: ${filename} (extension will be auto-added based on content type)`);
    
    const updatedFiles = await this.gasClient.updateFile(
      parsedPath.projectId,
      filename,
      content,
      position,
      accessToken
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