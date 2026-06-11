const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizePatternData } = require('../src/pattern-data');

test('normalizes pattern-engine cards for the viewer', () => {
    const result = normalizePatternData({
        metadata: { document_count: 25 },
        cards: [{
            id: 'pattern-1',
            confidence: 'HIGH',
            confidence_score: 0.91,
            occurrence: {
                count: 5,
                by_sales_org: { '1000': 3, '2000': 2 },
            },
            sample_snippets: ['redacted text'],
            effects: [{
                metric: 'delay_days',
                baseline: 2,
                pattern_value: 6,
                lift: 3,
            }],
            evidence: { doc_keys: ['SO-1'] },
        }],
    });

    assert.equal(result.patterns.length, 1);
    assert.equal(result.patterns[0].confidence, 0.91);
    assert.equal(result.patterns[0].sample_size, 5);
    assert.deepEqual(result.patterns[0].filters.sales_orgs, ['1000', '2000']);
    assert.deepEqual(result.patterns[0].evidence.sample_snippets, ['redacted text']);
    assert.deepEqual(result.patterns[0].effect_sizes.delay_days, {
        baseline: 2,
        pattern: 6,
        multiplier: 3,
        unit: '',
    });
});

test('continues to accept the legacy viewer schema', () => {
    const result = normalizePatternData({
        patterns: [{
            id: 'legacy',
            confidence: 0.7,
            sample_size: 4,
            effect_sizes: {
                cycle_time: { baseline: 1, pattern: 2, multiplier: 2, unit: 'days' },
            },
            filters: { sales_orgs: ['1000'], plants: [] },
            evidence: { doc_keys: [] },
        }],
    });

    assert.equal(result.patterns[0].confidence, 0.7);
    assert.equal(result.patterns[0].sample_size, 4);
    assert.equal(result.patterns[0].effect_sizes.cycle_time.multiplier, 2);
});
