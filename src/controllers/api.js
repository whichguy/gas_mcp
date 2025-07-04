/**
 * API controllers for handling requests
 */

function handleUserRequest(requestData) {
  try {
    const user = new User(requestData.name, requestData.email, requestData.role);
    const validation = user.validate();
    
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error
      };
    }

    return {
      success: true,
      user: user.getInfo(),
      id: generateRandomId()
    };
  } catch (error) {
    return {
      success: false,
      error: 'Internal server error: ' + error.message
    };
  }
}

function processDataRequest(data) {
  const processed = data.map(item => ({
    ...item,
    id: generateRandomId(),
    processed: true,
    timestamp: new Date().toISOString()
  }));

  return {
    success: true,
    count: processed.length,
    data: processed
  };
}