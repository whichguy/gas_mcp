# Documentation Index

## 📋 Overview

This directory contains all technical documentation for the MCP Google Apps Script Server, organized by audience and purpose.

## 📁 Documentation Structure

### 📚 API Documentation (`api/`)
Complete API reference documentation for all MCP tools and endpoints.

- **[API_REFERENCE.md](api/API_REFERENCE.md)** - Comprehensive API documentation with schemas, examples, and error handling

### 🛠️ Developer Documentation (`developer/`)
Technical documentation for developers, contributors, and those working on the codebase.

- **[SCHEMAS_AND_VALIDATION.md](developer/SCHEMAS_AND_VALIDATION.md)** - JSON schemas, validation patterns, and input/output formats
- **[LLM_SCHEMA_DESIGN_GUIDE.md](developer/LLM_SCHEMA_DESIGN_GUIDE.md)** - Schema design patterns optimized for LLM consumption
- **[OAUTH_SINGLETON_ARCHITECTURE.md](developer/OAUTH_SINGLETON_ARCHITECTURE.md)** - Deep dive into OAuth callback server architecture
- **[STDOUT_STDERR_DOCUMENTATION.md](developer/STDOUT_STDERR_DOCUMENTATION.md)** - MCP protocol communication and diagnostic logging

## 🎯 Quick Navigation

### For Users
- **Getting Started**: See main [README.md](../README.md) in project root
- **Installation**: Follow setup guide in main README.md
- **Usage Examples**: Check main README.md and [examples/](../examples/) directory

### For API Integration
- **API Reference**: Start with [api/API_REFERENCE.md](api/API_REFERENCE.md)
- **Tool Schemas**: Review [developer/SCHEMAS_AND_VALIDATION.md](developer/SCHEMAS_AND_VALIDATION.md)

### For Developers
- **Architecture**: Begin with [developer/OAUTH_SINGLETON_ARCHITECTURE.md](developer/OAUTH_SINGLETON_ARCHITECTURE.md)
- **LLM Integration**: See [developer/LLM_SCHEMA_DESIGN_GUIDE.md](developer/LLM_SCHEMA_DESIGN_GUIDE.md)
- **Protocol Details**: Reference [developer/STDOUT_STDERR_DOCUMENTATION.md](developer/STDOUT_STDERR_DOCUMENTATION.md)

### For Contributors
- **Schema Development**: Use [developer/LLM_SCHEMA_DESIGN_GUIDE.md](developer/LLM_SCHEMA_DESIGN_GUIDE.md)
- **Validation Patterns**: Reference [developer/SCHEMAS_AND_VALIDATION.md](developer/SCHEMAS_AND_VALIDATION.md)
- **Contributing Guide**: See main [README.md](../README.md) contributing section

## 📊 Document Purposes

| Document | Audience | Purpose |
|----------|----------|---------|
| **API Reference** | Integrators, Power Users | Complete API documentation with examples |
| **Schemas & Validation** | Developers, Contributors | Technical schema specifications |
| **LLM Schema Guide** | AI/LLM Developers | Optimizing tools for AI consumption |
| **OAuth Architecture** | System Architects, Developers | Understanding authentication design |
| **STDOUT/STDERR Docs** | Protocol Developers | MCP communication internals |

## 🔗 External Links

- **[Model Context Protocol](https://modelcontextprotocol.io/)** - MCP specification
- **[Google Apps Script API](https://developers.google.com/apps-script/api)** - Google's official API docs
- **[OAuth 2.0 Guide](https://developers.google.com/identity/protocols/oauth2)** - OAuth implementation reference

---

💡 **Tip**: Start with the main [README.md](../README.md) for general usage, then dive into specific documentation based on your role and needs. 