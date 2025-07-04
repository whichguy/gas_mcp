/**
 * API Service Layer
 * Handles external API calls and data processing
 */
function fetchUserData(userId) {
  const url = `https://jsonplaceholder.typicode.com/users/${userId}`;
  
  try {
    const response = UrlFetchApp.fetch(url);
    const data = JSON.parse(response.getContentText());
    return {
      success: true,
      data: data,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

function processApiResponse(response) {
  if (!response.success) {
    console.error('API Error:', response.error);
    return null;
  }
  
  return {
    id: response.data.id,
    name: response.data.name,
    email: response.data.email,
    processed: true
  };
}