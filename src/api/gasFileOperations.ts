/**
 * File Operations Module
 *
 * This module handles all file-level operations for Google Apps Script API:
 * - Update project content (multiple files)
 * - Update/create single file
 * - Delete file
 * - Reorder files for execution
 *
 * Extracted from gasClient.ts for better modularity and maintainability.
 */

import { GASAuthOperations } from './gasAuthOperations.js';
import { GASFile } from './gasTypes.js';
import { getFileType } from './pathParser.js';
import { GASApiError } from '../errors/mcpErrors.js';

/**
 * File Operations class
 * Manages Google Apps Script file-level operations
 */
export class GASFileOperations {
  private authOps: GASAuthOperations;

  constructor(authOps: GASAuthOperations) {
    this.authOps = authOps;
  }

  /**
   * Update project content
   */
  async updateProjectContent(scriptId: string, files: GASFile[], accessToken?: string): Promise<GASFile[]> {
    await this.authOps.initializeClient(accessToken);

    return this.authOps.makeApiCall(async () => {
      const scriptApi = this.authOps.getScriptApi();

      // Let Google Apps Script API be the authority for validation
      // Remove arbitrary client-side limits and let the API return its own errors

      console.error(`📤 [GAS_API] Sending ${files.length} files in order:`);
      files.forEach((f, i) => console.error(`  ${i}: ${f.name} (${f.type})`));

      const response = await scriptApi.projects.updateContent({
        scriptId,
        requestBody: {
          files: files.map(file => ({
            name: file.name,
            type: file.type,
            source: file.source,
            // ✅ Preserve metadata to maintain file history and ordering
            ...(file.createTime && { createTime: file.createTime }),
            ...(file.updateTime && { updateTime: file.updateTime }),
            ...(file.lastModifyUser && { lastModifyUser: file.lastModifyUser })
          }))
        }
      });

      const returnedFiles = response.data.files || [];
      console.error(`📥 [GAS_API] Received ${returnedFiles.length} files in order:`);
      returnedFiles.forEach((f: any, i: number) => console.error(`  ${i}: ${f.name} (${f.type})`));

      return returnedFiles;
    }, accessToken);
  }

  /**
   * Create or update a single file
   */
  async updateFile(
    scriptId: string,
    fileName: string,
    content: string,
    position?: number,
    accessToken?: string,
    explicitType?: 'SERVER_JS' | 'HTML' | 'JSON',
    getProjectContentFn?: (scriptId: string, accessToken?: string) => Promise<GASFile[]>
  ): Promise<GASFile[]> {
    // Get current project content
    // Use injected function if provided, otherwise we need to import GASProjectOperations
    if (!getProjectContentFn) {
      throw new Error('getProjectContentFn must be provided to updateFile');
    }
    const currentFiles = await getProjectContentFn(scriptId, accessToken);

    // ✅ PRIORITY SYSTEM: 1) Explicit type, 2) Existing file type, 3) Extension detection
    let fileType: string;
    if (explicitType) {
      fileType = explicitType;
    } else {
      // Check if file already exists and preserve its type
      const existingFile = currentFiles.find(f => f.name === fileName);
      if (existingFile?.type) {
        fileType = existingFile.type;
      } else {
        // Fall back to extension detection
        fileType = getFileType(fileName);
      }
    }

    // Find existing file by exact name match ONLY
    const existingIndex = currentFiles.findIndex(f => f.name === fileName);

    const newFile: GASFile = {
      name: fileName, // ✅ Use exact fileName as provided
      type: fileType as any,
      source: content
    };

    let updatedFiles: GASFile[];

    if (existingIndex >= 0) {
      // Update existing file
      updatedFiles = [...currentFiles];

      // ✅ FIX: Honor position parameter even for existing files
      // If position is specified and different from current position, move the file
      if (position !== undefined && position >= 0 && position !== existingIndex && position < updatedFiles.length) {
        console.error(`🔄 [GAS_CLIENT] Moving ${fileName} from position ${existingIndex} to ${position}`);
        // Remove old file from current position FIRST (before updating)
        updatedFiles.splice(existingIndex, 1);
        // Insert new file at desired position
        updatedFiles.splice(position, 0, newFile);
        console.error(`✅ [GAS_CLIENT] File moved from ${existingIndex} to ${position}`);
      } else {
        // No position specified or same position - just update content in place
        updatedFiles[existingIndex] = newFile;
        if (position !== undefined) {
          console.error(`⚠️ [GAS_CLIENT] Position parameter ignored for ${fileName}: pos=${position}, existingIdx=${existingIndex}, len=${updatedFiles.length}`);
        }
      }
    } else {
      // Add new file
      updatedFiles = [...currentFiles];

      // Insert at specified position or append
      if (position !== undefined && position >= 0 && position < updatedFiles.length) {
        updatedFiles.splice(position, 0, newFile);
      } else {
        updatedFiles.push(newFile);
      }
    }

    // Update project with new file list
    return this.updateProjectContent(scriptId, updatedFiles, accessToken);
  }

  /**
   * Delete a file
   */
  async deleteFile(
    scriptId: string,
    fileName: string,
    accessToken?: string,
    getProjectContentFn?: (scriptId: string, accessToken?: string) => Promise<GASFile[]>
  ): Promise<GASFile[]> {
    // Get current project content
    if (!getProjectContentFn) {
      throw new Error('getProjectContentFn must be provided to deleteFile');
    }
    const currentFiles = await getProjectContentFn(scriptId, accessToken);
    const updatedFiles = currentFiles.filter(f => f.name !== fileName);

    if (updatedFiles.length === currentFiles.length) {
      throw new GASApiError(`File ${fileName} not found`, 404);
    }

    return this.updateProjectContent(scriptId, updatedFiles, accessToken);
  }

  /**
   * Reorder files for execution
   */
  async reorderFiles(
    scriptId: string,
    fileOrder: string[],
    accessToken?: string,
    getProjectContentFn?: (scriptId: string, accessToken?: string) => Promise<GASFile[]>
  ): Promise<GASFile[]> {
    // Get current project content
    if (!getProjectContentFn) {
      throw new Error('getProjectContentFn must be provided to reorderFiles');
    }
    const currentFiles = await getProjectContentFn(scriptId, accessToken);

    // Validate all files exist
    for (const fileName of fileOrder) {
      if (!currentFiles.find(f => f.name === fileName)) {
        throw new GASApiError(`File ${fileName} not found`, 404);
      }
    }

    // Reorder files according to specified order
    const orderedFiles: GASFile[] = [];

    // Add files in specified order
    for (const fileName of fileOrder) {
      const file = currentFiles.find(f => f.name === fileName)!;
      orderedFiles.push(file);
    }

    // Add any remaining files not in the order list
    for (const file of currentFiles) {
      if (!fileOrder.includes(file.name)) {
        orderedFiles.push(file);
      }
    }

    return this.updateProjectContent(scriptId, orderedFiles, accessToken);
  }
}
