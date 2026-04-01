/**
 * Tests for SFDC Pipeline Extraction Paths
 *
 * Validates the three Salesforce extraction paths: opportunities,
 * stage history, and activities. Checks IDs, types, SOQL structure,
 * and field type correctness.
 */

import { describe, it, expect } from '@jest/globals';

import { SFDC_PIPELINE_PATHS } from '../extraction-registry/sfdc/pipeline.js';
import type { ExtractionPath } from '../extraction-registry/types.js';

describe('SFDC Pipeline Extraction Paths', () => {
  // ========================================================================
  // Structural tests across all paths
  // ========================================================================

  it('should export exactly 3 paths', () => {
    expect(SFDC_PIPELINE_PATHS).toHaveLength(3);
  });

  it('all paths have IDs starting with sfdc.pipeline.', () => {
    for (const path of SFDC_PIPELINE_PATHS) {
      expect(path.id).toMatch(/^sfdc\.pipeline\./);
    }
  });

  it('all paths have systemType Salesforce', () => {
    for (const path of SFDC_PIPELINE_PATHS) {
      expect(path.systemType).toBe('Salesforce');
    }
  });

  it('all paths have domain pipeline', () => {
    for (const path of SFDC_PIPELINE_PATHS) {
      expect(path.domain).toBe('pipeline');
    }
  });

  it('all paths have queryType soql', () => {
    for (const path of SFDC_PIPELINE_PATHS) {
      expect(path.queryType).toBe('soql');
    }
  });

  it('all queries have valid SOQL structure (SELECT, FROM, WHERE, ORDER BY)', () => {
    for (const path of SFDC_PIPELINE_PATHS) {
      expect(path.query).toMatch(/SELECT\s+/);
      expect(path.query).toMatch(/FROM\s+\w+/);
      expect(path.query).toMatch(/WHERE\s+/);
      expect(path.query).toMatch(/ORDER BY\s+/);
    }
  });

  // ========================================================================
  // Path 1: Opportunities
  // ========================================================================

  describe('sfdc.pipeline.opportunities', () => {
    let path: ExtractionPath;

    beforeAll(() => {
      const found = SFDC_PIPELINE_PATHS.find(p => p.id === 'sfdc.pipeline.opportunities');
      expect(found).toBeDefined();
      path = found!;
    });

    it('query references the Opportunity object', () => {
      expect(path.query).toMatch(/FROM\s+Opportunity\b/);
    });

    it('has date_from and date_to parameters', () => {
      const paramNames = path.parameters.map(p => p.name);
      expect(paramNames).toContain('date_from');
      expect(paramNames).toContain('date_to');
    });

    it('both parameters are required', () => {
      for (const param of path.parameters) {
        expect(param.required).toBe(true);
      }
    });

    it('Amount field is typed as amount', () => {
      const amountField = path.expectedFields.find(f => f.name === 'Amount');
      expect(amountField).toBeDefined();
      expect(amountField!.type).toBe('amount');
    });

    it('date fields are typed as date', () => {
      const dateFieldNames = ['CloseDate', 'CreatedDate', 'LastModifiedDate'];
      for (const name of dateFieldNames) {
        const field = path.expectedFields.find(f => f.name === name);
        expect(field).toBeDefined();
        expect(field!.type).toBe('date');
      }
    });

    it('IsClosed and IsWon are typed as boolean', () => {
      const isClosed = path.expectedFields.find(f => f.name === 'IsClosed');
      const isWon = path.expectedFields.find(f => f.name === 'IsWon');
      expect(isClosed).toBeDefined();
      expect(isClosed!.type).toBe('boolean');
      expect(isWon).toBeDefined();
      expect(isWon!.type).toBe('boolean');
    });

    it('all fields have sfdcName mappings', () => {
      for (const field of path.expectedFields) {
        expect(field.sfdcName).toBeDefined();
        expect(field.sfdcName!.length).toBeGreaterThan(0);
      }
    });
  });

  // ========================================================================
  // Path 2: Stage History
  // ========================================================================

  describe('sfdc.pipeline.stage-history', () => {
    let path: ExtractionPath;

    beforeAll(() => {
      const found = SFDC_PIPELINE_PATHS.find(p => p.id === 'sfdc.pipeline.stage-history');
      expect(found).toBeDefined();
      path = found!;
    });

    it('query references the OpportunityHistory object', () => {
      expect(path.query).toMatch(/FROM\s+OpportunityHistory\b/);
    });

    it('has opportunity_id parameter', () => {
      const paramNames = path.parameters.map(p => p.name);
      expect(paramNames).toContain('opportunity_id');
    });

    it('opportunity_id is required', () => {
      const param = path.parameters.find(p => p.name === 'opportunity_id');
      expect(param).toBeDefined();
      expect(param!.required).toBe(true);
    });

    it('Amount field is typed as amount', () => {
      const amountField = path.expectedFields.find(f => f.name === 'Amount');
      expect(amountField).toBeDefined();
      expect(amountField!.type).toBe('amount');
    });

    it('ExpectedRevenue field is typed as amount', () => {
      const field = path.expectedFields.find(f => f.name === 'ExpectedRevenue');
      expect(field).toBeDefined();
      expect(field!.type).toBe('amount');
    });

    it('date fields are typed as date', () => {
      const dateFieldNames = ['CloseDate', 'CreatedDate', 'SystemModstamp'];
      for (const name of dateFieldNames) {
        const field = path.expectedFields.find(f => f.name === name);
        expect(field).toBeDefined();
        expect(field!.type).toBe('date');
      }
    });

    it('all fields have sfdcName mappings', () => {
      for (const field of path.expectedFields) {
        expect(field.sfdcName).toBeDefined();
        expect(field.sfdcName!.length).toBeGreaterThan(0);
      }
    });
  });

  // ========================================================================
  // Path 3: Activities
  // ========================================================================

  describe('sfdc.pipeline.activities', () => {
    let path: ExtractionPath;

    beforeAll(() => {
      const found = SFDC_PIPELINE_PATHS.find(p => p.id === 'sfdc.pipeline.activities');
      expect(found).toBeDefined();
      path = found!;
    });

    it('query references the Task object', () => {
      expect(path.query).toMatch(/FROM\s+Task\b/);
    });

    it('has opportunity_id parameter', () => {
      const paramNames = path.parameters.map(p => p.name);
      expect(paramNames).toContain('opportunity_id');
    });

    it('opportunity_id is required', () => {
      const param = path.parameters.find(p => p.name === 'opportunity_id');
      expect(param).toBeDefined();
      expect(param!.required).toBe(true);
    });

    it('date fields are typed as date', () => {
      const dateFieldNames = ['ActivityDate', 'CreatedDate', 'LastModifiedDate'];
      for (const name of dateFieldNames) {
        const field = path.expectedFields.find(f => f.name === name);
        expect(field).toBeDefined();
        expect(field!.type).toBe('date');
      }
    });

    it('CallDurationInSeconds is typed as number', () => {
      const field = path.expectedFields.find(f => f.name === 'CallDurationInSeconds');
      expect(field).toBeDefined();
      expect(field!.type).toBe('number');
    });

    it('all fields have sfdcName mappings', () => {
      for (const field of path.expectedFields) {
        expect(field.sfdcName).toBeDefined();
        expect(field.sfdcName!.length).toBeGreaterThan(0);
      }
    });
  });
});
