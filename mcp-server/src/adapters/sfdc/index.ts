/**
 * SFDC Synthetic Adapter
 *
 * Loads Salesforce synthetic JSON data and serves it through the IDataAdapter interface.
 * Field normalization is handled by SFDCFieldMapper.
 *
 * Data directory: synthetic-data/sfdc_output/
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { BaseDataAdapter, registerAdapter } from '../adapter-interface.js';
import { SFDCFieldMapper, padToLength, formatDateToSAP, extractTime } from './field-mapper.js';
import type {
  SFDCOpportunity,
  SFDCAccount,
  SFDCLineItem,
  SFDCStageHistory,
  SFDCActivity,
  SFDCProduct,
} from './sfdc-types.js';
import type {
  SearchDocTextParams,
  SearchResult,
  DocTextParams,
  DocTextResult,
  DocFlowParams,
  DocFlowResult,
  SalesDocHeaderParams,
  SalesDocHeader,
  SalesDocItemsParams,
  SalesDocItem,
  DeliveryTimingParams,
  DeliveryTimingResult,
  InvoiceTimingParams,
  InvoiceTimingResult,
  MasterStubParams,
  MasterStub,
} from '../../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Raw JSON shapes from synthetic-data/sfdc_output/
// These match the actual file structure (id-keyed, not *_id-keyed)
// ============================================================================

interface RawOpportunity {
  id: string;
  name: string;
  account_id: string;
  owner_id: string;
  type: string;
  stage_name: string;
  amount: number;
  close_date: string;
  created_date: string;
  probability: number;
  is_closed: boolean;
  is_won: boolean;
  is_sap_linked?: boolean;
  sap_order_id?: string | null;
  _pattern_flags?: string[];
}

interface RawAccount {
  id: string;
  name: string;
  industry: string;
  annual_revenue: number;
  employee_count: number;
  billing_country: string;
  created_date: string;
}

interface RawLineItem {
  id: string;
  opportunity_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  list_price?: number;
}

interface RawStageHistory {
  id: string;
  opportunity_id: string;
  stage_name: string;
  created_date: string;
  owner_id: string;
  amount: number | null;
}

interface RawActivity {
  id: string;
  opportunity_id: string;
  owner_id: string;
  type: string;
  subject: string;
  activity_date: string;
  status: string;
}

interface RawProduct {
  id: string;
  name: string;
  product_code: string;
  list_price: number;
  family: string;
  is_active: boolean;
}

// ============================================================================
// Normalizers: raw JSON → typed SFDC interfaces expected by field-mapper
// ============================================================================

function normalizeOpportunity(raw: RawOpportunity): SFDCOpportunity {
  return {
    opportunity_id: raw.id,
    name: raw.name,
    account_id: raw.account_id,
    record_type: raw.type || 'New Business',
    stage_name: raw.stage_name,
    amount: raw.amount ?? 0,
    currency_iso_code: 'USD',
    owner_id: raw.owner_id,
    created_date: raw.created_date,
    close_date: raw.close_date,
    type: raw.type || '',
    lead_source: '',
    probability: raw.probability ?? 0,
    forecast_category: '',
    sap_order_number: raw.sap_order_id ?? null,
    is_closed: raw.is_closed ?? false,
    is_won: raw.is_won ?? false,
    _pattern_flags: raw._pattern_flags,
  };
}

function normalizeAccount(raw: RawAccount): SFDCAccount {
  return {
    account_id: raw.id,
    name: raw.name,
    industry: raw.industry || '',
    billing_state: raw.billing_country || '', // billing_state maps to billing_country in real data
    billing_country: raw.billing_country || '',
    type: 'Customer', // default — not in data
    number_of_employees: raw.employee_count ?? 0,
    annual_revenue: raw.annual_revenue ?? 0,
    sap_customer_number: null,
  };
}

function normalizeLineItem(raw: RawLineItem, sortOrder: number, productCode: string): SFDCLineItem {
  return {
    line_item_id: raw.id,
    opportunity_id: raw.opportunity_id,
    product_id: raw.product_id,
    product_code: productCode,
    product_name: raw.product_name,
    product_family: '',
    quantity: raw.quantity ?? 1,
    unit_price: raw.unit_price ?? 0,
    total_price: raw.total_price ?? 0,
    sort_order: sortOrder,
    service_date: null,
    description: '',
  };
}

function normalizeStageHistory(raw: RawStageHistory): SFDCStageHistory {
  return {
    id: raw.id,
    opportunity_id: raw.opportunity_id,
    stage_name: raw.stage_name,
    previous_stage: null,
    created_date: raw.created_date,
    amount: raw.amount ?? 0,
    probability: 0,
    expected_revenue: 0,
    close_date: '',
    duration_days: 0,
    changed_by: raw.owner_id,
  };
}

function normalizeActivity(raw: RawActivity): SFDCActivity {
  const actType: 'Task' | 'Event' = raw.type === 'Task' || raw.type === 'Event' ? raw.type : 'Task';
  return {
    activity_id: raw.id,
    type: actType,
    subject: raw.subject || '',
    status: raw.status || '',
    priority: 'Normal',
    activity_date: raw.activity_date || '',
    owner_id: raw.owner_id,
    what_id: raw.opportunity_id,
    who_id: null,
    description: raw.subject || '', // use subject as description fallback
  };
}

function normalizeProduct(raw: RawProduct): SFDCProduct {
  return {
    product_id: raw.id,
    product_code: raw.product_code || '',
    name: raw.name,
    family: raw.family || '',
    is_active: raw.is_active ?? true,
    description: raw.name,
  };
}

// ============================================================================
// SFDCSyntheticAdapter
// ============================================================================

export class SFDCSyntheticAdapter extends BaseDataAdapter {
  readonly name = 'sfdc';

  private dataDir: string;
  private mapper: SFDCFieldMapper;

  // In-memory indexes
  private oppById: Map<string, SFDCOpportunity> = new Map();
  private oppByVbeln: Map<string, SFDCOpportunity> = new Map();
  private histByOpp: Map<string, SFDCStageHistory[]> = new Map();
  private itemsByOpp: Map<string, SFDCLineItem[]> = new Map();
  private actsByOpp: Map<string, SFDCActivity[]> = new Map();
  private accountById: Map<string, SFDCAccount> = new Map();
  private productById: Map<string, SFDCProduct> = new Map();

  constructor(dataDir?: string) {
    super();
    this.dataDir =
      dataDir || join(__dirname, '..', '..', '..', '..', 'synthetic-data', 'sfdc_output');
    this.mapper = new SFDCFieldMapper();
  }

  protected async doInitialize(): Promise<void> {
    await this.loadAllData();
  }

  protected async doShutdown(): Promise<void> {
    this.oppById.clear();
    this.oppByVbeln.clear();
    this.histByOpp.clear();
    this.itemsByOpp.clear();
    this.actsByOpp.clear();
    this.accountById.clear();
    this.productById.clear();
  }

  private async loadJson<T>(filename: string): Promise<T> {
    const content = await readFile(join(this.dataDir, filename), 'utf-8');
    return JSON.parse(content) as T;
  }

  private async loadAllData(): Promise<void> {
    const [rawOpps, rawAccounts, rawLineItems, rawHistories, rawActivities, rawProducts] =
      await Promise.all([
        this.loadJson<RawOpportunity[]>('opportunities.json'),
        this.loadJson<RawAccount[]>('accounts.json'),
        this.loadJson<RawLineItem[]>('line_items.json'),
        this.loadJson<RawStageHistory[]>('stage_histories.json'),
        this.loadJson<RawActivity[]>('activities.json'),
        this.loadJson<RawProduct[]>('products.json'),
      ]);

    // Build product lookup first (needed when normalizing line items)
    const productCodeById = new Map<string, string>();
    for (const raw of rawProducts) {
      const product = normalizeProduct(raw);
      this.productById.set(product.product_id, product);
      this.productById.set(padToLength(product.product_code, 18), product);
      productCodeById.set(product.product_id, product.product_code);
    }

    // Index opportunities
    for (const raw of rawOpps) {
      const opp = normalizeOpportunity(raw);
      this.oppById.set(opp.opportunity_id, opp);
      this.oppByVbeln.set(padToLength(opp.opportunity_id, 10), opp);
    }

    // Index accounts — both raw id and padded version
    for (const raw of rawAccounts) {
      const account = normalizeAccount(raw);
      this.accountById.set(account.account_id, account);
      this.accountById.set(padToLength(account.account_id, 10), account);
    }

    // Group stage histories by opportunity_id
    for (const raw of rawHistories) {
      const hist = normalizeStageHistory(raw);
      const list = this.histByOpp.get(hist.opportunity_id) ?? [];
      list.push(hist);
      this.histByOpp.set(hist.opportunity_id, list);
    }

    // Group line items by opportunity_id with sort_order derived from position
    const oppLineItemCount = new Map<string, number>();
    for (const raw of rawLineItems) {
      const count = oppLineItemCount.get(raw.opportunity_id) ?? 0;
      oppLineItemCount.set(raw.opportunity_id, count + 1);
      const productCode = productCodeById.get(raw.product_id) ?? raw.product_id;
      const item = normalizeLineItem(raw, count + 1, productCode);
      const list = this.itemsByOpp.get(item.opportunity_id) ?? [];
      list.push(item);
      this.itemsByOpp.set(item.opportunity_id, list);
    }

    // Group activities by opportunity_id (what_id in typed form)
    for (const raw of rawActivities) {
      const act = normalizeActivity(raw);
      const list = this.actsByOpp.get(act.what_id) ?? [];
      list.push(act);
      this.actsByOpp.set(act.what_id, list);
    }
  }

  // Resolve opportunity from either raw id or padded VBELN
  private resolveOpp(vbeln: string): SFDCOpportunity | undefined {
    return this.oppById.get(vbeln) ?? this.oppByVbeln.get(vbeln);
  }

  // =========================================================================
  // Tool 1: Search Document Text
  // =========================================================================
  async searchDocText(params: SearchDocTextParams): Promise<SearchResult[]> {
    this.ensureInitialized();

    let pattern: RegExp;
    try {
      pattern = new RegExp(params.pattern, 'gi');
    } catch {
      throw new Error(`Invalid regex pattern: ${params.pattern}`);
    }

    const limit = params.limit ?? 200;
    const results: SearchResult[] = [];
    const seenOpps = new Set<string>();

    for (const [oppId, activities] of this.actsByOpp) {
      if (results.length >= limit) break;
      if (seenOpps.has(oppId)) continue;

      for (const act of activities) {
        const text = [act.subject, act.description].filter(Boolean).join(' | ');
        const matches = text.match(pattern);
        if (!matches) continue;

        seenOpps.add(oppId);
        const opp = this.oppById.get(oppId);
        const vbeln = padToLength(oppId, 10);

        const matchIndex = text.toLowerCase().indexOf((matches[0] || '').toLowerCase());
        const start = Math.max(0, matchIndex - 50);
        const end = Math.min(text.length, matchIndex + (matches[0] || '').length + 50);
        const snippet =
          (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');

        results.push({
          doc_type: 'sales',
          doc_key: vbeln,
          snippet,
          match_score: matches.length / Math.max(1, text.split(/\s+/).length),
          dates: {
            created: opp?.created_date ?? formatDateToSAP(act.activity_date),
          },
          org_keys: {
            VKORG: 'SFDC',
            VTWEG: '00',
            SPART: '00',
          },
        });
        break; // one result per opp
      }
    }

    return results.slice(0, limit);
  }

  // =========================================================================
  // Tool 2: Get Document Text
  // =========================================================================
  async getDocText(params: DocTextParams): Promise<DocTextResult> {
    this.ensureInitialized();

    const opp = this.resolveOpp(params.doc_key);
    if (!opp) {
      return { header_texts: [], item_texts: [] };
    }

    const activities = this.actsByOpp.get(opp.opportunity_id) ?? [];
    return this.mapper.activitiesToDocText(opp.opportunity_id, activities);
  }

  // =========================================================================
  // Tool 3: Get Document Flow
  // =========================================================================
  async getDocFlow(params: DocFlowParams): Promise<DocFlowResult> {
    this.ensureInitialized();

    const opp = this.resolveOpp(params.vbeln);
    if (!opp) {
      return { root_document: params.vbeln, flow: [] };
    }

    const stages = this.histByOpp.get(opp.opportunity_id) ?? [];
    return this.mapper.stageHistoryToDocFlow(opp.opportunity_id, stages);
  }

  // =========================================================================
  // Tool 4: Get Sales Document Header
  // =========================================================================
  async getSalesDocHeader(params: SalesDocHeaderParams): Promise<SalesDocHeader | null> {
    this.ensureInitialized();

    const opp = this.resolveOpp(params.vbeln);
    if (!opp) return null;

    return this.mapper.opportunityToSalesDocHeader(opp);
  }

  // =========================================================================
  // Tool 5: Get Sales Document Items
  // =========================================================================
  async getSalesDocItems(params: SalesDocItemsParams): Promise<SalesDocItem[]> {
    this.ensureInitialized();

    const opp = this.resolveOpp(params.vbeln);
    if (!opp) return [];

    const items = this.itemsByOpp.get(opp.opportunity_id) ?? [];
    return items.map(item => this.mapper.lineItemToSalesDocItem(item, opp.currency_iso_code));
  }

  // =========================================================================
  // Tool 6: Get Delivery Timing
  // Derive from close_date for closed opportunities; null if not closed
  // =========================================================================
  async getDeliveryTiming(params: DeliveryTimingParams): Promise<DeliveryTimingResult | null> {
    this.ensureInitialized();

    const opp = this.resolveOpp(params.vbeln);
    if (!opp || !opp.is_closed) return null;

    const items = this.itemsByOpp.get(opp.opportunity_id) ?? [];
    const sapCloseDate = formatDateToSAP(opp.close_date);

    return {
      delivery_number: padToLength(opp.opportunity_id, 10),
      header_timing: {
        requested_date: sapCloseDate,
        planned_gi_date: sapCloseDate,
        ...(opp.is_won && { actual_gi_date: sapCloseDate }),
      },
      item_timing: items.map(item => ({
        item_number: padToLength(item.sort_order.toString(), 6),
        material: padToLength(item.product_code, 18),
        requested_date: sapCloseDate,
        confirmed_date: sapCloseDate,
        ...(opp.is_won && { actual_date: sapCloseDate }),
      })),
    };
  }

  // =========================================================================
  // Tool 7: Get Invoice Timing
  // Derive from close_date for won opportunities; null if not won
  // =========================================================================
  async getInvoiceTiming(params: InvoiceTimingParams): Promise<InvoiceTimingResult | null> {
    this.ensureInitialized();

    const opp = this.resolveOpp(params.vbeln);
    if (!opp || !opp.is_won) return null;

    const sapCloseDate = formatDateToSAP(opp.close_date);
    const sapCreatedDate = formatDateToSAP(opp.created_date);
    const createdTime = extractTime(opp.created_date);

    return {
      invoice_number: padToLength(opp.opportunity_id, 10),
      billing_date: sapCloseDate,
      posting_date: sapCloseDate,
      created_date: sapCreatedDate,
      created_time: createdTime,
      linked_deliveries: [],
      linked_orders: [padToLength(opp.opportunity_id, 10)],
    };
  }

  // =========================================================================
  // Tool 8: Get Master Stub
  // =========================================================================
  async getMasterStub(params: MasterStubParams): Promise<MasterStub | null> {
    this.ensureInitialized();

    switch (params.entity_type) {
      case 'customer': {
        const account =
          this.accountById.get(params.id) ?? this.accountById.get(padToLength(params.id, 10));
        if (!account) return null;
        return this.mapper.accountToMasterStub(account);
      }
      case 'material': {
        const product =
          this.productById.get(params.id) ?? this.productById.get(padToLength(params.id, 18));
        if (!product) return null;
        return this.mapper.productToMasterStub(product);
      }
      case 'vendor':
        // No vendor concept in SFDC
        return null;
    }
  }
}

// Register adapter
registerAdapter('sfdc', () => new SFDCSyntheticAdapter());

export default SFDCSyntheticAdapter;
