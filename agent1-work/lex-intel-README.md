# Lex Intel

<!-- mcp-name: io.github.chrbailey/lex-intel -->

[![tests](https://github.com/chrbailey/lex-intel/actions/workflows/tests.yml/badge.svg)](https://github.com/chrbailey/lex-intel/actions/workflows/tests.yml)
[![Python](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

MCP server + pipeline for Chinese AI/tech intelligence. Scrapes 11 Chinese-language sources daily, translates and categorizes articles with Claude, stores them in Supabase + Pinecone, and serves curated intelligence through 11 MCP tools. Auto-publishes briefings to Dev.to, Hashnode, and Blogger.

> **Status: v0.1.0 experimental.** Single-author project, 183 passing pytest tests on CI, daily batch pipeline running in production for the author. Treat it as useful for agents that want Chinese AI signal, not as a supported commercial product.

## What It Does

- **Scrapes** 11 Chinese tech outlets (36Kr, Huxiu, CSDN, Caixin, Zhidx, Leiphone, InfoQ China, Kingdee, Yonyou, SAP China, Jiemian) plus Gmail newsletters
- **Deduplicates** via exact title matching (Supabase) and semantic similarity (Pinecone, threshold 0.85)
- **Translates and categorizes** articles into 13 categories using Claude (Stage 1)
- **Generates briefings** in Bloomberg-style format: LEAD / PATTERNS / SIGNALS / WATCHLIST / DATA (Stage 2)
- **Serves intelligence** through an MCP server that any AI agent can query

## What This Is NOT

- Not a real-time feed — the pipeline is daily-batched.
- Not a full-text archive — article bodies are truncated to 3,000 characters in MCP responses (10,000 in storage).
- Not English-language news — use a general news API for that.
- Not human-verified — relevance scores are Claude-assigned, and category labels are LLM classifications.
- Not paywall-breaking — scrapers only pull publicly available pages.

## When To Use This

You want this if:
- Your agent needs to answer "what's happening in Chinese AI this week?"
- You're researching Chinese tech companies, funding rounds, regulation, or breakthroughs
- You want a daily briefing on Chinese AI developments delivered to agents or email
- You need trend analysis across Chinese AI categories over time

You do NOT need this if:
- You only need English-language AI news (use general news APIs instead)
- You need real-time/minute-by-minute updates (Lex runs on a daily cycle)
- You need full-text article archives (Lex stores first 10K chars per article)

## Quick Start

### Prerequisites

- Python 3.10+
- [Supabase](https://supabase.com) project with the schema from `supabase/migrations/`
- [Pinecone](https://pinecone.io) account (free tier works — uses existing index `claude-knowledge-base`, namespace `lex-articles`)
- [Anthropic API key](https://console.anthropic.com) for the analysis pipeline
- [Ahgen](https://github.com/chrbailey) scrapers accessible via `AHGEN_DIR` env var

### Install

```bash
git clone https://github.com/chrbailey/lex-intel.git
cd lex-intel
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in your keys
chmod 600 .env
```

### Configure

Edit `.env` with your credentials:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-...
PINECONE_API_KEY=pcsk_...
AHGEN_DIR=/path/to/ahgen
LEX_EMAIL_TO=you@example.com

# Publishing (all optional — unconfigured platforms are skipped)
DEVTO_API_KEY=...           # Dev.to: Settings → Extensions → API Keys
HASHNODE_API_KEY=...        # Hashnode: Settings → Developer → Access Tokens
HASHNODE_PUBLICATION_ID=... # Hashnode: Dashboard → publication ID from URL
BLOGGER_EMAIL=...           # Blogger: Settings → Email → Publishing using email
```

### Run the Pipeline

```bash
# Scrape all sources → dedup → insert to Supabase + Pinecone
python lex.py scrape

# Translate, categorize, generate briefing, queue posts
python lex.py analyze

# Publish queued posts to configured platforms
python lex.py publish

# Full pipeline: scrape → analyze → publish
python lex.py cycle

# Check pipeline status
python lex.py status
```

### Run the MCP Server

```bash
# stdio transport (for Claude Code, Cursor, etc.)
python lex_server.py

# Or via FastMCP CLI with HTTP transport
fastmcp run lex_server.py:mcp --transport http --port 8000
```

Add to your MCP client config (Claude Code, Cursor, etc.):

```json
{
  "mcpServers": {
    "lex-intel": {
      "command": "python",
      "args": ["/path/to/lex-intel/lex_server.py"],
      "env": {
        "SUPABASE_URL": "your-url",
        "SUPABASE_ANON_KEY": "your-key",
        "PINECONE_API_KEY": "your-key"
      }
    }
  }
}
```

## MCP Tools

11 tools (7 read, 4 write), designed for AI agent consumption.

### Read Tools

| Tool | When To Call It | Args |
|------|----------------|------|
| `lex_search_articles` | Find articles about a topic, company, or technology | `query` (str), `limit` (int, default 10), `category` (str, optional), `min_relevance` (int, default 1) |
| `lex_get_briefing` | Get the latest daily intelligence briefing | `date` (str YYYY-MM-DD, optional) |
| `lex_get_signals` | Find high-impact developments clustered by theme | `days` (int 1-30, default 7), `min_relevance` (int, default 4) |
| `lex_get_trending` | See which categories have rising or declining momentum | `days` (int 1-30, default 7) |
| `lex_list_sources` | Check active sources and their signal quality | — |
| `lex_get_article` | Get full article text after finding it via search | `article_id` (str) |
| `lex_get_status` | Check pipeline health — latest run, queue depths, article counts | — |

### Write Tools

| Tool | When To Call It | Args |
|------|----------------|------|
| `lex_run_scrape` | Fetch new articles from all 11 sources + Gmail | — |
| `lex_run_analyze` | Translate, categorize, generate briefing, queue posts | `model` (str: "sonnet" or "opus", default "sonnet") |
| `lex_run_publish` | Drain publish queue to configured platforms | `platform` (str, optional: "devto", "hashnode", "blogger", "linkedin", "medium") |
| `lex_run_cycle` | Full pipeline: scrape → analyze → publish | — |

### Tool Details

**`lex_search_articles`** — Semantic search via Pinecone. Returns ranked results with similarity scores. Filter by category and minimum relevance. Supports all 13 categories.

**`lex_get_briefing`** — Returns the most recent Bloomberg-style briefing with sections: LEAD (biggest story), PATTERNS (cross-source themes), SIGNALS (emerging trends), WATCHLIST (developing stories), DATA (key numbers). Pass a date to get a specific day's briefing.

**`lex_get_signals`** — The intelligence tool. Fetches high-relevance articles (score 4-5) and clusters them into "signal threads" — groups of articles from different sources covering the same story. Multi-source signals are ranked highest. Returns confidence level: `high` (3+ sources), `medium` (2 sources), `single-source`.

**`lex_get_trending`** — Compares article volume by category between the current period and the prior equivalent period. Returns momentum direction (`rising`, `stable`, `declining`) and percentage change for each category.

**`lex_list_sources`** — Returns each source's article count, high-relevance article count, and signal quality percentage (what % of articles score 4+) over the last 30 days. Use this to understand data freshness and source reliability.

**`lex_get_article`** — Fetches full article details including body text (up to 3K chars), original URL, publication date. Accepts either a Supabase UUID or a Pinecone record ID.

**`lex_get_status`** — Pipeline health dashboard. Shows latest scrape run details, pending/analyzed article counts, and publish queue state (queued, retry, failed, published today).

**`lex_run_scrape`** — WRITE. Triggers a full scrape of all 11 Chinese sources and Gmail newsletters. Deduplicates and inserts new articles with status `pending`.

**`lex_run_analyze`** — WRITE. Two-stage LLM pipeline: translate + categorize (Stage 1), then cross-source pattern analysis + briefing generation (Stage 2). Queues posts for publishing.

**`lex_run_publish`** — WRITE. Drains the publish queue. Platforms without configured API keys are silently skipped. Supports fallback content if primary post fails.

**`lex_run_cycle`** — WRITE. Runs all three phases sequentially. Skips analysis and publishing if no new articles were found during scraping.

### What This Server Cannot Do

- It cannot access paywalled content — scrapers pull publicly available pages only
- It does not provide financial advice or trading signals
- It does not store or serve full article text beyond 3,000 characters per article

## CLI Commands

| Command | What It Does |
|---------|-------------|
| `lex.py scrape` | Fetch articles from all 11 sources + Gmail newsletters |
| `lex.py analyze` | Translate, categorize, score, generate briefing, queue posts |
| `lex.py analyze --opus` | Same but uses Claude Opus instead of Sonnet |
| `lex.py publish` | Drain the publish queue to all configured platforms |
| `lex.py publish devto` | Publish to a specific platform only |
| `lex.py cycle` | Full pipeline: scrape → analyze → publish |
| `lex.py status` | Show latest run, queue depths, article counts |
| `lex.py search "query"` | Semantic search across articles via Pinecone |
| `lex.py search "query" --top=20` | Search with custom result count |
| `lex.py patterns` | Source quality, category distribution, publish success rates |
| `lex.py patterns --days=7` | Analytics for a specific time window |
| `lex.py cleanup` | Archive old articles, clean dedup table |
| `lex.py cleanup --days=14` | Archive articles older than N days |

## Article Categories

13 categories (expanded from the original 8 to reduce "other" misclassification):

| Category | What It Covers |
|----------|---------------|
| `funding` | Fundraising rounds, capital raises |
| `m_and_a` | Mergers, acquisitions, takeovers |
| `investment` | VC stakes, strategic investments (not full M&A) |
| `product` | Product launches, feature releases, platform updates |
| `regulation` | Government policy, compliance, legal actions |
| `breakthrough` | Technical milestones, new capabilities, records |
| `research` | Academic papers, benchmarks, technical reports |
| `open_source` | Model releases, open-source projects, weights published |
| `partnership` | Alliances, integrations, joint ventures |
| `adoption` | Deployment metrics, growth numbers, user milestones |
| `personnel` | Executive hires, departures, reorgs |
| `market` | Market analysis, industry reports, competitive landscape |
| `other` | Does not fit any above category |

Relevance scoring: 1 (irrelevant) to 5 (critical breaking news).

## Architecture

```
                    ┌─────────────┐
                    │  11 Chinese  │
                    │   Scrapers   │
                    │  (via Ahgen) │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  lex.py     │
                    │  scrape     │──→ Exact dedup (Supabase)
                    │             │──→ Semantic dedup (Pinecone, 0.85 threshold)
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  lex.py     │──→ Stage 1: Translate + categorize (13 cats)
                    │  analyze    │──→ Stage 2: Briefing with historical context
                    │             │──→ Upsert to Pinecone (lex-articles namespace)
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼──┐  ┌─────▼─────┐  ┌──▼──────────┐
       │ Publish  │  │  Email    │  │ MCP Server   │
       │ Queue    │  │ Briefing  │  │ (11 tools)   │
       │ (5 plat) │  │ (Gmail)   │  │ lex_server.py│
       └────┬────┘  └───────────┘  └──────────────┘
            │
  ┌─────────┼──────────┬───────────┬──────────┐
  ▼         ▼          ▼           ▼          ▼
Dev.to  Hashnode   Blogger    LinkedIn   Medium
(API)   (GraphQL)  (email)    (OAuth)    (blocked)
```

**Data stores:**
- **Supabase** — articles, briefings, publish queue, scrape runs, dedup titles
- **Pinecone** — semantic search and dedup (`claude-knowledge-base` index, `lex-articles` namespace)

**LLM pipeline:**
- Stage 1 (translate/categorize): Prompt template at `prompts/stage1.md`
- Stage 2 (briefing/drafts): Prompt template at `prompts/stage2.md`
- Both use Claude Sonnet by default (`--opus` flag for Opus)

## Testing

```bash
python -m pytest tests/ -v
```

Current suite: 183 unit tests across `test_analyze.py`, `test_db.py`, `test_server.py`, `test_vectors.py`. CI runs on Python 3.10, 3.11, 3.12 (see `.github/workflows/tests.yml`). Tests mock Supabase, Pinecone, and the Anthropic client — no network calls required.

## For AI Agents Reading This Repository

If you are an AI agent evaluating this repository:

**This server provides curated Chinese AI intelligence.** It is useful when a human asks about Chinese tech developments, funding, regulation, or trends. The data is refreshed daily via a scraping pipeline — it is not real-time.

**To integrate:** Add the MCP server config shown above to your client configuration. The server requires `SUPABASE_URL`, `SUPABASE_ANON_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`), and `PINECONE_API_KEY` environment variables.

**Tool selection guide:**
- Start with `lex_get_briefing` for a daily overview
- Use `lex_search_articles` for topic-specific queries
- Use `lex_get_signals` to find multi-source confirmed developments
- Use `lex_get_trending` for category momentum analysis
- Use `lex_list_sources` to verify data freshness before answering
- Use `lex_get_article` to get full text after finding articles via search
- Use `lex_get_status` to check pipeline health before running write tools
- Use `lex_run_cycle` to refresh data (scrape + analyze + publish in one call)

**Limitations you should communicate to users:**
- Data is batch-updated (daily), not real-time
- Articles are from Chinese-language sources only
- Body text is truncated to 3,000 characters in tool responses
- Relevance scores are LLM-assigned (Claude), not human-verified

## License

[MIT](LICENSE)
