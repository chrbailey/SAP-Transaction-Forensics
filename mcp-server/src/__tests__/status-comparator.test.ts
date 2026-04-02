// mcp-server/src/__tests__/status-comparator.test.ts

import { describe, it, expect } from '@jest/globals';
import {
  StatusIncompatibleComparator,
  ApprovalBypassComparator,
} from '../contradiction/comparators/status.js';
import type { FieldRecord } from '../contradiction/comparators/status.js';

// ============================================================================
// StatusIncompatibleComparator
// ============================================================================

describe('StatusIncompatibleComparator', () => {
  const comparator = new StatusIncompatibleComparator();

  it('detects SAP cancelled + SFDC Closed Won', () => {
    const sap: FieldRecord = { VBELN: '0000001234', ABSTK: 'X' };
    const sfdc: FieldRecord = { StageName: 'Closed Won', OpportunityId: 'OPP-001' };

    const finding = comparator.compare(sap, sfdc);

    expect(finding).not.toBeNull();
    expect(finding!.type).toBe('STATUS_INCOMPATIBLE');
    expect(finding!.scoringDetails['incompatiblePair']).toBe('cancelled_vs_won');
  });

  it('detects SAP blocked + SFDC Closed Won', () => {
    const sap: FieldRecord = { VBELN: '0000001234', LIFSK: '01' };
    const sfdc: FieldRecord = { StageName: 'Closed Won', OpportunityId: 'OPP-002' };

    const finding = comparator.compare(sap, sfdc);

    expect(finding).not.toBeNull();
    expect(finding!.type).toBe('STATUS_INCOMPATIBLE');
    expect(finding!.scoringDetails['incompatiblePair']).toBe('blocked_vs_won');
  });

  it('returns null for compatible statuses', () => {
    const sap: FieldRecord = { VBELN: '0000001234', status: 'active' };
    const sfdc: FieldRecord = { StageName: 'Closed Won', OpportunityId: 'OPP-003' };

    const finding = comparator.compare(sap, sfdc);

    expect(finding).toBeNull();
  });

  it('detects SFDC Closed Lost + SAP active', () => {
    const sap: FieldRecord = { VBELN: '0000005678', status: 'active' };
    const sfdc: FieldRecord = { StageName: 'Closed Lost', OpportunityId: 'OPP-004' };

    const finding = comparator.compare(sap, sfdc);

    expect(finding).not.toBeNull();
    expect(finding!.type).toBe('STATUS_INCOMPATIBLE');
    expect(finding!.scoringDetails['incompatiblePair']).toBe('closed_lost_vs_active');
  });

  it('always returns HIGH severity', () => {
    const sap: FieldRecord = { VBELN: '0000001234', ABSTK: 'X' };
    const sfdc: FieldRecord = { StageName: 'Closed Won', OpportunityId: 'OPP-005' };

    const finding = comparator.compare(sap, sfdc);

    expect(finding).not.toBeNull();
    expect(finding!.severity).toBe('HIGH');
    expect(finding!.confidence).toBe(0.9);
  });
});

// ============================================================================
// ApprovalBypassComparator
// ============================================================================

describe('ApprovalBypassComparator', () => {
  const comparator = new ApprovalBypassComparator();

  it('detects amount > threshold with no approval', () => {
    const record: FieldRecord = { NETWR: 50000, ERNAM: 'USER_A' };
    const config = { approvalThreshold: 10000 };

    const finding = comparator.compare(record, config);

    expect(finding).not.toBeNull();
    expect(finding!.type).toBe('APPROVAL_BYPASS');
    expect(finding!.scoringDetails['hasApproval']).toBe(0);
  });

  it('returns null when amount below threshold', () => {
    const record: FieldRecord = { NETWR: 5000, ERNAM: 'USER_A' };
    const config = { approvalThreshold: 10000 };

    const finding = comparator.compare(record, config);

    expect(finding).toBeNull();
  });

  it('returns CRITICAL when amount > 5x threshold', () => {
    const record: FieldRecord = { NETWR: 60000, ERNAM: 'USER_A' };
    const config = { approvalThreshold: 10000 };

    const finding = comparator.compare(record, config);

    expect(finding).not.toBeNull();
    expect(finding!.severity).toBe('CRITICAL');
  });

  it('detects same-user create and approve', () => {
    const record: FieldRecord = {
      NETWR: 15000,
      ERNAM: 'USER_A',
      USNAM: 'USER_A',
      FRGZU: 'approved',
    };
    const config = { approvalThreshold: 10000 };

    const finding = comparator.compare(record, config);

    expect(finding).not.toBeNull();
    expect(finding!.type).toBe('APPROVAL_BYPASS');
    expect(finding!.scoringDetails['sameUser']).toBe(1);
    expect(finding!.scoringDetails['hasApproval']).toBe(1);
  });

  it('returns null when different users and approval exists', () => {
    const record: FieldRecord = {
      NETWR: 15000,
      ERNAM: 'USER_A',
      USNAM: 'USER_B',
      FRGZU: 'approved',
    };
    const config = { approvalThreshold: 10000 };

    const finding = comparator.compare(record, config);

    expect(finding).toBeNull();
  });

  it('scoringDetails includes all metrics', () => {
    const record: FieldRecord = { NETWR: 25000, ERNAM: 'USER_C' };
    const config = { approvalThreshold: 10000 };

    const finding = comparator.compare(record, config);

    expect(finding).not.toBeNull();
    expect(finding!.scoringDetails).toEqual({
      amount: 25000,
      threshold: 10000,
      ratio: 2.5,
      hasApproval: 0,
      sameUser: 0,
    });
    expect(finding!.confidence).toBe(0.85);
  });
});
