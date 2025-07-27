import * as fs from 'fs/promises';
import * as path from 'path';
import { FileOperationError, ValidationError } from '../errors/mcpErrors.js';
import { McpGasConfigManager } from '../config/mcpGasConfig.js';

/**
 * Local file representation
 */
export interface LocalFile {
  name: string;
  relativePath: string;
  fullPath: string;
  content: string;
  size: number;
  lastModified: Date;
}

/**
 * File comparison result
 */
export interface FileComparison {
  name: string;
  status: 'same' | 'local-only' | 'remote-only' | 'different';
  localPath?: string;
  localSize?: number;
  remoteSize?: number;
  lastModified?: Date;
}



/**
 * Git information for appsscript.json
 */
export interface GitInfo {
  repository?: string;
  branch?: string;
  commit?: string;
  lastSync?: string;
  remote?: string;
  status?: 'clean' | 'dirty' | 'conflicted';
}

/**
 * MCP-specific metadata for appsscript.json
 */
export interface McpInfo {
  scriptId: string;
  projectName?: string;
  localRoot: string;
  lastSync: string;
  created?: string;
  description?: string;
  cacheVersion: string;
}

/**
 * Enhanced appsscript.json structure
 */
export interface EnhancedAppsscriptJson {
  timeZone: string;
  dependencies: {
    enabledAdvancedServices?: any[];
  };
  exceptionLogging: string;
  runtimeVersion: string;
  git?: GitInfo;
  mcp?: McpInfo;
}

/**
 * Utility class for local file system operations
 * Handles configurable root directory with project-specific folders for gas sync functionality
 * NO LONGER USES src/ subdirectories - files are stored directly in project directory
 */
export class LocalFileManager {
  // PRODUCTION-READY: Use persistent directory instead of volatile /tmp
  private static readonly DEFAULT_ROOT = process.env.MCP_GAS_PROJECTS_ROOT || 
    (process.platform === 'win32' 
      ? path.join(process.env.USERPROFILE || 'C:\\Users\\Default', '.mcp-gas', 'projects')
      : path.join(process.env.HOME || '/var/lib/mcp-gas', '.mcp-gas', 'projects'));

  private static readonly IGNORE_FILES = ['.DS_Store', 'Thumbs.db', '.gitignore'];
  private static readonly SUPPORTED_EXTENSIONS = ['.gs', '.js', '.html', '.json'];

  /**
   * Set the local root directory for all project folders
   */
  static async setLocalRoot(rootPath: string, workingDir?: string): Promise<void> {
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    
    // If rootPath is relative, resolve it relative to working directory
    // If rootPath is absolute, use it as-is
    const absoluteRoot = path.isAbsolute(rootPath) ? rootPath : path.resolve(actualWorkingDir, rootPath);
    
    // Ensure the directory exists
    await fs.mkdir(absoluteRoot, { recursive: true });
    
    // Use unified configuration instead of separate file
    console.error(`🔧 [LOCAL_FILE_MANAGER] Setting local root via unified config: ${absoluteRoot}`);
    await McpGasConfigManager.setLocalRootPath(absoluteRoot);
  }

  /**
   * Get the local root directory configuration
   */
  static async getLocalRoot(workingDir?: string): Promise<string> {
    try {
      // Use unified configuration instead of separate file
      const rootPath = await McpGasConfigManager.getLocalRootPath();
      console.error(`🔧 [LOCAL_FILE_MANAGER] Got local root via unified config: ${rootPath}`);
      return rootPath;
    } catch (error) {
      // Default to /tmp/gas-projects if no configuration exists
      const actualWorkingDir = this.getWorkingDirectory(workingDir);
      await this.setLocalRoot(this.DEFAULT_ROOT, actualWorkingDir);
      return this.DEFAULT_ROOT;
    }
  }

  /**
   * Initialize default local root configuration at server startup
   * This ensures the default "/tmp/gas-projects" directory is set up if no configuration exists
   */
  static async initializeDefaultRoot(workingDir?: string): Promise<string> {
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    
    try {
      // Try to get existing configuration
      return await this.getLocalRoot(actualWorkingDir);
    } catch (error) {
      // No configuration exists, initialize with default
      console.error(`🗂️  Initializing default local root directory: ${this.DEFAULT_ROOT}`);
      
      // Create the directory and configuration
      await fs.mkdir(this.DEFAULT_ROOT, { recursive: true });
      await this.setLocalRoot(this.DEFAULT_ROOT, actualWorkingDir);
      
      console.error(`✅ Default local root initialized: ${this.DEFAULT_ROOT}`);
      return this.DEFAULT_ROOT;
    }
  }

  /**
   * Get the project-specific directory path (NO src/ subdirectory)
   */
  static async getProjectDirectory(projectName: string, workingDir?: string): Promise<string> {
    const localRoot = await this.getLocalRoot(workingDir);
    return path.join(localRoot, projectName);
  }



  /**
   * Ensure project directory structure exists (NO src/ subdirectory)
   */
  static async ensureProjectDirectory(projectName: string, workingDir?: string): Promise<string> {
    const projectDir = await this.getProjectDirectory(projectName, workingDir);
    
    // Create the project directory directly (no src/ subdirectory)
    await fs.mkdir(projectDir, { recursive: true });
    return projectDir;
  }



  /**
   * Get all files from a project directory (NO src/ subdirectory)
   */
  static async getProjectFiles(projectName: string, workingDir?: string): Promise<LocalFile[]> {
    const projectPath = await this.getProjectDirectory(projectName, workingDir);
    
    try {
      await fs.access(projectPath);
    } catch (error) {
      // project directory doesn't exist
      return [];
    }

    const files: LocalFile[] = [];
    await this.scanDirectory(projectPath, projectPath, files);
    return files;
  }

  /**
   * Get git information from appsscript.json
   */
  static async getGitInfo(projectName: string, workingDir?: string): Promise<GitInfo | null> {
    try {
      const projectDir = await this.getProjectDirectory(projectName, workingDir);
      const appsscriptPath = path.join(projectDir, 'appsscript.json');
      
      const content = await fs.readFile(appsscriptPath, 'utf-8');
      const appsscript = JSON.parse(content) as EnhancedAppsscriptJson;
      
      return appsscript.git || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Update git information in appsscript.json
   */
  static async updateGitInfo(projectName: string, gitInfo: GitInfo, workingDir?: string): Promise<void> {
    const projectDir = await this.getProjectDirectory(projectName, workingDir);
    const appsscriptPath = path.join(projectDir, 'appsscript.json');
    
    let appsscript: EnhancedAppsscriptJson;
    
    try {
      const content = await fs.readFile(appsscriptPath, 'utf-8');
      appsscript = JSON.parse(content);
    } catch (error) {
      // Create default appsscript.json if it doesn't exist
      appsscript = {
        timeZone: "America/New_York",
        dependencies: {},
        exceptionLogging: "STACKDRIVER",
        runtimeVersion: "V8"
      };
    }
    
    // Update git information
    appsscript.git = {
      ...appsscript.git,
      ...gitInfo,
      lastSync: new Date().toISOString()
    };
    
    await fs.writeFile(appsscriptPath, JSON.stringify(appsscript, null, 2));
  }

  /**
   * Get MCP information from appsscript.json
   */
  static async getMcpInfo(projectName: string, workingDir?: string): Promise<McpInfo | null> {
    try {
      const projectDir = await this.getProjectDirectory(projectName, workingDir);
      const appsscriptPath = path.join(projectDir, 'appsscript.json');
      
      const content = await fs.readFile(appsscriptPath, 'utf-8');
      const appsscript = JSON.parse(content) as EnhancedAppsscriptJson;
      
      return appsscript.mcp || null;
    } catch (error) {
      return null;
    }
  }



  /**
   * Update MCP information in appsscript.json
   */
  static async updateMcpInfo(projectName: string, mcpInfo: Partial<McpInfo>, workingDir?: string): Promise<void> {
    const projectDir = await this.getProjectDirectory(projectName, workingDir);
    const appsscriptPath = path.join(projectDir, 'appsscript.json');
    
    let appsscript: EnhancedAppsscriptJson;
    
    try {
      const content = await fs.readFile(appsscriptPath, 'utf-8');
      appsscript = JSON.parse(content);
    } catch (error) {
      // Create default appsscript.json if it doesn't exist
      appsscript = {
        timeZone: "America/New_York",
        dependencies: {},
        exceptionLogging: "STACKDRIVER",
        runtimeVersion: "V8"
      };
    }
    
    // Update MCP information - ensure required fields are present
    const updatedMcpInfo: McpInfo = {
      scriptId: mcpInfo.scriptId || appsscript.mcp?.scriptId || projectName,
      projectName: mcpInfo.projectName || appsscript.mcp?.projectName || projectName,
      localRoot: mcpInfo.localRoot || appsscript.mcp?.localRoot || await this.getLocalRoot(workingDir),
      lastSync: new Date().toISOString(),
      created: mcpInfo.created || appsscript.mcp?.created || new Date().toISOString(),
      description: mcpInfo.description || appsscript.mcp?.description,
      cacheVersion: mcpInfo.cacheVersion || appsscript.mcp?.cacheVersion || "1.0.0"
    };
    
    appsscript.mcp = updatedMcpInfo;
    
    await fs.writeFile(appsscriptPath, JSON.stringify(appsscript, null, 2));
  }

  /**
   * Recursively scan directory for files
   */
  private static async scanDirectory(basePath: string, currentPath: string, files: LocalFile[]): Promise<void> {
    try {
      const items = await fs.readdir(currentPath, { withFileTypes: true });
      
      for (const item of items) {
        const fullPath = path.join(currentPath, item.name);
        
        if (item.isDirectory()) {
          // Recursively scan subdirectories
          await this.scanDirectory(basePath, fullPath, files);
        } else if (item.isFile() && this.shouldIncludeFile(item.name)) {
          const stats = await fs.stat(fullPath);
          const content = await fs.readFile(fullPath, 'utf-8');
          const relativePath = path.relative(basePath, fullPath);
          
          files.push({
            name: this.normalizeFileNameWithPath(relativePath),
            relativePath,
            fullPath,
            content,
            size: content.length,
            lastModified: stats.mtime
          });
        }
      }
    } catch (error: any) {
      throw new FileOperationError('scan', currentPath, error.message);
    }
  }

  /**
   * Check if file should be included in sync
   */
  private static shouldIncludeFile(fileName: string): boolean {
    // Skip ignored files
    if (this.IGNORE_FILES.includes(fileName)) {
      return false;
    }

    // Include files with supported extensions
    const ext = path.extname(fileName).toLowerCase();
    return this.SUPPORTED_EXTENSIONS.includes(ext);
  }

  /**
   * Normalize file name for GAS compatibility (remove extension)
   * LEGACY: Use normalizeFileNameWithPath for directory-aware normalization
   */
  private static normalizeFileName(fileName: string): string {
    // Remove extension for GAS compatibility (GAS auto-detects file types)
    return path.parse(fileName).name;
  }

  /**
   * Normalize file path for GAS compatibility (preserve directory structure, remove extension)
   * Converts local filesystem paths to GAS filename format with directory prefixes
   * 
   * Examples:
   * - "utils/helper.js" → "utils/helper" (GAS uses "/" for directory structure)
   * - "models/User.js" → "models/User"
   * - "Code.js" → "Code"
   */
  private static normalizeFileNameWithPath(relativePath: string): string {
    // Convert Windows backslashes to forward slashes for GAS compatibility
    const normalizedPath = relativePath.replace(/\\/g, '/');
    
    // Remove file extension (GAS uses type field instead)
    const parsed = path.parse(normalizedPath);
    const dir = parsed.dir;
    const nameWithoutExt = parsed.name;
    
    // Combine directory and filename with forward slash separator
    return dir ? `${dir}/${nameWithoutExt}` : nameWithoutExt;
  }

  /**
   * Write files to a project's src directory
   */
  static async writeProjectFiles(
    projectName: string,
    files: Array<{name: string; content: string; type?: string}>, 
    workingDir?: string
  ): Promise<void> {
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    const projectPath = await this.getProjectDirectory(projectName, actualWorkingDir);
    
    // Ensure the project directory exists
    await fs.mkdir(projectPath, { recursive: true });

    for (const file of files) {
      const extension = this.getFileExtension(file.type, file.content);
      
      // ✅ FIX: Parse directory structure from GAS filename
      // Convert "utils/helper" → "utils/helper.js" with proper directory structure
      const fileName = file.name;
      const filePath = path.join(projectPath, `${fileName}${extension}`);
      
      // Create directory for the file if it's in a subdirectory
      const fileDir = path.dirname(filePath);
      if (fileDir !== projectPath) {
        await fs.mkdir(fileDir, { recursive: true });
      }
      
      await fs.writeFile(filePath, file.content, 'utf-8');
    }
  }

  /**
   * Write files to local src directory (LEGACY - use writeProjectFiles instead)
   */
  static async writeLocalFiles(files: Array<{name: string; content: string; type?: string}>, workingDir?: string): Promise<void> {
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    const projectPath = await this.ensureProjectDirectory(actualWorkingDir, actualWorkingDir);

    for (const file of files) {
      const extension = this.getFileExtension(file.type, file.content);
      const fileName = this.normalizeFileName(file.name);
      const filePath = path.join(projectPath, `${fileName}${extension}`);
      
      // Create directory for the file if it's in a subdirectory
      const fileDir = path.dirname(filePath);
      if (fileDir !== projectPath) {
        await fs.mkdir(fileDir, { recursive: true });
      }
      
      await fs.writeFile(filePath, file.content, 'utf-8');
    }
  }

  /**
   * Simple copy remote files to local (overwrites existing local files)
   * This replaces the complex merge logic with a simple git-like pull model
   */
  static async copyRemoteToLocal(
    projectName: string,
    remoteFiles: Array<{name: string; content: string; type?: string}>, 
    workingDir?: string
  ): Promise<{
    filesWritten: number;
    filesList: string[];
    projectPath: string;
  }> {
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    const projectPath = await this.getProjectDirectory(projectName, actualWorkingDir);
    
    // Ensure the project directory exists
    await fs.mkdir(projectPath, { recursive: true });

    const filesList: string[] = [];

    for (const remoteFile of remoteFiles) {
      const extension = this.getFileExtension(remoteFile.type, remoteFile.content);
      
      // Parse directory structure from GAS filename
      const fileName = remoteFile.name;
      const filePath = path.join(projectPath, `${fileName}${extension}`);
      
      // Create directory for the file if it's in a subdirectory
      const fileDir = path.dirname(filePath);
      if (fileDir !== projectPath) {
        await fs.mkdir(fileDir, { recursive: true });
      }
      
      // Simple overwrite - no merge logic
      await fs.writeFile(filePath, remoteFile.content, 'utf-8');
      filesList.push(remoteFile.name);
    }

    return {
      filesWritten: remoteFiles.length,
      filesList,
      projectPath
    };
  }

  /**
   * @deprecated Use copyRemoteToLocal instead for simple overwrite behavior
   * Complex merge logic is being phased out for simpler git-like workflow
   */
  static async mergeProjectFiles(
    projectName: string,
    remoteFiles: Array<{name: string; content: string; type?: string}>, 
    workingDir?: string,
    options: {
      overwriteModified?: boolean;
      preserveLocal?: boolean;
    } = {}
  ): Promise<{
    written: string[];
    skipped: string[];
    overwritten: string[];
    summary: string;
  }> {
    // For backward compatibility, just call the simple version
    console.warn('⚠️ mergeProjectFiles is deprecated - use copyRemoteToLocal for simple overwrite behavior');
    
    const result = await this.copyRemoteToLocal(projectName, remoteFiles, workingDir);
    
    return {
      written: result.filesList,
      skipped: [],
      overwritten: [], // All files are effectively overwritten in simple model
      summary: `Copied ${result.filesWritten} files from remote (simple overwrite mode)`
    };
  }

  /**
   * @deprecated Use copyRemoteToLocal instead for simple overwrite behavior  
   * Complex merge logic is being phased out for simpler git-like workflow
   */
  static async mergeRemoteFiles(
    remoteFiles: Array<{name: string; content: string; type?: string}>, 
    workingDir?: string,
    options: {
      overwriteModified?: boolean;
      preserveLocal?: boolean;
    } = {}
  ): Promise<{
    written: string[];
    skipped: string[];
    overwritten: string[];
    summary: string;
  }> {
    // For backward compatibility, use current working directory as project name
    console.warn('⚠️ mergeRemoteFiles is deprecated - use copyRemoteToLocal for simple overwrite behavior');
    
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    const projectName = actualWorkingDir; // Use working dir as project name (legacy behavior)
    
    const result = await this.copyRemoteToLocal(projectName, remoteFiles, workingDir);
    
    return {
      written: result.filesList,
      skipped: [],
      overwritten: [], // All files are effectively overwritten in simple model
      summary: `Copied ${result.filesWritten} files from remote (simple overwrite mode)`
    };
  }

  /**
   * Write a single file to project src directory
   */
  static async writeProjectFile(projectName: string, name: string, content: string, type?: string, workingDir?: string): Promise<void> {
    return this.writeProjectFiles(projectName, [{name, content, type}], workingDir);
  }

  /**
   * Write a single file to local src directory (LEGACY)
   */
  static async writeLocalFile(name: string, content: string, type?: string, workingDir?: string): Promise<void> {
    return this.writeLocalFiles([{name, content, type}], workingDir);
  }

  /**
   * Read a single file from project src directory
   */
  static async readProjectFile(projectName: string, name: string, workingDir?: string): Promise<string | null> {
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    const projectPath = await this.getProjectDirectory(projectName, actualWorkingDir);
    
    // Try different extensions
    for (const extension of this.SUPPORTED_EXTENSIONS) {
      try {
        const fileName = this.normalizeFileName(name);
        const filePath = path.join(projectPath, `${fileName}${extension}`);
        const content = await fs.readFile(filePath, 'utf-8');
        return content;
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          throw new FileOperationError('read', name, error.message);
        }
        // File doesn't exist with this extension, try next
        continue;
      }
    }

    // Also try without extension (for files like README, etc.)
    try {
      const filePath = path.join(projectPath, name);
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw new FileOperationError('read', name, error.message);
      }
    }

    return null;
  }

  /**
   * Read a single file from project-specific directory
   */
  static async readFileFromProject(projectName: string, fileName: string, workingDir?: string): Promise<string | null> {
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    const projectPath = await this.getProjectDirectory(projectName, actualWorkingDir);
    
    // Try different extensions based on GAS file types
    const extensions = ['.gs', '.html', '.json', ''];
    
    for (const extension of extensions) {
      try {
        const fullFileName = fileName + extension;
        const filePath = path.join(projectPath, fullFileName);
        const content = await fs.readFile(filePath, 'utf-8');
        console.error(`📖 [READ PROJECT FILE] Successfully read: ${projectPath}/${fullFileName}`);
        return content;
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          throw new Error(`Failed to read file ${fileName}: ${error.message}`);
        }
        // File doesn't exist with this extension, try next
        continue;
      }
    }
    
    // File not found with any extension
    console.error(`📁 [READ PROJECT FILE] File not found: ${projectName}/${fileName} (tried extensions: ${extensions.join(', ')})`);
    return null;
  }

  /**
   * Read a single file from local src directory (LEGACY)
   */
  static async readLocalFile(name: string, workingDir?: string): Promise<string | null> {
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    const projectPath = await this.ensureProjectDirectory(actualWorkingDir, actualWorkingDir);
    
    // Try different extensions
    for (const extension of this.SUPPORTED_EXTENSIONS) {
      try {
        const fileName = this.normalizeFileName(name);
        const filePath = path.join(projectPath, `${fileName}${extension}`);
        const content = await fs.readFile(filePath, 'utf-8');
        return content;
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          throw new FileOperationError('read', name, error.message);
        }
        // File doesn't exist with this extension, try next
        continue;
      }
    }

    // Also try without extension (for files like README, etc.)
    try {
      const filePath = path.join(projectPath, name);
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw new FileOperationError('read', name, error.message);
      }
    }

    return null;
  }

  /**
   * Get the full path to a project file
   */
  static async getProjectFilePath(projectName: string, name: string, workingDir?: string): Promise<string | null> {
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    const projectPath = await this.getProjectDirectory(projectName, actualWorkingDir);
    
    // Try different extensions
    for (const extension of this.SUPPORTED_EXTENSIONS) {
      try {
        const fileName = this.normalizeFileName(name);
        const filePath = path.join(projectPath, `${fileName}${extension}`);
        await fs.access(filePath);
        return filePath;
      } catch (error) {
        // File doesn't exist with this extension, try next
        continue;
      }
    }

    // Also try without extension
    try {
      const filePath = path.join(projectPath, name);
      await fs.access(filePath);
      return filePath;
    } catch (error) {
      // File doesn't exist
    }

    return null;
  }

  /**
   * Get the full path to a local file (LEGACY)
   */
  static getLocalFilePath(name: string, workingDir?: string): string | null {
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    // Note: This method is synchronous, so we can't use async ensureProjectDirectory
    // For now, we'll use a synchronous approach or return null
    return null;
  }



  /**
   * Delete a file from local src directory
   */
  static async deleteLocalFile(name: string, workingDir?: string): Promise<void> {
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    const projectPath = await this.ensureProjectDirectory(actualWorkingDir, actualWorkingDir);
    
    // Try different extensions
    for (const extension of this.SUPPORTED_EXTENSIONS) {
      try {
        const fileName = this.normalizeFileName(name);
        const filePath = path.join(projectPath, `${fileName}${extension}`);
        await fs.unlink(filePath);
        return;
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          throw new FileOperationError('delete', name, error.message);
        }
        // File doesn't exist with this extension, try next
        continue;
      }
    }

    throw new FileOperationError('delete', name, 'file not found in src directory');
  }

  /**
   * Clear all files from local src directory
   */
  static async clearLocalFiles(workingDir?: string): Promise<void> {
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    const projectPath = await this.ensureProjectDirectory(actualWorkingDir, actualWorkingDir);
    
    try {
      await fs.rm(projectPath, { recursive: true, force: true });
    } catch (error: any) {
      // Directory might not exist, which is fine
      if (error.code !== 'ENOENT') {
        throw new FileOperationError('clear', projectPath, error.message);
      }
    }
  }

  /**
   * Compare local files with remote files
   */
  static async compareFiles(
    localFiles: LocalFile[], 
    remoteFiles: Array<{name: string; content: string; type?: string}>
  ): Promise<FileComparison[]> {
    const comparisons: FileComparison[] = [];
    const localFileMap = new Map(localFiles.map(f => [f.name, f]));
    const remoteFileMap = new Map(remoteFiles.map(f => [f.name, f]));

    // Check all local files
    for (const localFile of localFiles) {
      const remoteFile = remoteFileMap.get(localFile.name);
      
      if (!remoteFile) {
        comparisons.push({
          name: localFile.name,
          status: 'local-only',
          localPath: localFile.relativePath,
          localSize: localFile.size,
          lastModified: localFile.lastModified
        });
      } else if (localFile.content !== remoteFile.content) {
        comparisons.push({
          name: localFile.name,
          status: 'different',
          localPath: localFile.relativePath,
          localSize: localFile.size,
          remoteSize: remoteFile.content.length,
          lastModified: localFile.lastModified
        });
      } else {
        comparisons.push({
          name: localFile.name,
          status: 'same',
          localPath: localFile.relativePath,
          localSize: localFile.size,
          remoteSize: remoteFile.content.length,
          lastModified: localFile.lastModified
        });
      }
    }

    // Check for remote-only files
    for (const remoteFile of remoteFiles) {
      if (!localFileMap.has(remoteFile.name)) {
        comparisons.push({
          name: remoteFile.name,
          status: 'remote-only',
          remoteSize: remoteFile.content.length
        });
      }
    }

    return comparisons.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get appropriate file extension based on GAS file type
   * Maps Google Apps Script API file types to local development extensions
   * 
   * @see https://developers.google.com/apps-script/api/reference/rest/v1/File FileType
   */
  private static getFileExtension(type?: string, content?: string): string {
    if (type) {
      switch (type.toLowerCase()) {
        case 'server_js':
        case 'javascript':
          return '.js';  // ✅ LOCAL: Use .js for Apps Script code (not .gs)
        case 'html':
          return '.html';  // ✅ LOCAL: HTML files stay .html
        case 'json':
          return '.json';  // ✅ LOCAL: JSON files stay .json (manifest)
        default:
          return '.js';  // ✅ DEFAULT: Default to .js for unknown types
      }
    }

    // Auto-detect from content
    if (content) {
      const trimmed = content.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        return '.json';
      }
      if (trimmed.includes('<html>') || trimmed.includes('<!DOCTYPE')) {
        return '.html';
      }
    }

    // Default to .js for Apps Script development
    return '.js';
  }



  /**
   * Detect the proper workspace directory by looking for package.json or similar markers
   */
  private static detectWorkspaceDirectory(): string {
    // Try to find the workspace by looking for package.json or other project markers
    let currentDir = process.cwd();
    const maxAttempts = 10; // Prevent infinite loops
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      try {
        const packageJsonPath = path.join(currentDir, 'package.json');
        const nodeModulesPath = path.join(currentDir, 'node_modules');
        const gasProjectsPath = path.join(currentDir, 'gas-projects');
        
        // Check if we're in an MCP Gas workspace by looking for specific files
        if (require('fs').existsSync(packageJsonPath)) {
          const packageJson = JSON.parse(require('fs').readFileSync(packageJsonPath, 'utf-8'));
          if (packageJson.name === 'mcp-gas-server' || 
              require('fs').existsSync(gasProjectsPath) ||
              require('fs').existsSync(nodeModulesPath)) {
            console.error(`🔍 [LocalFileManager] Detected workspace at: ${currentDir}`);
            return currentDir;
          }
        }
        
        // Move up one directory
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
          // Reached filesystem root
          break;
        }
        currentDir = parentDir;
        attempts++;
      } catch (error) {
        break;
      }
    }
    
    // PRODUCTION-READY: Use persistent workspace fallback
    const persistentWorkspace = process.env.MCP_GAS_WORKSPACE || 
      (process.platform === 'win32' 
        ? path.join(process.env.USERPROFILE || 'C:\\Users\\Default', '.mcp-gas', 'workspace')
        : path.join(process.env.HOME || '/var/lib/mcp-gas', '.mcp-gas', 'workspace'));
    console.error(`⚠️ [LocalFileManager] Could not detect workspace, using persistent fallback: ${persistentWorkspace}`);
    return persistentWorkspace;
  }

  /**
   * Get the proper working directory (workspace-aware)
   */
  private static getWorkingDirectory(workingDir?: string): string {
    if (workingDir) {
      return workingDir;
    }
    
    // Check for environment variable override first
    if (process.env.MCP_GAS_WORKING_DIR) {
      console.error(`🔍 [LocalFileManager] Using MCP_GAS_WORKING_DIR: ${process.env.MCP_GAS_WORKING_DIR}`);
      return process.env.MCP_GAS_WORKING_DIR;
    }
    
    // If no working directory specified, try to detect the workspace
    const detectedWorkspace = this.detectWorkspaceDirectory();
    console.error(`🔍 [LocalFileManager] Using working directory: ${detectedWorkspace}`);
    return detectedWorkspace;
  }

  /**
   * Public method to get the working directory (used by tools)
   */
  static getResolvedWorkingDirectory(workingDir?: string): string {
    return this.getWorkingDirectory(workingDir);
  }

  /**
   * Ensure project directory has git repository initialized
   */
  static async ensureProjectGitRepo(projectName: string, workingDir?: string): Promise<{
    gitInitialized: boolean;
    isNewRepo: boolean;
    repoPath: string;
  }> {
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    
    // 🔧 CRITICAL FIX: Ensure the project directory exists BEFORE git operations
    const projectPath = await this.ensureProjectDirectory(projectName, actualWorkingDir);
    
    try {
      // Check if .git directory exists
      const gitPath = path.join(projectPath, '.git');
      const gitExists = await fs.access(gitPath).then(() => true).catch(() => false);
      
      if (gitExists) {
        return {
          gitInitialized: true,
          isNewRepo: false,
          repoPath: projectPath
        };
      }
      
      // Initialize git repository
      console.error(`🔧 [GIT INIT] Initializing git repository for project: ${projectName}`);
      const { spawn } = await import('child_process');
      
      await new Promise<void>((resolve, reject) => {
        const gitInit = spawn('git', ['init'], { 
          cwd: projectPath,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        
        gitInit.stdout?.on('data', (data) => {
          stdout += data.toString();
        });
        
        gitInit.stderr?.on('data', (data) => {
          stderr += data.toString();
        });
        
        gitInit.on('close', (code) => {
          if (code === 0) {
            console.error(`✅ [GIT INIT] Repository initialized: ${projectPath}`);
            resolve();
          } else {
            console.error(`❌ [GIT INIT] Failed: ${stderr}`);
            reject(new Error(`Git init failed: ${stderr}`));
          }
        });
      });
      
      // Create initial .gitignore
      const gitignoreContent = `# MCP Gas Server
.env
.env.local
*.log
node_modules/
.DS_Store
`;
      
      await fs.writeFile(path.join(projectPath, '.gitignore'), gitignoreContent);
      
      return {
        gitInitialized: true,
        isNewRepo: true,
        repoPath: projectPath
      };
      
    } catch (error: any) {
      console.error(`⚠️ [GIT INIT] Failed to initialize git repo: ${error.message}`);
      return {
        gitInitialized: false,
        isNewRepo: false,
        repoPath: projectPath
      };
    }
  }

  /**
   * Verify sync status between local and remote files
   */
  static async verifySyncStatus(
    projectName: string,
    remoteFiles: Array<{name: string; content: string; type?: string}>,
    workingDir?: string
  ): Promise<{
    inSync: boolean;
    differences: {
      onlyLocal: string[];
      onlyRemote: string[];
      contentDiffers: string[];
    };
    summary: string;
  }> {
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    const projectPath = await this.getProjectDirectory(projectName, actualWorkingDir);
    
    const differences = {
      onlyLocal: [] as string[],
      onlyRemote: [] as string[],
      contentDiffers: [] as string[]
    };
    
    try {
      // Get local files
      const localFiles = new Map<string, string>();
      
      try {
        const files = await fs.readdir(projectPath);
        for (const filename of files) {
          if (filename.startsWith('.')) continue; // Skip git and hidden files
          
          const filePath = path.join(projectPath, filename);
          const stat = await fs.stat(filePath);
          
          if (stat.isFile()) {
            const content = await fs.readFile(filePath, 'utf-8');
            // Convert filename back to GAS format (remove extension)
            const gasName = this.convertToGasFileName(filename);
            localFiles.set(gasName, content);
          }
        }
      } catch (error) {
        // Directory doesn't exist or is empty
        console.error(`📁 [SYNC CHECK] Local project directory not found or empty: ${projectPath}`);
      }
      
      // Create remote files map
      const remoteFilesMap = new Map<string, string>();
      for (const remoteFile of remoteFiles) {
        remoteFilesMap.set(remoteFile.name, remoteFile.content);
      }
      
      // Check for files only in local
      for (const [localName, localContent] of localFiles) {
        if (!remoteFilesMap.has(localName)) {
          differences.onlyLocal.push(localName);
        } else {
          // Check content differences
          const remoteContent = remoteFilesMap.get(localName)!;
          if (localContent.trim() !== remoteContent.trim()) {
            differences.contentDiffers.push(localName);
          }
        }
      }
      
      // Check for files only in remote
      for (const [remoteName] of remoteFilesMap) {
        if (!localFiles.has(remoteName)) {
          differences.onlyRemote.push(remoteName);
        }
      }
      
      const inSync = differences.onlyLocal.length === 0 && 
                     differences.onlyRemote.length === 0 && 
                     differences.contentDiffers.length === 0;
      
      const summary = inSync 
        ? `✅ Local and remote are in sync (${localFiles.size} files)`
        : `⚠️ Sync differences: ${differences.onlyLocal.length} local-only, ${differences.onlyRemote.length} remote-only, ${differences.contentDiffers.length} content differs`;
      
      return {
        inSync,
        differences,
        summary
      };
      
    } catch (error: any) {
      console.error(`❌ [SYNC CHECK] Error verifying sync status: ${error.message}`);
      return {
        inSync: false,
        differences,
        summary: `Sync check failed: ${error.message}`
      };
    }
  }

  /**
   * Get file extension for a given filename (different from the private method that takes type/content)
   */
  static getFileExtensionFromName(filename: string): string {
    if (filename.toLowerCase() === 'appsscript') {
      return '.json';
    } else if (filename.includes('.')) {
      return '';  // Already has extension
    } else {
      return '.gs'; // Default for Google Apps Script files
    }
  }

  /**
   * Convert local filename back to GAS format
   */
  private static convertToGasFileName(filename: string): string {
    // Remove file extensions to get GAS filename
    if (filename.endsWith('.gs')) {
      return filename.slice(0, -3);
    } else if (filename.endsWith('.html')) {
      return filename.slice(0, -5);
    } else if (filename.endsWith('.json')) {
      return filename.slice(0, -5);
    }
    return filename;
  }

  /**
   * Auto-commit changes to project git repository
   */
  static async autoCommitChanges(
    projectName: string,
    changedFiles: string[],
    commitMessage: string,
    workingDir?: string
  ): Promise<{
    committed: boolean;
    commitHash?: string;
    message: string;
  }> {
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    const projectPath = await this.getProjectDirectory(projectName, actualWorkingDir);
    
    try {
      const { spawn } = await import('child_process');
      
      // First, add changed files
      await new Promise<void>((resolve, reject) => {
        const gitAdd = spawn('git', ['add', '.'], { 
          cwd: projectPath,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let stderr = '';
        gitAdd.stderr?.on('data', (data) => {
          stderr += data.toString();
        });
        
        gitAdd.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Git add failed: ${stderr}`));
          }
        });
      });
      
      // Check if there are changes to commit
      const hasChanges = await new Promise<boolean>((resolve) => {
        const gitStatus = spawn('git', ['status', '--porcelain'], { 
          cwd: projectPath,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let stdout = '';
        gitStatus.stdout?.on('data', (data) => {
          stdout += data.toString();
        });
        
        gitStatus.on('close', () => {
          resolve(stdout.trim().length > 0);
        });
      });
      
      if (!hasChanges) {
        return {
          committed: false,
          message: 'No changes to commit'
        };
      }
      
      // Commit changes
      const commitHash = await new Promise<string>((resolve, reject) => {
        const gitCommit = spawn('git', ['commit', '-m', commitMessage], { 
          cwd: projectPath,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        
        gitCommit.stdout?.on('data', (data) => {
          stdout += data.toString();
        });
        
        gitCommit.stderr?.on('data', (data) => {
          stderr += data.toString();
        });
        
        gitCommit.on('close', (code) => {
          if (code === 0) {
            // Extract commit hash from output
            const hashMatch = stdout.match(/\[.*?([a-f0-9]+)\]/);
            const hash = hashMatch ? hashMatch[1] : 'unknown';
            resolve(hash);
          } else {
            reject(new Error(`Git commit failed: ${stderr}`));
          }
        });
      });
      
      return {
        committed: true,
        commitHash,
        message: `Committed changes: ${changedFiles.length} files`
      };
      
    } catch (error: any) {
      console.error(`❌ [GIT COMMIT] Failed to commit changes: ${error.message}`);
      return {
        committed: false,
        message: `Commit failed: ${error.message}`
      };
    }
  }
} 