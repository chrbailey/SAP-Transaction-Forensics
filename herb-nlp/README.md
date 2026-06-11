# HERB NLP Pipeline

Enterprise-communication forensics using semantic NLP, network analysis, and
temporal change-point detection. **Migrated from the now-archived
`chrbailey/transaction-forensics` repo** so all work lives in one place.

This is the pipeline behind the **NLP Patterns** tab of the
[portfolio dashboard](../demo/portfolio/index.html): TF-IDF + KMeans (and optional
BERTopic) clustering over **37,064 documents** from the Salesforce/HERB dataset,
surfacing communication clusters, approval bottlenecks, and knowledge silos.

## Modules

| File | What it does |
|---|---|
| `analyze.py` | Main pattern engine — semantic clustering, produces `pattern_cards.json` |
| `bertopic_cluster.py` | Optional BERTopic document clustering (sentence-transformers + HDBSCAN + UMAP) |
| `network_analysis.py` | Communication graph — communities, bridge users, product silos |
| `temporal_analysis.py` | Change-point detection over communication volume/topics |

## Run

```bash
cd herb-nlp
pip install -r requirements.txt
python analyze.py            # writes pattern_cards.json
```

The generated `pattern_cards.json` is what the portfolio dashboard's NLP tab reads
(a baked copy is committed at `../demo/portfolio/pattern_cards.json`).

## Relationship to the rest of this repo

The TypeScript MCP server + Python pattern engine in the repo root are the
**forensic engine** (detectors, evidence systems, conformance). This `herb-nlp/`
module is the **unstructured-text discovery** side — the "why" layer described in
the top-level README's core insight. They are complementary: the engine finds
contradictions in structured transactions; this finds the patterns hiding in the
text around them.
