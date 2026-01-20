/**
 * GitFormatTranslator - Handles translation between native git formats and GAS CommonJS modules
 *
 * Supports bidirectional conversion of git configuration files while preserving
 * their native formats (INI, gitignore, attributes, etc.)
 */

import * as GitUtils from './GitUtilities.js';

export interface GitFileFormat {
  format: 'ini' | 'gitignore' | 'attributes' | 'ref' | 'json' | 'script' | 'text';
  raw: string;
  parsed?: any;
  gitPath?: string;
}

export class GitFormatTranslator {
  /**
   * Check if a file is inside a .git/ folder
   * @deprecated Use GitUtils.isGitConfigFile() instead
   */
  static isGitConfigFile(filename: string): boolean {
    return GitUtils.isGitConfigFile(filename);
  }

  /**
   * Extract the git file path relative to .git/ folder
   * @deprecated Use GitUtils.getGitRelativePath() instead
   */
  static getGitRelativePath(filename: string): string | null {
    return GitUtils.getGitRelativePath(filename);
  }

  /**
   * Get the project prefix (everything before .git/)
   * @deprecated Use GitUtils.getProjectPrefix() instead
   */
  static getProjectPrefix(filename: string): string | null {
    return GitUtils.getProjectPrefix(filename);
  }

  /**
   * Detect format based on git-relative path
   * @deprecated Use GitUtils.detectGitFileFormat() instead
   */
  static detectFormat(gitRelativePath: string): GitFileFormat['format'] {
    return GitUtils.detectGitFileFormat(gitRelativePath);
  }

  /**
   * Convert native git format to GAS CommonJS module
   */
  static toGAS(content: string, gasPath: string): string {
    const gitPath = this.getGitRelativePath(gasPath);
    if (!gitPath) {
      throw new Error(`Invalid git file path: ${gasPath}`);
    }
    
    const format = this.detectFormat(gitPath);
    
    // Include parser functions if needed
    let parserFunctions = '';
    if (format === 'ini') {
      parserFunctions = this.getINIParserFunction();
    } else if (format === 'attributes') {
      parserFunctions = this.getAttributesParserFunction();
    } else if (format === 'ref') {
      parserFunctions = this.getRefParserFunction();
    }
    
    return `function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  require = globalThis.require
) {
  // Git file: ${gitPath}
  const RAW_CONTENT = ${JSON.stringify(content)};
  
  ${parserFunctions}
  
  module.exports = {
    raw: RAW_CONTENT,
    parsed: ${this.generateParser(format, 'RAW_CONTENT')},
    format: '${format}',
    gitPath: '${gitPath}'
  };
}
__defineModule__(_main);`;
  }

  /**
   * Extract native git format from GAS module
   */
  static fromGAS(gasContent: string): string {
    if (!gasContent) return '';

    // First unwrap CommonJS if present
    const unwrapped = this.unwrapCommonJS(gasContent);

    // Look for raw content in various formats
    // IMPORTANT: Patterns must handle escaped quotes within the string
    // The pattern `(?:[^"\\]|\\.)*` matches: any char except " or \, OR a backslash followed by any char
    const patterns = [
      // RAW_CONTENT = "..." with proper escape handling
      /RAW_CONTENT\s*=\s*"((?:[^"\\]|\\.)*)"/s,
      // raw: "..." with proper escape handling
      /raw:\s*"((?:[^"\\]|\\.)*)"/s,
      // Template literal versions (backtick strings don't need escape handling for quotes)
      /RAW_CONTENT\s*=\s*`([^`]*)`/s,
      /raw:\s*`([^`]*)`/s,
      // Single quote versions with escape handling
      /RAW_CONTENT\s*=\s*'((?:[^'\\]|\\.)*)'/s,
      /raw:\s*'((?:[^'\\]|\\.)*)'/s,
      // Backward compat: simple module.exports = "..." (legacy format)
      /^module\.exports\s*=\s*"((?:[^"\\]|\\.)*)"\s*;?\s*$/s,
      /module\.exports\s*=\s*"((?:[^"\\]|\\.)*)"\s*;?\s*$/s
    ];

    for (const pattern of patterns) {
      const match = unwrapped.match(pattern);
      if (match && match[1]) {
        try {
          // Try to parse as JSON string (handles escaping like \n, \t, \", etc.)
          return JSON.parse('"' + match[1] + '"');
        } catch {
          // Return as-is if not valid JSON string
          return match[1];
        }
      }
    }

    // Fallback: return the unwrapped content
    return unwrapped;
  }

  /**
   * Unwrap CommonJS module wrapper
   * @deprecated Use GitUtils.unwrapCommonJSModule() instead
   */
  private static unwrapCommonJS(source: string): string {
    return GitUtils.unwrapCommonJSModule(source);
  }

  /**
   * Generate parser code based on format
   */
  private static generateParser(format: string, varName: string): string {
    switch (format) {
      case 'ini':
        return `parseINI(${varName})`;
      case 'gitignore':
        return `${varName}.split('\\n').filter(line => line.trim() && !line.startsWith('#'))`;
      case 'attributes':
        return `parseAttributes(${varName})`;
      case 'json':
        return `JSON.parse(${varName})`;
      case 'ref':
        return `parseRef(${varName})`;
      case 'script':
        return 'null /* script content */';
      default:
        return 'null';
    }
  }
  
  /**
   * Get INI parser function code
   */
  private static getINIParserFunction(): string {
    return `function parseINI(content) {
    const result = {};
    let currentSection = '';
    let currentSubsection = '';
    
    const lines = content.split('\\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
        continue;
      }
      
      const sectionMatch = trimmed.match(/^\\[([^\\]]+)\\]$/);
      if (sectionMatch) {
        const sectionContent = sectionMatch[1].trim();
        const subsectionMatch = sectionContent.match(/^(\\S+)\\s+"([^"]+)"$/);
        if (subsectionMatch) {
          currentSection = subsectionMatch[1];
          currentSubsection = subsectionMatch[2];
          if (!result[currentSection]) result[currentSection] = {};
          if (!result[currentSection][currentSubsection]) result[currentSection][currentSubsection] = {};
        } else {
          currentSection = sectionContent;
          currentSubsection = '';
          if (!result[currentSection]) result[currentSection] = {};
        }
        continue;
      }
      
      const kvMatch = trimmed.match(/^([^=]+)=(.*)$/);
      if (kvMatch && currentSection) {
        const key = kvMatch[1].trim();
        let value = kvMatch[2].trim();
        
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        
        if (currentSubsection) {
          result[currentSection][currentSubsection][key] = value;
        } else {
          result[currentSection][key] = value;
        }
      }
    }
    
    return result;
  }`;
  }
  
  /**
   * Get attributes parser function code
   */
  private static getAttributesParserFunction(): string {
    return `function parseAttributes(content) {
    const lines = content.split('\\n').filter(line => line.trim() && !line.startsWith('#'));
    return lines.map(line => {
      const parts = line.trim().split(/\\s+/);
      return {
        pattern: parts[0],
        attributes: parts.slice(1)
      };
    });
  }`;
  }
  
  /**
   * Get ref parser function code
   */
  private static getRefParserFunction(): string {
    return `function parseRef(content) {
    const trimmed = content.trim();
    if (trimmed.startsWith('ref:')) {
      return { type: 'ref', target: trimmed.substring(4).trim() };
    }
    return { type: 'commit', sha: trimmed };
  }`;
  }
}