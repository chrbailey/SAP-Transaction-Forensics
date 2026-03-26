/**
 * Salesforce REST API Client (Phase 2 Stub)
 *
 * This module will provide live Salesforce connectivity via REST API.
 * Currently a stub documenting the planned implementation.
 *
 * Prerequisites for Phase 2:
 * - Connected App in target Salesforce org
 * - OAuth2 credentials (client_id, client_secret, or JWT)
 * - Network access to Salesforce instance
 *
 * Planned APIs:
 * - Opportunity: /services/data/vXX.0/query/?q=SELECT...FROM Opportunity
 * - OpportunityFieldHistory: Field history tracking
 * - OpportunityLineItem: Line item data
 * - Task/Event: Activity records
 * - Account: Customer data
 * - Product2: Product catalog
 * - OpportunityStage: Pipeline metadata (for process model discovery)
 */

export interface SFDCRestConfig {
  instanceUrl: string;       // e.g., https://mycompany.salesforce.com
  apiVersion: string;        // e.g., v60.0
  authType: 'oauth2' | 'jwt';
  clientId: string;
  clientSecret?: string;
  privateKey?: string;
  username?: string;
}

export class SFDCRestClient {
  private config: SFDCRestConfig;

  constructor(config: SFDCRestConfig) {
    this.config = config;
  }

  async authenticate(): Promise<void> {
    throw new Error(
      'SFDC REST client not implemented (Phase 2). ' +
      'Use SFDCSyntheticAdapter for testing.'
    );
  }

  async query(_soql: string): Promise<unknown[]> {
    throw new Error('SFDC REST client not implemented (Phase 2)');
  }

  /**
   * Phase 2: Discover pipeline stages from org metadata.
   *
   * SOQL: SELECT StageName, SortOrder, DefaultProbability, IsClosed, IsWon
   *       FROM OpportunityStage WHERE IsActive = true ORDER BY SortOrder
   */
  async discoverPipelines(): Promise<unknown[]> {
    throw new Error('SFDC REST client not implemented (Phase 2)');
  }
}
