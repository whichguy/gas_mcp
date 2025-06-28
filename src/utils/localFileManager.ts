import * as fs from 'fs/promises';
import * as path from 'path';
import { FileOperationError } from '../errors/mcpErrors.js';

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
 * Utility class for local file system operations
 * Handles ./src/ directory management for gas sync functionality
 */
export class LocalFileManager {
  private static readonly SRC_DIR = 'src';
  private static readonly IGNORE_FILES = ['.DS_Store', 'Thumbs.db', '.gitignore'];
  private static readonly SUPPORTED_EXTENSIONS = ['.gs', '.js', '.html', '.json'];

  /**
   * Get all files from the local src directory
   */
  static async getLocalFiles(workingDir: string = process.cwd()): Promise<LocalFile[]> {
    const srcPath = path.join(workingDir, this.SRC_DIR);
    
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
            name: this.normalizeFileName(item.name),
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
   */
  private static normalizeFileName(fileName: string): string {
    // Remove extension for GAS compatibility (GAS auto-detects file types)
    return path.parse(fileName).name;
  }

  /**
   * Write files to local src directory (OVERWRITES existing files)
   * Use mergeRemoteFiles() for merge behavior instead
   */
  static async writeLocalFiles(files: Array<{name: string; content: string; type?: string}>, workingDir: string = process.cwd()): Promise<void> {
    const srcPath = path.join(workingDir, this.SRC_DIR);
    
    // Ensure src directory exists
    await fs.mkdir(srcPath, { recursive: true });

    for (const file of files) {
      const extension = this.getFileExtension(file.type, file.content);
      const fileName = `${file.name}${extension}`;
      const filePath = path.join(srcPath, fileName);
      
      // Ensure subdirectory exists if file has a path
      const dir = path.dirname(filePath);
      if (dir !== srcPath) {
        await fs.mkdir(dir, { recursive: true });
      }

      await fs.writeFile(filePath, file.content, 'utf-8');
    }
  }

  /**
   * Merge remote files with local files (PRESERVES local files)
   * Only writes remote files that don't exist locally or are different
   */
  static async mergeRemoteFiles(
    remoteFiles: Array<{name: string; content: string; type?: string}>, 
    workingDir: string = process.cwd(),
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
    const srcPath = path.join(workingDir, this.SRC_DIR);
    const { overwriteModified = false, preserveLocal = true } = options;
    
    // Ensure src directory exists
    await fs.mkdir(srcPath, { recursive: true });

    // Get existing local files for comparison
    const localFiles = await this.getLocalFiles(workingDir);
    const localFileMap = new Map(localFiles.map(f => [f.name, f]));

    const written: string[] = [];
    const skipped: string[] = [];
    const overwritten: string[] = [];

    for (const remoteFile of remoteFiles) {
      const localFile = localFileMap.get(remoteFile.name);
      const extension = this.getFileExtension(remoteFile.type, remoteFile.content);
      const fileName = `${remoteFile.name}${extension}`;
      const filePath = path.join(srcPath, fileName);

      // Ensure subdirectory exists if file has a path
      const dir = path.dirname(filePath);
      if (dir !== srcPath) {
        await fs.mkdir(dir, { recursive: true });
      }

      if (!localFile) {
        // File doesn't exist locally - always write
        await fs.writeFile(filePath, remoteFile.content, 'utf-8');
        written.push(remoteFile.name);
      } else if (localFile.content === remoteFile.content) {
        // Files are identical - skip
        skipped.push(remoteFile.name);
      } else {
        // Files are different - check options
        if (preserveLocal && !overwriteModified) {
          // Preserve local file - skip remote
          skipped.push(`${remoteFile.name} (local modified)`);
        } else {
          // Overwrite local with remote
          await fs.writeFile(filePath, remoteFile.content, 'utf-8');
          overwritten.push(remoteFile.name);
        }
      }
    }

    const summary = `Merged ${remoteFiles.length} remote files: ${written.length} new, ${skipped.length} skipped, ${overwritten.length} overwritten`;
    
    return {
      written,
      skipped, 
      overwritten,
      summary
    };
  }

  /**
   * Write a single file to local src directory
   */
  static async writeLocalFile(name: string, content: string, type?: string, workingDir: string = process.cwd()): Promise<void> {
    await this.writeLocalFiles([{ name, content, type }], workingDir);
  }

  /**
   * Read a single file from local src directory
   */
  static async readLocalFile(name: string, workingDir: string = process.cwd()): Promise<string | null> {
    const srcPath = path.join(workingDir, this.SRC_DIR);
    
    // Try different extensions to find the file
    for (const ext of this.SUPPORTED_EXTENSIONS) {
      const fileName = `${name}${ext}`;
      const filePath = path.join(srcPath, fileName);
      
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        return content;
      } catch (error) {
        // File doesn't exist with this extension, try next
        continue;
      }
    }

    // File not found with any extension
    return null;
  }

  /**
   * Get the local file path for a given name
   */
  static getLocalFilePath(name: string, workingDir: string = process.cwd()): string | null {
    const srcPath = path.join(workingDir, this.SRC_DIR);
    
    // Try different extensions to find the file
    for (const ext of this.SUPPORTED_EXTENSIONS) {
      const fileName = `${name}${ext}`;
      const filePath = path.join(srcPath, fileName);
      
      try {
        // Check if file exists synchronously (for path resolution)
        require('fs').accessSync(filePath);
        return filePath;
      } catch (error) {
        // File doesn't exist with this extension, try next
        continue;
      }
    }

    // File not found, return potential path with .gs extension
    return path.join(srcPath, `${name}.gs`);
  }

  /**
   * Delete a file from local src directory
   */
  static async deleteLocalFile(name: string, workingDir: string = process.cwd()): Promise<void> {
    const srcPath = path.join(workingDir, this.SRC_DIR);
    
    // Try different extensions to find the file
    for (const ext of this.SUPPORTED_EXTENSIONS) {
      const fileName = `${name}${ext}`;
      const filePath = path.join(srcPath, fileName);
      
      try {
        await fs.unlink(filePath);
        return; // Successfully deleted
      } catch (error) {
        // File doesn't exist with this extension, try next
        continue;
      }
    }

    throw new FileOperationError('delete', name, 'file not found in src directory');
  }

  /**
   * Clear all files from local src directory
   */
  static async clearLocalFiles(workingDir: string = process.cwd()): Promise<void> {
    const srcPath = path.join(workingDir, this.SRC_DIR);
    
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
  static async ensureSrcDirectory(workingDir: string = process.cwd()): Promise<string> {
    const srcPath = path.join(workingDir, this.SRC_DIR);
    await fs.mkdir(srcPath, { recursive: true });
    return srcPath;
  }

  /**
   * Get src directory path
   */
  static getSrcDirectory(workingDir: string = process.cwd()): string {
    return path.join(workingDir, this.SRC_DIR);
  }

  /**
   * Check if src directory exists and has files
   */
  static async hasSrcFiles(workingDir: string = process.cwd()): Promise<boolean> {
    const files = await this.getLocalFiles(workingDir);
    return files.length > 0;
  }
} 