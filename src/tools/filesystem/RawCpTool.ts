import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { SCRIPT_ID_SCHEMA, ACCESS_TOKEN_SCHEMA } from './shared/schemas.js';

/**
 * Copy files exactly without CommonJS processing
 *
 * ⚠️ ADVANCED TOOL - Preserves all wrappers and system code
 * Use cp for development with module handling
 */
export class RawCpTool extends BaseFileSystemTool {
  public name = 'raw_cp';
  public description = '[FILE:RAW] Copy files exactly without CommonJS processing. Preserves all wrappers and system code. Use instead of cp when you need to see/edit the CommonJS _main() wrapper.';

  public inputSchema = {
    type: 'object',
    properties: {
      sourceScriptId: {
        ...SCRIPT_ID_SCHEMA,
        description: 'Source Google Apps Script project ID (44 characters) to copy files FROM'
      },
      destinationScriptId: {
        ...SCRIPT_ID_SCHEMA,
        description: 'Destination Google Apps Script project ID (44 characters) to copy files TO'
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
        ...ACCESS_TOKEN_SCHEMA
      }
    },
    required: ['sourceScriptId', 'destinationScriptId'],
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'bulk copy between projects without CommonJS processing',
      workflow: 'raw_cp({sourceScriptId:"...",destinationScriptId:"..."})',
      preservesWrappers: 'copies exact→preserves all wrappers+system code',
      examples: ['all: raw_cp({sourceScriptId:"1abc2def...",destinationScriptId:"1xyz9abc..."})', 'specific: raw_cp({sourceScriptId:"1abc2def...",destinationScriptId:"1xyz9abc...",includeFiles:["Utils","Config"]})', 'exclude: raw_cp({sourceScriptId:"1abc2def...",destinationScriptId:"1xyz9abc...",excludeFiles:["Test","Debug"]})', 'overwrite: raw_cp({sourceScriptId:"1abc2def...",destinationScriptId:"1xyz9abc...",mergeStrategy:"overwrite-destination"})', 'dry run: raw_cp({sourceScriptId:"1abc2def...",destinationScriptId:"1xyz9abc...",dryRun:true})'],
      mergeStrategies: {'preserve-destination': 'keep dest (default)', 'overwrite-destination': 'replace with source', 'skip-conflicts': 'only new files'}
    }
  };

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
          file.type as 'SERVER_JS' | 'HTML' | 'JSON'
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
