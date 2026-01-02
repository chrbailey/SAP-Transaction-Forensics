/**
 * Tool Registry
 *
 * Central export point for all MCP tools.
 * Each tool includes its definition (for MCP registration) and executor function.
 */

// Tool 1: Search Document Text
export {
  searchDocTextTool,
  executeSearchDocText,
  SearchDocTextSchema,
  type SearchDocTextInput,
} from './search_doc_text.js';

// Tool 2: Get Document Text
export {
  getDocTextTool,
  executeGetDocText,
  GetDocTextSchema,
  type GetDocTextInput,
} from './get_doc_text.js';

// Tool 3: Get Document Flow
export {
  getDocFlowTool,
  executeGetDocFlow,
  GetDocFlowSchema,
  type GetDocFlowInput,
} from './get_doc_flow.js';

// Tool 4: Get Sales Document Header
export {
  getSalesDocHeaderTool,
  executeGetSalesDocHeader,
  GetSalesDocHeaderSchema,
  type GetSalesDocHeaderInput,
} from './get_sales_doc_header.js';

// Tool 5: Get Sales Document Items
export {
  getSalesDocItemsTool,
  executeGetSalesDocItems,
  GetSalesDocItemsSchema,
  type GetSalesDocItemsInput,
} from './get_sales_doc_items.js';

// Tool 6: Get Delivery Timing
export {
  getDeliveryTimingTool,
  executeGetDeliveryTiming,
  GetDeliveryTimingSchema,
  type GetDeliveryTimingInput,
} from './get_delivery_timing.js';

// Tool 7: Get Invoice Timing
export {
  getInvoiceTimingTool,
  executeGetInvoiceTiming,
  GetInvoiceTimingSchema,
  type GetInvoiceTimingInput,
} from './get_invoice_timing.js';

// Tool 8: Get Master Stub
export {
  getMasterStubTool,
  executeGetMasterStub,
  GetMasterStubSchema,
  type GetMasterStubInput,
} from './get_master_stub.js';

// Tool 9: Ask Process (Natural Language Interface)
export {
  askProcessTool,
  executeAskProcess,
  AskProcessSchema,
  type AskProcessInput,
} from './ask_process.js';

/**
 * All tool definitions for MCP registration
 */
import { searchDocTextTool } from './search_doc_text.js';
import { getDocTextTool } from './get_doc_text.js';
import { getDocFlowTool } from './get_doc_flow.js';
import { getSalesDocHeaderTool } from './get_sales_doc_header.js';
import { getSalesDocItemsTool } from './get_sales_doc_items.js';
import { getDeliveryTimingTool } from './get_delivery_timing.js';
import { getInvoiceTimingTool } from './get_invoice_timing.js';
import { getMasterStubTool } from './get_master_stub.js';
import { askProcessTool } from './ask_process.js';

export const allTools = [
  searchDocTextTool,
  getDocTextTool,
  getDocFlowTool,
  getSalesDocHeaderTool,
  getSalesDocItemsTool,
  getDeliveryTimingTool,
  getInvoiceTimingTool,
  getMasterStubTool,
  askProcessTool,
];

/**
 * Tool executor map for routing
 */
import { executeSearchDocText } from './search_doc_text.js';
import { executeGetDocText } from './get_doc_text.js';
import { executeGetDocFlow } from './get_doc_flow.js';
import { executeGetSalesDocHeader } from './get_sales_doc_header.js';
import { executeGetSalesDocItems } from './get_sales_doc_items.js';
import { executeGetDeliveryTiming } from './get_delivery_timing.js';
import { executeGetInvoiceTiming } from './get_invoice_timing.js';
import { executeGetMasterStub } from './get_master_stub.js';
import { executeAskProcess } from './ask_process.js';
import { SAPAdapter } from '../adapters/adapter.js';

export type ToolExecutor = (adapter: SAPAdapter, input: unknown) => Promise<unknown>;

export const toolExecutors: Record<string, ToolExecutor> = {
  search_doc_text: executeSearchDocText,
  get_doc_text: executeGetDocText,
  get_doc_flow: executeGetDocFlow,
  get_sales_doc_header: executeGetSalesDocHeader,
  get_sales_doc_items: executeGetSalesDocItems,
  get_delivery_timing: executeGetDeliveryTiming,
  get_invoice_timing: executeGetInvoiceTiming,
  get_master_stub: executeGetMasterStub,
  ask_process: executeAskProcess,
};

/**
 * Execute a tool by name
 */
export async function executeTool(
  toolName: string,
  adapter: SAPAdapter,
  input: unknown
): Promise<unknown> {
  const executor = toolExecutors[toolName];
  if (!executor) {
    throw new Error(`Unknown tool: ${toolName}`);
  }
  return executor(adapter, input);
}
