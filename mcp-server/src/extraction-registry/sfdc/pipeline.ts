// mcp-server/src/extraction-registry/sfdc/pipeline.ts

/**
 * Salesforce Pipeline Extraction Paths
 *
 * Three deterministic SOQL extraction paths for Salesforce CRM
 * pipeline analysis: opportunities, stage history, and activities.
 * Used for ghost pipeline, stage skip, quarter-end compression,
 * amount inflation, and engagement pattern detection.
 */

import type { ExtractionPath } from '../types.js';

// ============================================================================
// Path 1: Opportunities
// ============================================================================

const opportunitiesPath: ExtractionPath = {
  id: 'sfdc.pipeline.opportunities',
  version: '1.0.0',
  name: 'Salesforce Opportunity Pipeline Extract',
  description:
    'Extract opportunity records for pipeline integrity analysis — ghost pipeline, stage skip, quarter-end compression, amount inflation detection',
  systemType: 'Salesforce',
  domain: 'pipeline',
  queryType: 'soql',
  query: [
    'SELECT Id, Name, AccountId, Account.Name, OwnerId, Owner.Name,',
    '       RecordType.Name, StageName, Amount, CloseDate, CreatedDate,',
    '       LastModifiedDate, ForecastCategory, Probability,',
    '       NextStep, Description, LeadSource, Type,',
    '       IsClosed, IsWon, FiscalYear, FiscalQuarter',
    'FROM Opportunity',
    'WHERE CreatedDate >= :date_from AND CreatedDate <= :date_to',
    'ORDER BY CreatedDate ASC',
  ].join('\n'),
  parameters: [
    {
      name: 'date_from',
      type: 'date',
      required: true,
      description: 'Start date for opportunity creation window (ISO 8601)',
    },
    {
      name: 'date_to',
      type: 'date',
      required: true,
      description: 'End date for opportunity creation window (ISO 8601)',
    },
  ],
  expectedFields: [
    { name: 'Id', type: 'string', sfdcName: 'Id', description: '18-character Salesforce Opportunity ID' },
    { name: 'Name', type: 'string', sfdcName: 'Name', description: 'Opportunity name' },
    { name: 'AccountId', type: 'string', sfdcName: 'AccountId', description: 'Parent account ID' },
    { name: 'AccountName', type: 'string', sfdcName: 'Account.Name', description: 'Parent account name' },
    { name: 'OwnerId', type: 'string', sfdcName: 'OwnerId', description: 'Opportunity owner user ID' },
    { name: 'OwnerName', type: 'string', sfdcName: 'Owner.Name', description: 'Opportunity owner display name' },
    { name: 'RecordTypeName', type: 'string', sfdcName: 'RecordType.Name', description: 'Record type (New Business, Renewal, Upsell, etc.)' },
    { name: 'StageName', type: 'string', sfdcName: 'StageName', description: 'Current pipeline stage' },
    { name: 'Amount', type: 'amount', sfdcName: 'Amount', description: 'Opportunity amount in default currency' },
    { name: 'CloseDate', type: 'date', sfdcName: 'CloseDate', description: 'Expected or actual close date' },
    { name: 'CreatedDate', type: 'date', sfdcName: 'CreatedDate', description: 'Record creation timestamp' },
    { name: 'LastModifiedDate', type: 'date', sfdcName: 'LastModifiedDate', description: 'Last modification timestamp' },
    { name: 'ForecastCategory', type: 'string', sfdcName: 'ForecastCategory', description: 'Forecast category (Pipeline, Best Case, Commit, Closed)' },
    { name: 'Probability', type: 'number', sfdcName: 'Probability', description: 'Win probability percentage (0-100)' },
    { name: 'NextStep', type: 'string', sfdcName: 'NextStep', description: 'Next step text field' },
    { name: 'Description', type: 'string', sfdcName: 'Description', description: 'Opportunity description' },
    { name: 'LeadSource', type: 'string', sfdcName: 'LeadSource', description: 'Lead source channel' },
    { name: 'Type', type: 'string', sfdcName: 'Type', description: 'Opportunity type' },
    { name: 'IsClosed', type: 'boolean', sfdcName: 'IsClosed', description: 'Whether the opportunity is in a terminal stage' },
    { name: 'IsWon', type: 'boolean', sfdcName: 'IsWon', description: 'Whether the opportunity was won' },
    { name: 'FiscalYear', type: 'number', sfdcName: 'FiscalYear', description: 'Fiscal year of the opportunity' },
    { name: 'FiscalQuarter', type: 'number', sfdcName: 'FiscalQuarter', description: 'Fiscal quarter (1-4)' },
  ],
  testData: {
    inputParams: { date_from: '2024-01-01T00:00:00Z', date_to: '2024-12-31T23:59:59Z' },
    expectedRowCount: 100,
  },
};

// ============================================================================
// Path 2: Stage History
// ============================================================================

const stageHistoryPath: ExtractionPath = {
  id: 'sfdc.pipeline.stage-history',
  version: '1.0.0',
  name: 'Salesforce Opportunity Stage History',
  description:
    'Extract complete stage history for an opportunity — stage regression, owner swap at close, amount inflation between stages',
  systemType: 'Salesforce',
  domain: 'pipeline',
  queryType: 'soql',
  query: [
    'SELECT Id, OpportunityId, StageName, Amount, Probability,',
    '       ExpectedRevenue, CloseDate, CreatedDate, CreatedById,',
    '       ForecastCategory, SystemModstamp',
    'FROM OpportunityHistory',
    'WHERE OpportunityId = :opportunity_id',
    'ORDER BY CreatedDate ASC',
  ].join('\n'),
  parameters: [
    {
      name: 'opportunity_id',
      type: 'string',
      required: true,
      description: '18-character Salesforce Opportunity ID',
    },
  ],
  expectedFields: [
    { name: 'Id', type: 'string', sfdcName: 'Id', description: 'Stage history record ID' },
    { name: 'OpportunityId', type: 'string', sfdcName: 'OpportunityId', description: 'Parent opportunity ID' },
    { name: 'StageName', type: 'string', sfdcName: 'StageName', description: 'Stage name at this snapshot' },
    { name: 'Amount', type: 'amount', sfdcName: 'Amount', description: 'Opportunity amount at this stage' },
    { name: 'Probability', type: 'number', sfdcName: 'Probability', description: 'Win probability at this stage' },
    { name: 'ExpectedRevenue', type: 'amount', sfdcName: 'ExpectedRevenue', description: 'Amount * Probability at this stage' },
    { name: 'CloseDate', type: 'date', sfdcName: 'CloseDate', description: 'Expected close date at this stage' },
    { name: 'CreatedDate', type: 'date', sfdcName: 'CreatedDate', description: 'When this stage snapshot was created' },
    { name: 'CreatedById', type: 'string', sfdcName: 'CreatedById', description: 'User who triggered the stage change' },
    { name: 'ForecastCategory', type: 'string', sfdcName: 'ForecastCategory', description: 'Forecast category at this stage' },
    { name: 'SystemModstamp', type: 'date', sfdcName: 'SystemModstamp', description: 'System modification timestamp' },
  ],
  testData: {
    inputParams: { opportunity_id: '006000000000001AAA' },
    expectedRowCount: 5,
  },
};

// ============================================================================
// Path 3: Activities (Tasks)
// ============================================================================

const activitiesPath: ExtractionPath = {
  id: 'sfdc.pipeline.activities',
  version: '1.0.0',
  name: 'Salesforce Opportunity Activity Extract',
  description:
    'Extract activity records linked to an opportunity — ghost pipeline detection (zero activities), engagement pattern analysis',
  systemType: 'Salesforce',
  domain: 'pipeline',
  queryType: 'soql',
  query: [
    'SELECT Id, WhoId, WhatId, Subject, ActivityDate, Status, Priority,',
    '       OwnerId, Owner.Name, CreatedDate, LastModifiedDate,',
    '       TaskSubtype, CallType, CallDurationInSeconds, Description',
    'FROM Task',
    'WHERE WhatId = :opportunity_id',
    'ORDER BY ActivityDate ASC',
  ].join('\n'),
  parameters: [
    {
      name: 'opportunity_id',
      type: 'string',
      required: true,
      description: '18-character Salesforce Opportunity ID',
    },
  ],
  expectedFields: [
    { name: 'Id', type: 'string', sfdcName: 'Id', description: 'Task record ID' },
    { name: 'WhoId', type: 'string', sfdcName: 'WhoId', description: 'Related contact or lead ID' },
    { name: 'WhatId', type: 'string', sfdcName: 'WhatId', description: 'Related opportunity ID' },
    { name: 'Subject', type: 'string', sfdcName: 'Subject', description: 'Task subject line' },
    { name: 'ActivityDate', type: 'date', sfdcName: 'ActivityDate', description: 'Date the activity occurred or is due' },
    { name: 'Status', type: 'string', sfdcName: 'Status', description: 'Task status (Not Started, In Progress, Completed, etc.)' },
    { name: 'Priority', type: 'string', sfdcName: 'Priority', description: 'Task priority (High, Normal, Low)' },
    { name: 'OwnerId', type: 'string', sfdcName: 'OwnerId', description: 'Task owner user ID' },
    { name: 'OwnerName', type: 'string', sfdcName: 'Owner.Name', description: 'Task owner display name' },
    { name: 'CreatedDate', type: 'date', sfdcName: 'CreatedDate', description: 'Task creation timestamp' },
    { name: 'LastModifiedDate', type: 'date', sfdcName: 'LastModifiedDate', description: 'Last modification timestamp' },
    { name: 'TaskSubtype', type: 'string', sfdcName: 'TaskSubtype', description: 'Task subtype (Task, Email, Call, etc.)' },
    { name: 'CallType', type: 'string', sfdcName: 'CallType', description: 'Call direction (Inbound, Outbound)' },
    { name: 'CallDurationInSeconds', type: 'number', sfdcName: 'CallDurationInSeconds', description: 'Call duration in seconds' },
    { name: 'Description', type: 'string', sfdcName: 'Description', description: 'Task description / notes' },
  ],
  testData: {
    inputParams: { opportunity_id: '006000000000001AAA' },
    expectedRowCount: 10,
  },
};

// ============================================================================
// Export
// ============================================================================

export const SFDC_PIPELINE_PATHS: ExtractionPath[] = [
  opportunitiesPath,
  stageHistoryPath,
  activitiesPath,
];
