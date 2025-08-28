/**
 * GitFormatTranslator - Handles translation between native git formats and GAS CommonJS modules
 * 
 * Supports bidirectional conversion of git configuration files while preserving
 * their native formats (INI, gitignore, attributes, etc.)
 */

export interface GitFileFormat {
  format: 'ini' | 'gitignore' | 'attributes' | 'ref' | 'json' | 'script' | 'text';
  raw: string;
  parsed?: any;
  gitPath?: string;
}

export class GitFormatTranslator {
  /**
   * Check if a file is inside a .git/ folder
   * Must have '.git/' in the path, and the file must be after it
   */
  static isGitConfigFile(filename: string): boolean {
    // Must contain '.git/' (not just 'git/')
    if (!filename.includes('.git/')) {
      return filename.startsWith('.git/');
    }
    
    // Ensure there's actual content after '.git/'
    const gitIndex = filename.lastIndexOf('.git/');
    const afterGit = filename.substring(gitIndex + 5); // 5 = '.git/'.length
    
    // Must have a filename after .git/ (not just '.git/' or '.git//')
    return afterGit.length > 0 && !afterGit.startsWith('/');
  }

  /**
   * Extract the git file path relative to .git/ folder
   * Only works for files actually inside .git/
   */
  static getGitRelativePath(filename: string): string | null {
    if (!this.isGitConfigFile(filename)) {
      return null;
    }
    
    const path = filename.replace(/\.gs$/, '');
    
    // Find the last occurrence of '.git/'
    const gitIndex = path.lastIndexOf('.git/');
    
    if (gitIndex === -1) {
      // Should not happen if isGitConfigFile returned true
      return null;
    }
    
    // Return everything after '.git/'
    return path.substring(gitIndex + 5);
  }

  /**
   * Get the project prefix (everything before .git/)
   */
  static getProjectPrefix(filename: string): string | null {
    if (!this.isGitConfigFile(filename)) {
      return null;
    }
    
    const gitIndex = filename.indexOf('.git/');
    
    if (gitIndex === 0) {
      // Root level .git/
      return '';
    }
    
    if (gitIndex > 0) {
      // Nested .git/ - return path before it
      return filename.substring(0, gitIndex).replace(/\/$/, '');
    }
    
    return null;
  }

  /**
   * Detect format based on git-relative path
   * Path must be relative to .git/ folder
   */
  static detectFormat(gitRelativePath: string): GitFileFormat['format'] {
    // gitRelativePath is already relative to .git/
    // e.g., 'config', 'info/exclude', 'hooks/pre-commit'
    
    if (gitRelativePath === 'config') return 'ini';
    if (gitRelativePath === 'HEAD') return 'ref';
    if (gitRelativePath === 'description') return 'text';
    if (gitRelativePath === 'info/exclude') return 'gitignore';
    if (gitRelativePath === 'info/attributes') return 'attributes';
    if (gitRelativePath.startsWith('hooks/')) return 'script';
    if (gitRelativePath.startsWith('refs/')) return 'ref';
    if (gitRelativePath.endsWith('.json')) return 'json';
    
    return 'text';
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
    const patterns = [
      /raw:\s*["'`]([^"'`]*?)["'`]/s,
      /raw:\s*`([^`]*?)`/s,
      /RAW_CONTENT\s*=\s*["'`]([^"'`]*?)["'`]/s,
      /RAW_CONTENT\s*=\s*`([^`]*?)`/s
    ];
    
    for (const pattern of patterns) {
      const match = unwrapped.match(pattern);
      if (match && match[1]) {
        try {
          // Try to parse as JSON string (handles escaping)
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
   */
  private static unwrapCommonJS(source: string): string {
    if (!source.includes('function _main(') || !source.includes('__defineModule__(_main)')) {
      return source;
    }
    
    // Extract content between function declaration and closing brace
    const match = source.match(/function _main\([^)]*\)\s*{([\s\S]*?)}\s*\n?\s*__defineModule__\(_main\);?/);
    return match ? match[1] : source;
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