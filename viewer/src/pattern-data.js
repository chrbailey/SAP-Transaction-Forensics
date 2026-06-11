const fs = require('fs');

function effectMap(card) {
    if (card.effect_sizes && !Array.isArray(card.effect_sizes)) {
        return card.effect_sizes;
    }

    return Object.fromEntries((card.effects || []).map(effect => {
        const baseline = Number(effect.baseline);
        const pattern = Number(effect.pattern_value);
        const multiplier = effect.lift ?? (baseline === 0 ? null : pattern / baseline);

        return [effect.metric, {
            baseline,
            pattern,
            multiplier,
            unit: effect.unit || '',
        }];
    }));
}

function normalizePattern(card) {
    const occurrence = card.occurrence || {};
    const fullEvidence = card.full_evidence || {};
    const evidence = card.evidence || {};

    return {
        ...card,
        confidence: card.confidence_score ?? (
            typeof card.confidence === 'number' ? card.confidence : 0
        ),
        sample_size: card.sample_size ?? occurrence.count ?? evidence.sample_size ?? 0,
        effect_sizes: effectMap(card),
        filters: card.filters || {
            sales_orgs: Object.keys(occurrence.by_sales_org || {}),
            plants: Object.keys(occurrence.by_plant || {}),
        },
        evidence: {
            ...evidence,
            doc_keys: evidence.doc_keys || fullEvidence.doc_keys || [],
            sample_snippets: evidence.sample_snippets || card.sample_snippets || [],
        },
    };
}

function normalizePatternData(data) {
    const rawPatterns = data.patterns || data.cards || data.pattern_cards || [];
    return {
        ...data,
        metadata: data.metadata || {},
        patterns: rawPatterns.map(normalizePattern),
    };
}

function loadPatternData(dataPath) {
    try {
        return normalizePatternData(JSON.parse(fs.readFileSync(dataPath, 'utf8')));
    } catch (error) {
        console.error('Error loading pattern data:', error.message);
        return {
            metadata: {
                generated_at: new Date().toISOString(),
                document_count: 0,
                error: 'No pattern data available',
            },
            patterns: [],
        };
    }
}

module.exports = {
    loadPatternData,
    normalizePattern,
    normalizePatternData,
};
