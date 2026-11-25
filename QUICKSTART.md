# Try Transaction Forensics with Claude Code

The MCP server uses bundled synthetic SAP records. You can try it with Node.js 22.22+ or 24 and its bundled npm, plus [Claude Code](https://code.claude.com/docs/en/overview).

## Clone and build

```bash
git clone https://github.com/chrbailey/SAP-Transaction-Forensics.git
cd SAP-Transaction-Forensics
(cd mcp-server && npm ci && npm run build)
claude
```

Start Claude Code from the repository root. Approve the project’s `transaction-forensics` MCP server when prompted, then run `/mcp` to check the connection.

## Look up a synthetic order

> Use `get_sales_doc_header` to look up sales order `0000000001`. Show the order type and sales organization.

The tool returns `VBELN: 0000000001`, `AUART: OR`, and `VKORG: 3000`. The [demo walkthrough](scripts/demo-walkthrough.md) has more prompts, including conformance and journal entry analysis.

The MCP server exposes 18 data and analysis tools and nine PromptSpeak governance tools. The source also contains evidence tools such as `generate_handoff_packet`, `detect_contradictions`, and `query_provenance`. Those tools require separate integration before they appear in `/mcp`.

## Explore the synthetic Salesforce and SAP dashboard

[Open the hosted demo](https://chrbailey.github.io/SAP-Transaction-Forensics/) or open `demo/index.html` from the checkout. To regenerate its findings with Python 3.10–3.12:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install numpy pandas scipy scikit-learn faker click
make bake-demo
```

The [pattern discovery demo](pattern-discovery/README.md) shows how candidate patterns are evaluated and added to a persistent library.

## Check the server locally

```bash
(cd mcp-server && npm run test:stdio)
```

This runs the built server with the project’s MCP configuration and reads a bundled synthetic order. If the build is missing, run the build step above. If installation fails while compiling `better-sqlite3`, install the platform’s build tools (macOS Command Line Tools or Linux compiler toolchain and Python) and retry.
