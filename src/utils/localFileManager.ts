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
  projectId: string;
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
  private static readonly DEFAULT_ROOT = '/tmp/gas-projects';

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
      projectId: mcpInfo.projectId || appsscript.mcp?.projectId || projectName,
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
   * Merge remote files with local project files, handling conflicts intelligently
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
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    const projectPath = await this.getProjectDirectory(projectName, actualWorkingDir);
    
    // Ensure the project directory exists
    await fs.mkdir(projectPath, { recursive: true });

    const written: string[] = [];
    const skipped: string[] = [];
    const overwritten: string[] = [];

    // Get existing local files
    const localFiles = await this.getProjectFiles(projectName, actualWorkingDir);
    const localFileMap = new Map(localFiles.map(f => [f.name, f]));

    for (const remoteFile of remoteFiles) {
      const extension = this.getFileExtension(remoteFile.type, remoteFile.content);
      
      // ✅ FIX: Parse directory structure from GAS filename
      // Convert "utils/helper" → "utils/helper.js" with proper directory structure
      const fileName = remoteFile.name;
      const filePath = path.join(projectPath, `${fileName}${extension}`);
      
      // Create directory for the file if it's in a subdirectory
      const fileDir = path.dirname(filePath);
      if (fileDir !== projectPath) {
        await fs.mkdir(fileDir, { recursive: true });
      }

      const localFile = localFileMap.get(remoteFile.name);
      
      if (!localFile) {
        // File doesn't exist locally, write it
        await fs.writeFile(filePath, remoteFile.content, 'utf-8');
        written.push(remoteFile.name);
      } else if (localFile.content === remoteFile.content) {
        // File is identical, skip
        skipped.push(remoteFile.name);
      } else {
        // File is different, handle based on options
        if (options.preserveLocal) {
          // Preserve local changes
          skipped.push(remoteFile.name);
        } else if (options.overwriteModified) {
          // Overwrite local changes
          await fs.writeFile(filePath, remoteFile.content, 'utf-8');
          overwritten.push(remoteFile.name);
        } else {
          // Default: overwrite if remote is newer or same timestamp
          await fs.writeFile(filePath, remoteFile.content, 'utf-8');
          overwritten.push(remoteFile.name);
        }
      }
    }

    const summary = `Merged ${remoteFiles.length} remote files: ${written.length} new, ${overwritten.length} updated, ${skipped.length} skipped`;
    
    return {
      written,
      skipped,
      overwritten,
      summary
    };
  }

  /**
   * Merge remote files with local files (LEGACY - use mergeProjectFiles instead)
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
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    const projectPath = await this.ensureProjectDirectory(actualWorkingDir, actualWorkingDir);

    const written: string[] = [];
    const skipped: string[] = [];
    const overwritten: string[] = [];

    // Get existing local files
    const localFiles = await this.getProjectFiles(actualWorkingDir, actualWorkingDir);
    const localFileMap = new Map(localFiles.map(f => [f.name, f]));

    for (const remoteFile of remoteFiles) {
      const extension = this.getFileExtension(remoteFile.type, remoteFile.content);
      
      // ✅ FIX: Parse directory structure from GAS filename
      // Convert "utils/helper" → "utils/helper.js" with proper directory structure
      const fileName = remoteFile.name;
      const filePath = path.join(projectPath, `${fileName}${extension}`);
      
      // Create directory for the file if it's in a subdirectory
      const fileDir = path.dirname(filePath);
      if (fileDir !== projectPath) {
        await fs.mkdir(fileDir, { recursive: true });
      }

      const localFile = localFileMap.get(remoteFile.name);
      
      if (!localFile) {
        // File doesn't exist locally, write it
        await fs.writeFile(filePath, remoteFile.content, 'utf-8');
        written.push(remoteFile.name);
      } else if (localFile.content === remoteFile.content) {
        // File is identical, skip
        skipped.push(remoteFile.name);
      } else {
        // File is different, handle based on options
        if (options.preserveLocal) {
          // Preserve local changes
          skipped.push(remoteFile.name);
        } else if (options.overwriteModified) {
          // Overwrite local changes
          await fs.writeFile(filePath, remoteFile.content, 'utf-8');
          overwritten.push(remoteFile.name);
        } else {
          // Default: overwrite if remote is newer or same timestamp
          await fs.writeFile(filePath, remoteFile.content, 'utf-8');
          overwritten.push(remoteFile.name);
        }
      }
    }

    const summary = `Merged ${remoteFiles.length} remote files: ${written.length} new, ${overwritten.length} updated, ${skipped.length} skipped`;
    
    return {
      written,
      skipped,
      overwritten,
      summary
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
    
    // Fallback: Use /tmp as the workspace for MCP environments
    const tmpWorkspace = '/tmp/mcp-gas-workspace';
    console.error(`⚠️ [LocalFileManager] Could not detect workspace, using fallback: ${tmpWorkspace}`);
    return tmpWorkspace;
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
} 