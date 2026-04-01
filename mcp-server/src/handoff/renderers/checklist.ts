/**
 * Checklist Generator
 *
 * Generates the standard reviewer checklist for auditor handoff packets.
 * Produces 25 items across 5 categories that reviewers must complete
 * before accepting the forensic assessment.
 */

import type { ChecklistItem, ReviewerChecklist } from '../types.js';

type ChecklistCategory = ChecklistItem['category'];

interface CategoryDefinition {
  category: ChecklistCategory;
  items: string[];
}

/** Standard checklist definitions — 5 items per category */
const CHECKLIST_DEFINITIONS: readonly CategoryDefinition[] = [
  {
    category: 'data_quality',
    items: [
      'Extraction replay hashes verified against current data',
      'Sample data values spot-checked against source system',
      'Date ranges confirmed to cover the full audit period',
      'Currency conversions validated where cross-system amounts compared',
      'Null/missing values in critical fields documented',
    ],
  },
  {
    category: 'completeness',
    items: [
      'All systems in scope were accessed and extracted',
      'All extraction paths in the registry were executed',
      'No orphan findings (all reference extraction IDs exist)',
      'Schema validation passed for all extraction paths',
      'Event log covers full date range without gaps',
    ],
  },
  {
    category: 'methodology',
    items: [
      'Contradiction thresholds appropriate for this engagement',
      "Reality-gap reference model matches client's industry",
      'Documented business rules sourced from current SOPs',
      'Scoring weights reviewed and accepted by engagement lead',
      'False positive rate assessed and documented',
    ],
  },
  {
    category: 'findings',
    items: [
      'Each CRITICAL finding has been individually reviewed',
      'Each HIGH finding has supporting evidence verified',
      'Contradictions confirmed against both source systems',
      'Reality gaps validated against actual process documentation',
      'Risk scores reflect engagement-specific materiality thresholds',
    ],
  },
  {
    category: 'remediation',
    items: [
      'Remediation recommendations are actionable and specific',
      'Timeline for remediation is realistic',
      'Responsible parties identified for each finding',
      'Follow-up extraction schedule defined for verification',
      'Accepted risks documented with business justification',
    ],
  },
] as const;

export class ChecklistGenerator {
  /** Generate the standard reviewer checklist */
  generateChecklist(
    engagementId: string,
    findingCount: number,
    systemCount: number,
  ): ReviewerChecklist {
    const items: ChecklistItem[] = [];
    let itemIndex = 0;

    for (const def of CHECKLIST_DEFINITIONS) {
      for (const text of def.items) {
        itemIndex++;
        items.push({
          id: `CHK-${String(itemIndex).padStart(3, '0')}`,
          category: def.category,
          text,
          required: true,
          checked: false,
          notes: '',
        });
      }
    }

    return {
      engagementId,
      reviewerName: '',
      generatedAt: new Date().toISOString(),
      items,
      completedCount: 0,
      totalCount: items.length,
    };
  }
}

/** Exported for testing */
export { CHECKLIST_DEFINITIONS };
