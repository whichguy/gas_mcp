/**
 * UPDATED LOCAL VERSION - Calculate the Fibonacci number at position n using memoization for efficiency
 * @param {number} n - The position in the Fibonacci sequence (0-based)
 * @returns {number} The Fibonacci number at position n
 * 
 * TESTING LOCAL SYNC: This comment added locally to test gas_push functionality!
 */
function fibonacci(n) {
  // Input validation
  if (typeof n !== 'number' || n < 0 || !Number.isInteger(n)) {
    throw new Error('Input must be a non-negative integer');
  }
  
  // Base cases
  if (n === 0) return 0;
  if (n === 1) return 1;
  
  // Use memoization for efficiency
  const memo = {};
  
  function fibMemo(num) {
    if (num in memo) return memo[num];
    if (num === 0) return 0;
    if (num === 1) return 1;
    
    memo[num] = fibMemo(num - 1) + fibMemo(num - 2);
    return memo[num];
  }
  
  return fibMemo(n);
}

/**
 * Calculate Fibonacci sequence up to n terms
 * @param {number} count - Number of terms to generate
 * @returns {Array} Array of Fibonacci numbers
 */
function fibonacciSequence(count) {
  if (typeof count !== 'number' || count < 0 || !Number.isInteger(count)) {
    throw new Error('Count must be a non-negative integer');
  }
  
  const sequence = [];
  for (let i = 0; i < count; i++) {
    sequence.push(fibonacci(i));
  }
  
  return sequence;
}

/**
 * Test function to demonstrate Fibonacci calculations
 * NOW WITH UPDATED LOCAL SYNC!
 */
function testFibonacci() {
  const testCases = [0, 1, 5, 10, 15, 20];
  const results = {};
  
  testCases.forEach(n => {
    results[`fibonacci(${n})`] = fibonacci(n);
  });
  
  // Generate sequence of first 10 numbers
  results['sequence_10'] = fibonacciSequence(10);
  
  console.log('UPDATED LOCAL FIBONACCI Test Results:', results);
  return results;
}