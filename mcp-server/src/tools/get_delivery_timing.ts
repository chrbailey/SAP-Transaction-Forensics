/**
 * Tool 6: get_delivery_timing
 *
 * Retrieve timing information for a delivery document.
 * Compares requested vs actual dates at header and item level.
 */

import { z } from 'zod';
import { SAPAdapter } from '../adapters/adapter.js';
import { DeliveryTimingParams, DeliveryTimingResult } from '../types/sap.js';
import { createAuditContext } from '../logging/audit.js';
import { withTimeout, getPolicyConfig } from '../policies/limits.js';

/**
 * Zod schema for input validation
 */
export const GetDeliveryTimingSchema = z.object({
  vbeln: z.string().min(1, 'Delivery number is required'),
});

export type GetDeliveryTimingInput = z.infer<typeof GetDeliveryTimingSchema>;

/**
 * Tool definition for MCP registration
 */
export const getDeliveryTimingTool = {
  name: 'get_delivery_timing',
  description: `Retrieve timing information for a delivery document.
Compares requested delivery dates with actual goods movement dates.

Returns:
- Header timing: requested_date, planned_gi_date, actual_gi_date, loading_date
- Item timing: per-item comparison of requested vs actual dates

Use this tool to:
- Analyze delivery performance
- Compare promised vs actual delivery dates
- Identify delayed shipments
- Track goods issue timing

Parameters:
- vbeln: Delivery number (required)`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      vbeln: {
        type: 'string',
        description: 'Delivery number (VBELN)',
      },
    },
    required: ['vbeln'],
  },
};

/**
 * Execute the get_delivery_timing tool
 */
export async function executeGetDeliveryTiming(
  adapter: SAPAdapter,
  rawInput: unknown
): Promise<DeliveryTimingResult | null> {
  // Validate input
  const input = GetDeliveryTimingSchema.parse(rawInput);

  // Create audit context
  const auditContext = createAuditContext(
    'get_delivery_timing',
    input as Record<string, unknown>,
    adapter.name
  );

  try {
    // Build params
    const params: DeliveryTimingParams = {
      vbeln: input.vbeln,
    };

    // Execute with timeout
    const config = getPolicyConfig();
    const result = await withTimeout(
      adapter.getDeliveryTiming(params),
      config.defaultTimeoutMs,
      'get_delivery_timing'
    );

    // Count items if result exists
    const itemCount = result ? result.item_timing.length : 0;

    // Log success
    auditContext.success(result ? 1 + itemCount : 0);

    return result;
  } catch (error) {
    auditContext.error(error as Error);
    throw error;
  }
}
