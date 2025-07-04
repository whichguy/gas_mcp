/**
 * Utility helper functions
 */

function formatDate(date) {
  return new Date(date).toLocaleDateString();
}

function generateRandomId() {
  return Math.random().toString(36).substring(2, 15);
}

function validateEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

function capitalizeWords(str) {
  return str.replace(/\b\w/g, l => l.toUpperCase());
}

// NEW FUNCTION ADDED FOR PUSH TEST
function formatPhoneNumber(phone) {
  // Remove all non-digits
  const cleaned = phone.replace(/\D/g, '');
  
  // Format as (XXX) XXX-XXXX
  if (cleaned.length === 10) {
    return `(${cleaned.substring(0, 3)}) ${cleaned.substring(3, 6)}-${cleaned.substring(6)}`;
  }
  
  return phone; // Return original if not 10 digits
}