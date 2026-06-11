# Live Demo Dashboard

A **zero-install** forensic dashboard. It renders real findings from the analysis
pipeline — anomaly detection, cross-system SFDC↔SAP correlation, quarter-end
compression, and evidence chains — with no SAP access required.

## See it three ways

| Way | Command | Notes |
|-----|---------|-------|
| **Live (hosted)** | visit the GitHub Pages URL | Nothing to install. Auto-deployed from `main`. |
| **One command** | `make demo-web` | Regenerates findings (seed 42) and opens the dashboard locally. |
| **Double-click** | open `demo/index.html` | Works offline — data is baked into `findings-data.js`. |

## Files

- `index.html` — the dashboard (self-contained: inline CSS + JS).
- `findings-data.js` — baked findings as `window.DEMO_FINDINGS` (so the page works from `file://`).
- `findings.json` — the same findings, machine-readable (for download / reuse).
- `report.md` — the full Markdown forensic report.

## Regenerating

The data is deterministic. To rebuild after changing the analysis code:

```bash
./scripts/bake-demo.sh      # or: make bake-demo
```

This generates synthetic Salesforce + SAP data (seed 42), runs the forensic
analysis, and rewrites the three data files above.
