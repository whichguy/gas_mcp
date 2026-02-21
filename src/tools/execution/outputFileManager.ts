// Manages response output files — cleanup + atomic write for large exec results
import * as fs from 'fs';
import * as path from 'path';
import { generateExecHints, ExecHints } from '../../utils/execHints.js';

/**
 * Output file management for large exec responses
 * Automatically writes to file when response exceeds threshold
 */
export const OUTPUT_FILE_DIR = '/tmp';
export const OUTPUT_FILE_PREFIX = 'mcp-gas-exec';
export const OUTPUT_SIZE_THRESHOLD = 8 * 1024; // 8KB threshold (~2K tokens) for auto-file output
export const OUTPUT_FILE_MAX_AGE_DAYS = 2;

/**
 * Clean up old output files (older than 2 days)
 * Called lazily on new file creation to avoid startup overhead
 */
export function cleanupOldOutputFiles(): void {
  try {
    const files = fs.readdirSync(OUTPUT_FILE_DIR);
    const now = Date.now();
    const maxAge = OUTPUT_FILE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (file.startsWith(OUTPUT_FILE_PREFIX)) {
        const filePath = path.join(OUTPUT_FILE_DIR, file);
        try {
          const stats = fs.statSync(filePath);
          if (now - stats.mtimeMs > maxAge) {
            fs.unlinkSync(filePath);
            console.error(`[OUTPUT CLEANUP] Removed old file: ${file}`);
          }
        } catch (err) {
          // Ignore errors for individual files
        }
      }
    }
  } catch (err) {
    // Ignore cleanup errors - non-critical
  }
}

/**
 * Write large response to file and return metadata
 * @param response - The full response object to write
 * @param content - Pre-serialized JSON content (to avoid double stringify)
 * @param scriptId - Script ID for filename
 * @returns Object with file path and metadata for LLM
 */
export function writeResponseToFileWithContent(
  response: any,
  content: string,
  scriptId: string
): {
  outputFile: string;
  resultSize: number;
  loggerLines: number;
  summary: string;
} {
  // Lazy cleanup of old files
  cleanupOldOutputFiles();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const shortScriptId = (scriptId || 'unknown').substring(0, 12);  // Guard against undefined/null
  const filename = `${OUTPUT_FILE_PREFIX}-${timestamp}-${shortScriptId}.json`;
  const filePath = path.join(OUTPUT_FILE_DIR, filename);

  fs.writeFileSync(filePath, content, 'utf-8');

  const resultSize = content.length;
  const loggerLines = (response.logger_output || '').split('\n').filter((l: string) => l.trim()).length;

  // Generate a brief summary of the result for the LLM
  let summary = '';
  if (response.status === 'success') {
    const resultType = typeof response.result;
    if (resultType === 'object' && response.result !== null) {
      if (Array.isArray(response.result)) {
        summary = `Array with ${response.result.length} items`;
      } else {
        const keys = Object.keys(response.result);
        summary = `Object with ${keys.length} keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}`;
      }
    } else {
      summary = `${resultType} value`;
    }
  } else {
    summary = `Error: ${response.error?.message || 'Unknown error'}`;
  }

  console.error(`[OUTPUT FILE] Large response (${(resultSize / 1024).toFixed(1)}KB) written to: ${filePath}`);

  return {
    outputFile: filePath,
    resultSize,
    loggerLines,
    summary
  };
}

/**
 * Wrap response with automatic file output for large responses
 * Combines size check and file writing to avoid double JSON.stringify
 *
 * @param response - The full response object
 * @param scriptId - Script ID for filename
 * @returns Either the original response or file metadata if too large
 */
export function wrapLargeResponse(response: any, scriptId: string): any {
  // Serialize once and check size
  let content: string;
  try {
    content = JSON.stringify(response, null, 2);
  } catch {
    // Non-serializable response, return as-is
    return response;
  }

  // Check if within threshold - return original response
  if (content.length <= OUTPUT_SIZE_THRESHOLD) {
    return response;
  }

  // Large response - try to write to file
  try {
    const fileInfo = writeResponseToFileWithContent(response, content, scriptId);

    // Generate hints for large output case
    const largeOutputHints = generateExecHints(
      response.status === 'success' ? 'success' : 'error',
      response.js_statement || '',
      response.result,
      response.logger_output || '',
      undefined,
      true,  // outputWrittenToFile
      response.environment
    );

    return {
      status: response.status,
      scriptId: response.scriptId,
      js_statement: response.js_statement,
      outputWrittenToFile: true,
      outputFile: fileInfo.outputFile,
      resultSize: fileInfo.resultSize,
      loggerLines: fileInfo.loggerLines,
      summary: fileInfo.summary,
      hint: `Response exceeded ${(OUTPUT_SIZE_THRESHOLD / 1024).toFixed(0)}KB (~${Math.round(OUTPUT_SIZE_THRESHOLD / 4)} tokens). Full result written to file. Use Read tool to access: ${fileInfo.outputFile}`,
      ...(Object.keys(largeOutputHints).length > 0 && { hints: largeOutputHints }),
      executedAt: response.executedAt,
      environment: response.environment,
      versionNumber: response.versionNumber,
      ide_url_hint: response.ide_url_hint  // Preserve ide_url_hint for debugging
    };
  } catch (err) {
    // File write failed - return original response with warning
    console.error(`[OUTPUT FILE] Failed to write large response: ${err}`);
    return {
      ...response,
      _fileWriteWarning: `Large response (${(content.length / 1024).toFixed(1)}KB) could not be written to file: ${err}`
    };
  }
}
