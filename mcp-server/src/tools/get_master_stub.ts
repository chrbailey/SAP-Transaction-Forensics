/**
 * Tool 8: get_master_stub
 *
 * Retrieve safe/anonymized attributes for master data entities.
 * Does NOT return PII or sensitive business data.
 */

import { z } from 'zod';
import { SAPAdapter } from '../adapters/adapter.js';
import { MasterStubParams, MasterStub } from '../types/sap.js';
import { createAuditContext } from '../logging/audit.js';
import { withTimeout, getPolicyConfig } from '../policies/limits.js';

/**
 * Zod schema for input validation
 */
export const GetMasterStubSchema = z.object({
  entity_type: z.enum(['customer', 'vendor', 'material']),
  id: z.string().min(1, 'Entity ID is required'),
  hash_id: z.boolean().optional().default(false),
});

export type GetMasterStubInput = z.infer<typeof GetMasterStubSchema>;

/**
 * Tool definition for MCP registration
 */
export const getMasterStubTool = {
  name: 'get_master_stub',
  description: `Retrieve safe/anonymized attributes for master data entities.
Returns ONLY non-sensitive classification data - NO PII or sensitive business data.

Safe attributes returned:
- Industry classification
- Geographic region (coarse, e.g., country/state level)
- Category/classification codes
- Account group (for customers/vendors)
- Material type/group (for materials)
- Optionally: hashed ID for anonymization

NOT returned (for privacy):
- Names, addresses, contact details
- Bank accounts, tax IDs
- Credit limits, payment terms
- Specific pricing data

Use this tool to:
- Get classification data for analysis
- Understand customer/vendor/material categories
- Support process mining without exposing PII

Parameters:
- entity_type: customer, vendor, or material (required)
- id: Entity ID (required)
- hash_id: If true, include a hashed version of the ID (optional)`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      entity_type: {
        type: 'string',
        enum: ['customer', 'vendor', 'material'],
        description: 'Type of master data entity',
      },
      id: {
        type: 'string',
        description: 'Entity ID (customer number, vendor number, or material number)',
      },
      hash_id: {
        type: 'boolean',
        description: 'Include hashed ID for anonymization (optional, default false)',
      },
    },
    required: ['entity_type', 'id'],
  },
};

/**
 * Execute the get_master_stub tool
 */
export async function executeGetMasterStub(
  adapter: SAPAdapter,
  rawInput: unknown
): Promise<MasterStub | null> {
  // Validate input
  const input = GetMasterStubSchema.parse(rawInput);

  // Create audit context
  const auditContext = createAuditContext(
    'get_master_stub',
    input as Record<string, unknown>,
    adapter.name
  );

  try {
    // Build params
    const params: MasterStubParams = {
      entity_type: input.entity_type,
      id: input.id,
      hash_id: input.hash_id,
    };

    // Execute with timeout
    const config = getPolicyConfig();
    const result = await withTimeout(
      adapter.getMasterStub(params),
      config.defaultTimeoutMs,
      'get_master_stub'
    );

    // Log success
    auditContext.success(result ? 1 : 0);

    return result;
  } catch (error) {
    auditContext.error(error as Error);
    throw error;
  }
}
