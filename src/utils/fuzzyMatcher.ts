/**
 * Fuzzy string matching utility using Levenshtein distance
 *
 * Provides fuzzy text search with configurable similarity thresholds.
 * Used by AiderTool and RawAiderTool for token-efficient file editing.
 */

export interface FuzzyMatch {
  position: number;
  text: string;
  similarity: number;
  endPosition: number; // Added for overlap detection
}

export interface EditOperation {
  searchText: string;
  replaceText: string;
  similarityThreshold?: number;
  match?: FuzzyMatch; // Populated after finding match
}

export class FuzzyMatcher {
  private debug: boolean = false;
  private timeoutMs: number = 180000; // 3 minutes (180 seconds)

  constructor(debug: boolean = false, timeoutMs?: number) {
    this.debug = debug;
    if (timeoutMs) this.timeoutMs = timeoutMs;
  }

  /**
   * Find all fuzzy matches for multiple edit operations
   * Validates that matches don't overlap before returning
   *
   * @param content - Text content to search in
   * @param edits - Array of edit operations
   * @returns Array of edits with populated match information
   * @throws Error if edits would overlap
   */
  findAllMatches(content: string, edits: EditOperation[]): EditOperation[] {
    const editsWithMatches: EditOperation[] = [];

    // Find matches for all edits first
    for (const edit of edits) {
      const threshold = edit.similarityThreshold ?? 0.8;
      const match = this.findFuzzyMatch(content, edit.searchText, threshold);

      if (!match) {
        editsWithMatches.push({
          ...edit,
          match: undefined
        });
      } else {
        editsWithMatches.push({
          ...edit,
          match
        });
      }
    }

    // Validate no overlaps among successful matches
    this.validateNoOverlaps(editsWithMatches);

    return editsWithMatches;
  }

  /**
   * Apply edits in reverse position order to avoid position invalidation
   *
   * @param content - Original content
   * @param edits - Edits with match information (from findAllMatches)
   * @returns Modified content and number of edits applied
   */
  applyEdits(content: string, edits: EditOperation[]): { content: string; editsApplied: number } {
    // Filter to only edits with matches
    const editsToApply = edits
      .filter(edit => edit.match !== undefined)
      .sort((a, b) => b.match!.position - a.match!.position); // Reverse position order

    let modifiedContent = content;
    let editsApplied = 0;

    for (const edit of editsToApply) {
      const match = edit.match!;

      // Apply replacement
      modifiedContent = modifiedContent.substring(0, match.position) +
                       edit.replaceText +
                       modifiedContent.substring(match.endPosition);

      editsApplied++;

      if (this.debug) {
        console.error(`Applied edit ${editsApplied}: replaced "${match.text.substring(0, 30)}..." with "${edit.replaceText.substring(0, 30)}..." at position ${match.position}`);
      }
    }

    return { content: modifiedContent, editsApplied };
  }

  /**
   * Find best fuzzy match for search text in content
   * Returns position, matched text, similarity score, and end position
   *
   * @param content - Text to search in
   * @param searchText - Text to search for
   * @param threshold - Minimum similarity (0.0 to 1.0)
   * @returns Match information or null if no match above threshold
   */
  findFuzzyMatch(content: string, searchText: string, threshold: number): FuzzyMatch | null {
    if (!searchText || searchText.length === 0) {
      throw new Error('searchText cannot be empty');
    }

    const searchLength = searchText.length;
    const contentLength = content.length;

    if (contentLength === 0) {
      return null;
    }

    // Start timeout timer
    const startTime = Date.now();
    let iterationCount = 0;

    // PHASE 1: Try exact match first (handles 95% of cases instantly)
    const exactPos = content.indexOf(searchText);
    if (exactPos !== -1) {
      if (this.debug) {
        console.error(`Exact match found at position ${exactPos}`);
      }
      return {
        position: exactPos,
        text: searchText,
        similarity: 1.0,
        endPosition: exactPos + searchLength
      };
    }

    // PHASE 2: Try normalized exact match (handles whitespace-only variations)
    // This is SAFE because we use position mapping to find the exact location in original content
    const { normalized: normalizedContent, positionMap: contentPosMap } = this.normalizeWithPositionMap(content);
    const normalizedSearch = this.normalizeForComparison(searchText);

    const normalizedPos = normalizedContent.indexOf(normalizedSearch);
    if (normalizedPos !== -1) {
      // Map normalized position back to original content position
      const originalStartPos = contentPosMap[normalizedPos];

      // Find the actual end position in original content by searching forward
      // We need to find where the normalized match ends in the original text
      let originalEndPos = originalStartPos;
      let normalizedIdx = normalizedPos;
      const normalizedEndPos = normalizedPos + normalizedSearch.length;

      while (normalizedIdx < normalizedEndPos && normalizedIdx < contentPosMap.length) {
        originalEndPos = contentPosMap[normalizedIdx] + 1; // +1 because we want position AFTER the char
        normalizedIdx++;
      }

      // Verify the match in original content (safety check)
      const matchedText = content.substring(originalStartPos, originalEndPos);
      const matchedNormalized = this.normalizeForComparison(matchedText);

      if (matchedNormalized === normalizedSearch) {
        if (this.debug) {
          console.error(`Normalized exact match found at position ${originalStartPos}`);
        }
        return {
          position: originalStartPos,
          text: matchedText,
          similarity: 1.0,
          endPosition: originalEndPos
        };
      }
    }

    // Prepare for fuzzy matching - extract character set for quick reject
    const searchChars = new Set(normalizedSearch.split(''));
    const minLength = Math.floor(searchLength * (1 - (1 - threshold)));
    const maxLength = Math.ceil(searchLength * (1 + (1 - threshold)));

    // PHASE 2-4: Fuzzy matching with smart windows and coarse-then-fine search
    // Note: We normalize each candidate in the loop. This is necessary because position mapping
    // from normalized space to original space is complex (normalization changes string lengths).
    // Performance is still good due to: (1) only 5 window sizes, (2) coarse-then-fine search
    let bestMatch: FuzzyMatch | null = null;

    // Try only 5 strategic window sizes instead of hundreds
    const windowVariations = [-0.10, -0.05, 0, 0.05, 0.10];

    for (const variation of windowVariations) {
      const windowSize = Math.floor(searchLength * (1 + variation));
      if (windowSize < 1 || windowSize > contentLength) continue;

      // Coarse search first (check every Nth position for speed)
      const coarseStride = Math.max(1, Math.floor(searchLength / 20));
      const promisingRegions: number[] = [];

      for (let i = 0; i <= contentLength - windowSize; i += coarseStride) {
        // Timeout check every 100 iterations
        if (++iterationCount % 100 === 0) {
          const elapsed = Date.now() - startTime;
          if (elapsed > this.timeoutMs) {
            throw new Error(
              `Fuzzy matching timeout after ${(elapsed / 1000).toFixed(1)}s. ` +
              `Search text too long (${searchText.length} chars). ` +
              `Try shorter search text or use grep/ripgrep for large-scale searches.`
            );
          }
        }

        // PHASE 3: Length-based quick reject
        if (windowSize < minLength || windowSize > maxLength) {
          continue; // Skip candidates that are too different in length
        }

        const candidateText = content.substring(i, i + windowSize);
        const normalizedCandidate = this.normalizeForComparison(candidateText);

        // PHASE 4: Character-set quick reject
        // Check if candidate has all required characters from search text
        const candidateChars = new Set(normalizedCandidate.split(''));
        let hasAllChars = true;
        for (const char of searchChars) {
          if (!candidateChars.has(char)) {
            hasAllChars = false;
            break;
          }
        }
        if (!hasAllChars) {
          continue; // Skip candidates missing required characters
        }

        // PHASE 5: Full Levenshtein distance calculation (expensive)
        const similarity = this.calculateSimilarityFromNormalized(normalizedSearch, normalizedCandidate);

        // Track promising regions (within 0.1 of threshold)
        if (similarity >= threshold - 0.1) {
          promisingRegions.push(i);

          // Update best match
          if (!bestMatch || similarity > bestMatch.similarity) {
            bestMatch = {
              position: i,
              text: candidateText,
              similarity,
              endPosition: i + windowSize
            };

            // Early exit on excellent match (threshold + 10%)
            if (similarity >= threshold + 0.10) {
              if (this.debug) {
                console.error(`Excellent match found at position ${i}, similarity=${similarity.toFixed(3)}`);
              }
              return bestMatch;
            }
          }
        }
      }

      // Fine search in promising regions (stride = 1 for precision)
      for (const regionStart of promisingRegions) {
        const searchStart = Math.max(0, regionStart - coarseStride);
        const searchEnd = Math.min(contentLength - windowSize, regionStart + coarseStride);

        for (let i = searchStart; i <= searchEnd; i++) {
          // Timeout check every 100 iterations
          if (++iterationCount % 100 === 0) {
            const elapsed = Date.now() - startTime;
            if (elapsed > this.timeoutMs) {
              throw new Error(
                `Fuzzy matching timeout after ${(elapsed / 1000).toFixed(1)}s. ` +
                `Search text too long (${searchText.length} chars). ` +
                `Try shorter search text or use grep/ripgrep for large-scale searches.`
              );
            }
          }

          // Length-based quick reject
          if (windowSize < minLength || windowSize > maxLength) {
            continue;
          }

          const candidateText = content.substring(i, i + windowSize);
          const normalizedCandidate = this.normalizeForComparison(candidateText);

          // Character-set quick reject
          const candidateChars = new Set(normalizedCandidate.split(''));
          let hasAllChars = true;
          for (const char of searchChars) {
            if (!candidateChars.has(char)) {
              hasAllChars = false;
              break;
            }
          }
          if (!hasAllChars) {
            continue;
          }

          // Full Levenshtein distance calculation
          const similarity = this.calculateSimilarityFromNormalized(normalizedSearch, normalizedCandidate);

          if (similarity >= threshold && (!bestMatch || similarity > bestMatch.similarity)) {
            bestMatch = {
              position: i,
              text: candidateText,
              similarity,
              endPosition: i + windowSize
            };

            // Early exit on excellent match
            if (similarity >= threshold + 0.10) {
              if (this.debug) {
                console.error(`Excellent match found at position ${i}, similarity=${similarity.toFixed(3)}`);
              }
              return bestMatch;
            }
          }
        }
      }
    }

    if (this.debug && bestMatch) {
      console.error(`Best match: similarity=${bestMatch.similarity.toFixed(3)}, position=${bestMatch.position}`);
    }

    return bestMatch;
  }

  /**
   * Calculate similarity between two strings using Levenshtein distance
   * Returns value between 0.0 (completely different) and 1.0 (identical)
   *
   * @param str1 - First string
   * @param str2 - Second string
   * @returns Similarity score (0.0 to 1.0)
   */
  calculateSimilarity(str1: string, str2: string): number {
    // Quick exact match check
    if (str1 === str2) {
      return 1.0;
    }

    // Normalize whitespace for comparison
    const normalized1 = this.normalizeForComparison(str1);
    const normalized2 = this.normalizeForComparison(str2);

    return this.calculateSimilarityFromNormalized(normalized1, normalized2);
  }

  /**
   * Calculate similarity from already-normalized strings
   * More efficient when strings are pre-normalized to avoid redundant normalization
   *
   * @param normalized1 - First normalized string
   * @param normalized2 - Second normalized string
   * @returns Similarity score (0.0 to 1.0)
   */
  private calculateSimilarityFromNormalized(normalized1: string, normalized2: string): number {
    // Quick exact match check
    if (normalized1 === normalized2) {
      return 1.0;
    }

    const distance = this.levenshteinDistance(normalized1, normalized2);
    const maxLength = Math.max(normalized1.length, normalized2.length);

    if (maxLength === 0) return 1.0;

    return 1.0 - (distance / maxLength);
  }

  /**
   * Normalize text for similarity comparison
   * Preserves relative indentation while normalizing whitespace variations
   *
   * @param text - Text to normalize
   * @returns Normalized text
   */
  private normalizeForComparison(text: string): string {
    // Step 1: Normalize line endings
    let normalized = text.replace(/\r\n/g, '\n');

    // Step 2: Convert tabs to spaces (2 spaces per tab)
    normalized = normalized.replace(/\t/g, '  ');

    // Step 3: Normalize multiple spaces to single (but not at line start)
    const lines = normalized.split('\n');
    const normalizedLines = lines.map(line => {
      // Preserve leading spaces, normalize rest
      const leadingSpaces = line.match(/^[ ]*/)?.[0] ?? '';
      const rest = line.substring(leadingSpaces.length);
      return leadingSpaces + rest.replace(/[ ]+/g, ' ');
    });

    // Step 4: Trim trailing whitespace from each line
    return normalizedLines
      .map(line => line.trimEnd())
      .join('\n')
      .trim();
  }

  /**
   * Normalize text and build position mapping from normalized to original positions
   * This allows safe position lookup after normalization
   *
   * @param text - Text to normalize
   * @returns Object with normalized text and position map (normalized index → original index)
   */
  private normalizeWithPositionMap(text: string): { normalized: string; positionMap: number[] } {
    const positionMap: number[] = [];
    let normalized = '';
    let originalPos = 0;

    // Process character by character, tracking position changes
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      // Handle \r\n → \n (2 chars become 1)
      if (char === '\r' && nextChar === '\n') {
        positionMap.push(originalPos);
        normalized += '\n';
        originalPos += 2;
        i++; // Skip the \n
        continue;
      }

      // Handle \r → \n (1 char stays 1)
      if (char === '\r') {
        positionMap.push(originalPos);
        normalized += '\n';
        originalPos++;
        continue;
      }

      // Handle \t → spaces (1 char becomes 2)
      if (char === '\t') {
        positionMap.push(originalPos);
        positionMap.push(originalPos); // Both spaces map to the tab
        normalized += '  ';
        originalPos++;
        continue;
      }

      // Regular character
      positionMap.push(originalPos);
      normalized += char;
      originalPos++;
    }

    // Now apply space normalization (multiple spaces → single)
    // This is complex because we need to update the position map
    const lines = normalized.split('\n');
    let finalNormalized = '';
    const finalPositionMap: number[] = [];
    let normalizedPos = 0;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];

      // Handle leading spaces (preserve them)
      const leadingSpaces = line.match(/^[ ]*/)?.[0] ?? '';
      for (let i = 0; i < leadingSpaces.length; i++) {
        finalNormalized += ' ';
        finalPositionMap.push(positionMap[normalizedPos + i]);
      }

      // Handle rest of line (collapse multiple spaces)
      const rest = line.substring(leadingSpaces.length);
      let inSpaceRun = false;
      for (let i = 0; i < rest.length; i++) {
        const char = rest[i];
        const origIdx = normalizedPos + leadingSpaces.length + i;

        if (char === ' ') {
          if (!inSpaceRun) {
            // First space in a run - keep it
            finalNormalized += ' ';
            finalPositionMap.push(positionMap[origIdx]);
            inSpaceRun = true;
          }
          // Skip subsequent spaces (they're collapsed)
        } else {
          finalNormalized += char;
          finalPositionMap.push(positionMap[origIdx]);
          inSpaceRun = false;
        }
      }

      // Trim trailing whitespace from line
      while (finalNormalized.length > 0 && finalNormalized[finalNormalized.length - 1] === ' ') {
        finalNormalized = finalNormalized.slice(0, -1);
        finalPositionMap.pop();
      }

      // Add newline if not last line
      if (lineIdx < lines.length - 1) {
        finalNormalized += '\n';
        finalPositionMap.push(positionMap[normalizedPos + line.length]);
      }

      normalizedPos += line.length + 1; // +1 for the \n we split on
    }

    // Final trim
    finalNormalized = finalNormalized.trim();
    // Adjust position map for trim
    while (finalPositionMap.length > finalNormalized.length) {
      finalPositionMap.pop();
    }

    return { normalized: finalNormalized, positionMap: finalPositionMap };
  }

  /**
   * Calculate Levenshtein distance between two strings
   * Optimized implementation with single array
   *
   * @param str1 - First string
   * @param str2 - Second string
   * @returns Edit distance (number of operations to transform str1 into str2)
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;

    // Quick checks
    if (len1 === 0) return len2;
    if (len2 === 0) return len1;

    // Create array for dynamic programming
    const distances = new Array(len2 + 1);

    // Initialize first row
    for (let j = 0; j <= len2; j++) {
      distances[j] = j;
    }

    // Calculate distances
    for (let i = 1; i <= len1; i++) {
      let prev = distances[0];
      distances[0] = i;

      for (let j = 1; j <= len2; j++) {
        const temp = distances[j];

        if (str1[i - 1] === str2[j - 1]) {
          distances[j] = prev;
        } else {
          distances[j] = Math.min(
            prev + 1,           // substitution
            distances[j] + 1,   // deletion
            distances[j - 1] + 1 // insertion
          );
        }

        prev = temp;
      }
    }

    return distances[len2];
  }

  /**
   * Validate that edit matches don't overlap
   *
   * @param edits - Edits with match information
   * @throws Error if any matches overlap
   */
  private validateNoOverlaps(edits: EditOperation[]): void {
    const matchedEdits = edits.filter(edit => edit.match !== undefined);

    // Sort by position for easier overlap detection
    const sortedEdits = [...matchedEdits].sort((a, b) => a.match!.position - b.match!.position);

    for (let i = 0; i < sortedEdits.length - 1; i++) {
      const current = sortedEdits[i].match!;
      const next = sortedEdits[i + 1].match!;

      if (current.endPosition > next.position) {
        throw new Error(
          `Edit regions overlap: ` +
          `Edit ${i + 1} (position ${current.position}-${current.endPosition}) ` +
          `overlaps with Edit ${i + 2} (position ${next.position}-${next.endPosition}). ` +
          `Matched texts: "${current.text.substring(0, 30)}..." and "${next.text.substring(0, 30)}...". ` +
          `Suggestion: Make search text more specific or adjust edits to target different regions.`
        );
      }
    }
  }
}
