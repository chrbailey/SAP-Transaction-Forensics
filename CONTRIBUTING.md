# Contributing to SAP Workflow Mining

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## Code of Conduct

Be respectful, professional, and constructive. We welcome contributors from all backgrounds.

## How to Contribute

### Reporting Bugs

1. Check existing issues to avoid duplicates
2. Use the bug report template
3. Include reproduction steps and environment details
4. Redact any sensitive SAP data from logs

### Suggesting Features

1. Open a feature request issue
2. Describe the use case and problem it solves
3. Consider SAP-specific context (modules, tables, BAPIs)

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `make test`
5. Submit a pull request

## Development Setup

### Prerequisites

- Docker & Docker Compose
- Node.js 18+ (for MCP Server)
- Python 3.10+ (for Pattern Engine)
- Optional: SAP NetWeaver RFC SDK (for RFC adapter)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/your-org/sap-workflow-mining.git
cd sap-workflow-mining

# Run with synthetic data (no SAP required)
docker-compose up --build

# Run tests
make test
```

### Project Structure

```
sap-workflow-mining/
├── mcp-server/          # TypeScript MCP server with SAP tools
│   ├── src/adapters/    # Data source adapters (synthetic, RFC, OData)
│   └── src/tools/       # MCP tool implementations
├── pattern-engine/      # Python pattern discovery engine
│   └── src/             # Ingest, cluster, correlate, report
├── synthetic-data/      # Test data generator
├── viewer/              # Web UI for pattern cards
└── docs/                # Documentation
```

## Coding Standards

### TypeScript (MCP Server)

- Use strict mode
- Follow existing code style
- Add JSDoc comments for public APIs
- Handle errors explicitly (no silent failures)

### Python (Pattern Engine)

- Follow PEP 8
- Type hints for function signatures
- Docstrings for public functions
- Use `pytest` for tests

## Testing

### Run All Tests

```bash
make test
```

### Individual Components

```bash
# MCP Server
cd mcp-server && npm test

# Pattern Engine
cd pattern-engine && pytest

# Integration tests
docker-compose run pattern-engine python -m pytest tests/
```

## Security Considerations

When contributing:

1. **Never commit credentials** - Use environment variables
2. **No real SAP data** - All test data must be synthetic
3. **Read-only operations** - Do not add write operations to SAP
4. **PII handling** - Ensure redaction applies to new fields

## Release Process

1. Update version in package.json and pyproject.toml
2. Update CHANGELOG.md
3. Create a GitHub release with tag
4. Docker images are built automatically

## Questions?

Open an issue with the "question" label.
