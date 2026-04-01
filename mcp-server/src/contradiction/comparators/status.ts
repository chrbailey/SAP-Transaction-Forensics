// mcp-server/src/contradiction/comparators/status.ts
// Status + Approval comparators for cross-system contradiction detection

// ============================================================================
// Types (local — same pattern as other comparator files)
// ============================================================================

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type ContradictionType = 'STATUS_INCOMPATIBLE' | 'APPROVAL_BYPASS';

export interface ContradictionFinding {
  type: ContradictionType;
  severity: Severity;
  confidence: number;
  description: string;
  scoringDetails: Record<string, unknown>;
}

export interface ComparatorConfig {
  approvalThreshold?: number;
}

/** A generic record from SAP, SFDC, NetSuite, etc. */
export type FieldRecord = Record<string, unknown>;

// ============================================================================
// Helpers
// ============================================================================

function fieldValue(record: FieldRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    const val = record[key];
    if (val !== undefined && val !== null && val !== '') return val;
  }
  return undefined;
}

function fieldString(record: FieldRecord, ...keys: string[]): string | undefined {
  const val = fieldValue(record, ...keys);
  return typeof val === 'string' ? val : undefined;
}

function fieldNumber(record: FieldRecord, ...keys: string[]): number | undefined {
  const val = fieldValue(record, ...keys);
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const parsed = parseFloat(val);
    return isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

// ============================================================================
// StatusIncompatibleComparator
// ============================================================================

export class StatusIncompatibleComparator {
  readonly type = 'STATUS_INCOMPATIBLE' as const;

  /**
   * Compare two records from different systems and detect logically
   * incompatible status combinations.
   *
   * Returns a ContradictionFinding if an incompatibility is detected,
   * or null if the statuses are compatible.
   */
  compare(recordA: FieldRecord, recordB: FieldRecord): ContradictionFinding | null {
    // Try every incompatible-pair check. First match wins.
    const checks: Array<() => ContradictionFinding | null> = [
      () => this._sapCancelledVsSfdcWon(recordA, recordB),
      () => this._sapBlockedVsSfdcWon(recordA, recordB),
      () => this._sapDeliveryCompleteVsSfdcEarlyStage(recordA, recordB),
      () => this._sfdcClosedLostVsSapActive(recordA, recordB),
      () => this._netsuiteInactiveWithTransactions(recordA, recordB),
    ];

    for (const check of checks) {
      const finding = check();
      if (finding) return finding;
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Private checks
  // --------------------------------------------------------------------------

  /**
   * SAP order cancelled (ABSTK='X' or status='X') + SFDC "Closed Won"
   */
  private _sapCancelledVsSfdcWon(a: FieldRecord, b: FieldRecord): ContradictionFinding | null {
    const [sap, sfdc] = this._orientRecords(a, b);
    if (!sap || !sfdc) return null;

    const isCancelled =
      fieldString(sap, 'ABSTK') === 'X' || fieldString(sap, 'status') === 'X';
    const isClosedWon = fieldString(sfdc, 'StageName', 'stage') === 'Closed Won';

    if (isCancelled && isClosedWon) {
      return this._makeFinding(
        'cancelled_vs_won',
        'SAP order is cancelled but SFDC opportunity is Closed Won',
      );
    }
    return null;
  }

  /**
   * SAP order blocked (LIFSK or FAKSK set) + SFDC "Closed Won"
   */
  private _sapBlockedVsSfdcWon(a: FieldRecord, b: FieldRecord): ContradictionFinding | null {
    const [sap, sfdc] = this._orientRecords(a, b);
    if (!sap || !sfdc) return null;

    const isBlocked =
      fieldValue(sap, 'LIFSK') !== undefined || fieldValue(sap, 'FAKSK') !== undefined;
    const isClosedWon = fieldString(sfdc, 'StageName', 'stage') === 'Closed Won';

    if (isBlocked && isClosedWon) {
      return this._makeFinding(
        'blocked_vs_won',
        'SAP order is blocked (delivery or billing) but SFDC opportunity is Closed Won',
      );
    }
    return null;
  }

  /**
   * SAP delivery complete + SFDC still "Prospecting" or "Qualification"
   */
  private _sapDeliveryCompleteVsSfdcEarlyStage(
    a: FieldRecord,
    b: FieldRecord,
  ): ContradictionFinding | null {
    const [sap, sfdc] = this._orientRecords(a, b);
    if (!sap || !sfdc) return null;

    const deliveryComplete =
      fieldString(sap, 'WBSTK') === 'C' || fieldString(sap, 'delivery_status') === 'complete';
    const earlyStage = ['Prospecting', 'Qualification'].includes(
      fieldString(sfdc, 'StageName', 'stage') ?? '',
    );

    if (deliveryComplete && earlyStage) {
      return this._makeFinding(
        'delivered_vs_early_stage',
        'SAP delivery is complete but SFDC opportunity is still in early stage',
      );
    }
    return null;
  }

  /**
   * SFDC "Closed Lost" + SAP active order (no cancellation)
   */
  private _sfdcClosedLostVsSapActive(a: FieldRecord, b: FieldRecord): ContradictionFinding | null {
    const [sap, sfdc] = this._orientRecords(a, b);
    if (!sap || !sfdc) return null;

    const isClosedLost = fieldString(sfdc, 'StageName', 'stage') === 'Closed Lost';
    const isCancelled =
      fieldString(sap, 'ABSTK') === 'X' || fieldString(sap, 'status') === 'X';
    const isActive = !isCancelled && fieldValue(sap, 'VBELN', 'vbeln') !== undefined;

    if (isClosedLost && isActive) {
      return this._makeFinding(
        'closed_lost_vs_active',
        'SFDC opportunity is Closed Lost but SAP order is still active',
      );
    }
    return null;
  }

  /**
   * NetSuite user inactive + recent transactions
   */
  private _netsuiteInactiveWithTransactions(
    a: FieldRecord,
    b: FieldRecord,
  ): ContradictionFinding | null {
    // Check either record order
    const userInactive = (r: FieldRecord): boolean =>
      fieldString(r, 'isinactive', 'is_inactive') === 'T' ||
      fieldString(r, 'isinactive', 'is_inactive') === 'true' ||
      fieldValue(r, 'isinactive', 'is_inactive') === true;

    const hasRecentTransactions = (r: FieldRecord): boolean =>
      fieldValue(r, 'recent_transaction_count') !== undefined &&
      (fieldNumber(r, 'recent_transaction_count') ?? 0) > 0;

    if (
      (userInactive(a) && hasRecentTransactions(b)) ||
      (userInactive(b) && hasRecentTransactions(a))
    ) {
      return this._makeFinding(
        'inactive_user_with_transactions',
        'NetSuite user is inactive but has recent transactions',
      );
    }
    return null;
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /**
   * Orient two records: returns [sapRecord, sfdcRecord] or null if
   * we cannot determine which is which. Uses heuristics on field names.
   */
  private _orientRecords(
    a: FieldRecord,
    b: FieldRecord,
  ): [FieldRecord | null, FieldRecord | null] {
    const looksLikeSAP = (r: FieldRecord): boolean =>
      fieldValue(r, 'VBELN', 'vbeln', 'ABSTK', 'LIFSK', 'FAKSK', 'WBSTK') !== undefined ||
      r['_system'] === 'sap';
    const looksLikeSFDC = (r: FieldRecord): boolean =>
      fieldValue(r, 'StageName', 'stage', 'OpportunityId') !== undefined ||
      r['_system'] === 'sfdc';

    if (looksLikeSAP(a) && looksLikeSFDC(b)) return [a, b];
    if (looksLikeSAP(b) && looksLikeSFDC(a)) return [b, a];

    // Fallback: try both as SAP and both as SFDC
    return [a, b];
  }

  private _makeFinding(
    incompatiblePair: string,
    description: string,
  ): ContradictionFinding {
    return {
      type: this.type,
      severity: 'HIGH',
      confidence: 0.90,
      description,
      scoringDetails: { incompatiblePair },
    };
  }
}

// ============================================================================
// ApprovalBypassComparator
// ============================================================================

export class ApprovalBypassComparator {
  readonly type = 'APPROVAL_BYPASS' as const;

  /**
   * Check a single record for transactions that exceed an approval
   * threshold without proper authorization.
   *
   * Returns a ContradictionFinding if a bypass is detected, or null otherwise.
   */
  compare(record: FieldRecord, config: ComparatorConfig = {}): ContradictionFinding | null {
    const threshold = config.approvalThreshold ?? 10000;

    // Step 1: Extract amount
    const amount = fieldNumber(record, 'NETWR', 'DMBTR', 'Amount', 'amount');
    if (amount === undefined || amount <= threshold) return null;

    // Step 2: Check for approval
    const approvalStatus = fieldString(record, 'FRGZU', 'FRGDT', 'approval_status');
    const hasApproval = approvalStatus !== undefined;

    // Step 3: Check for same-user create+post
    const creator = fieldString(record, 'ERNAM', 'CreatedById', 'created_by');
    const poster = fieldString(record, 'USNAM', 'posted_by', 'ApprovedById');
    const sameUser = creator !== undefined && poster !== undefined && creator === poster;

    // Step 4: If amount > threshold AND (no approval OR same-user) → finding
    if (!hasApproval || sameUser) {
      const ratio = amount / threshold;
      const severity = this._computeSeverity(ratio);

      return {
        type: this.type,
        severity,
        confidence: 0.85,
        description: sameUser && hasApproval
          ? `Transaction amount ${amount} exceeds threshold ${threshold} and was created and posted by the same user`
          : `Transaction amount ${amount} exceeds threshold ${threshold} without approval`,
        scoringDetails: {
          amount,
          threshold,
          ratio,
          hasApproval: hasApproval ? 1 : 0,
          sameUser: sameUser ? 1 : 0,
        },
      };
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private _computeSeverity(ratio: number): Severity {
    if (ratio > 5) return 'CRITICAL';
    if (ratio > 2) return 'HIGH';
    return 'MEDIUM';
  }
}
