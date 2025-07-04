/**
 * Math Utilities
 * Collection of mathematical helper functions
 */
function isPrime(n) {
  if (n <= 1) return false;
  if (n <= 3) return true;
  if (n % 2 === 0 || n % 3 === 0) return false;
  
  for (let i = 5; i * i <= n; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}

function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}