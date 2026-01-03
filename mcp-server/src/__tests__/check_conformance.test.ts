/**
 * Tests for check_conformance tool
 *
 * Tests conformance checking of SAP Order-to-Cash process flows
 * against the expected O2C reference model.
 * Uses Jest with ESM support.
 */

import { CheckConformanceSchema, checkConformanceTool } from '../tools/check_conformance.js';

describe('CheckConformanceSchema', () => {
  describe('input validation', () => {
    it('should accept valid input with all fields', () => {
      const input = {
        doc_numbers: ['0000012345', '0000012346'],
        include_deviations: true,
        severity_filter: 'all' as const,
      };

      const result = CheckConformanceSchema.parse(input);

      expect(result.doc_numbers).toEqual(['0000012345', '0000012346']);
      expect(result.include_deviations).toBe(true);
      expect(result.severity_filter).toBe('all');
    });

    it('should apply defaults for optional fields', () => {
      const input = {};

      const result = CheckConformanceSchema.parse(input);

      expect(result.include_deviations).toBe(true);
      expect(result.severity_filter).toBe('all');
      expect(result.doc_numbers).toBeUndefined();
    });

    it('should accept specific severity filter values', () => {
      const severities: Array<'all' | 'critical' | 'major' | 'minor'> = [
        'all',
        'critical',
        'major',
        'minor',
      ];

      for (const severity of severities) {
        const input = { severity_filter: severity };
        const result = CheckConformanceSchema.parse(input);
        expect(result.severity_filter).toBe(severity);
      }
    });

    it('should reject invalid severity filter', () => {
      const input = { severity_filter: 'high' }; // Invalid

      expect(() => CheckConformanceSchema.parse(input)).toThrow();
    });

    it('should reject non-boolean include_deviations', () => {
      const input = { include_deviations: 'yes' };

      expect(() => CheckConformanceSchema.parse(input)).toThrow();
    });

    it('should accept empty doc_numbers array', () => {
      const input = { doc_numbers: [] };

      const result = CheckConformanceSchema.parse(input);
      expect(result.doc_numbers).toEqual([]);
    });

    it('should accept array of document numbers', () => {
      const input = {
        doc_numbers: ['0000012345', '0000012346', '0000012347'],
      };

      const result = CheckConformanceSchema.parse(input);
      expect(result.doc_numbers?.length).toBe(3);
    });
  });
});

describe('checkConformanceTool', () => {
  it('should have correct tool definition', () => {
    expect(checkConformanceTool.name).toBe('check_conformance');
    expect(checkConformanceTool.description).toContain('conformance');
    expect(checkConformanceTool.description).toContain('reference model');
    expect(checkConformanceTool.inputSchema.properties).toHaveProperty('doc_numbers');
    expect(checkConformanceTool.inputSchema.properties).toHaveProperty('include_deviations');
    expect(checkConformanceTool.inputSchema.properties).toHaveProperty('severity_filter');
  });

  it('should have array type for doc_numbers property', () => {
    expect(checkConformanceTool.inputSchema.properties.doc_numbers.type).toBe('array');
  });

  it('should have boolean type for include_deviations property', () => {
    expect(checkConformanceTool.inputSchema.properties.include_deviations.type).toBe('boolean');
  });

  it('should have enum for severity_filter property', () => {
    expect(checkConformanceTool.inputSchema.properties.severity_filter.enum).toContain('all');
    expect(checkConformanceTool.inputSchema.properties.severity_filter.enum).toContain('critical');
    expect(checkConformanceTool.inputSchema.properties.severity_filter.enum).toContain('major');
    expect(checkConformanceTool.inputSchema.properties.severity_filter.enum).toContain('minor');
  });

  it('should describe deviation types', () => {
    expect(checkConformanceTool.description).toContain('deviation');
  });
});

describe('O2C Reference Model', () => {
  // Test the expected sequence in the O2C reference model
  const referenceSequence = [
    { activity: 'Order Created', category: 'C', required: true },
    { activity: 'Delivery Created', category: 'J', required: true },
    { activity: 'Goods Issued', category: 'J', required: false },
    { activity: 'Invoice Created', category: 'M', required: true },
    { activity: 'Payment Received', category: 'P', required: false },
  ];

  it('should have Order Created as first required activity', () => {
    expect(referenceSequence[0]?.activity).toBe('Order Created');
    expect(referenceSequence[0]?.required).toBe(true);
  });

  it('should have Delivery Created as required activity', () => {
    const delivery = referenceSequence.find(s => s.activity === 'Delivery Created');
    expect(delivery?.required).toBe(true);
  });

  it('should have Invoice Created as required activity', () => {
    const invoice = referenceSequence.find(s => s.activity === 'Invoice Created');
    expect(invoice?.required).toBe(true);
  });

  it('should have Goods Issued as optional activity', () => {
    const gi = referenceSequence.find(s => s.activity === 'Goods Issued');
    expect(gi?.required).toBe(false);
  });

  it('should have Payment Received as optional activity', () => {
    const payment = referenceSequence.find(s => s.activity === 'Payment Received');
    expect(payment?.required).toBe(false);
  });

  it('should maintain correct sequence order', () => {
    const orderIndex = referenceSequence.findIndex(s => s.activity === 'Order Created');
    const deliveryIndex = referenceSequence.findIndex(s => s.activity === 'Delivery Created');
    const invoiceIndex = referenceSequence.findIndex(s => s.activity === 'Invoice Created');

    expect(orderIndex).toBeLessThan(deliveryIndex);
    expect(deliveryIndex).toBeLessThan(invoiceIndex);
  });
});

describe('Deviation Detection Logic', () => {
  type DeviationType =
    | 'missing_activity'
    | 'wrong_order'
    | 'skipped_step'
    | 'repeated_activity'
    | 'unexpected_activity';
  type DeviationSeverity = 'critical' | 'major' | 'minor';

  interface Deviation {
    doc_number: string;
    deviation_type: DeviationType;
    severity: DeviationSeverity;
    description: string;
    expected?: string;
    actual?: string;
  }

  function detectMissingActivity(
    docNumber: string,
    hasDelivery: boolean,
    hasInvoice: boolean
  ): Deviation[] {
    const deviations: Deviation[] = [];

    if (!hasDelivery) {
      deviations.push({
        doc_number: docNumber,
        deviation_type: 'missing_activity',
        severity: 'critical',
        description: 'Delivery document missing - required step skipped',
        expected: 'Delivery Created',
        actual: 'Not found',
      });
    }

    if (!hasInvoice) {
      deviations.push({
        doc_number: docNumber,
        deviation_type: 'missing_activity',
        severity: 'critical',
        description: 'Invoice document missing - required step skipped',
        expected: 'Invoice Created',
        actual: 'Not found',
      });
    }

    return deviations;
  }

  function detectWrongOrder(
    docNumber: string,
    orderDate: Date,
    deliveryDate: Date,
    invoiceDate: Date
  ): Deviation[] {
    const deviations: Deviation[] = [];

    if (deliveryDate < orderDate) {
      deviations.push({
        doc_number: docNumber,
        deviation_type: 'wrong_order',
        severity: 'major',
        description: 'Delivery created before order',
        expected: 'Order -> Delivery',
        actual: 'Delivery -> Order',
      });
    }

    if (invoiceDate < deliveryDate) {
      deviations.push({
        doc_number: docNumber,
        deviation_type: 'wrong_order',
        severity: 'major',
        description: 'Invoice created before delivery',
        expected: 'Delivery -> Invoice',
        actual: 'Invoice -> Delivery',
      });
    }

    return deviations;
  }

  it('should detect missing delivery', () => {
    const deviations = detectMissingActivity('0000012345', false, true);
    expect(deviations.length).toBe(1);
    expect(deviations[0]?.deviation_type).toBe('missing_activity');
    expect(deviations[0]?.description).toContain('Delivery');
  });

  it('should detect missing invoice', () => {
    const deviations = detectMissingActivity('0000012345', true, false);
    expect(deviations.length).toBe(1);
    expect(deviations[0]?.deviation_type).toBe('missing_activity');
    expect(deviations[0]?.description).toContain('Invoice');
  });

  it('should detect multiple missing activities', () => {
    const deviations = detectMissingActivity('0000012345', false, false);
    expect(deviations.length).toBe(2);
  });

  it('should not detect deviations for complete flow', () => {
    const deviations = detectMissingActivity('0000012345', true, true);
    expect(deviations.length).toBe(0);
  });

  it('should classify missing activities as critical', () => {
    const deviations = detectMissingActivity('0000012345', false, true);
    expect(deviations[0]?.severity).toBe('critical');
  });

  it('should detect wrong order: delivery before order', () => {
    const orderDate = new Date('2024-01-15');
    const deliveryDate = new Date('2024-01-14');
    const invoiceDate = new Date('2024-01-16');

    const deviations = detectWrongOrder('0000012345', orderDate, deliveryDate, invoiceDate);
    expect(deviations.some(d => d.description.includes('Delivery created before order'))).toBe(
      true
    );
  });

  it('should detect wrong order: invoice before delivery', () => {
    const orderDate = new Date('2024-01-14');
    const deliveryDate = new Date('2024-01-16');
    const invoiceDate = new Date('2024-01-15');

    const deviations = detectWrongOrder('0000012345', orderDate, deliveryDate, invoiceDate);
    expect(deviations.some(d => d.description.includes('Invoice created before delivery'))).toBe(
      true
    );
  });

  it('should classify wrong order as major severity', () => {
    const orderDate = new Date('2024-01-15');
    const deliveryDate = new Date('2024-01-14');
    const invoiceDate = new Date('2024-01-16');

    const deviations = detectWrongOrder('0000012345', orderDate, deliveryDate, invoiceDate);
    expect(deviations[0]?.severity).toBe('major');
  });
});

describe('Conformance Rate Calculation', () => {
  function calculateConformanceRate(totalCases: number, conformingCases: number): number {
    if (totalCases === 0) return 0;
    return Math.round((conformingCases / totalCases) * 10000) / 100;
  }

  it('should calculate 100% for all conforming cases', () => {
    const rate = calculateConformanceRate(10, 10);
    expect(rate).toBe(100);
  });

  it('should calculate 0% for no conforming cases', () => {
    const rate = calculateConformanceRate(10, 0);
    expect(rate).toBe(0);
  });

  it('should calculate 50% for half conforming', () => {
    const rate = calculateConformanceRate(10, 5);
    expect(rate).toBe(50);
  });

  it('should handle decimal percentages', () => {
    const rate = calculateConformanceRate(3, 1);
    expect(rate).toBeCloseTo(33.33, 1);
  });

  it('should return 0 for zero total cases', () => {
    const rate = calculateConformanceRate(0, 0);
    expect(rate).toBe(0);
  });
});

describe('Deviation Severity Summary', () => {
  type DeviationSeverity = 'critical' | 'major' | 'minor';

  interface SeveritySummary {
    critical: number;
    major: number;
    minor: number;
  }

  function summarizeSeverities(severities: DeviationSeverity[]): SeveritySummary {
    return {
      critical: severities.filter(s => s === 'critical').length,
      major: severities.filter(s => s === 'major').length,
      minor: severities.filter(s => s === 'minor').length,
    };
  }

  it('should count critical deviations', () => {
    const severities: DeviationSeverity[] = ['critical', 'critical', 'major'];
    const summary = summarizeSeverities(severities);
    expect(summary.critical).toBe(2);
  });

  it('should count major deviations', () => {
    const severities: DeviationSeverity[] = ['major', 'major', 'minor'];
    const summary = summarizeSeverities(severities);
    expect(summary.major).toBe(2);
  });

  it('should count minor deviations', () => {
    const severities: DeviationSeverity[] = ['minor', 'minor', 'minor'];
    const summary = summarizeSeverities(severities);
    expect(summary.minor).toBe(3);
  });

  it('should handle empty array', () => {
    const summary = summarizeSeverities([]);
    expect(summary.critical).toBe(0);
    expect(summary.major).toBe(0);
    expect(summary.minor).toBe(0);
  });

  it('should count mixed severities correctly', () => {
    const severities: DeviationSeverity[] = ['critical', 'major', 'minor', 'critical', 'major'];
    const summary = summarizeSeverities(severities);
    expect(summary.critical).toBe(2);
    expect(summary.major).toBe(2);
    expect(summary.minor).toBe(1);
  });
});

describe('Deviation Type Summary', () => {
  type DeviationType = 'missing_activity' | 'wrong_order' | 'skipped_step' | 'repeated_activity';

  interface DeviationTypeSummary {
    missing_activity: number;
    wrong_order: number;
    skipped_step: number;
    repeated_activity: number;
  }

  function summarizeDeviationTypes(types: DeviationType[]): DeviationTypeSummary {
    return {
      missing_activity: types.filter(t => t === 'missing_activity').length,
      wrong_order: types.filter(t => t === 'wrong_order').length,
      skipped_step: types.filter(t => t === 'skipped_step').length,
      repeated_activity: types.filter(t => t === 'repeated_activity').length,
    };
  }

  it('should count missing_activity deviations', () => {
    const types: DeviationType[] = ['missing_activity', 'missing_activity', 'wrong_order'];
    const summary = summarizeDeviationTypes(types);
    expect(summary.missing_activity).toBe(2);
  });

  it('should count wrong_order deviations', () => {
    const types: DeviationType[] = ['wrong_order', 'wrong_order'];
    const summary = summarizeDeviationTypes(types);
    expect(summary.wrong_order).toBe(2);
  });

  it('should count repeated_activity deviations', () => {
    const types: DeviationType[] = ['repeated_activity', 'repeated_activity', 'repeated_activity'];
    const summary = summarizeDeviationTypes(types);
    expect(summary.repeated_activity).toBe(3);
  });

  it('should handle empty array', () => {
    const summary = summarizeDeviationTypes([]);
    expect(summary.missing_activity).toBe(0);
    expect(summary.wrong_order).toBe(0);
    expect(summary.skipped_step).toBe(0);
    expect(summary.repeated_activity).toBe(0);
  });
});
