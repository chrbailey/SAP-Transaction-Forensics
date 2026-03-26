// mcp-server/src/cross-system/unified-log.ts
// Merges SFDC and SAP event sequences into a single chronological timeline
// and computes cross-system metrics.

// ============================================================================
// Interfaces
// ============================================================================

export interface UnifiedEvent {
  system: 'sfdc' | 'sap';
  event_type: string;
  timestamp: string;
  entity_id: string;
  details: Record<string, unknown>;
}

export interface CrossSystemMetrics {
  total_duration_days: number;
  sfdc_to_sap_gap_days: number | null;
  amount_discrepancy: number | null;
  stage_count_sfdc: number;
  doc_flow_count_sap: number;
}

export interface UnifiedEventLog {
  correlation_id: string;
  sfdc_opportunity_id: string;
  sap_vbeln: string | null;
  match_confidence: number;
  events: UnifiedEvent[];
  cross_system_metrics: CrossSystemMetrics;
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Parse an ISO timestamp string to milliseconds since epoch.
 */
function toMs(timestamp: string): number {
  return new Date(timestamp).getTime();
}

/**
 * Compute the absolute difference in days between two ISO timestamps.
 */
function daysBetween(a: string, b: string): number {
  return Math.abs(toMs(a) - toMs(b)) / (1000 * 60 * 60 * 24);
}

/**
 * Find the first event matching a predicate, or undefined.
 */
function findEvent(
  events: UnifiedEvent[],
  predicate: (e: UnifiedEvent) => boolean
): UnifiedEvent | undefined {
  return events.find(predicate);
}

// ============================================================================
// UnifiedLogBuilder
// ============================================================================

export class UnifiedLogBuilder {
  /**
   * Builds a unified event log by merging SFDC and SAP event sequences.
   *
   * @param correlationId  Unique identifier for this cross-system correlation
   * @param sfdcOppId      SFDC Opportunity ID
   * @param sapVbeln       SAP Sales Order number, or null if no match
   * @param confidence     Match confidence score (0–1)
   * @param sfdcEvents     Events sourced from SFDC
   * @param sapEvents      Events sourced from SAP
   * @returns              A fully merged and annotated UnifiedEventLog
   */
  buildLog(
    correlationId: string,
    sfdcOppId: string,
    sapVbeln: string | null,
    confidence: number,
    sfdcEvents: UnifiedEvent[],
    sapEvents: UnifiedEvent[]
  ): UnifiedEventLog {
    // Merge and sort all events chronologically
    const events: UnifiedEvent[] = [...sfdcEvents, ...sapEvents].sort(
      (a, b) => toMs(a.timestamp) - toMs(b.timestamp)
    );

    const metrics = this._computeMetrics(events, sfdcEvents, sapEvents);

    return {
      correlation_id: correlationId,
      sfdc_opportunity_id: sfdcOppId,
      sap_vbeln: sapVbeln,
      match_confidence: confidence,
      events,
      cross_system_metrics: metrics,
    };
  }

  // --------------------------------------------------------------------------
  // Private: metric computation
  // --------------------------------------------------------------------------

  private _computeMetrics(
    allEvents: UnifiedEvent[],
    sfdcEvents: UnifiedEvent[],
    sapEvents: UnifiedEvent[]
  ): CrossSystemMetrics {
    return {
      total_duration_days: this._totalDurationDays(allEvents),
      sfdc_to_sap_gap_days: this._sfdcToSapGapDays(sfdcEvents, sapEvents),
      amount_discrepancy: this._amountDiscrepancy(sfdcEvents, sapEvents),
      stage_count_sfdc: this._stageCountSfdc(sfdcEvents),
      doc_flow_count_sap: sapEvents.length,
    };
  }

  /**
   * Total duration in days from the first to the last event across all systems.
   * Returns 0 when there are fewer than 2 events.
   */
  private _totalDurationDays(allEvents: UnifiedEvent[]): number {
    if (allEvents.length < 2) return 0;
    const first = allEvents[0]!.timestamp;
    const last = allEvents[allEvents.length - 1]!.timestamp;
    return daysBetween(first, last);
  }

  /**
   * Gap in days between SFDC 'Closed Won' stage_change and SAP 'order_created'.
   * Returns null if either event is not present.
   */
  private _sfdcToSapGapDays(
    sfdcEvents: UnifiedEvent[],
    sapEvents: UnifiedEvent[]
  ): number | null {
    const closedWon = findEvent(
      sfdcEvents,
      e => e.event_type === 'stage_change' && e.details['stage'] === 'Closed Won'
    );
    const orderCreated = findEvent(
      sapEvents,
      e => e.event_type === 'order_created'
    );

    if (!closedWon || !orderCreated) return null;

    return daysBetween(closedWon.timestamp, orderCreated.timestamp);
  }

  /**
   * Absolute difference between SFDC Closed Won amount and SAP netwr.
   * Returns null when either value is unavailable.
   *
   * SFDC amount is read from the 'amount' field in the Closed Won stage_change details.
   * SAP netwr is read from the 'netwr' field in the order_created details.
   */
  private _amountDiscrepancy(
    sfdcEvents: UnifiedEvent[],
    sapEvents: UnifiedEvent[]
  ): number | null {
    const closedWon = findEvent(
      sfdcEvents,
      e => e.event_type === 'stage_change' && e.details['stage'] === 'Closed Won'
    );
    const orderCreated = findEvent(
      sapEvents,
      e => e.event_type === 'order_created'
    );

    if (!closedWon || !orderCreated) return null;

    const sfdcAmount = closedWon.details['amount'];
    const sapNetwr = orderCreated.details['netwr'];

    if (typeof sfdcAmount !== 'number' || typeof sapNetwr !== 'number') return null;

    return Math.abs(sfdcAmount - sapNetwr);
  }

  /**
   * Count of SFDC 'stage_change' events.
   */
  private _stageCountSfdc(sfdcEvents: UnifiedEvent[]): number {
    return sfdcEvents.filter(e => e.event_type === 'stage_change').length;
  }
}
