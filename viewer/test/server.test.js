const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');

test('serves pattern data, downloads and SPA routes', async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'transaction-forensics-viewer-'));
    t.after(() => rm(directory, { recursive: true, force: true }));

    const fixture = path.join(directory, 'pattern_cards.json');
    await writeFile(fixture, JSON.stringify({
        metadata: { document_count: 1 },
        patterns: [{
            id: 'pattern-1',
            title: 'Synthetic pattern',
            description: 'A test pattern',
            confidence: 0.9,
            sample_size: 1,
            evidence: { doc_keys: ['SO-1'] },
        }],
    }));

    const originalDataPath = process.env.PATTERN_DATA_PATH;
    process.env.PATTERN_DATA_PATH = fixture;
    let app;
    try {
        app = require('../src/server');
    } finally {
        if (originalDataPath === undefined) {
            delete process.env.PATTERN_DATA_PATH;
        } else {
            process.env.PATTERN_DATA_PATH = originalDataPath;
        }
    }

    const server = app.listen(0, '127.0.0.1');
    t.after(() => new Promise(resolve => server.close(resolve)));
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const summary = await fetch(`${baseUrl}/api/patterns`);
    assert.equal(summary.status, 200);
    const { patterns } = await summary.json();
    assert.equal(patterns[0].id, 'pattern-1');
    assert.equal(patterns[0].evidence, undefined);

    const evidence = await fetch(`${baseUrl}/api/evidence/pattern-1`);
    assert.equal(evidence.status, 200);
    assert.equal((await evidence.json()).evidence_count, 1);

    const missing = await fetch(`${baseUrl}/api/patterns/missing`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'Pattern not found' });

    const download = await fetch(`${baseUrl}/api/export/markdown`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition'), /pattern_cards\.md/);
    assert.match(await download.text(), /Synthetic pattern/);

    for (const route of ['/', '/review/pattern-1']) {
        const response = await fetch(`${baseUrl}${route}`);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /^text\/html/);
        assert.match(await response.text(), /Transaction Forensics/);
    }
});
