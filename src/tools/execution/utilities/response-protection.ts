/**
 * Response Size Protection Utilities
 *
 * Provides token estimation and response size protection for MCP protocol compliance.
 * MCP responses must not exceed token limits to prevent protocol errors.
 */

/**
 * Simple token counting utility for MCP response size protection
 * Estimates tokens using approximate character-to-token ratio
 */
export function estimateTokenCount(text: string): number {
  // Rough estimation: 1 token ≈ 4 characters (conservative)
  // This accounts for JSON structure, whitespace, and encoding overhead
  return Math.ceil(text.length / 3.5);
}

/**
 * Filter logger output using optional regex pattern and/or tail limit
 * @param loggerOutput The raw logger output string
 * @param filterPattern Optional regex pattern to match lines (case-insensitive)
 * @param tailLines Optional number of lines to return from the end
 * @returns Filtered logger output with metadata
 */
export function filterLoggerOutput(
  loggerOutput: string,
  filterPattern?: string,
  tailLines?: number
): { filteredOutput: string; metadata: string } {
  if (!loggerOutput) {
    return { filteredOutput: '', metadata: '' };
  }

  const lines = loggerOutput.split('\n');
  let filtered = lines;
  let metadata = '';

  // Apply regex filter if provided
  if (filterPattern) {
    try {
      const regex = new RegExp(filterPattern, 'i'); // Case-insensitive by default
      const originalCount = filtered.length;
      filtered = filtered.filter(line => regex.test(line));
      metadata += `[Filtered ${originalCount} lines → ${filtered.length} lines using pattern: ${filterPattern}]\n`;
    } catch (error: any) {
      metadata += `[Filter pattern error: ${error.message} - returning unfiltered output]\n`;
    }
  }

  // Apply tail limit if provided
  if (tailLines && tailLines > 0) {
    const originalCount = filtered.length;
    if (filtered.length > tailLines) {
      filtered = filtered.slice(-tailLines);
      metadata += `[Showing last ${tailLines} of ${originalCount} lines]\n`;
    }
  }

  return {
    filteredOutput: filtered.join('\n'),
    metadata: metadata ? `\n${metadata}` : ''
  };
}

/**
 * Protects MCP responses from exceeding token limits by truncating logger_output
 * @param response The response object to protect
 * @param maxTokens Maximum allowed tokens (default: 22000, leaving room for structure)
 * @returns Protected response with truncated logger_output if needed
 */
export function protectResponseSize(response: any, maxTokens: number = 22000): any {
  // Convert response to JSON to get accurate size estimate
  const responseJson = JSON.stringify(response);
  const estimatedTokens = estimateTokenCount(responseJson);

  if (estimatedTokens <= maxTokens) {
    // Response is within limits, return as-is
    return response;
  }

  console.error(`[RESPONSE SIZE PROTECTION] Response size: ${estimatedTokens} tokens > ${maxTokens} limit - truncating logger_output`);

  // Calculate how much we need to reduce
  const excessTokens = estimatedTokens - maxTokens;
  const loggerOutput = response.logger_output || '';

  if (!loggerOutput) {
    // No logger output to truncate, but response is still too large
    console.error(`[RESPONSE SIZE PROTECTION] Response too large but no logger_output to truncate!`);
    return {
      ...response,
      result: '[TRUNCATED: Response too large for MCP protocol]',
      logger_output: `RESPONSE SIZE ERROR: Response (${estimatedTokens} tokens) exceeded MCP limit (${maxTokens}) but had no logger_output to truncate.`
    };
  }

  // Calculate target logger_output size (conservatively remove extra tokens)
  const excessChars = Math.ceil(excessTokens * 4); // Conservative character removal
  const targetLoggerSize = Math.max(0, loggerOutput.length - excessChars - 500); // Extra buffer

  if (targetLoggerSize <= 0) {
    // Logger output needs to be completely removed
    return {
      ...response,
      logger_output: `LOGGER TRUNCATED: Full logger output (${loggerOutput.length} chars) removed due to MCP token limit. Original response: ${estimatedTokens} tokens > ${maxTokens} limit.`
    };
  }

  // Truncate logger output and add informative message
  const truncatedLogger = loggerOutput.substring(0, targetLoggerSize);
  const truncationMessage = `\n\nLOGGER TRUNCATED: Output truncated from ${loggerOutput.length} to ${targetLoggerSize} chars (removed ${loggerOutput.length - targetLoggerSize} chars) due to MCP token limit. Original response: ${estimatedTokens} tokens > ${maxTokens} limit.`;

  const protectedResponse = {
    ...response,
    logger_output: truncatedLogger + truncationMessage
  };

  // Verify the protected response is within limits
  const protectedJson = JSON.stringify(protectedResponse);
  const protectedTokens = estimateTokenCount(protectedJson);

  console.error(`[RESPONSE SIZE PROTECTION] Protected response: ${protectedTokens} tokens (was ${estimatedTokens})`);

  return protectedResponse;
}
