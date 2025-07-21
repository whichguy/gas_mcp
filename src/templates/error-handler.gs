/**
 * Production Error Handler Template for Google Apps Script
 * Provides comprehensive error handling, logging, and user-friendly error responses
 */

/**
 * Global error handler for all GAS functions
 * @param {Error} error - The error object
 * @param {string} context - Context where error occurred
 * @param {Object} metadata - Additional metadata for debugging
 * @returns {Object} Structured error response
 */
function handleError(error, context, metadata = {}) {
  const errorId = Utilities.getUuid();
  const timestamp = new Date().toISOString();
  
  // Structured error information
  const errorInfo = {
    errorId: errorId,
    timestamp: timestamp,
    context: context,
    message: error.message || 'Unknown error',
    stack: error.stack || 'No stack trace available',
    metadata: metadata,
    environment: {
      userEmail: Session.getActiveUser().getEmail(),
      timezone: Session.getScriptTimeZone(),
      locale: Session.getActiveUserLocale()
    }
  };
  
  // Log to Google Cloud Logging (if configured)
  console.error('Production Error:', JSON.stringify(errorInfo, null, 2));
  
  // Log to spreadsheet (optional - configure PRODUCTION_ERROR_SHEET_ID)
  try {
    const errorSheetId = PropertiesService.getScriptProperties().getProperty('PRODUCTION_ERROR_SHEET_ID');
    if (errorSheetId) {
      logErrorToSheet(errorSheetId, errorInfo);
    }
  } catch (logError) {
    console.warn('Failed to log error to sheet:', logError.message);
  }
  
  // Send notification for critical errors (optional)
  try {
    const alertEmail = PropertiesService.getScriptProperties().getProperty('PRODUCTION_ALERT_EMAIL');
    if (alertEmail && isCriticalError(error)) {
      sendErrorAlert(alertEmail, errorInfo);
    }
  } catch (alertError) {
    console.warn('Failed to send error alert:', alertError.message);
  }
  
  // Return user-friendly error response
  return {
    success: false,
    error: {
      id: errorId,
      message: getPublicErrorMessage(error),
      timestamp: timestamp,
      support: 'Contact support with error ID: ' + errorId
    }
  };
}

/**
 * Log error to designated error tracking spreadsheet
 */
function logErrorToSheet(sheetId, errorInfo) {
  try {
    const sheet = SpreadsheetApp.openById(sheetId).getActiveSheet();
    const row = [
      errorInfo.timestamp,
      errorInfo.errorId,
      errorInfo.context,
      errorInfo.message,
      errorInfo.environment.userEmail,
      JSON.stringify(errorInfo.metadata),
      errorInfo.stack.substring(0, 1000) // Truncate long stack traces
    ];
    sheet.appendRow(row);
  } catch (error) {
    console.error('Error logging to sheet:', error.message);
  }
}

/**
 * Send email alert for critical errors
 */
function sendErrorAlert(alertEmail, errorInfo) {
  try {
    const subject = `Production Error Alert - ${errorInfo.context}`;
    const body = `
    Error ID: ${errorInfo.errorId}
    Context: ${errorInfo.context}
    Message: ${errorInfo.message}
    User: ${errorInfo.environment.userEmail}
    Timestamp: ${errorInfo.timestamp}
    
    Metadata: ${JSON.stringify(errorInfo.metadata, null, 2)}
    
    Stack Trace:
    ${errorInfo.stack}
    `;
    
    GmailApp.sendEmail(alertEmail, subject, body);
  } catch (error) {
    console.error('Failed to send error alert email:', error.message);
  }
}

/**
 * Determine if error is critical and requires immediate attention
 */
function isCriticalError(error) {
  const criticalPatterns = [
    /quota/i,
    /limit/i,
    /authorization/i,
    /forbidden/i,
    /service.*unavailable/i
  ];
  
  return criticalPatterns.some(pattern => pattern.test(error.message));
}

/**
 * Get user-friendly error message (hide sensitive details)
 */
function getPublicErrorMessage(error) {
  const publicMessages = {
    'Authorization': 'Access denied. Please check permissions.',
    'Quota': 'Service temporarily unavailable. Please try again later.',
    'Network': 'Connection error. Please check your network and try again.',
    'Validation': 'Invalid input provided. Please check your data.'
  };
  
  for (const [key, message] of Object.entries(publicMessages)) {
    if (error.message.toLowerCase().includes(key.toLowerCase())) {
      return message;
    }
  }
  
  return 'An unexpected error occurred. Please try again or contact support.';
}

/**
 * Wrapper function for safe execution with error handling
 * @param {Function} func - Function to execute safely
 * @param {string} context - Context for error reporting
 * @param {Object} metadata - Additional metadata
 */
function executeWithErrorHandling(func, context, metadata = {}) {
  try {
    const result = func();
    return {
      success: true,
      data: result
    };
  } catch (error) {
    return handleError(error, context, metadata);
  }
}

/**
 * Production health check function
 */
function healthCheck() {
  return executeWithErrorHandling(() => {
    // Test basic GAS functionality
    const testResults = {
      timestamp: new Date().toISOString(),
      services: {
        scriptApp: !!ScriptApp,
        utilities: !!Utilities,
        properties: !!PropertiesService,
        session: !!Session
      },
      user: Session.getActiveUser().getEmail(),
      timezone: Session.getScriptTimeZone(),
      quotas: {
        // Add quota checks as needed
        executionTimeRemaining: 6 * 60 * 1000 // 6 minutes default
      }
    };
    
    return testResults;
  }, 'healthCheck');
} 