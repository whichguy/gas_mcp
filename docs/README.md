# Documentation Index

## 📋 Overview

This directory contains all technical documentation for the MCP Google Apps Script Server, organized by audience and purpose.

## 📁 Documentation Structure

### 🎯 Quick Reference
**Start here for comprehensive tool documentation**:
- **[REFERENCE.md](REFERENCE.md)** - Complete reference for all 63 tools: capabilities, limitations, compatibility matrix, and troubleshooting

### 📚 API Documentation (`api/`)
Complete API reference documentation for all MCP tools and endpoints.

- **[API_REFERENCE.md](api/API_REFERENCE.md)** - Comprehensive API documentation with schemas, examples, and error handling
- **[LOCAL_SYNC_API.md](api/LOCAL_SYNC_API.md)** - Local file synchronization API documentation

### 🛠️ Developer Documentation (`developer/`)
Technical documentation for developers, contributors, and those working on the codebase.

- **[SCHEMAS_AND_VALIDATION.md](developer/SCHEMAS_AND_VALIDATION.md)** - JSON schemas, validation patterns, and input/output formats
- **[LLM_SCHEMA_DESIGN_GUIDE.md](developer/LLM_SCHEMA_DESIGN_GUIDE.md)** - Schema design patterns optimized for LLM consumption
- **[OAUTH_SINGLETON_ARCHITECTURE.md](developer/OAUTH_SINGLETON_ARCHITECTURE.md)** - Deep dive into OAuth callback server architecture
- **[STDOUT_STDERR_DOCUMENTATION.md](developer/STDOUT_STDERR_DOCUMENTATION.md)** - MCP protocol communication and diagnostic logging

### 🔒 Security Documentation (`security/`)
Security guidelines and best practices for the MCP server.

- **[SECURITY_GUIDELINES.md](security/SECURITY_GUIDELINES.md)** - Security best practices and guidelines for AI assistants

### ⚙️ Configuration
- **[UNIFIED_CONFIGURATION.md](UNIFIED_CONFIGURATION.md)** - Configuration management system and settings

### 🔄 Git Integration (`git/`)
Version control integration workflows and patterns for Google Apps Script.

- **[GIT_WORKFLOWS.md](git/GIT_WORKFLOWS.md)** - Complete Git sync workflows, tool reference, and best practices
- **[archive/](git/archive/)** - Historical development, testing docs, and proposals

## 🎯 Quick Navigation

### For Users
- **🎯 Tool Reference**: Start with **[REFERENCE.md](REFERENCE.md)** for complete capabilities, limitations, and compatibility
- **Getting Started**: See main [README.md](../README.md) in project root
- **Claude Code Users**: See [CLAUDE.md](../CLAUDE.md) for specific instructions
- **Installation**: Follow setup guide in main README.md
- **Usage Examples**: Check [examples/README.md](../examples/README.md)

### For API Integration
- **API Reference**: Start with [api/API_REFERENCE.md](api/API_REFERENCE.md)
- **Local Sync**: Review [api/LOCAL_SYNC_API.md](api/LOCAL_SYNC_API.md)
- **Tool Schemas**: Review [developer/SCHEMAS_AND_VALIDATION.md](developer/SCHEMAS_AND_VALIDATION.md)

### For Developers
- **Architecture**: Begin with [developer/OAUTH_SINGLETON_ARCHITECTURE.md](developer/OAUTH_SINGLETON_ARCHITECTURE.md)
- **LLM Integration**: See [developer/LLM_SCHEMA_DESIGN_GUIDE.md](developer/LLM_SCHEMA_DESIGN_GUIDE.md)
- **Protocol Details**: Reference [developer/STDOUT_STDERR_DOCUMENTATION.md](developer/STDOUT_STDERR_DOCUMENTATION.md)

### For Contributors
- **Contributing Guide**: See [.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md)
- **Schema Development**: Use [developer/LLM_SCHEMA_DESIGN_GUIDE.md](developer/LLM_SCHEMA_DESIGN_GUIDE.md)
- **Validation Patterns**: Reference [developer/SCHEMAS_AND_VALIDATION.md](developer/SCHEMAS_AND_VALIDATION.md)

## 📊 Document Purposes

| Document | Audience | Purpose |
|----------|----------|---------|
| **🎯 REFERENCE.md** | All Users | Complete tool capabilities, limitations, compatibility matrix, troubleshooting |
| **API Reference** | Integrators, Power Users | Complete API documentation with examples |
| **Local Sync API** | Developers | Local file synchronization details |
| **Schemas & Validation** | Developers, Contributors | Technical schema specifications |
| **LLM Schema Guide** | AI/LLM Developers | Optimizing tools for AI consumption |
| **OAuth Architecture** | System Architects, Developers | Understanding authentication design |
| **STDOUT/STDERR Docs** | Protocol Developers | MCP communication internals |
| **Security Guidelines** | All Users | Security best practices |
| **Unified Configuration** | Administrators | Configuration management |

## 🔗 External Links

- **[Model Context Protocol](https://modelcontextprotocol.io/)** - MCP specification
- **[Google Apps Script API](https://developers.google.com/apps-script/api)** - Google's official API docs
- **[OAuth 2.0 Guide](https://developers.google.com/identity/protocols/oauth2)** - OAuth implementation reference

---

💡 **Tip**: Start with the main [README.md](../README.md) for general usage, then dive into specific documentation based on your role and needs.