#!/usr/bin/env node
/**
 * SAP Workflow Mining MCP Server
 *
 * This server exposes 8 SAP-shaped tools for workflow mining analysis.
 * It uses the Model Context Protocol (MCP) to integrate with AI assistants.
 *
 * Architecture:
 * - Tools: 8 specialized tools for SAP document analysis
 * - Adapters: Pluggable data sources (synthetic, ECC RFC, S/4 OData)
 * - Policies: Row limits, field restrictions, timeout handling
 * - Governance: PromptSpeak-based pre-execution blocking and holds
 * - Audit: Comprehensive logging of all tool calls
 *
 * Usage:
 *   SAP_ADAPTER=synthetic node dist/index.js
 *   SYNTHETIC_DATA_PATH=/path/to/data node dist/index.js
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { IDataAdapter } from './adapters/adapter-interface.js';
import { SyntheticAdapter } from './adapters/synthetic/index.js';
import { allTools, executeTool } from './tools/index.js';
import { logServerEvent } from './logging/audit-logger.js';
import { PolicyViolationError, TimeoutError } from './policies/limits.js';
import { gatekeeper, getFrameDocumentation } from './governance/index.js';

// Import adapters to ensure they register themselves
import './adapters/ecc_rfc/index.js';
import './adapters/s4_odata/index.js';
import './adapters/csv/index.js';

/**
 * Server configuration from environment
 */
interface ServerConfig {
  adapterType: 'synthetic' | 'ecc_rfc' | 's4_odata' | 'csv';
  syntheticDataPath?: string;
  csvFilePaths?: string[];
  logLevel?: string;
}

function getConfig(): ServerConfig {
  const syntheticDataPath = process.env['SYNTHETIC_DATA_PATH'];
  const csvPaths = process.env['CSV_FILE_PATHS'];
  return {
    adapterType: (process.env['SAP_ADAPTER'] as ServerConfig['adapterType']) || 'synthetic',
    ...(syntheticDataPath ? { syntheticDataPath } : {}),
    ...(csvPaths ? { csvFilePaths: csvPaths.split(',').map(p => p.trim()) } : {}),
    logLevel: process.env['LOG_LEVEL'] || 'info',
  };
}

/**
 * Create the appropriate adapter based on configuration
 */
async function createAdapter(config: ServerConfig): Promise<IDataAdapter> {
  switch (config.adapterType) {
    case 'synthetic': {
      const adapter = new SyntheticAdapter(config.syntheticDataPath);
      await adapter.initialize();
      return adapter;
    }

    case 'csv': {
      const { CSVAdapter } = await import('./adapters/csv/index.js');
      const csvAdapter = new CSVAdapter(config.csvFilePaths);
      await csvAdapter.initialize();
      return csvAdapter;
    }

    case 'ecc_rfc':
    case 's4_odata':
      throw new Error(
        `Adapter '${config.adapterType}' is not yet implemented. ` +
          `Use 'synthetic' adapter for testing or implement the adapter.`
      );

    default:
      throw new Error(`Unknown adapter type: ${config.adapterType}`);
  }
}

/**
 * Create and configure the MCP server
 */
function createMCPServer(): Server {
  const server = new Server(
    {
      name: 'sap-workflow-mining',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  return server;
}

/**
 * Governance tools for PromptSpeak integration
 */
const governanceTools = [
  {
    name: 'ps_precheck',
    description:
      'Check if an SAP operation would be allowed without executing. Returns governance decision including hold status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tool: { type: 'string', description: 'SAP tool name to check' },
        params: { type: 'object', description: 'Tool parameters' },
        frame: { type: 'string', description: 'PromptSpeak frame (e.g., ⊕◐◀α)' },
      },
      required: ['tool', 'params'],
    },
  },
  {
    name: 'ps_list_holds',
    description: 'List pending holds awaiting human approval',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'ps_approve_hold',
    description: 'Approve a held operation for execution',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hold_id: { type: 'string', description: 'Hold ID to approve' },
        approved_by: { type: 'string', description: 'Approver identifier' },
        modified_params: { type: 'object', description: 'Optional modified parameters' },
      },
      required: ['hold_id', 'approved_by'],
    },
  },
  {
    name: 'ps_reject_hold',
    description: 'Reject a held operation',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hold_id: { type: 'string', description: 'Hold ID to reject' },
        rejected_by: { type: 'string', description: 'Rejector identifier' },
        reason: { type: 'string', description: 'Rejection reason' },
      },
      required: ['hold_id', 'rejected_by', 'reason'],
    },
  },
  {
    name: 'ps_agent_status',
    description: 'Get governance status for an agent (circuit breaker state)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string', description: 'Agent ID (default: "default")' },
      },
    },
  },
  {
    name: 'ps_halt_agent',
    description: 'Halt an agent via circuit breaker (blocks all operations)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string', description: 'Agent ID to halt' },
        reason: { type: 'string', description: 'Reason for halting' },
      },
      required: ['agent_id', 'reason'],
    },
  },
  {
    name: 'ps_resume_agent',
    description: 'Resume a halted agent',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string', description: 'Agent ID to resume' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'ps_stats',
    description: 'Get governance statistics (holds, blocked operations, audit counts)',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'ps_frame_docs',
    description: 'Get documentation for PromptSpeak frame format',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

/**
 * Execute a governance tool
 */
function executeGovernanceTool(name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case 'ps_precheck':
      return gatekeeper.precheck({
        agentId: (args['agent_id'] as string) || 'default',
        frame: args['frame'] as string,
        tool: args['tool'] as string,
        params: (args['params'] as Record<string, unknown>) || {},
      });

    case 'ps_list_holds':
      return gatekeeper.listHolds();

    case 'ps_approve_hold':
      return gatekeeper.approveHold(
        args['hold_id'] as string,
        args['approved_by'] as string,
        args['modified_params'] as Record<string, unknown> | undefined
      );

    case 'ps_reject_hold':
      return gatekeeper.rejectHold(
        args['hold_id'] as string,
        args['rejected_by'] as string,
        args['reason'] as string
      );

    case 'ps_agent_status':
      return gatekeeper.getAgentStatus((args['agent_id'] as string) || 'default');

    case 'ps_halt_agent':
      gatekeeper.haltAgent(args['agent_id'] as string, args['reason'] as string);
      return { halted: true, agent_id: args['agent_id'] };

    case 'ps_resume_agent': {
      const resumed = gatekeeper.resumeAgent(args['agent_id'] as string);
      return { resumed, agent_id: args['agent_id'] };
    }

    case 'ps_stats':
      return gatekeeper.getStats();

    case 'ps_frame_docs':
      return { documentation: getFrameDocumentation() };

    default:
      throw new Error(`Unknown governance tool: ${name}`);
  }
}

/**
 * Set up request handlers for the MCP server
 */
function setupHandlers(server: Server, adapter: IDataAdapter): void {
  // Register tool list handler (includes both SAP and governance tools)
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [...allTools, ...governanceTools],
    };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params;

    try {
      // Check if this is a governance tool
      if (name.startsWith('ps_')) {
        const result = executeGovernanceTool(name, args || {});
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // For SAP tools, run through governance pipeline first
      const frame = (args?.['_frame'] as string) || undefined;
      const agentId = (args?.['_agent_id'] as string) || 'default';

      // Remove governance metadata from args before passing to tool
      const cleanArgs = { ...args };
      delete cleanArgs['_frame'];
      delete cleanArgs['_agent_id'];

      // Execute governance check
      const govResult = gatekeeper.execute({
        agentId,
        frame: frame || '', // Empty frame will get default
        tool: name,
        params: cleanArgs || {},
      });

      // If held, return hold info
      if (govResult.held) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  held: true,
                  hold_id: govResult.holdRequest?.holdId,
                  reason: govResult.holdRequest?.reason,
                  severity: govResult.holdRequest?.severity,
                  message:
                    'Operation held for human approval. Use ps_approve_hold or ps_reject_hold to proceed.',
                  expires_at: govResult.holdRequest?.expiresAt,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // If blocked by governance, return error
      if (!govResult.allowed) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'Governance Blocked',
                  code: 'GOVERNANCE_BLOCKED',
                  message: govResult.error,
                  audit_id: govResult.auditId,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      // Execute the actual SAP tool
      const result = await executeTool(name, adapter, cleanArgs);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      // Handle different error types with structured JSON responses

      // Policy violations (row limits, field access, etc.)
      if (error instanceof PolicyViolationError) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'Policy Violation',
                  code: 'POLICY_VIOLATION',
                  message: error.message,
                  violation: error.violation,
                  details: error.details,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      // Timeout errors
      if (error instanceof TimeoutError) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'Timeout',
                  code: 'TIMEOUT',
                  message: error.message,
                  timeout_ms: error.timeoutMs,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      // Zod validation errors
      if (error && typeof error === 'object' && 'issues' in error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'Validation Error',
                  code: 'VALIDATION_ERROR',
                  message: 'Invalid tool parameters',
                  issues: (error as { issues: unknown[] }).issues,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      // Generic errors
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorName = error instanceof Error ? error.name : 'UnknownError';

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: 'Tool Execution Error',
                code: 'EXECUTION_ERROR',
                error_type: errorName,
                message: errorMessage,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  });
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const config = getConfig();

  logServerEvent('start', {
    adapter: config.adapterType,
    data_path: config.syntheticDataPath || 'default',
    tools_count: allTools.length,
  });

  try {
    // Create adapter
    const adapter = await createAdapter(config);

    // Create MCP server
    const server = createMCPServer();

    // Set up handlers
    setupHandlers(server, adapter);

    // Set up graceful shutdown
    const shutdown = async (signal: string) => {
      logServerEvent('stop', { signal });
      await adapter.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Connect to stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    logServerEvent('ready', {
      adapter: adapter.name,
      tools: allTools.map(t => t.name),
    });

    // Server is now running and waiting for requests via stdio
  } catch (error) {
    logServerEvent('error', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// Run the server
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
