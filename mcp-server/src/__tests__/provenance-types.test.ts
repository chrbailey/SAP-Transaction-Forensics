/**
 * Tests for provenance and extraction registry type definitions
 *
 * Validates that type structures are importable, usable, and that
 * runtime constraints hold (since TypeScript types are erased at runtime).
 */

import type {
  SystemType,
  EvidenceRole,
  ExtractionRecord,
  FindingEvidence,
  ProvenanceNode,
  ProvenanceDAG,
  ProvenanceSummary,
} from '../provenance/types.js';

import type {
  QueryType,
  FieldType,
  ExtractionDomain,
  ParameterDefinition,
  FieldDefinition,
  TestExpectation,
  ExtractionPath,
  ExtractionResult,
  RegistryMetadata,
} from '../extraction-registry/types.js';

// --- Runtime validation helpers ---

const VALID_SYSTEM_TYPES: readonly string[] = ['SAP', 'NetSuite', 'Salesforce'];
const VALID_EVIDENCE_ROLES: readonly string[] = ['primary', 'corroborating', 'contradicting'];
const VALID_QUERY_TYPES: readonly string[] = ['sql', 'saved-search', 'soql', 'rfc', 'odata'];
const VALID_FIELD_TYPES: readonly string[] = ['string', 'number', 'date', 'amount', 'boolean'];
const VALID_EXTRACTION_DOMAINS: readonly string[] = [
  'o2c',
  'fi-co',
  'p2p',
  'user-audit',
  'pipeline',
];
const VALID_NODE_TYPES: readonly string[] = ['finding', 'evidence', 'extraction'];

function isValidSystemType(value: string): value is SystemType {
  return VALID_SYSTEM_TYPES.includes(value);
}

function isValidEvidenceRole(value: string): value is EvidenceRole {
  return VALID_EVIDENCE_ROLES.includes(value);
}

function isValidQueryType(value: string): value is QueryType {
  return VALID_QUERY_TYPES.includes(value);
}

function isValidFieldType(value: string): value is FieldType {
  return VALID_FIELD_TYPES.includes(value);
}

function isValidExtractionDomain(value: string): value is ExtractionDomain {
  return VALID_EXTRACTION_DOMAINS.includes(value);
}

function isValidNodeType(value: string): value is ProvenanceNode['type'] {
  return VALID_NODE_TYPES.includes(value);
}

// --- Provenance types ---

describe('Provenance types', () => {
  describe('SystemType constraints', () => {
    it('should accept valid system types', () => {
      for (const st of VALID_SYSTEM_TYPES) {
        expect(isValidSystemType(st)).toBe(true);
      }
    });

    it('should reject invalid system types', () => {
      expect(isValidSystemType('Oracle')).toBe(false);
      expect(isValidSystemType('sap')).toBe(false);
      expect(isValidSystemType('')).toBe(false);
    });

    it('should have exactly 3 valid values', () => {
      expect(VALID_SYSTEM_TYPES).toHaveLength(3);
    });
  });

  describe('EvidenceRole constraints', () => {
    it('should accept valid evidence roles', () => {
      for (const role of VALID_EVIDENCE_ROLES) {
        expect(isValidEvidenceRole(role)).toBe(true);
      }
    });

    it('should reject invalid evidence roles', () => {
      expect(isValidEvidenceRole('supporting')).toBe(false);
      expect(isValidEvidenceRole('')).toBe(false);
    });
  });

  describe('ExtractionRecord', () => {
    const record: ExtractionRecord = {
      id: 'ext-001',
      adapterId: 'sap-ecc-001',
      systemType: 'SAP',
      tableName: 'VBAK',
      recordId: '0000012345',
      fieldName: 'VBELN',
      rawValue: '0000012345',
      normalizedValue: '12345',
      extractionTimestamp: '2026-03-31T10:00:00.000Z',
      queryHash: 'abc123def456',
      replayHash: 'fed654cba321',
      extractionPathId: 'sap.o2c.order-header',
      extractionPathVersion: '1.0.0',
    };

    it('should have all required fields', () => {
      expect(record.id).toBeDefined();
      expect(record.adapterId).toBeDefined();
      expect(record.systemType).toBeDefined();
      expect(record.tableName).toBeDefined();
      expect(record.recordId).toBeDefined();
      expect(record.fieldName).toBeDefined();
      expect(record.rawValue).toBeDefined();
      expect(record.normalizedValue).toBeDefined();
      expect(record.extractionTimestamp).toBeDefined();
      expect(record.queryHash).toBeDefined();
      expect(record.replayHash).toBeDefined();
      expect(record.extractionPathId).toBeDefined();
      expect(record.extractionPathVersion).toBeDefined();
    });

    it('should use a valid SystemType', () => {
      expect(isValidSystemType(record.systemType)).toBe(true);
    });

    it('should have ISO 8601 extraction timestamp', () => {
      expect(new Date(record.extractionTimestamp).toISOString()).toBe(record.extractionTimestamp);
    });
  });

  describe('FindingEvidence', () => {
    const evidence: FindingEvidence = {
      findingId: 'find-001',
      extractionId: 'ext-001',
      role: 'primary',
      addedAt: '2026-03-31T10:05:00Z',
    };

    it('should have all required fields', () => {
      expect(evidence.findingId).toBeDefined();
      expect(evidence.extractionId).toBeDefined();
      expect(evidence.role).toBeDefined();
      expect(evidence.addedAt).toBeDefined();
    });

    it('should use a valid EvidenceRole', () => {
      expect(isValidEvidenceRole(evidence.role)).toBe(true);
    });
  });

  describe('ProvenanceNode', () => {
    const leaf: ProvenanceNode = {
      type: 'extraction',
      id: 'ext-001',
      data: { tableName: 'VBAK', fieldName: 'VBELN' },
      children: [],
    };

    const parent: ProvenanceNode = {
      type: 'finding',
      id: 'find-001',
      data: { description: 'Duplicate invoice detected' },
      children: [leaf],
    };

    it('should use valid node types', () => {
      expect(isValidNodeType(leaf.type)).toBe(true);
      expect(isValidNodeType(parent.type)).toBe(true);
    });

    it('should support nested children (DAG structure)', () => {
      expect(parent.children).toHaveLength(1);
      expect(parent.children[0]!.id).toBe('ext-001');
    });

    it('should allow arbitrary data via Record<string, unknown>', () => {
      expect(leaf.data['tableName']).toBe('VBAK');
      expect(parent.data['description']).toBe('Duplicate invoice detected');
    });
  });

  describe('ProvenanceDAG', () => {
    const dag: ProvenanceDAG = {
      rootFindingId: 'find-001',
      nodes: [
        {
          type: 'finding',
          id: 'find-001',
          data: {},
          children: [
            { type: 'evidence', id: 'ev-001', data: {}, children: [] },
            { type: 'extraction', id: 'ext-001', data: {}, children: [] },
          ],
        },
      ],
      generatedAt: '2026-03-31T10:10:00Z',
      replayable: true,
    };

    it('should have all required fields', () => {
      expect(dag.rootFindingId).toBeDefined();
      expect(dag.nodes).toBeDefined();
      expect(dag.generatedAt).toBeDefined();
      expect(typeof dag.replayable).toBe('boolean');
    });

    it('should contain a valid node tree', () => {
      expect(dag.nodes).toHaveLength(1);
      expect(dag.nodes[0]!.children).toHaveLength(2);
    });
  });

  describe('ProvenanceSummary', () => {
    const summary: ProvenanceSummary = {
      findingId: 'find-001',
      extractionCount: 5,
      systemsCovered: ['SAP', 'Salesforce'],
      tablesCovered: ['VBAK', 'VBAP', 'Opportunity'],
      oldestExtraction: '2026-03-01T00:00:00Z',
      newestExtraction: '2026-03-31T10:00:00Z',
      allReplayable: true,
    };

    it('should have all required fields', () => {
      expect(summary.findingId).toBeDefined();
      expect(summary.extractionCount).toBeGreaterThan(0);
      expect(summary.systemsCovered.length).toBeGreaterThan(0);
      expect(summary.tablesCovered.length).toBeGreaterThan(0);
      expect(summary.oldestExtraction).toBeDefined();
      expect(summary.newestExtraction).toBeDefined();
      expect(typeof summary.allReplayable).toBe('boolean');
    });

    it('should only contain valid SystemType values in systemsCovered', () => {
      for (const sys of summary.systemsCovered) {
        expect(isValidSystemType(sys)).toBe(true);
      }
    });
  });
});

// --- Extraction Registry types ---

describe('Extraction Registry types', () => {
  describe('QueryType constraints', () => {
    it('should accept valid query types', () => {
      for (const qt of VALID_QUERY_TYPES) {
        expect(isValidQueryType(qt)).toBe(true);
      }
    });

    it('should reject invalid query types', () => {
      expect(isValidQueryType('graphql')).toBe(false);
      expect(isValidQueryType('rest')).toBe(false);
    });

    it('should have exactly 5 valid values', () => {
      expect(VALID_QUERY_TYPES).toHaveLength(5);
    });
  });

  describe('FieldType constraints', () => {
    it('should accept valid field types', () => {
      for (const ft of VALID_FIELD_TYPES) {
        expect(isValidFieldType(ft)).toBe(true);
      }
    });

    it('should have exactly 5 valid values', () => {
      expect(VALID_FIELD_TYPES).toHaveLength(5);
    });
  });

  describe('ExtractionDomain constraints', () => {
    it('should accept valid extraction domains', () => {
      for (const d of VALID_EXTRACTION_DOMAINS) {
        expect(isValidExtractionDomain(d)).toBe(true);
      }
    });

    it('should reject invalid domains', () => {
      expect(isValidExtractionDomain('hr')).toBe(false);
      expect(isValidExtractionDomain('mm')).toBe(false);
    });

    it('should have exactly 5 valid values', () => {
      expect(VALID_EXTRACTION_DOMAINS).toHaveLength(5);
    });
  });

  describe('ExtractionPath', () => {
    const path: ExtractionPath = {
      id: 'sap.o2c.order-header',
      version: '1.0.0',
      name: 'SAP Order Header',
      description: 'Extracts sales order header data from VBAK',
      systemType: 'SAP',
      domain: 'o2c',
      queryType: 'sql',
      query: 'SELECT VBELN, ERDAT, AUART FROM VBAK WHERE ERDAT BETWEEN ? AND ?',
      parameters: [
        { name: 'date_from', type: 'date', required: true, description: 'Start date' },
        { name: 'date_to', type: 'date', required: true, description: 'End date' },
      ],
      expectedFields: [
        {
          name: 'orderNumber',
          type: 'string',
          sapFieldName: 'VBELN',
          description: 'Sales order number',
        },
        { name: 'createdDate', type: 'date', sapFieldName: 'ERDAT', description: 'Creation date' },
        { name: 'orderType', type: 'string', sapFieldName: 'AUART', description: 'Order type' },
      ],
      testData: {
        inputParams: { date_from: '2024-01-01', date_to: '2024-01-31' },
        expectedRowCount: 150,
        expectedHash: 'sha256-abc123',
        description: 'January 2024 orders for sales org 1000',
      },
    };

    it('should have all required fields', () => {
      expect(path.id).toBeDefined();
      expect(path.version).toBeDefined();
      expect(path.name).toBeDefined();
      expect(path.description).toBeDefined();
      expect(path.systemType).toBeDefined();
      expect(path.domain).toBeDefined();
      expect(path.queryType).toBeDefined();
      expect(path.query).toBeDefined();
      expect(path.parameters).toBeDefined();
      expect(path.expectedFields).toBeDefined();
    });

    it('should use valid constrained types', () => {
      expect(isValidSystemType(path.systemType)).toBe(true);
      expect(isValidExtractionDomain(path.domain)).toBe(true);
      expect(isValidQueryType(path.queryType)).toBe(true);
    });

    it('should have properly structured parameters', () => {
      expect(path.parameters).toHaveLength(2);
      for (const param of path.parameters) {
        expect(param.name).toBeDefined();
        expect(isValidFieldType(param.type)).toBe(true);
        expect(typeof param.required).toBe('boolean');
        expect(param.description).toBeDefined();
      }
    });

    it('should have properly structured expected fields', () => {
      expect(path.expectedFields).toHaveLength(3);
      for (const field of path.expectedFields) {
        expect(field.name).toBeDefined();
        expect(isValidFieldType(field.type)).toBe(true);
        expect(field.description).toBeDefined();
      }
    });

    it('should support optional testData', () => {
      expect(path.testData).toBeDefined();
      expect(path.testData!.inputParams).toBeDefined();
      expect(typeof path.testData!.expectedRowCount).toBe('number');
    });

    it('should support field name mappings for SAP', () => {
      const orderField = path.expectedFields[0]!;
      expect(orderField.sapFieldName).toBe('VBELN');
    });
  });

  describe('ExtractionPath with Salesforce', () => {
    const sfdcPath: ExtractionPath = {
      id: 'sfdc.pipeline.opportunity',
      version: '1.0.0',
      name: 'Salesforce Opportunity',
      description: 'Extracts opportunity data via SOQL',
      systemType: 'Salesforce',
      domain: 'pipeline',
      queryType: 'soql',
      query: 'SELECT Id, Name, Amount, StageName FROM Opportunity WHERE CloseDate >= :date_from',
      parameters: [
        { name: 'date_from', type: 'date', required: true, description: 'Earliest close date' },
      ],
      expectedFields: [
        { name: 'id', type: 'string', sfdcName: 'Id', description: 'Opportunity ID' },
        { name: 'name', type: 'string', sfdcName: 'Name', description: 'Opportunity name' },
        { name: 'amount', type: 'amount', sfdcName: 'Amount', description: 'Deal amount' },
        { name: 'stage', type: 'string', sfdcName: 'StageName', description: 'Pipeline stage' },
      ],
    };

    it('should support Salesforce system type with SOQL query type', () => {
      expect(isValidSystemType(sfdcPath.systemType)).toBe(true);
      expect(isValidQueryType(sfdcPath.queryType)).toBe(true);
      expect(sfdcPath.systemType).toBe('Salesforce');
      expect(sfdcPath.queryType).toBe('soql');
    });

    it('should support sfdcName field mappings', () => {
      const amountField = sfdcPath.expectedFields[2]!;
      expect(amountField.sfdcName).toBe('Amount');
      expect(amountField.type).toBe('amount');
    });
  });

  describe('ExtractionResult', () => {
    const result: ExtractionResult = {
      pathId: 'sap.o2c.order-header',
      pathVersion: '1.0.0',
      parameters: { date_from: '2024-01-01', date_to: '2024-01-31' },
      rows: [
        { orderNumber: '12345', createdDate: '2024-01-15', orderType: 'OR' },
        { orderNumber: '12346', createdDate: '2024-01-16', orderType: 'OR' },
      ],
      rowCount: 2,
      replayHash: 'sha256-result-hash',
      extractedAt: '2026-03-31T10:00:00.000Z',
    };

    it('should have all required fields', () => {
      expect(result.pathId).toBeDefined();
      expect(result.pathVersion).toBeDefined();
      expect(result.parameters).toBeDefined();
      expect(result.rows).toBeDefined();
      expect(typeof result.rowCount).toBe('number');
      expect(result.replayHash).toBeDefined();
      expect(result.extractedAt).toBeDefined();
    });

    it('should have rowCount matching rows length', () => {
      expect(result.rowCount).toBe(result.rows.length);
    });

    it('should have ISO 8601 extractedAt timestamp', () => {
      expect(new Date(result.extractedAt).toISOString()).toBe(result.extractedAt);
    });
  });

  describe('RegistryMetadata', () => {
    const metadata: RegistryMetadata = {
      registryVersion: '1.0.0',
      lastUpdated: '2026-03-31T10:00:00Z',
      pathCount: 12,
      domains: ['o2c', 'fi-co', 'pipeline'],
      systems: ['SAP', 'Salesforce'],
    };

    it('should have all required fields', () => {
      expect(metadata.registryVersion).toBeDefined();
      expect(metadata.lastUpdated).toBeDefined();
      expect(typeof metadata.pathCount).toBe('number');
      expect(metadata.domains).toBeDefined();
      expect(metadata.systems).toBeDefined();
    });

    it('should contain only valid domains', () => {
      for (const domain of metadata.domains) {
        expect(isValidExtractionDomain(domain)).toBe(true);
      }
    });

    it('should contain only valid system types', () => {
      for (const sys of metadata.systems) {
        expect(isValidSystemType(sys)).toBe(true);
      }
    });
  });
});
