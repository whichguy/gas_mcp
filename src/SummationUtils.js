/**
 * Summation Utility Functions
 * A collection of functions to perform various summation operations
 */

/**
 * Simple summation of an array of numbers
 * @param {number[]} numbers - Array of numbers to sum
 * @returns {number} The sum of all numbers
 */
function sumArray(numbers) {
  if (!Array.isArray(numbers)) {
    throw new Error('Input must be an array');
  }
  
  if (numbers.length === 0) {
    return 0;
  }
  
  return numbers.reduce((sum, num) => {
    if (typeof num !== 'number' || isNaN(num)) {
      throw new Error(`Invalid number: ${num}`);
    }
    return sum + num;
  }, 0);
}

/**
 * Summation of multiple individual arguments
 * @param {...number} numbers - Individual numbers to sum
 * @returns {number} The sum of all arguments
 */
function sumNumbers(...numbers) {
  return sumArray(numbers);
}

/**
 * Summation with validation and filtering
 * @param {number[]} numbers - Array of numbers to sum
 * @param {Object} options - Options for summation
 * @param {boolean} options.skipInvalid - Skip invalid numbers instead of throwing error
 * @param {number} options.defaultValue - Default value for invalid numbers
 * @returns {number} The sum of valid numbers
 */
function sumWithOptions(numbers, options = {}) {
  if (!Array.isArray(numbers)) {
    throw new Error('Input must be an array');
  }
  
  const { skipInvalid = false, defaultValue = 0 } = options;
  
  return numbers.reduce((sum, num) => {
    if (typeof num !== 'number' || isNaN(num)) {
      if (skipInvalid) {
        return sum; // Skip invalid numbers
      } else if (defaultValue !== undefined) {
        return sum + defaultValue; // Use default value
      } else {
        throw new Error(`Invalid number: ${num}`);
      }
    }
    return sum + num;
  }, 0);
}

/**
 * Calculate range sum (sum of integers from start to end)
 * @param {number} start - Starting number (inclusive)
 * @param {number} end - Ending number (inclusive)
 * @returns {number} Sum of all integers from start to end
 */
function sumRange(start, end) {
  if (typeof start !== 'number' || typeof end !== 'number') {
    throw new Error('Start and end must be numbers');
  }
  
  if (start > end) {
    throw new Error('Start must be less than or equal to end');
  }
  
  // Use mathematical formula: n(n+1)/2 for efficiency
  const count = end - start + 1;
  return count * (start + end) / 2;
}

/**
 * Test function to validate all summation functions
 * @returns {Object} Test results
 */
function testSummationFunctions() {
  const results = {
    tests: [],
    passed: 0,
    failed: 0
  };
  
  function addTest(name, testFn) {
    try {
      const result = testFn();
      results.tests.push({ name, status: 'PASSED', result });
      results.passed++;
    } catch (error) {
      results.tests.push({ name, status: 'FAILED', error: error.message });
      results.failed++;
    }
  }
  
  // Test sumArray
  addTest('sumArray([1, 2, 3, 4, 5])', () => {
    const result = sumArray([1, 2, 3, 4, 5]);
    if (result !== 15) throw new Error(`Expected 15, got ${result}`);
    return result;
  });
  
  addTest('sumArray([])', () => {
    const result = sumArray([]);
    if (result !== 0) throw new Error(`Expected 0, got ${result}`);
    return result;
  });
  
  // Test sumNumbers
  addTest('sumNumbers(10, 20, 30)', () => {
    const result = sumNumbers(10, 20, 30);
    if (result !== 60) throw new Error(`Expected 60, got ${result}`);
    return result;
  });
  
  // Test sumRange
  addTest('sumRange(1, 10)', () => {
    const result = sumRange(1, 10);
    if (result !== 55) throw new Error(`Expected 55, got ${result}`);
    return result;
  });
  
  addTest('sumRange(5, 8)', () => {
    const result = sumRange(5, 8);
    if (result !== 26) throw new Error(`Expected 26, got ${result}`);
    return result;
  });
  
  // Test sumWithOptions
  addTest('sumWithOptions([1, 2, "invalid", 4], {skipInvalid: true})', () => {
    const result = sumWithOptions([1, 2, "invalid", 4], {skipInvalid: true});
    if (result !== 7) throw new Error(`Expected 7, got ${result}`);
    return result;
  });
  
  results.summary = `${results.passed} passed, ${results.failed} failed`;
  return results;
}