import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('project MCP config serves bundled synthetic data over clean stdio', { timeout: 15000 }, async () => {
  const root = new URL('../../', import.meta.url);
  const config = JSON.parse(await readFile(new URL('.mcp.json', root), 'utf8'));
  const transport = new StdioClientTransport({
    ...config.mcpServers['transaction-forensics'],
    cwd: fileURLToPath(root),
    stderr: 'ignore',
  });
  const client = new Client({ name: 'stdio-smoke-test', version: '1.0.0' });
  const protocolErrors = [];
  client.onerror = error => protocolErrors.push(error.message);

  try {
    await client.connect(transport, { timeout: 5000 });
    const { tools } = await client.listTools();
    assert.ok(tools.some(tool => tool.name === 'get_sales_doc_header'));

    const vbeln = '0000000001';
    const header = await client.callTool({ name: 'get_sales_doc_header', arguments: { vbeln } });
    assert.ok(!header.isError);
    const order = JSON.parse(header.content[0].text);
    assert.equal(order.VBELN, vbeln);
    assert.equal(order.AUART, 'OR');
    assert.equal(order.VKORG, '3000');

    const invalid = await client.callTool({
      name: 'get_sales_doc_header',
      arguments: { vbeln: 1 },
    });
    assert.equal(invalid.isError, true);
    const validation = JSON.parse(invalid.content[0].text);
    assert.equal(validation.code, 'VALIDATION_ERROR');
    assert.deepEqual(validation.issues[0].path, ['vbeln']);

    const halted = await client.callTool({
      name: 'ps_halt_agent',
      arguments: { agent_id: 'stdio-smoke-test', reason: 'test process only' },
    });
    assert.ok(!halted.isError);
    assert.equal(JSON.parse(halted.content[0].text).halted, true);

    assert.deepEqual(protocolErrors, []);
  } finally {
    await client.close();
  }
});
