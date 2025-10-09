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

  constructor(debug: boolean = false) {
    this.debug = debug;
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

    // Sliding window to find best match
    let bestMatch: FuzzyMatch | null = null;

    // Try different window sizes (±20% of search text length)
    const minWindowSize = Math.max(1, Math.floor(searchLength * 0.8));
    const maxWindowSize = Math.min(contentLength, Math.ceil(searchLength * 1.2));

    for (let windowSize = minWindowSize; windowSize <= maxWindowSize; windowSize++) {
      for (let i = 0; i <= contentLength - windowSize; i++) {
        const candidateText = content.substring(i, i + windowSize);
        const similarity = this.calculateSimilarity(searchText, candidateText);

        if (similarity >= threshold && (!bestMatch || similarity > bestMatch.similarity)) {
          bestMatch = {
            position: i,
            text: candidateText,
            similarity,
            endPosition: i + windowSize
          };

          // Early exit on perfect match
          if (similarity === 1.0) {
            if (this.debug) {
              console.error(`Perfect match found at position ${i}`);
            }
            return bestMatch;
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

    // Check again after normalization
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
