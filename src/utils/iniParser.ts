/**
 * INI File Parser and Serializer
 * 
 * Handles parsing and serialization of INI-style configuration files
 * commonly used in git config files.
 */

/**
 * Parse INI format content into JavaScript object
 * Handles sections like [core], [remote "origin"], etc.
 */
export function parseINI(content: string): Record<string, any> {
  const result: Record<string, any> = {};
  let currentSection = '';
  let currentSubsection = '';
  
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
      continue;
    }
    
    // Section header [section] or [section "subsection"]
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const sectionContent = sectionMatch[1].trim();
      
      // Check for subsection like [remote "origin"]
      const subsectionMatch = sectionContent.match(/^(\S+)\s+"([^"]+)"$/);
      if (subsectionMatch) {
        currentSection = subsectionMatch[1];
        currentSubsection = subsectionMatch[2];
        
        if (!result[currentSection]) {
          result[currentSection] = {};
        }
        if (!result[currentSection][currentSubsection]) {
          result[currentSection][currentSubsection] = {};
        }
      } else {
        currentSection = sectionContent;
        currentSubsection = '';
        if (!result[currentSection]) {
          result[currentSection] = {};
        }
      }
      continue;
    }
    
    // Key-value pair
    const kvMatch = trimmed.match(/^([^=]+)=(.*)$/);
    if (kvMatch && currentSection) {
      const key = kvMatch[1].trim();
      let value: any = kvMatch[2].trim();
      
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      
      // Convert boolean strings
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      // Try to parse as number
      else if (/^\d+$/.test(value)) value = parseInt(value, 10);
      
      // Store in appropriate location
      if (currentSubsection) {
        result[currentSection][currentSubsection][key] = value;
      } else {
        result[currentSection][key] = value;
      }
    }
  }
  
  return result;
}

/**
 * Serialize JavaScript object to INI format
 */
export function serializeINI(obj: Record<string, any>): string {
  const lines: string[] = [];
  
  for (const [section, content] of Object.entries(obj)) {
    if (typeof content !== 'object' || content === null) {
      continue;
    }
    
    // Check if this is a subsection container
    const hasSubsections = Object.values(content).some(
      v => typeof v === 'object' && v !== null && !Array.isArray(v)
    );
    
    if (hasSubsections) {
      // Handle subsections like remote.origin
      for (const [subsection, values] of Object.entries(content)) {
        if (typeof values === 'object' && values !== null && !Array.isArray(values)) {
          lines.push(`[${section} "${subsection}"]`);
          for (const [key, value] of Object.entries(values)) {
            lines.push(`    ${key} = ${formatINIValue(value)}`);
          }
          lines.push('');
        } else {
          // Direct key-value under section
          lines.push(`[${section}]`);
          lines.push(`    ${subsection} = ${formatINIValue(values)}`);
        }
      }
    } else {
      // Simple section with key-value pairs
      lines.push(`[${section}]`);
      for (const [key, value] of Object.entries(content)) {
        lines.push(`    ${key} = ${formatINIValue(value)}`);
      }
      lines.push('');
    }
  }
  
  return lines.join('\n').trimEnd();
}

/**
 * Format a value for INI output
 */
function formatINIValue(value: any): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return value.toString();
  }
  if (typeof value === 'string') {
    // Quote if contains spaces or special characters
    if (/\s|[=;#]/.test(value)) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  return String(value);
}

/**
 * Parse git attributes format
 */
export function parseAttributes(content: string): Array<{pattern: string, attrs: string[]}> {
  const result: Array<{pattern: string, attrs: string[]}> = [];
  
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    
    // Split pattern and attributes
    const parts = trimmed.split(/\s+/);
    if (parts.length > 1) {
      result.push({
        pattern: parts[0],
        attrs: parts.slice(1)
      });
    }
  }
  
  return result;
}

/**
 * Parse git ref format (like HEAD file)
 */
export function parseRef(content: string): { type: 'ref' | 'sha', value: string } {
  const trimmed = content.trim();
  
  if (trimmed.startsWith('ref:')) {
    return {
      type: 'ref',
      value: trimmed.substring(4).trim()
    };
  }
  
  // Assume it's a SHA
  return {
    type: 'sha',
    value: trimmed
  };
}