/**
 * Tool: analyze_sod
 *
 * Segregation of Duties (SoD) Analysis for SAP FI/CO
 *
 * Detects conflict pairs where the same user performs incompatible
 * functions, violating internal control requirements.
 *
 * Conflict matrix:
 * - Post-and-approve: Same user posts and approves entries
 * - Create-and-pay: Vendor master creation + payment execution
 * - Park-and-post: Same user parks and posts (bypasses review)
 * - Vendor master + payment run: XK01/XK02 + F110
 * - Post-and-reverse: Same user creates and reverses entries
 *
 * Data source: BKPF/BSEG from FI/CO dataset loaded via CSV adapter
 */

import { z } from 'zod';
import { SAPAdapter } from '../adapters/adapter.js';
import { createAuditContext } from '../logging/audit.js';
import { getFICoDataset } from '../adapters/csv/index.js';
import { BKPF, SoDConflict, ForensicSeverity, FICoDataset } from '../types/fi-co.js';

// ============================================================================
// Zod Schema
// ============================================================================

export const AnalyzeSoDSchema = z.object({
  company_code: z.string().optional().describe('Filter by company code (BUKRS)'),
  fiscal_year: z.string().optional().describe('Filter by fiscal year (GJAHR)'),
  min_occurrences: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe('Minimum conflict occurrences to report (default: 1)'),
  include_low_risk: z
    .boolean()
    .default(false)
    .describe('Include low-risk conflicts (default: false)'),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe('Maximum conflicts to return (default: 100)'),
  csv_file: z.string().optional().describe('Path to CSV file to load (if data not already loaded)'),
});

export type AnalyzeSoDInput = z.infer<typeof AnalyzeSoDSchema>;

// ============================================================================
// Tool Definition
// ============================================================================

export const analyzeSoDTool = {
  name: 'analyze_sod',
  description: `Segregation of Duties (SoD) analysis for SAP FI/CO documents.

Detects situations where the same user performs incompatible business functions,
which violates internal control requirements and increases fraud risk.

Conflict types detected:
- Post-and-approve: Same user creates and approves journal entries
- Create-and-pay: User creates vendor master records AND processes payments
- Park-and-post: Same user parks a document and later posts it (bypasses review)
- Vendor master + payment: User maintains vendor data AND runs payment programs
- Post-and-reverse: Same user posts entries and reverses them (potential cover-up)

Analysis uses BKPF document headers to identify user activity patterns,
cross-referencing transaction codes (TCODE) and document relationships.

Returns: Conflict pairs with risk ratings, occurrence counts, and sample documents.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      company_code: {
        type: 'string',
        description: 'Filter by company code (BUKRS)',
      },
      fiscal_year: {
        type: 'string',
        description: 'Filter by fiscal year (GJAHR)',
      },
      min_occurrences: {
        type: 'number',
        description: 'Minimum conflict occurrences to report (default: 1)',
      },
      include_low_risk: {
        type: 'boolean',
        description: 'Include low-risk conflicts (default: false)',
      },
      max_results: {
        type: 'number',
        description: 'Maximum conflicts to return (default: 100)',
      },
      csv_file: {
        type: 'string',
        description: 'Path to CSV file to load',
      },
    },
    required: [],
  },
};

// ============================================================================
// SoD Conflict Detection Functions
// ============================================================================

/** TCodes that indicate document creation/posting */
const POSTING_TCODES = new Set([
  'FB01',
  'F-02',
  'F-01',
  'FB50',
  'FBS1',
  'FB05',
  'FB60',
  'FB65',
  'FB70',
  'FB75', // Vendor/customer invoices
  'MIRO',
  'MR01', // Invoice verification
]);

/** TCodes that indicate document approval or release */
const APPROVAL_TCODES = new Set([
  'FBV2',
  'FBV4', // Post parked documents
  'FMKFR01', // Release for payment
  'FB08', // Reverse document
]);

/** TCodes that indicate document parking */
const PARKING_TCODES = new Set([
  'FBV1',
  'FV50',
  'FV60',
  'FV65',
  'FV70',
  'MIR7', // Park invoice
]);

/** TCodes that indicate payment processing */
const PAYMENT_TCODES = new Set([
  'F110',
  'F-53',
  'F-58',
  'FCH5',
  'FBZ1',
  'F-28',
  'F-32', // Incoming payments
]);

/** TCodes that indicate vendor master maintenance */
const VENDOR_MASTER_TCODES = new Set([
  'XK01',
  'XK02',
  'FK01',
  'FK02',
  'MK01',
  'MK02', // Purchasing vendor
]);

/** TCodes that indicate reversals */
const REVERSAL_TCODES = new Set(['FB08', 'F.80', 'MR8M', 'FBRA']);

/**
 * Build a map of user → documents grouped by function category
 */
interface UserActivity {
  posting: BKPF[];
  approval: BKPF[];
  parking: BKPF[];
  payment: BKPF[];
  vendor_master: BKPF[];
  reversal: BKPF[];
}

function buildUserActivityMap(documents: BKPF[]): Map<string, UserActivity> {
  const userMap = new Map<string, UserActivity>();

  for (const doc of documents) {
    const user = doc.USNAM;
    if (!user) continue;

    if (!userMap.has(user)) {
      userMap.set(user, {
        posting: [],
        approval: [],
        parking: [],
        payment: [],
        vendor_master: [],
        reversal: [],
      });
    }

    const activity = userMap.get(user)!;
    const tcode = doc.TCODE || '';

    if (POSTING_TCODES.has(tcode)) activity.posting.push(doc);
    if (APPROVAL_TCODES.has(tcode)) activity.approval.push(doc);
    if (PARKING_TCODES.has(tcode)) activity.parking.push(doc);
    if (PAYMENT_TCODES.has(tcode)) activity.payment.push(doc);
    if (VENDOR_MASTER_TCODES.has(tcode)) activity.vendor_master.push(doc);
    if (REVERSAL_TCODES.has(tcode)) activity.reversal.push(doc);
  }

  // Also detect post-and-approve via parked document flow
  // If a user parks (FBV1) and the same user posts (FBV2),
  // or PPNAM matches USNAM on a posted parked doc
  for (const doc of documents) {
    if (doc.PPNAM && doc.PPNAM === doc.USNAM) {
      // Same person parked and posted this document
      const activity = userMap.get(doc.USNAM);
      if (activity) {
        // Mark as both parking and approval
        if (!activity.parking.includes(doc)) activity.parking.push(doc);
        if (!activity.approval.includes(doc)) activity.approval.push(doc);
      }
    }
  }

  return userMap;
}

/**
 * Detect post-and-approve conflicts
 */
function detectPostAndApprove(userMap: Map<string, UserActivity>, allDocs: BKPF[]): SoDConflict[] {
  const conflicts: SoDConflict[] = [];

  // Check PPNAM (parked by) vs USNAM (posted by) — same user shouldn't do both
  const parkPostPairs = new Map<string, { parked: BKPF[]; posted: BKPF[] }>();

  for (const doc of allDocs) {
    if (doc.PPNAM && doc.PPNAM === doc.USNAM) {
      const user = doc.USNAM;
      if (!parkPostPairs.has(user)) {
        parkPostPairs.set(user, { parked: [], posted: [] });
      }
      parkPostPairs.get(user)!.posted.push(doc);
    }
  }

  for (const [user, activity] of userMap) {
    // User has both posting and approval activity
    if (activity.posting.length > 0 && activity.approval.length > 0) {
      const sampleDocs = [
        ...activity.posting.slice(0, 3).map(d => `${d.BUKRS}-${d.BELNR}-${d.GJAHR}`),
        ...activity.approval.slice(0, 3).map(d => `${d.BUKRS}-${d.BELNR}-${d.GJAHR}`),
      ];

      conflicts.push({
        conflict_type: 'post_and_approve',
        severity: 'critical',
        description: `User ${user} both posts journal entries (${activity.posting.length}x) and approves/releases them (${activity.approval.length}x)`,
        user,
        action_1: {
          description: `Posted ${activity.posting.length} journal entries`,
          tcode: [...new Set(activity.posting.map(d => d.TCODE).filter(Boolean))].join(', '),
          date: activity.posting[0]?.BUDAT,
        },
        action_2: {
          description: `Approved/released ${activity.approval.length} documents`,
          tcode: [...new Set(activity.approval.map(d => d.TCODE).filter(Boolean))].join(', '),
          date: activity.approval[0]?.BUDAT,
        },
        occurrence_count: Math.min(activity.posting.length, activity.approval.length),
        risk_rating: 'critical',
        sample_documents: sampleDocs,
      });
    }
  }

  // Also check for park-and-post by same user
  for (const [user, pairs] of parkPostPairs) {
    if (pairs.posted.length > 0) {
      conflicts.push({
        conflict_type: 'park_and_post',
        severity: 'high',
        description: `User ${user} parked and posted ${pairs.posted.length} document(s) — bypassing independent review`,
        user,
        action_1: {
          description: `Parked documents (PPNAM = ${user})`,
          tcode: 'FBV1',
        },
        action_2: {
          description: `Posted the same parked documents (USNAM = ${user})`,
          tcode: 'FBV2',
        },
        occurrence_count: pairs.posted.length,
        risk_rating: 'high',
        sample_documents: pairs.posted.slice(0, 5).map(d => `${d.BUKRS}-${d.BELNR}-${d.GJAHR}`),
      });
    }
  }

  return conflicts;
}

/**
 * Detect create-and-pay conflicts
 */
function detectCreateAndPay(userMap: Map<string, UserActivity>): SoDConflict[] {
  const conflicts: SoDConflict[] = [];

  for (const [user, activity] of userMap) {
    if (activity.vendor_master.length > 0 && activity.payment.length > 0) {
      conflicts.push({
        conflict_type: 'create_and_pay',
        severity: 'critical',
        description: `User ${user} maintains vendor master data (${activity.vendor_master.length}x) AND processes payments (${activity.payment.length}x)`,
        user,
        action_1: {
          description: `Vendor master maintenance: ${activity.vendor_master.length} changes`,
          tcode: [...new Set(activity.vendor_master.map(d => d.TCODE).filter(Boolean))].join(', '),
          date: activity.vendor_master[0]?.BUDAT,
        },
        action_2: {
          description: `Payment processing: ${activity.payment.length} payments`,
          tcode: [...new Set(activity.payment.map(d => d.TCODE).filter(Boolean))].join(', '),
          date: activity.payment[0]?.BUDAT,
        },
        occurrence_count: Math.min(activity.vendor_master.length, activity.payment.length),
        risk_rating: 'critical',
        sample_documents: [
          ...activity.vendor_master.slice(0, 3).map(d => `${d.BUKRS}-${d.BELNR}-${d.GJAHR}`),
          ...activity.payment.slice(0, 3).map(d => `${d.BUKRS}-${d.BELNR}-${d.GJAHR}`),
        ],
      });
    }
  }

  return conflicts;
}

/**
 * Detect park-and-post conflicts
 */
function detectParkAndPost(userMap: Map<string, UserActivity>): SoDConflict[] {
  const conflicts: SoDConflict[] = [];

  for (const [user, activity] of userMap) {
    if (activity.parking.length > 0 && activity.approval.length > 0) {
      // Check if the same documents were parked and approved
      const parkedDocKeys = new Set(activity.parking.map(d => `${d.BUKRS}-${d.BELNR}-${d.GJAHR}`));
      const approvedDocKeys = activity.approval
        .map(d => `${d.BUKRS}-${d.BELNR}-${d.GJAHR}`)
        .filter(k => parkedDocKeys.has(k));

      if (approvedDocKeys.length > 0) {
        conflicts.push({
          conflict_type: 'park_and_post',
          severity: 'high',
          description: `User ${user} parked AND posted ${approvedDocKeys.length} document(s)`,
          user,
          action_1: {
            description: `Parked ${activity.parking.length} documents`,
            tcode: [...new Set(activity.parking.map(d => d.TCODE).filter(Boolean))].join(', '),
          },
          action_2: {
            description: `Approved/posted ${approvedDocKeys.length} of the same documents`,
            tcode: [...new Set(activity.approval.map(d => d.TCODE).filter(Boolean))].join(', '),
          },
          occurrence_count: approvedDocKeys.length,
          risk_rating: 'high',
          sample_documents: approvedDocKeys.slice(0, 5),
        });
      }
    }
  }

  return conflicts;
}

/**
 * Detect vendor master + payment conflicts
 */
function detectVendorMasterAndPayment(userMap: Map<string, UserActivity>): SoDConflict[] {
  const conflicts: SoDConflict[] = [];

  for (const [user, activity] of userMap) {
    if (activity.vendor_master.length > 0 && activity.payment.length > 0) {
      // Already caught by create_and_pay, but this is specifically for
      // vendor master maintenance (XK02 changes) + payment run (F110)
      const hasXK02 = activity.vendor_master.some(d => d.TCODE === 'XK02' || d.TCODE === 'FK02');
      const hasF110 = activity.payment.some(d => d.TCODE === 'F110');

      if (hasXK02 && hasF110) {
        conflicts.push({
          conflict_type: 'vendor_master_and_payment',
          severity: 'critical',
          description: `User ${user} modifies vendor master data (XK02/FK02) AND runs automatic payment program (F110)`,
          user,
          action_1: {
            description: 'Vendor master data modifications',
            tcode: 'XK02/FK02',
          },
          action_2: {
            description: 'Automatic payment program execution',
            tcode: 'F110',
          },
          occurrence_count: Math.min(
            activity.vendor_master.filter(d => d.TCODE === 'XK02' || d.TCODE === 'FK02').length,
            activity.payment.filter(d => d.TCODE === 'F110').length
          ),
          risk_rating: 'critical',
          sample_documents: [
            ...activity.vendor_master.slice(0, 3).map(d => `${d.BUKRS}-${d.BELNR}-${d.GJAHR}`),
            ...activity.payment.slice(0, 3).map(d => `${d.BUKRS}-${d.BELNR}-${d.GJAHR}`),
          ],
        });
      }
    }
  }

  return conflicts;
}

/**
 * Detect post-and-reverse conflicts
 */
function detectPostAndReverse(userMap: Map<string, UserActivity>, allDocs: BKPF[]): SoDConflict[] {
  const conflicts: SoDConflict[] = [];

  // Find documents that are reversals (STBLG references)
  const reversalMap = new Map<string, BKPF>(); // reversed doc key → reversal doc
  for (const doc of allDocs) {
    if (doc.STBLG && doc.STJAH) {
      const reversedKey = `${doc.BUKRS}-${doc.STBLG}-${doc.STJAH}`;
      reversalMap.set(reversedKey, doc);
    }
  }

  // Find users who posted the original AND the reversal
  const userReversals = new Map<string, { original: BKPF; reversal: BKPF }[]>();

  for (const doc of allDocs) {
    const docKey = `${doc.BUKRS}-${doc.BELNR}-${doc.GJAHR}`;
    const reversal = reversalMap.get(docKey);

    if (reversal && doc.USNAM === reversal.USNAM) {
      const user = doc.USNAM;
      if (!userReversals.has(user)) {
        userReversals.set(user, []);
      }
      userReversals.get(user)!.push({ original: doc, reversal });
    }
  }

  for (const [user, pairs] of userReversals) {
    if (pairs.length > 0) {
      conflicts.push({
        conflict_type: 'post_and_reverse',
        severity: pairs.length > 3 ? 'high' : 'medium',
        description: `User ${user} posted and reversed ${pairs.length} document(s)`,
        user,
        action_1: {
          description: `Posted ${pairs.length} original documents`,
          document_key: pairs[0]!.original.BELNR,
          date: pairs[0]!.original.BUDAT,
        },
        action_2: {
          description: `Reversed the same ${pairs.length} documents`,
          tcode: 'FB08',
          document_key: pairs[0]!.reversal.BELNR,
          date: pairs[0]!.reversal.BUDAT,
        },
        occurrence_count: pairs.length,
        risk_rating: pairs.length > 5 ? 'high' : pairs.length > 2 ? 'medium' : 'low',
        sample_documents: pairs
          .slice(0, 5)
          .flatMap(p => [
            `${p.original.BUKRS}-${p.original.BELNR}-${p.original.GJAHR}`,
            `${p.reversal.BUKRS}-${p.reversal.BELNR}-${p.reversal.GJAHR}`,
          ]),
      });
    }
  }

  return conflicts;
}

// ============================================================================
// Main Analysis Function
// ============================================================================

function runSoDAnalysis(dataset: FICoDataset, input: AnalyzeSoDInput): SoDConflict[] {
  // Filter documents
  let filteredBKPF = dataset.bkpf;

  if (input.company_code) {
    filteredBKPF = filteredBKPF.filter(d => d.BUKRS === input.company_code);
  }
  if (input.fiscal_year) {
    filteredBKPF = filteredBKPF.filter(d => d.GJAHR === input.fiscal_year);
  }

  if (filteredBKPF.length === 0) {
    return [];
  }

  // Build user activity map
  const userMap = buildUserActivityMap(filteredBKPF);

  // Run all SoD detection rules
  const allConflicts: SoDConflict[] = [
    ...detectPostAndApprove(userMap, filteredBKPF),
    ...detectCreateAndPay(userMap),
    ...detectParkAndPost(userMap),
    ...detectVendorMasterAndPayment(userMap),
    ...detectPostAndReverse(userMap, filteredBKPF),
  ];

  // Filter by minimum occurrences
  let filtered = allConflicts.filter(c => c.occurrence_count >= input.min_occurrences);

  // Filter by risk level
  if (!input.include_low_risk) {
    filtered = filtered.filter(c => c.risk_rating !== 'low');
  }

  // Deduplicate: same user + same conflict type
  const seen = new Set<string>();
  filtered = filtered.filter(c => {
    const key = `${c.user}|${c.conflict_type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by severity
  const severityOrder: Record<ForensicSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  filtered.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.occurrence_count - a.occurrence_count;
  });

  return filtered.slice(0, input.max_results);
}

// ============================================================================
// Tool Executor
// ============================================================================

export async function executeAnalyzeSoD(
  _adapter: SAPAdapter,
  rawInput: unknown
): Promise<{
  conflicts: SoDConflict[];
  summary: {
    total_documents_analyzed: number;
    total_conflicts: number;
    unique_users_with_conflicts: number;
    by_conflict_type: Record<string, number>;
    by_severity: Record<ForensicSeverity, number>;
    highest_risk_users: Array<{ user: string; conflict_count: number; types: string[] }>;
  };
}> {
  const input = AnalyzeSoDSchema.parse(rawInput);

  const auditContext = createAuditContext('analyze_sod', input as Record<string, unknown>, 'csv');

  try {
    let dataset = getFICoDataset();

    if (!dataset && input.csv_file) {
      const { CSVAdapter } = await import('../adapters/csv/index.js');
      const adapter = new CSVAdapter(input.csv_file);
      await adapter.initialize();
      dataset = adapter.getDataset();
    }

    if (!dataset || dataset.bkpf.length === 0) {
      throw new Error(
        'No FI/CO data loaded. Load data via CSV adapter or provide csv_file parameter.'
      );
    }

    const conflicts = runSoDAnalysis(dataset, input);

    // Build summary
    const byType: Record<string, number> = {};
    const bySeverity: Record<ForensicSeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
    const userConflicts = new Map<string, Set<string>>();

    for (const c of conflicts) {
      byType[c.conflict_type] = (byType[c.conflict_type] || 0) + 1;
      bySeverity[c.severity]++;
      if (!userConflicts.has(c.user)) {
        userConflicts.set(c.user, new Set());
      }
      userConflicts.get(c.user)!.add(c.conflict_type);
    }

    const highestRiskUsers = Array.from(userConflicts.entries())
      .map(([user, types]) => ({
        user,
        conflict_count: types.size,
        types: Array.from(types),
      }))
      .sort((a, b) => b.conflict_count - a.conflict_count)
      .slice(0, 10);

    const result = {
      conflicts,
      summary: {
        total_documents_analyzed: dataset.bkpf.length,
        total_conflicts: conflicts.length,
        unique_users_with_conflicts: userConflicts.size,
        by_conflict_type: byType,
        by_severity: bySeverity,
        highest_risk_users: highestRiskUsers,
      },
    };

    auditContext.success(conflicts.length);
    return result;
  } catch (error) {
    auditContext.error(error as Error);
    throw error;
  }
}
