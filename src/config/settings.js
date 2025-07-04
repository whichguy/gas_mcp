/**
 * Application configuration and settings
 */

const CONFIG = {
  app: {
    name: 'Subfolder Test Application',
    version: '1.0.0',
    environment: 'development'
  },
  
  api: {
    timeout: 30000,
    retries: 3,
    baseUrl: 'https://api.example.com'
  },
  
  validation: {
    maxNameLength: 100,
    minNameLength: 2,
    allowedRoles: ['admin', 'user', 'guest'],
    requireEmailVerification: true
  },
  
  processing: {
    batchSize: 100,
    maxDatasetSize: 10000,
    enableAnalytics: true
  }
};

function getConfig(section) {
  return section ? CONFIG[section] : CONFIG;
}

function updateConfig(section, key, value) {
  if (CONFIG[section] && CONFIG[section].hasOwnProperty(key)) {
    CONFIG[section][key] = value;
    return { success: true, message: 'Configuration updated' };
  }
  return { success: false, message: 'Invalid configuration path' };
}