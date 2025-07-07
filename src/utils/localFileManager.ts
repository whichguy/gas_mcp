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
 * Local root configuration
 */
export interface LocalRootConfig {
  rootPath: string;
  lastUpdated: string;
}

/**
 * Project-specific metadata
 */
export interface ProjectInfo {
  projectName: string;
  scriptId: string;
  lastSync: string;
  created: string;
  description?: string;
}

/**
 * Utility class for local file system operations
 * Handles configurable root directory with project-specific folders for gas sync functionality
 */
export class LocalFileManager {
  private static readonly DEFAULT_ROOT = '/tmp/gas-projects';
  private static readonly LOCAL_ROOT_CONFIG = '.gas-local-root.json';
  private static readonly PROJECT_INFO_FILE = '.project-info.json';
  private static readonly SRC_DIR = 'src';
  private static readonly IGNORE_FILES = ['.DS_Store', 'Thumbs.db', '.gitignore', '.project-info.json'];
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
      // Check if configuration already exists
      const configPath = path.join(actualWorkingDir, this.LOCAL_ROOT_CONFIG);
      await fs.access(configPath);
      
      // Configuration exists, return the configured path
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
   * Get the project-specific directory path
   */
  static async getProjectDirectory(projectName: string, workingDir?: string): Promise<string> {
    const localRoot = await this.getLocalRoot(workingDir);
    return path.join(localRoot, projectName);
  }

  /**
   * Get the project-specific src directory path
   */
  static async getProjectSrcDirectory(projectName: string, workingDir?: string): Promise<string> {
    const projectDir = await this.getProjectDirectory(projectName, workingDir);
    return path.join(projectDir, this.SRC_DIR);
  }

  /**
   * Ensure project directory structure exists
   */
  static async ensureProjectDirectory(projectName: string, workingDir?: string): Promise<string> {
    const projectDir = await this.getProjectDirectory(projectName, workingDir);
    const srcDir = path.join(projectDir, this.SRC_DIR);
    
    await fs.mkdir(srcDir, { recursive: true });
    return projectDir;
  }

  /**
   * Save project metadata
   */
  static async saveProjectInfo(projectInfo: ProjectInfo, workingDir?: string): Promise<void> {
    const projectDir = await this.ensureProjectDirectory(projectInfo.projectName, workingDir);
    const infoPath = path.join(projectDir, this.PROJECT_INFO_FILE);
    await fs.writeFile(infoPath, JSON.stringify(projectInfo, null, 2));
  }

  /**
   * Load project metadata
   */
  static async loadProjectInfo(projectName: string, workingDir?: string): Promise<ProjectInfo | null> {
    try {
      const projectDir = await this.getProjectDirectory(projectName, workingDir);
      const infoPath = path.join(projectDir, this.PROJECT_INFO_FILE);
      const content = await fs.readFile(infoPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  /**
   * Get all files from a project's src directory
   */
  static async getProjectFiles(projectName: string, workingDir?: string): Promise<LocalFile[]> {
    const srcPath = await this.getProjectSrcDirectory(projectName, workingDir);
    
    try {
      await fs.access(srcPath);
    } catch (error) {
      // src directory doesn't exist
      return [];
    }

    const files: LocalFile[] = [];
    await this.scanDirectory(srcPath, srcPath, files);
    return files;
  }

  /**
   * Get all files from the local src directory (LEGACY - use getProjectFiles instead)
   */
  static async getLocalFiles(workingDir?: string): Promise<LocalFile[]> {
    // This is legacy - try to determine current project and use project-specific files
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    
    try {
      // Try to get current project from .gas-current.json
      const currentPath = path.join(actualWorkingDir, '.gas-current.json');
      const currentContent = await fs.readFile(currentPath, 'utf-8');
      const current = JSON.parse(currentContent);
      
      if (current.projectName) {
        return await this.getProjectFiles(current.projectName, actualWorkingDir);
      }
    } catch (error) {
      // No current project set, fall back to legacy src directory
    }
    
    // Legacy: Use workspace src directory
    const srcPath = path.join(actualWorkingDir, this.SRC_DIR);
    
    try {
      await fs.access(srcPath);
    } catch (error) {
      // src directory doesn't exist
      return [];
    }

    const files: LocalFile[] = [];
    await this.scanDirectory(srcPath, srcPath, files);
    return files;
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
    const srcPath = await this.getProjectSrcDirectory(projectName, actualWorkingDir);
    
    // Ensure the src directory exists
    await fs.mkdir(srcPath, { recursive: true });

    for (const file of files) {
      const extension = this.getFileExtension(file.type, file.content);
      
      // ✅ FIX: Parse directory structure from GAS filename
      // Convert "utils/helper" → "utils/helper.js" with proper directory structure
      const fileName = file.name;
      const filePath = path.join(srcPath, `${fileName}${extension}`);
      
      // Create directory for the file if it's in a subdirectory
      const fileDir = path.dirname(filePath);
      if (fileDir !== srcPath) {
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
    const srcPath = await this.ensureSrcDirectory(actualWorkingDir);

    for (const file of files) {
      const extension = this.getFileExtension(file.type, file.content);
      const fileName = this.normalizeFileName(file.name);
      const filePath = path.join(srcPath, `${fileName}${extension}`);
      
      // Create directory for the file if it's in a subdirectory
      const fileDir = path.dirname(filePath);
      if (fileDir !== srcPath) {
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
    const srcPath = await this.getProjectSrcDirectory(projectName, actualWorkingDir);
    
    // Ensure the src directory exists
    await fs.mkdir(srcPath, { recursive: true });

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
      const filePath = path.join(srcPath, `${fileName}${extension}`);
      
      // Create directory for the file if it's in a subdirectory
      const fileDir = path.dirname(filePath);
      if (fileDir !== srcPath) {
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
    const srcPath = await this.ensureSrcDirectory(actualWorkingDir);

    const written: string[] = [];
    const skipped: string[] = [];
    const overwritten: string[] = [];

    // Get existing local files
    const localFiles = await this.getLocalFiles(actualWorkingDir);
    const localFileMap = new Map(localFiles.map(f => [f.name, f]));

    for (const remoteFile of remoteFiles) {
      const extension = this.getFileExtension(remoteFile.type, remoteFile.content);
      
      // ✅ FIX: Parse directory structure from GAS filename
      // Convert "utils/helper" → "utils/helper.js" with proper directory structure
      const fileName = remoteFile.name;
      const filePath = path.join(srcPath, `${fileName}${extension}`);
      
      // Create directory for the file if it's in a subdirectory
      const fileDir = path.dirname(filePath);
      if (fileDir !== srcPath) {
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
    const srcPath = await this.getProjectSrcDirectory(projectName, actualWorkingDir);
    
    // Try different extensions
    for (const extension of this.SUPPORTED_EXTENSIONS) {
      try {
        const fileName = this.normalizeFileName(name);
        const filePath = path.join(srcPath, `${fileName}${extension}`);
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
      const filePath = path.join(srcPath, name);
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
    const srcPath = path.join(actualWorkingDir, this.SRC_DIR);
    
    // Try different extensions
    for (const extension of this.SUPPORTED_EXTENSIONS) {
      try {
        const fileName = this.normalizeFileName(name);
        const filePath = path.join(srcPath, `${fileName}${extension}`);
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
      const filePath = path.join(srcPath, name);
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
    const srcPath = await this.getProjectSrcDirectory(projectName, actualWorkingDir);
    
    // Try different extensions
    for (const extension of this.SUPPORTED_EXTENSIONS) {
      try {
        const fileName = this.normalizeFileName(name);
        const filePath = path.join(srcPath, `${fileName}${extension}`);
        await fs.access(filePath);
        return filePath;
      } catch (error) {
        // File doesn't exist with this extension, try next
        continue;
      }
    }

    // Also try without extension
    try {
      const filePath = path.join(srcPath, name);
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
    const srcPath = path.join(actualWorkingDir, this.SRC_DIR);
    
    // Try different extensions
    for (const extension of this.SUPPORTED_EXTENSIONS) {
      try {
        const fileName = this.normalizeFileName(name);
        const filePath = path.join(srcPath, `${fileName}${extension}`);
        require('fs').accessSync(filePath);
        return filePath;
      } catch (error) {
        // File doesn't exist with this extension, try next
        continue;
      }
    }

    // Also try without extension
    try {
      const filePath = path.join(srcPath, name);
      require('fs').accessSync(filePath);
      return filePath;
    } catch (error) {
      // File doesn't exist
    }

    return null;
  }

  /**
   * List all local projects
   */
  static async listLocalProjects(workingDir?: string): Promise<ProjectInfo[]> {
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    const localRoot = await this.getLocalRoot(actualWorkingDir);
    
    try {
      await fs.access(localRoot);
    } catch (error) {
      // Local root doesn't exist yet
      return [];
    }

    const projects: ProjectInfo[] = [];
    const entries = await fs.readdir(localRoot, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const projectInfo = await this.loadProjectInfo(entry.name, actualWorkingDir);
        if (projectInfo) {
          projects.push(projectInfo);
        }
      }
    }
    
    return projects;
  }

  /**
   * Delete a file from local src directory
   */
  static async deleteLocalFile(name: string, workingDir?: string): Promise<void> {
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    const srcPath = path.join(actualWorkingDir, this.SRC_DIR);
    
    // Try different extensions
    for (const extension of this.SUPPORTED_EXTENSIONS) {
      try {
        const fileName = this.normalizeFileName(name);
        const filePath = path.join(srcPath, `${fileName}${extension}`);
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
    const srcPath = path.join(actualWorkingDir, this.SRC_DIR);
    
    try {
      await fs.rm(srcPath, { recursive: true, force: true });
    } catch (error: any) {
      // Directory might not exist, which is fine
      if (error.code !== 'ENOENT') {
        throw new FileOperationError('clear', srcPath, error.message);
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
   * Ensure src directory exists
   */
  static async ensureSrcDirectory(workingDir?: string): Promise<string> {
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    const srcPath = path.join(actualWorkingDir, this.SRC_DIR);
    await fs.mkdir(srcPath, { recursive: true });
    return srcPath;
  }

  /**
   * Get src directory path
   */
  static getSrcDirectory(workingDir?: string): string {
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    return path.join(actualWorkingDir, this.SRC_DIR);
  }

  /**
   * Check if src directory exists and has files
   */
  static async hasSrcFiles(workingDir?: string): Promise<boolean> {
    const actualWorkingDir = this.getWorkingDirectory(workingDir);
    const files = await this.getLocalFiles(actualWorkingDir);
    return files.length > 0;
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