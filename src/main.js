/**
 * Main Application Entry Point
 * Coordinates between components, utils, and services
 */
function main() {
  console.log('Starting Directory Structure Test Application');
  
  // Test math utilities
  const primes = [2, 3, 5, 7, 11, 13].filter(n => isPrime(n));
  console.log('Prime numbers:', primes);
  
  // Test API service
  const userData = fetchUserData(1);
  const processedUser = processApiResponse(userData);
  console.log('Processed user:', processedUser);
  
  // Test button component
  const buttons = [
    createButton('Save', 'saveData()', 'primary'),
    createButton('Cancel', 'cancel()', 'secondary')
  ];
  
  const buttonHtml = renderButtons(buttons);
  console.log('Button HTML:', buttonHtml);
  
  return {
    status: 'success',
    message: 'Directory structure test completed successfully',
    components: ['Button'],
    utils: ['math'],
    services: ['api']
  };
}

function doGet() {
  const result = main();
  return ContentService.createTextOutput(JSON.stringify(result, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}