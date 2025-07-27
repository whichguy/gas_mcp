/**
 * Pattern validation utilities for gas_grep
 * Prevents ReDoS attacks and validates regex safety
 */

export interface PatternValidation {
  valid: boolean;
  error?: string;
  suggestion?: string;
}

/**
 * Validate grep pattern for safety and performance
 */
export function validateGrepPattern(pattern: string): PatternValidation {
  // Check pattern length
  if (pattern.length > 200) {
    return {
      valid: false,
      error: 'Pattern too long (max 200 characters)',
      suggestion: 'Use shorter, more specific patterns'
    };
  }

  // Check for empty pattern
  if (!pattern.trim()) {
    return {
      valid: false,
      error: 'Pattern cannot be empty',
      suggestion: 'Provide a search pattern'
    };
  }

  // Check for potentially dangerous regex patterns (ReDoS)
  const dangerousPatterns = [
    /\(\.\*\)\*/,           // (.*)*
    /\(\.\+\)\+/,           // (.+)+
    /\(\.\*\)\+/,           // (.*)+ 
    /\(\?\:\.\*\)\*/,       // (?:.*)*
    /\(\?\:\.\+\)\+/,       // (?:.+)+
    /\(\w\*\)\*/,           // (\w*)*
    /\(\w\+\)\+/,           // (\w+)+
  ];

  for (const dangerous of dangerousPatterns) {
    if (dangerous.test(pattern)) {
      return {
        valid: false,
        error: 'Potentially expensive regex pattern detected',
        suggestion: 'Avoid nested quantifiers like (.*)*  or (.+)+'
      };
    }
  }

  // Check for excessive nested groups
  const nestedGroups = (pattern.match(/\(/g) || []).length;
  if (nestedGroups > 10) {
    return {
      valid: false,
      error: 'Too many nested groups (max 10)',
      suggestion: 'Simplify the regex pattern'
    };
  }

  // Check for excessive quantifiers
  const quantifiers = (pattern.match(/[*+?{]/g) || []).length;
  if (quantifiers > 15) {
    return {
      valid: false,
      error: 'Too many quantifiers (max 15)',
      suggestion: 'Use simpler patterns with fewer quantifiers'
    };
  }

  return { valid: true };
}

/**
 * Auto-detect search mode based on pattern content
 */
export function detectSearchMode(pattern: string): 'regex' | 'literal' | 'auto' {
  // Check for regex metacharacters
  const regexChars = /[.*+?^${}()|[\]\\]/;
  
  if (regexChars.test(pattern)) {
    return 'regex';
  }
  
  // Simple alphanumeric patterns are literal
  if (/^[a-zA-Z0-9\s_-]+$/.test(pattern)) {
    return 'literal';
  }
  
  return 'auto';
}

/**
 * Escape regex special characters for literal search
 */
export function escapeRegexPattern(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile pattern to RegExp with safety checks
 */
export function compileGrepPattern(
  pattern: string,
  mode: 'regex' | 'literal' | 'auto',
  caseSensitive: boolean = false,
  wholeWord: boolean = false
): RegExp {
  let processedPattern = pattern;

  // Handle different modes
  switch (mode) {
    case 'literal':
      processedPattern = escapeRegexPattern(pattern);
      break;
      
    case 'auto':
      // Auto-detect and handle accordingly
      const detectedMode = detectSearchMode(pattern);
      if (detectedMode === 'literal') {
        processedPattern = escapeRegexPattern(pattern);
      }
      break;
      
    case 'regex':
      // Use pattern as-is for regex mode
      break;
  }

  // Add word boundaries if requested
  if (wholeWord) {
    processedPattern = `\\b${processedPattern}\\b`;
  }

  // Compile with appropriate flags
  const flags = caseSensitive ? 'g' : 'gi';
  
  try {
    return new RegExp(processedPattern, flags);
  } catch (error) {
    throw new Error(`Invalid regex pattern: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Estimate regex complexity for performance prediction
 */
export function estimatePatternComplexity(pattern: string): number {
  let complexity = 1;
  
  // Count quantifiers (*, +, ?, {n,m})
  complexity += (pattern.match(/[*+?]|\{\d+,?\d*\}/g) || []).length * 2;
  
  // Count groups
  complexity += (pattern.match(/\(/g) || []).length;
  
  // Count character classes
  complexity += (pattern.match(/\[[^\]]*\]/g) || []).length;
  
  // Count alternations
  complexity += (pattern.match(/\|/g) || []).length;
  
  // Count lookarounds
  complexity += (pattern.match(/\(\?\[=!<]/g) || []).length * 3;
  
  return complexity;
} 