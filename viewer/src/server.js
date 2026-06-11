const express = require('express');
const path = require('path');
const { loadPatternData } = require('./pattern-data');

const app = express();
const PORT = process.env.PORT || 8080;

// Path to pattern cards data
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(__dirname, '../../output');
const DATA_PATH = process.env.PATTERN_DATA_PATH || path.join(OUTPUT_DIR, 'pattern_cards.json');

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// API: Get all patterns (summary view)
app.get('/api/patterns', (req, res) => {
    const data = loadPatternData(DATA_PATH);

    // Return patterns with summary data (excluding full evidence details)
    const summaryPatterns = data.patterns.map(pattern => ({
        id: pattern.id,
        title: pattern.title,
        description: pattern.description,
        confidence: pattern.confidence,
        sample_size: pattern.sample_size,
        top_phrases: pattern.top_phrases,
        effect_sizes: pattern.effect_sizes,
        caveats: pattern.caveats,
        filters: pattern.filters
    }));

    res.json({
        metadata: data.metadata,
        patterns: summaryPatterns
    });
});

// API: Get single pattern with full evidence
app.get('/api/patterns/:id', (req, res) => {
    const data = loadPatternData(DATA_PATH);
    const pattern = data.patterns.find(p => p.id === req.params.id);

    if (!pattern) {
        return res.status(404).json({ error: 'Pattern not found' });
    }

    res.json(pattern);
});

// API: Get evidence for a specific pattern
app.get('/api/evidence/:pattern_id', (req, res) => {
    const data = loadPatternData(DATA_PATH);
    const pattern = data.patterns.find(p => p.id === req.params.pattern_id);

    if (!pattern) {
        return res.status(404).json({ error: 'Pattern not found' });
    }

    // Return only the evidence portion
    res.json({
        pattern_id: pattern.id,
        pattern_title: pattern.title,
        evidence: pattern.evidence || {
            doc_keys: [],
            sample_snippets: []
        },
        evidence_count: pattern.evidence?.doc_keys?.length || 0
    });
});

// API: Get available filter options
app.get('/api/filters', (req, res) => {
    const data = loadPatternData(DATA_PATH);

    // Extract unique filter values from all patterns
    const salesOrgs = new Set();
    const plants = new Set();
    const confidenceLevels = { high: 0, medium: 0, low: 0 };
    const allPhrases = new Set();

    data.patterns.forEach(pattern => {
        // Collect sales orgs
        if (pattern.filters?.sales_orgs) {
            pattern.filters.sales_orgs.forEach(org => salesOrgs.add(org));
        }

        // Collect plants
        if (pattern.filters?.plants) {
            pattern.filters.plants.forEach(plant => plants.add(plant));
        }

        // Count confidence levels
        if (pattern.confidence >= 0.8) {
            confidenceLevels.high++;
        } else if (pattern.confidence >= 0.6) {
            confidenceLevels.medium++;
        } else {
            confidenceLevels.low++;
        }

        // Collect all phrases
        if (pattern.top_phrases) {
            pattern.top_phrases.forEach(phrase => allPhrases.add(phrase));
        }
    });

    res.json({
        sales_orgs: Array.from(salesOrgs).sort(),
        plants: Array.from(plants).sort(),
        confidence_levels: confidenceLevels,
        phrases: Array.from(allPhrases).sort(),
        metadata: {
            total_patterns: data.patterns.length,
            document_count: data.metadata?.document_count || 0,
            date_range: data.metadata?.date_range || null,
            generated_at: data.metadata?.generated_at || null
        }
    });
});

// API: Export all patterns as JSON
app.get('/api/export/json', (req, res) => {
    const data = loadPatternData(DATA_PATH);
    res.setHeader('Content-Disposition', 'attachment; filename="pattern_cards.json"');
    res.setHeader('Content-Type', 'application/json');
    res.json(data);
});

// API: Export all patterns as Markdown
app.get('/api/export/markdown', (req, res) => {
    const data = loadPatternData(DATA_PATH);

    let markdown = `# Transaction Forensics - Pattern Cards\n\n`;
    markdown += `Generated: ${data.metadata?.generated_at || 'Unknown'}\n`;
    markdown += `Documents Analyzed: ${data.metadata?.document_count || 0}\n\n`;
    markdown += `---\n\n`;

    data.patterns.forEach((pattern, index) => {
        markdown += `## ${index + 1}. ${pattern.title}\n\n`;
        markdown += `**ID:** ${pattern.id}\n`;
        markdown += `**Confidence:** ${(pattern.confidence * 100).toFixed(0)}%\n`;
        markdown += `**Sample Size:** ${pattern.sample_size}\n\n`;
        markdown += `### Description\n${pattern.description}\n\n`;

        if (pattern.top_phrases?.length) {
            markdown += `### Key Phrases\n`;
            pattern.top_phrases.forEach(phrase => {
                markdown += `- \`${phrase}\`\n`;
            });
            markdown += `\n`;
        }

        if (pattern.effect_sizes) {
            markdown += `### Effect Sizes\n`;
            markdown += `| Metric | Baseline | Pattern | Multiplier |\n`;
            markdown += `|--------|----------|---------|------------|\n`;
            Object.entries(pattern.effect_sizes).forEach(([key, value]) => {
                markdown += `| ${key} | ${value.baseline} ${value.unit} | ${value.pattern} ${value.unit} | ${value.multiplier}x |\n`;
            });
            markdown += `\n`;
        }

        if (pattern.caveats?.length) {
            markdown += `### Caveats\n`;
            pattern.caveats.forEach(caveat => {
                markdown += `- ${caveat}\n`;
            });
            markdown += `\n`;
        }

        markdown += `---\n\n`;
    });

    res.setHeader('Content-Disposition', 'attachment; filename="pattern_cards.md"');
    res.setHeader('Content-Type', 'text/markdown');
    res.send(markdown);
});

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Transaction Forensics Viewer running at http://localhost:${PORT}`);
    console.log(`Data source: ${DATA_PATH}`);
});
