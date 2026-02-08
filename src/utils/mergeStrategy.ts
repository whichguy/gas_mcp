/**
 * Merge Strategy Utilities for Git-GAS Integration
 * 
 * Provides three-way merge capabilities for reconciling differences between
 * Git repository, local cache, and Google Apps Script project files.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { execGitCommandWithStderr } from './gitCommands.js';

/**
 * Conflict information for a file
 */
export interface ConflictInfo {
  line: number;
  gitContent: string;
  localContent: string;
  gasContent: string;
  resolution?: string;
}

/**
 * File version information for merging
 */
export interface FileVersion {
  path: string;
  content: string;
  exists: boolean;
  lastModified?: Date;
}

/**
 * Merge result with conflict information
 */
export interface MergeResult {
  content: string;
  hasConflicts: boolean;
  conflicts: ConflictInfo[];
  merged: boolean;
}

/**
 * Merge strategy options
 */
export type MergeStrategyType = 'ours' | 'theirs' | 'gas-wins' | 'git-wins' | 'manual' | 'auto';

/**
 * Utility class for handling file merges in Git-GAS integration
 */
export class MergeStrategy {
  
  /**
   * Perform a three-way merge between Git, local cache, and GAS versions
   * 
   * @param gitVersion - Version from Git repository
   * @param localVersion - Version in local cache
   * @param gasVersion - Version from Google Apps Script
   * @param strategy - Merge strategy to apply
   * @returns Merged content with conflict information
   */
  static async mergeThreeWay(
    gitVersion: FileVersion,
    localVersion: FileVersion,
    gasVersion: FileVersion,
    strategy: MergeStrategyType = 'auto'
  ): Promise<MergeResult> {
    
    // Handle simple cases first
    if (!gitVersion.exists && !localVersion.exists && !gasVersion.exists) {
      return { content: '', hasConflicts: false, conflicts: [], merged: true };
    }
    
    // If only one version exists, use it
    const existingVersions = [gitVersion, localVersion, gasVersion].filter(v => v.exists);
    if (existingVersions.length === 1) {
      return { 
        content: existingVersions[0].content, 
        hasConflicts: false, 
        conflicts: [], 
        merged: true 
      };
    }
    
    // Check if all versions are identical
    if (gitVersion.content === localVersion.content && localVersion.content === gasVersion.content) {
      return { 
        content: gitVersion.content, 
        hasConflicts: false, 
        conflicts: [], 
        merged: true 
      };
    }
    
    // Apply strategy-based resolution
    switch (strategy) {
      case 'ours':
        // Local cache wins
        return { 
          content: localVersion.content, 
          hasConflicts: false, 
          conflicts: [], 
          merged: true 
        };
        
      case 'theirs':
        // Git version wins
        return { 
          content: gitVersion.content, 
          hasConflicts: false, 
          conflicts: [], 
          merged: true 
        };
        
      case 'gas-wins':
        // GAS version wins (source of truth)
        return { 
          content: gasVersion.content, 
          hasConflicts: false, 
          conflicts: [], 
          merged: true 
        };
        
      case 'git-wins':
        // Git version wins over GAS
        return { 
          content: gitVersion.content, 
          hasConflicts: false, 
          conflicts: [], 
          merged: true 
        };
        
      case 'auto':
        // Intelligent merge based on timestamps and content
        return await this.autoMerge(gitVersion, localVersion, gasVersion);
        
      case 'manual':
        // Create conflict markers for manual resolution
        return this.createConflictMarkers(gitVersion, localVersion, gasVersion);
        
      default:
        throw new Error(`Unknown merge strategy: ${strategy}`);
    }
  }
  
  /**
   * Perform automatic merge based on content analysis
   */
  private static async autoMerge(
    gitVersion: FileVersion,
    localVersion: FileVersion,
    gasVersion: FileVersion
  ): Promise<MergeResult> {
    
    // If GAS and Git are the same, local has diverged
    if (gitVersion.content === gasVersion.content && localVersion.content !== gitVersion.content) {
      // Local has changes, preserve them
      return { 
        content: localVersion.content, 
        hasConflicts: false, 
        conflicts: [], 
        merged: true 
      };
    }
    
    // If Local and Git are the same, GAS has diverged
    if (localVersion.content === gitVersion.content && gasVersion.content !== gitVersion.content) {
      // GAS has changes, use them (GAS is source of truth)
      return { 
        content: gasVersion.content, 
        hasConflicts: false, 
        conflicts: [], 
        merged: true 
      };
    }
    
    // If Local and GAS are the same, Git has diverged
    if (localVersion.content === gasVersion.content && gitVersion.content !== gasVersion.content) {
      // Git has changes, merge them
      return { 
        content: gitVersion.content, 
        hasConflicts: false, 
        conflicts: [], 
        merged: true 
      };
    }
    
    // All three are different - attempt line-by-line merge
    return await this.lineByLineMerge(gitVersion, localVersion, gasVersion);
  }
  
  /**
   * Perform line-by-line merge for complex conflicts
   */
  private static async lineByLineMerge(
    gitVersion: FileVersion,
    localVersion: FileVersion,
    gasVersion: FileVersion
  ): Promise<MergeResult> {
    
    const gitLines = gitVersion.content.split('\n');
    const localLines = localVersion.content.split('\n');
    const gasLines = gasVersion.content.split('\n');
    
    const mergedLines: string[] = [];
    const conflicts: ConflictInfo[] = [];
    let hasConflicts = false;
    
    const maxLines = Math.max(gitLines.length, localLines.length, gasLines.length);
    
    for (let i = 0; i < maxLines; i++) {
      const gitLine = gitLines[i] || '';
      const localLine = localLines[i] || '';
      const gasLine = gasLines[i] || '';
      
      // If all three are the same, use it
      if (gitLine === localLine && localLine === gasLine) {
        mergedLines.push(gitLine);
      }
      // If two are the same, use the different one (it has changes)
      else if (gitLine === localLine) {
        mergedLines.push(gasLine); // GAS has changes
      }
      else if (gitLine === gasLine) {
        mergedLines.push(localLine); // Local has changes
      }
      else if (localLine === gasLine) {
        mergedLines.push(gitLine); // Git has changes
      }
      // All three are different - conflict
      else {
        hasConflicts = true;
        conflicts.push({
          line: i + 1,
          gitContent: gitLine,
          localContent: localLine,
          gasContent: gasLine
        });
        
        // For auto mode, prefer GAS (source of truth)
        mergedLines.push(gasLine);
      }
    }
    
    return {
      content: mergedLines.join('\n'),
      hasConflicts,
      conflicts,
      merged: true
    };
  }
  
  /**
   * Create conflict markers for manual resolution
   */
  private static createConflictMarkers(
    gitVersion: FileVersion,
    localVersion: FileVersion,
    gasVersion: FileVersion
  ): Promise<MergeResult> {
    
    const conflictContent = `<<<<<<< GAS (Source of Truth)
${gasVersion.content}
||||||| LOCAL (Cache)
${localVersion.content}
======= GIT (Repository)
${gitVersion.content}
>>>>>>> GIT`;
    
    return Promise.resolve({
      content: conflictContent,
      hasConflicts: true,
      conflicts: [{
        line: 1,
        gitContent: gitVersion.content,
        localContent: localVersion.content,
        gasContent: gasVersion.content
      }],
      merged: false
    });
  }
  
  /**
   * Detect conflicts between two file versions
   */
  static async detectConflicts(
    file1: FileVersion,
    file2: FileVersion
  ): Promise<ConflictInfo[]> {
    
    if (file1.content === file2.content) {
      return [];
    }
    
    const lines1 = file1.content.split('\n');
    const lines2 = file2.content.split('\n');
    const conflicts: ConflictInfo[] = [];
    
    const maxLines = Math.max(lines1.length, lines2.length);
    
    for (let i = 0; i < maxLines; i++) {
      const line1 = lines1[i] || '';
      const line2 = lines2[i] || '';
      
      if (line1 !== line2) {
        conflicts.push({
          line: i + 1,
          gitContent: line1,
          localContent: line2,
          gasContent: ''
        });
      }
    }
    
    return conflicts;
  }
  
  /**
   * Try to use git's merge capabilities if available
   */
  static async gitMerge(
    baseFile: string,
    oursFile: string,
    theirsFile: string
  ): Promise<MergeResult> {
    try {
      // Use git merge-file for three-way merge
      // SECURITY: Use spawn with array args to prevent shell injection
      const { stdout, stderr } = await execGitCommandWithStderr(
        ['merge-file', '-p', oursFile, baseFile, theirsFile],
        process.cwd()
      );

      const hasConflicts = stderr.includes('conflicts');
      
      return {
        content: stdout,
        hasConflicts,
        conflicts: [],
        merged: true
      };
    } catch (error: any) {
      // Git merge failed, fall back to manual merge
      const ours = await fs.readFile(oursFile, 'utf-8');
      const theirs = await fs.readFile(theirsFile, 'utf-8');
      const base = await fs.readFile(baseFile, 'utf-8');
      
      return this.mergeThreeWay(
        { path: theirsFile, content: theirs, exists: true },
        { path: oursFile, content: ours, exists: true },
        { path: baseFile, content: base, exists: true },
        'manual'
      );
    }
  }
  
  /**
   * Check if content has conflict markers
   */
  static hasConflictMarkers(content: string): boolean {
    return content.includes('<<<<<<<') && 
           content.includes('=======') && 
           content.includes('>>>>>>>');
  }
  
  /**
   * Remove conflict markers and accept one side
   */
  static resolveConflictMarkers(content: string, accept: 'ours' | 'theirs'): string {
    const lines = content.split('\n');
    const resolved: string[] = [];
    let inConflict = false;
    let inOurs = false;
    let inTheirs = false;
    
    for (const line of lines) {
      if (line.startsWith('<<<<<<<')) {
        inConflict = true;
        inOurs = true;
        continue;
      }
      if (line.startsWith('|||||||')) {
        inOurs = false;
        continue;
      }
      if (line.startsWith('=======')) {
        inOurs = false;
        inTheirs = true;
        continue;
      }
      if (line.startsWith('>>>>>>>')) {
        inConflict = false;
        inTheirs = false;
        continue;
      }
      
      if (!inConflict) {
        resolved.push(line);
      } else if (accept === 'ours' && inOurs) {
        resolved.push(line);
      } else if (accept === 'theirs' && inTheirs) {
        resolved.push(line);
      }
    }
    
    return resolved.join('\n');
  }
}

/**
 * Helper class for managing merge sessions
 */
export class MergeSession {
  private tempDir: string;
  private fileVersions: Map<string, { git: FileVersion, local: FileVersion, gas: FileVersion }>;
  
  constructor(tempDir: string) {
    this.tempDir = tempDir;
    this.fileVersions = new Map();
  }
  
  /**
   * Add file versions for merging
   */
  async addFile(fileName: string, gitContent: string, localContent: string, gasContent: string) {
    this.fileVersions.set(fileName, {
      git: { path: fileName, content: gitContent, exists: true },
      local: { path: fileName, content: localContent, exists: true },
      gas: { path: fileName, content: gasContent, exists: true }
    });
  }
  
  /**
   * Perform merge for all files
   */
  async mergeAll(strategy: MergeStrategyType): Promise<Map<string, MergeResult>> {
    const results = new Map<string, MergeResult>();
    
    for (const [fileName, versions] of this.fileVersions) {
      const result = await MergeStrategy.mergeThreeWay(
        versions.git,
        versions.local,
        versions.gas,
        strategy
      );
      results.set(fileName, result);
    }
    
    return results;
  }
  
  /**
   * Clean up temporary files
   */
  async cleanup() {
    try {
      await fs.rm(this.tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Failed to clean up temp dir: ${this.tempDir}`);
    }
  }
}