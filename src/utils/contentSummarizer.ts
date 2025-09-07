/**
 * Content summarizer for context-aware tools
 * Provides rule-based content processing and token optimization
 */

import { GASFile } from './grepEngine.js';
import { ContentMode } from './schemaPatterns.js';

export interface SummaryOptions {
  mode: ContentMode;
  tokenBudget?: number;
  maxLines?: number;
  includeMetadata?: boolean;
}

export interface ContentSummary {
  mode: ContentMode;
  originalSize: number;
  summarySize: number;
  tokenEstimate: number;
  compressionRatio: number;
  content: string;
  metadata?: {
    functions: string[];
    exports: string[];
    imports: string[];
    classes: string[];
    totalLines: number;
    codeLines: number;
    commentLines: number;
  };
}

// Token estimation constants
const CHARS_PER_TOKEN = 3.5;
const MAX_LINE_LENGTH = 200;

/**
 * Rule-based content summarizer using pattern matching and heuristics
 */
export class ContentSummarizer {
  
  /**
   * Summarize file content based on specified mode
   */
  static summarizeContent(
    file: GASFile, 
    options: SummaryOptions
  ): ContentSummary {
    const originalContent = file.source || '';
    const originalSize = originalContent.length;
    
    let processedContent: string;
    let metadata: ContentSummary['metadata'];
    
    // Extract metadata if requested or for certain modes
    if (options.includeMetadata || 
        ['signatures', 'exports', 'structure'].includes(options.mode)) {
      metadata = this.extractMetadata(originalContent);
    }
    
    // Ensure metadata exists for modes that need it
    if (['summary', 'signatures', 'exports', 'structure'].includes(options.mode) && !metadata) {
      metadata = this.extractMetadata(originalContent);
    }
    
    // Process content based on mode
    switch (options.mode) {
      case 'full':
        processedContent = this.processFullContent(originalContent, options);
        break;
      case 'summary':
        processedContent = this.createSummary(originalContent, metadata!, options);
        break;
      case 'signatures':
        processedContent = this.extractSignatures(originalContent, metadata!);
        break;
      case 'exports':
        processedContent = this.extractExports(originalContent, metadata!);
        break;
      case 'structure':
        processedContent = this.extractStructure(originalContent, metadata!);
        break;
      default:
        if (!metadata) metadata = this.extractMetadata(originalContent);
        processedContent = this.createSummary(originalContent, metadata!, options);
    }
    
    const summarySize = processedContent.length;
    const tokenEstimate = Math.ceil(summarySize / CHARS_PER_TOKEN);
    const compressionRatio = originalSize > 0 ? summarySize / originalSize : 1;
    
    return {
      mode: options.mode,
      originalSize,
      summarySize,
      tokenEstimate,
      compressionRatio,
      content: processedContent,
      metadata
    };
  }
  
  /**
   * Extract code metadata using pattern matching
   */
  private static extractMetadata(content: string): ContentSummary['metadata'] {
    const lines = content.split('\n');
    const functions: string[] = [];
    const exports: string[] = [];
    const imports: string[] = [];
    const classes: string[] = [];
    let codeLines = 0;
    let commentLines = 0;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (!trimmed) continue;
      
      // Count comment lines
      if (trimmed.startsWith('//') || 
          trimmed.startsWith('/*') || 
          trimmed.startsWith('*') ||
          trimmed.startsWith('*/')) {
        commentLines++;
        continue;
      }
      
      codeLines++;
      
      // Extract function declarations
      const functionMatch = trimmed.match(/(?:function\s+|const\s+|let\s+|var\s+)(\w+)\s*(?:=\s*(?:function|async\s+function|\([^)]*\)\s*=>)|\([^)]*\))/);
      if (functionMatch) {
        functions.push(functionMatch[1]);
      }
      
      // Extract class declarations
      const classMatch = trimmed.match(/class\s+(\w+)/);
      if (classMatch) {
        classes.push(classMatch[1]);
      }
      
      // Extract exports
      const exportMatch = trimmed.match(/(?:export\s+(?:default\s+)?(?:function\s+|class\s+|const\s+|let\s+|var\s+)?(\w+)|module\.exports\.(\w+)|exports\.(\w+))/);
      if (exportMatch) {
        const exportName = exportMatch[1] || exportMatch[2] || exportMatch[3];
        if (exportName) exports.push(exportName);
      }
      
      // Extract imports/requires
      const importMatch = trimmed.match(/(?:import\s+.*?from\s+['"](.*?)['"]|require\s*\(\s*['"](.*?)['"]\s*\))/);
      if (importMatch) {
        const importName = importMatch[1] || importMatch[2];
        if (importName) imports.push(importName);
      }
    }
    
    return {
      functions: [...new Set(functions)],
      exports: [...new Set(exports)],
      imports: [...new Set(imports)],
      classes: [...new Set(classes)],
      totalLines: lines.length,
      codeLines,
      commentLines
    };
  }
  
  /**
   * Process full content with optional truncation
   */
  private static processFullContent(content: string, options: SummaryOptions): string {
    if (!options.tokenBudget) return content;
    
    const maxChars = options.tokenBudget * CHARS_PER_TOKEN;
    if (content.length <= maxChars) return content;
    
    // Truncate intelligently at line boundaries
    const lines = content.split('\n');
    let processedContent = '';
    
    for (const line of lines) {
      if (processedContent.length + line.length + 1 > maxChars) break;
      processedContent += line + '\n';
    }
    
    processedContent += '\n... (content truncated to fit token budget)';
    return processedContent;
  }
  
  /**
   * Create intelligent summary of content
   */
  private static createSummary(
    content: string, 
    metadata: NonNullable<ContentSummary['metadata']>, 
    options: SummaryOptions
  ): string {
    const lines = content.split('\n');
    const summary: string[] = [];
    
    // Add file overview
    summary.push(`📄 File Overview (${metadata.totalLines} lines, ${metadata.codeLines} code, ${metadata.commentLines} comments)`);
    
    // Add imports section
    if (metadata.imports.length > 0) {
      summary.push('\n🔗 Dependencies:');
      metadata.imports.forEach(imp => summary.push(`  • ${imp}`));
    }
    
    // Add exports section
    if (metadata.exports.length > 0) {
      summary.push('\n📤 Exports:');
      metadata.exports.forEach(exp => summary.push(`  • ${exp}`));
    }
    
    // Add classes section
    if (metadata.classes.length > 0) {
      summary.push('\n🏗️ Classes:');
      metadata.classes.forEach(cls => summary.push(`  • ${cls}`));
    }
    
    // Add functions section
    if (metadata.functions.length > 0) {
      summary.push('\n⚡ Functions:');
      metadata.functions.forEach(func => summary.push(`  • ${func}`));
    }
    
    // Add key code sections (first few lines of important functions)
    summary.push('\n🔍 Key Code Sections:');
    let addedSections = 0;
    const maxSections = 3;
    
    for (let i = 0; i < lines.length && addedSections < maxSections; i++) {
      const line = lines[i].trim();
      
      // Look for function/class definitions
      if (line.match(/(?:function\s+\w+|class\s+\w+|const\s+\w+\s*=\s*(?:function|async|\([^)]*\)\s*=>))/)) {
        summary.push(`\n${line}`);
        
        // Add next few relevant lines
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          const nextLine = lines[j].trim();
          if (nextLine && !nextLine.startsWith('//')) {
            summary.push(`${nextLine}`);
          }
        }
        addedSections++;
      }
    }
    
    const result = summary.join('\n');
    
    // Truncate if exceeds token budget
    if (options.tokenBudget) {
      const maxChars = options.tokenBudget * CHARS_PER_TOKEN;
      if (result.length > maxChars) {
        return result.substring(0, maxChars - 50) + '\n... (summary truncated)';
      }
    }
    
    return result;
  }
  
  /**
   * Extract function and method signatures
   */
  private static extractSignatures(content: string, metadata: NonNullable<ContentSummary['metadata']>): string {
    const lines = content.split('\n');
    const signatures: string[] = [];
    
    signatures.push('🔧 Function Signatures:');
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Match function declarations
      const functionMatch = trimmed.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)|const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>|(\w+)\s*:\s*(?:async\s+)?\([^)]*\)\s*=>/);
      if (functionMatch) {
        const funcName = functionMatch[1] || functionMatch[2] || functionMatch[3];
        signatures.push(`  • ${trimmed}`);
        continue;
      }
      
      // Match class methods
      const methodMatch = trimmed.match(/(?:async\s+)?(\w+)\s*\([^)]*\)\s*{/);
      if (methodMatch) {
        signatures.push(`  • ${trimmed.replace(/\s*{.*$/, '')}`);
      }
    }
    
    if (signatures.length === 1) {
      signatures.push('  (No function signatures found)');
    }
    
    return signatures.join('\n');
  }
  
  /**
   * Extract exports and public API
   */
  private static extractExports(content: string, metadata: NonNullable<ContentSummary['metadata']>): string {
    const exports: string[] = [];
    
    exports.push('📤 Exported Interface:');
    
    if (metadata.exports.length > 0) {
      metadata.exports.forEach(exp => {
        exports.push(`  • ${exp}`);
      });
    } else {
      exports.push('  (No exports found)');
    }
    
    // Add module.exports or export statements context
    const lines = content.split('\n');
    const exportLines: string[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.includes('module.exports') || 
          trimmed.includes('exports.') || 
          trimmed.startsWith('export ')) {
        exportLines.push(`    ${trimmed}`);
      }
    }
    
    if (exportLines.length > 0) {
      exports.push('\n📋 Export Statements:');
      exports.push(...exportLines);
    }
    
    return exports.join('\n');
  }
  
  /**
   * Extract high-level code structure
   */
  private static extractStructure(content: string, metadata: NonNullable<ContentSummary['metadata']>): string {
    const structure: string[] = [];
    
    structure.push('🏗️ Code Structure:');
    
    // File stats
    structure.push(`\n📊 File Statistics:`);
    structure.push(`  • Total lines: ${metadata.totalLines}`);
    structure.push(`  • Code lines: ${metadata.codeLines}`);
    structure.push(`  • Comment lines: ${metadata.commentLines}`);
    
    // Dependencies
    if (metadata.imports.length > 0) {
      structure.push(`\n📦 Dependencies (${metadata.imports.length}):`);
      metadata.imports.slice(0, 5).forEach(imp => structure.push(`  • ${imp}`));
      if (metadata.imports.length > 5) {
        structure.push(`  ... and ${metadata.imports.length - 5} more`);
      }
    }
    
    // Main components
    if (metadata.classes.length > 0) {
      structure.push(`\n🏛️ Classes (${metadata.classes.length}):`);
      metadata.classes.forEach(cls => structure.push(`  • ${cls}`));
    }
    
    if (metadata.functions.length > 0) {
      structure.push(`\n⚙️ Functions (${metadata.functions.length}):`);
      metadata.functions.slice(0, 10).forEach(func => structure.push(`  • ${func}`));
      if (metadata.functions.length > 10) {
        structure.push(`  ... and ${metadata.functions.length - 10} more`);
      }
    }
    
    // Public interface
    if (metadata.exports.length > 0) {
      structure.push(`\n🌐 Public Interface (${metadata.exports.length}):`);
      metadata.exports.forEach(exp => structure.push(`  • ${exp}`));
    }
    
    return structure.join('\n');
  }
  
  /**
   * Batch summarize multiple files with token budget management
   */
  static batchSummarize(
    files: GASFile[],
    options: SummaryOptions,
    globalTokenBudget?: number
  ): Map<string, ContentSummary> {
    const results = new Map<string, ContentSummary>();
    let totalTokens = 0;
    const budgetPerFile = globalTokenBudget ? Math.floor(globalTokenBudget / files.length) : options.tokenBudget;
    
    for (const file of files) {
      if (globalTokenBudget && totalTokens >= globalTokenBudget) break;
      
      const fileOptions: SummaryOptions = {
        ...options,
        tokenBudget: budgetPerFile
      };
      
      const summary = this.summarizeContent(file, fileOptions);
      results.set(file.name, summary);
      totalTokens += summary.tokenEstimate;
    }
    
    return results;
  }
  
  /**
   * Calculate optimal content mode based on file characteristics
   */
  static suggestContentMode(file: GASFile, tokenBudget?: number): ContentMode {
    const content = file.source || '';
    const lines = content.split('\n').length;
    const chars = content.length;
    
    // Small files - show full content
    if (chars < 1000 && lines < 50) {
      return 'full';
    }
    
    // Large files with tight token budget - show structure
    if (tokenBudget && chars > tokenBudget * CHARS_PER_TOKEN * 2) {
      return 'structure';
    }
    
    // API/module files - show exports
    if (content.includes('module.exports') || content.includes('export ')) {
      return 'exports';
    }
    
    // Function-heavy files - show signatures
    if ((content.match(/function\s+\w+/g) || []).length > 5) {
      return 'signatures';
    }
    
    // Default to summary
    return 'summary';
  }
}