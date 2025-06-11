import { randomBytes } from 'crypto';

export interface ProjectData {
  title: string;
  scriptId: string;
  description?: string;
  files?: FileData[];
}

export interface FileData {
  name: string;
  content: string;
  type: 'server_js' | 'html' | 'json';
}

export interface TokenData {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: 'Bearer';
  expires_at: number;
}

export interface UserData {
  email: string;
  name: string;
  picture?: string;
}

export class TestDataFactory {
  /**
   * Create test project data
   */
  static createTestProject(overrides: Partial<ProjectData> = {}): ProjectData {
    const timestamp = Date.now();
    const randomId = randomBytes(8).toString('hex');
    
    return {
      title: `Test Project ${timestamp}`,
      scriptId: `test_project_${randomId}`,
      description: 'Auto-generated test project',
      files: [
        this.createTestFile({ name: 'Code.gs' }),
        this.createTestFile({ name: 'appsscript.json', type: 'json' })
      ],
      ...overrides
    };
  }

  /**
   * Create test file data
   */
  static createTestFile(overrides: Partial<FileData> = {}): FileData {
    const timestamp = Date.now();
    
    const defaults: FileData = {
      name: `TestFile_${timestamp}.gs`,
      type: 'server_js' as const,
      content: `// Auto-generated test file created at ${new Date().toISOString()}
function testFunction_${timestamp}() {
  console.log('Hello from test file ${timestamp}');
  return { 
    message: 'Test successful', 
    timestamp: ${timestamp},
    random: Math.random()
  };
}`
    };

    const file = { ...defaults, ...overrides };

    // Adjust content based on file type
    if (file.type === 'json' && !overrides.content) {
      file.content = JSON.stringify({
        timeZone: 'America/Los_Angeles',
        dependencies: {},
        exceptionLogging: 'STACKDRIVER',
        runtimeVersion: 'V8'
      }, null, 2);
    } else if (file.type === 'html' && !overrides.content) {
      file.content = `<!DOCTYPE html>
<html>
<head>
  <title>Test HTML File ${timestamp}</title>
</head>
<body>
  <h1>Test HTML Content</h1>
  <p>Generated at: ${new Date().toISOString()}</p>
  <script>
    console.log('Test HTML file loaded');
  </script>
</body>
</html>`;
    }

    return file;
  }

  /**
   * Create valid OAuth token data
   */
  static createAuthTokens(overrides: Partial<TokenData> = {}): TokenData {
    const now = Date.now();
    const randomToken = randomBytes(32).toString('base64url');
    const randomRefresh = randomBytes(24).toString('base64url');
    
    return {
      access_token: `test_access_${randomToken}`,
      refresh_token: `test_refresh_${randomRefresh}`,
      scope: 'https://www.googleapis.com/auth/script.projects https://www.googleapis.com/auth/drive',
      token_type: 'Bearer',
      expires_at: now + (3600 * 1000), // 1 hour from now
      ...overrides
    };
  }

  /**
   * Create test user data
   */
  static createUserData(overrides: Partial<UserData> = {}): UserData {
    const randomId = randomBytes(4).toString('hex');
    
    return {
      email: `test.user.${randomId}@example.com`,
      name: `Test User ${randomId}`,
      picture: `https://example.com/avatar/${randomId}.jpg`,
      ...overrides
    };
  }

  /**
   * Create expired token data for testing
   */
  static createExpiredTokens(): TokenData {
    return this.createAuthTokens({
      expires_at: Date.now() - (3600 * 1000) // 1 hour ago
    });
  }

  /**
   * Create malformed token data for error testing
   */
  static createMalformedTokens(): Partial<TokenData> {
    return {
      access_token: 'invalid_token',
      // Missing required fields
    };
  }

  /**
   * Create test error response data
   */
  static createErrorResponse(
    type: 'AuthenticationError' | 'ValidationError' | 'GASApiError' | 'OAuthError',
    message: string,
    details: any = {}
  ) {
    const base = {
      error: {
        type,
        message,
        code: -32000,
        data: details
      },
      sessionId: randomBytes(16).toString('hex')
    };

    switch (type) {
      case 'AuthenticationError':
        base.error.data = {
          requiresAuth: true,
          authUrl: 'https://accounts.google.com/oauth/authorize?...',
          instructions: 'Use gas_auth tool to authenticate: gas_auth(mode="start")',
          ...details
        };
        break;
      
      case 'ValidationError':
        base.error.data = {
          field: 'unknown',
          value: 'invalid',
          expected: 'valid value',
          ...details
        };
        break;
      
      case 'GASApiError':
        base.error.code = -32002;
        base.error.data = {
          statusCode: 400,
          originalError: 'API Error',
          ...details
        };
        break;
      
      case 'OAuthError':
        base.error.code = -32003;
        base.error.data = {
          phase: 'authorization',
          instructions: 'Start authentication flow with gas_auth(mode="start")',
          ...details
        };
        break;
    }

    return base;
  }

  /**
   * Create dangerous/unsafe path test cases
   */
  static createDangerousPaths(): string[] {
    return [
      'project/../../../etc/passwd',
      'project\\..\\..\\windows\\system32',
      '/absolute/path/file.gs',
      'project//double//slash.gs',
      'project%2e%2e%2ftraversal.gs',
      'project\x00null-byte.gs',
      'project/./current/./dir.gs',
      'project/deeply/nested/../../../../escape.gs'
    ];
  }

  /**
   * Create valid project structure for validation
   */
  static createValidProjectStructure() {
    return {
      scriptId: 'valid_project_id_123',
      title: 'Valid Test Project',
      files: [
        {
          name: 'Code.gs',
          type: 'server_js',
          source: 'function test() { return "Hello World"; }'
        },
        {
          name: 'appsscript.json',
          type: 'json',
          source: JSON.stringify({
            timeZone: 'America/Los_Angeles',
            dependencies: {},
            exceptionLogging: 'STACKDRIVER'
          })
        }
      ],
      createTime: new Date().toISOString(),
      updateTime: new Date().toISOString()
    };
  }
} 