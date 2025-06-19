# Contributing to MCP Google Apps Script Server

Thank you for your interest in contributing to the MCP Gas Server! This guide will help you get started with contributing to the project.

## 🎯 Ways to Contribute

- 🐛 **Bug Reports** - Help us identify and fix issues
- ✨ **Feature Requests** - Suggest new functionality
- 📚 **Documentation** - Improve guides and examples
- 🧪 **Testing** - Add test coverage and find edge cases
- 💻 **Code Contributions** - Bug fixes and new features

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18.0.0 or higher
- **npm** v8.0.0 or higher
- **Git** for version control
- **Google Account** for testing OAuth flows

### Development Setup

1. **Fork the repository** on GitHub
2. **Clone your fork**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/mcp_gas.git
   cd mcp_gas
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Build the project**:
   ```bash
   npm run build
   ```
5. **Run tests**:
   ```bash
   npm test
   ```

## 🔄 Development Workflow

### 1. Create a Branch
```bash
git checkout -b feature/your-feature-name
# or
git checkout -b bugfix/issue-description
```

### 2. Make Changes
- Follow the existing code style
- Add tests for new functionality
- Update documentation as needed
- Ensure all tests pass

### 3. Test Your Changes
```bash
# Run unit tests
npm test

# Run integration tests (requires OAuth setup)
npm run test:workflow

# Run all tests
npm run test:all

# Lint code
npm run lint
```

### 4. Commit Changes
```bash
git add .
git commit -m "feat: add new MCP tool for spreadsheet analysis"
# or
git commit -m "fix: resolve OAuth callback timeout issue"
```

#### Commit Message Convention
We use conventional commits:
- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `test:` - Test additions/changes
- `refactor:` - Code refactoring
- `style:` - Code style changes
- `chore:` - Maintenance tasks

### 5. Push and Create PR
```bash
git push origin feature/your-feature-name
```
Then create a Pull Request on GitHub.

## 📋 Code Guidelines

### TypeScript Style
- Use TypeScript for all new code
- Follow existing naming conventions
- Add proper type annotations
- Use `const` assertions for readonly data

### MCP Tool Development
When adding new MCP tools:

1. **Extend BaseTool**:
   ```typescript
   export class MyNewTool extends BaseTool {
     public name = "my_new_tool";
     public description = "Tool description with LLM guidance";
     public inputSchema = { /* JSON Schema */ };
   }
   ```

2. **Follow LLM-friendly patterns**:
   - Add `llmHints` to input schema
   - Include `llmWorkflowGuide` for complex tools
   - Provide comprehensive examples

3. **Add comprehensive tests**:
   - Unit tests in `test/tools/`
   - Integration tests in `test/system/`
   - Error handling tests

### Documentation Standards
- Update README.md for user-facing changes
- Add/update API documentation in `docs/api/`
- Update developer docs in `docs/developer/` for technical changes
- Include code examples for new features

## 🧪 Testing Guidelines

### Test Categories
- **Unit Tests** - Individual function testing
- **Integration Tests** - End-to-end workflow testing
- **System Tests** - MCP protocol compliance

### Writing Tests
```typescript
describe('MyNewTool', () => {
  it('should execute successfully with valid input', async () => {
    const tool = new MyNewTool(mockSessionManager);
    const result = await tool.execute({
      requiredParam: 'test-value'
    });
    expect(result.status).to.equal('success');
  });
});
```

### Test Requirements
- All new features must include tests
- Maintain >90% code coverage
- Test both success and error cases
- Mock external dependencies

## 📚 Documentation Requirements

### For New Features
- Add usage examples to README.md
- Document new MCP tools in API reference
- Update relevant developer documentation
- Include inline code comments

### Documentation Style
- Use clear, concise language
- Include code examples
- Add troubleshooting guidance
- Use emoji for visual organization 🎯

## 🔐 Security Considerations

### OAuth & Authentication
- Never commit OAuth credentials
- Test authentication flows thoroughly
- Validate all user inputs
- Follow PKCE best practices

### Code Security
- Sanitize inputs to external APIs
- Use parameterized queries/requests
- Validate schema compliance
- Test error boundaries

## 🐛 Bug Reports

Use our bug report template and include:
- Clear reproduction steps
- Expected vs actual behavior
- Environment details
- Error logs/screenshots
- Minimal code example

## ✨ Feature Requests

Use our feature request template and include:
- Clear use case description
- User story format
- Technical considerations
- Impact assessment

## 🔍 Code Review Process

### What We Look For
- ✅ Functionality works as expected
- ✅ Tests cover new/changed code
- ✅ Documentation is updated
- ✅ Code follows project conventions
- ✅ No breaking changes (or properly documented)

### Review Checklist
- [ ] Code quality and readability
- [ ] Test coverage and quality
- [ ] Documentation completeness
- [ ] Security considerations
- [ ] Performance implications
- [ ] MCP protocol compliance

## 📞 Getting Help

- **Questions**: Open a [Discussion](https://github.com/whichguy/mcp_gas/discussions)
- **Issues**: Use [GitHub Issues](https://github.com/whichguy/mcp_gas/issues)
- **Documentation**: Check [docs/](docs/) directory
- **Examples**: Review [examples/](examples/) directory

## 🏷️ Release Process

### Versioning
We follow [Semantic Versioning](https://semver.org/):
- **MAJOR** - Breaking changes
- **MINOR** - New features (backward compatible)
- **PATCH** - Bug fixes

### Release Notes
- Include all notable changes
- Group by category (features, fixes, docs)
- Link to relevant issues/PRs
- Highlight breaking changes

## 📄 License

By contributing, you agree that your contributions will be licensed under the same MIT License that covers the project.

---

Thank you for contributing to the MCP Gas Server! 🚀 