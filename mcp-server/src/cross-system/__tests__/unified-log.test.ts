// mcp-server/src/cross-system/__tests__/unified-log.test.ts

import { describe, it, expect } from '@jest/globals';
import { UnifiedLogBuilder } from '../unified-log.js';
import type { UnifiedEvent } from '../unified-log.js';

// ============================================================================
// Test Data Helpers
// ============================================================================

function makeSFDCEvent(
  event_type: string,
  timestamp: string,
  entity_id: string,
  details: Record<string, unknown> = {}
): UnifiedEvent {
  return { system: 'sfdc', event_type, timestamp, entity_id, details };
}

function makeSAPEvent(
  event_type: string,
  timestamp: string,
  entity_id: string,
  details: Record<string, unknown> = {}
): UnifiedEvent {
  return { system: 'sap', event_type, timestamp, entity_id, details };
}

// ============================================================================
// UnifiedLogBuilder
// ============================================================================

describe('UnifiedLogBuilder', () => {
  const builder = new UnifiedLogBuilder();

  // --------------------------------------------------------------------------
  // Test 1: Creates unified log from SFDC + SAP events, events sorted by timestamp
  // --------------------------------------------------------------------------
  it('creates unified log and sorts events by timestamp', () => {
    const sfdcEvents: UnifiedEvent[] = [
      makeSFDCEvent('stage_change', '2024-01-15T10:00:00Z', 'OPP-001', { stage: 'Proposal' }),
      makeSFDCEvent('stage_change', '2024-02-20T14:00:00Z', 'OPP-001', {
        stage: 'Closed Won',
        amount: 50000,
      }),
    ];

    const sapEvents: UnifiedEvent[] = [
      makeSAPEvent('delivery_created', '2024-04-10T08:00:00Z', '0000001234', {}),
      makeSAPEvent('order_created', '2024-03-25T09:00:00Z', '0000001234', { netwr: 50000 }),
    ];

    const log = builder.buildLog('CORR-001', 'OPP-001', '0000001234', 0.95, sfdcEvents, sapEvents);

    expect(log.correlation_id).toBe('CORR-001');
    expect(log.sfdc_opportunity_id).toBe('OPP-001');
    expect(log.sap_vbeln).toBe('0000001234');
    expect(log.match_confidence).toBe(0.95);
    expect(log.events).toHaveLength(4);

    // Verify chronological order
    const timestamps = log.events.map(e => e.timestamp);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]! >= timestamps[i - 1]!).toBe(true);
    }

    // First event should be the earliest SFDC stage_change
    expect(log.events[0]!.timestamp).toBe('2024-01-15T10:00:00Z');
    expect(log.events[0]!.system).toBe('sfdc');

    // Last event should be the SAP delivery_created
    expect(log.events[3]!.timestamp).toBe('2024-04-10T08:00:00Z');
    expect(log.events[3]!.system).toBe('sap');
  });

  // --------------------------------------------------------------------------
  // Test 2: Computes sfdc_to_sap_gap_days (>30 for a 33-day gap scenario)
  // --------------------------------------------------------------------------
  it('computes sfdc_to_sap_gap_days correctly for a 33-day gap', () => {
    // SFDC Closed Won on 2024-02-20, SAP order_created on 2024-03-24 = 33 days gap
    const sfdcEvents: UnifiedEvent[] = [
      makeSFDCEvent('stage_change', '2024-01-10T10:00:00Z', 'OPP-002', { stage: 'Qualification' }),
      makeSFDCEvent('stage_change', '2024-02-20T10:00:00Z', 'OPP-002', {
        stage: 'Closed Won',
        amount: 75000,
      }),
    ];

    const sapEvents: UnifiedEvent[] = [
      makeSAPEvent('order_created', '2024-03-24T10:00:00Z', '0000005678', { netwr: 75000 }),
    ];

    const log = builder.buildLog('CORR-002', 'OPP-002', '0000005678', 0.88, sfdcEvents, sapEvents);

    expect(log.cross_system_metrics.sfdc_to_sap_gap_days).not.toBeNull();
    expect(log.cross_system_metrics.sfdc_to_sap_gap_days!).toBeGreaterThan(30);
    // 2024-02-20 → 2024-03-24 = 33 days
    expect(log.cross_system_metrics.sfdc_to_sap_gap_days!).toBeCloseTo(33, 0);
  });

  // --------------------------------------------------------------------------
  // Test 3: Computes amount_discrepancy ($5000 diff)
  // --------------------------------------------------------------------------
  it('computes amount_discrepancy when SFDC and SAP amounts differ', () => {
    const sfdcEvents: UnifiedEvent[] = [
      makeSFDCEvent('stage_change', '2024-03-01T10:00:00Z', 'OPP-003', {
        stage: 'Closed Won',
        amount: 55000,
      }),
    ];

    const sapEvents: UnifiedEvent[] = [
      makeSAPEvent('order_created', '2024-03-15T10:00:00Z', '0000009876', {
        netwr: 50000,
      }),
    ];

    const log = builder.buildLog('CORR-003', 'OPP-003', '0000009876', 0.8, sfdcEvents, sapEvents);

    expect(log.cross_system_metrics.amount_discrepancy).not.toBeNull();
    expect(log.cross_system_metrics.amount_discrepancy).toBeCloseTo(5000, 0);
  });

  // --------------------------------------------------------------------------
  // Test 4: Handles SFDC-only logs (no SAP match) — sap_vbeln null, gap null
  // --------------------------------------------------------------------------
  it('handles SFDC-only log with no SAP match', () => {
    const sfdcEvents: UnifiedEvent[] = [
      makeSFDCEvent('stage_change', '2024-04-01T10:00:00Z', 'OPP-004', { stage: 'Prospecting' }),
      makeSFDCEvent('stage_change', '2024-04-15T10:00:00Z', 'OPP-004', {
        stage: 'Closed Won',
        amount: 20000,
      }),
    ];

    const log = builder.buildLog('CORR-004', 'OPP-004', null, 0, sfdcEvents, []);

    expect(log.sap_vbeln).toBeNull();
    expect(log.match_confidence).toBe(0);
    expect(log.events).toHaveLength(2);
    expect(log.cross_system_metrics.sfdc_to_sap_gap_days).toBeNull();
    expect(log.cross_system_metrics.amount_discrepancy).toBeNull();
    expect(log.cross_system_metrics.doc_flow_count_sap).toBe(0);
    expect(log.cross_system_metrics.stage_count_sfdc).toBe(2);
  });

  // --------------------------------------------------------------------------
  // Additional: cross_system_metrics counts are accurate
  // --------------------------------------------------------------------------
  it('counts stage_count_sfdc and doc_flow_count_sap correctly', () => {
    const sfdcEvents: UnifiedEvent[] = [
      makeSFDCEvent('stage_change', '2024-01-01T00:00:00Z', 'OPP-005', { stage: 'Prospecting' }),
      makeSFDCEvent('stage_change', '2024-01-10T00:00:00Z', 'OPP-005', { stage: 'Qualification' }),
      makeSFDCEvent('stage_change', '2024-01-20T00:00:00Z', 'OPP-005', { stage: 'Closed Won' }),
      makeSFDCEvent('note_added', '2024-01-25T00:00:00Z', 'OPP-005', {}),
    ];

    const sapEvents: UnifiedEvent[] = [
      makeSAPEvent('order_created', '2024-02-01T00:00:00Z', '0000000001', { netwr: 10000 }),
      makeSAPEvent('delivery_created', '2024-02-10T00:00:00Z', '0000000001', {}),
      makeSAPEvent('invoice_created', '2024-02-15T00:00:00Z', '0000000001', {}),
    ];

    const log = builder.buildLog('CORR-005', 'OPP-005', '0000000001', 0.75, sfdcEvents, sapEvents);

    expect(log.cross_system_metrics.stage_count_sfdc).toBe(3); // only stage_change events
    expect(log.cross_system_metrics.doc_flow_count_sap).toBe(3); // all SAP events
  });

  // --------------------------------------------------------------------------
  // Additional: total_duration_days spans first to last event
  // --------------------------------------------------------------------------
  it('computes total_duration_days from first to last event', () => {
    const sfdcEvents: UnifiedEvent[] = [
      makeSFDCEvent('stage_change', '2024-01-01T00:00:00Z', 'OPP-006', { stage: 'Prospecting' }),
      makeSFDCEvent('stage_change', '2024-01-31T00:00:00Z', 'OPP-006', {
        stage: 'Closed Won',
        amount: 30000,
      }),
    ];

    const sapEvents: UnifiedEvent[] = [
      makeSAPEvent('order_created', '2024-03-01T00:00:00Z', '0000000002', { netwr: 30000 }),
    ];

    const log = builder.buildLog('CORR-006', 'OPP-006', '0000000002', 0.9, sfdcEvents, sapEvents);

    // Jan 1 → Mar 1 = 60 days
    expect(log.cross_system_metrics.total_duration_days).toBeCloseTo(60, 0);
  });

  // --------------------------------------------------------------------------
  // Additional: amount_discrepancy is null when no Closed Won or no netwr
  // --------------------------------------------------------------------------
  it('returns null amount_discrepancy when SFDC amount not available', () => {
    const sfdcEvents: UnifiedEvent[] = [
      // stage_change without amount in details
      makeSFDCEvent('stage_change', '2024-03-01T10:00:00Z', 'OPP-007', { stage: 'Closed Won' }),
    ];

    const sapEvents: UnifiedEvent[] = [
      makeSAPEvent('order_created', '2024-03-10T10:00:00Z', '0000000003', { netwr: 40000 }),
    ];

    const log = builder.buildLog('CORR-007', 'OPP-007', '0000000003', 0.7, sfdcEvents, sapEvents);

    expect(log.cross_system_metrics.amount_discrepancy).toBeNull();
  });
});
