/**
 * Feature Extraction Module
 *
 * Extracts ML features from process events for prediction models.
 */

import {
  ProcessCase,
  ProcessEvent,
  CaseFeatures,
  O2C_MILESTONES,
  P2P_MILESTONES,
} from './types.js';

/**
 * Normalizes activity names for consistent matching
 */
function normalizeActivity(activity: string): string {
  return activity
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Parses timestamp to Date object
 */
function parseTimestamp(timestamp: string): Date {
  return new Date(timestamp);
}

/**
 * Calculates hours between two timestamps
 */
function hoursBetween(start: string, end: string): number {
  const startDate = parseTimestamp(start);
  const endDate = parseTimestamp(end);
  return (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
}

/**
 * Detects if an activity matches a milestone
 */
function matchesMilestone(activity: string, milestone: string): boolean {
  const normalized = normalizeActivity(activity);
  const milestoneNorm = normalizeActivity(milestone);

  // Exact match
  if (normalized === milestoneNorm) return true;

  // Contains match
  if (normalized.includes(milestoneNorm) || milestoneNorm.includes(normalized)) {
    return true;
  }

  // Common variations
  const variations: Record<string, string[]> = {
    order_created: ['create_sales_order', 'sales_order_created', 'so_created'],
    delivery_created: ['create_delivery', 'outbound_delivery'],
    goods_issued: ['goods_issue', 'post_goods_issue', 'pgi'],
    invoice_created: ['create_invoice', 'billing_document'],
    credit_check: ['credit_check', 'check_credit'],
    credit_hold: ['credit_block', 'blocked_credit'],
    purchase_order: ['create_purchase_order', 'po_created', 'create_po'],
    goods_receipt: ['record_goods_receipt', 'gr_posted', 'post_gr'],
    service_entry: ['record_service_entry', 'ses_created'],
    invoice_receipt: ['record_invoice_receipt', 'ir_posted'],
  };

  const milestoneVariations = variations[milestoneNorm] || [];
  return milestoneVariations.some(v => normalized.includes(v) || v.includes(normalized));
}

/**
 * Detects rework (same activity repeated)
 */
function detectRework(events: ProcessEvent[]): boolean {
  const activities = events.map(e => normalizeActivity(e.activity));
  const seen = new Set<string>();

  for (const activity of activities) {
    if (seen.has(activity)) return true;
    seen.add(activity);
  }

  return false;
}

/**
 * Counts loops in event sequence
 */
function countLoops(events: ProcessEvent[]): number {
  const activities = events.map(e => normalizeActivity(e.activity));
  const activityCounts = new Map<string, number>();

  for (const activity of activities) {
    activityCounts.set(activity, (activityCounts.get(activity) || 0) + 1);
  }

  let loopCount = 0;
  for (const count of activityCounts.values()) {
    if (count > 1) loopCount += count - 1;
  }

  return loopCount;
}

/**
 * Counts backtracks (going to earlier milestone)
 */
function countBacktracks(events: ProcessEvent[], milestones: readonly string[]): number {
  let backtracks = 0;
  let highestMilestone = -1;

  for (const event of events) {
    const normalized = normalizeActivity(event.activity);
    const milestoneIndex = milestones.findIndex(m => matchesMilestone(normalized, m));

    if (milestoneIndex >= 0) {
      if (milestoneIndex < highestMilestone) {
        backtracks++;
      } else {
        highestMilestone = milestoneIndex;
      }
    }
  }

  return backtracks;
}

/**
 * Calculates progress score based on milestones reached
 */
function calculateProgress(events: ProcessEvent[], milestones: readonly string[]): number {
  const reachedMilestones = new Set<number>();

  for (const event of events) {
    const normalized = normalizeActivity(event.activity);
    for (let i = 0; i < milestones.length; i++) {
      const milestone = milestones[i];
      if (milestone && matchesMilestone(normalized, milestone)) {
        reachedMilestones.add(i);
      }
    }
  }

  if (reachedMilestones.size === 0) return 0;

  const maxReached = Math.max(...reachedMilestones);
  return (maxReached + 1) / milestones.length;
}

/**
 * Calculates complexity score based on case characteristics
 */
function calculateComplexity(features: Partial<CaseFeatures>): number {
  let complexity = 0;

  // More events = more complex
  if (features.eventCount) {
    complexity += Math.min(features.eventCount / 20, 0.3);
  }

  // More unique activities = more complex
  if (features.uniqueActivities) {
    complexity += Math.min(features.uniqueActivities / 15, 0.2);
  }

  // Rework adds complexity
  if (features.hasRework) complexity += 0.15;

  // Loops add complexity
  if (features.loopCount) {
    complexity += Math.min(features.loopCount * 0.05, 0.15);
  }

  // Backtracks add complexity
  if (features.backtrackCount) {
    complexity += Math.min(features.backtrackCount * 0.1, 0.2);
  }

  return Math.min(complexity, 1);
}

/**
 * Identifies risk indicators from case features
 */
function identifyRiskIndicators(events: ProcessEvent[], features: Partial<CaseFeatures>): string[] {
  const risks: string[] = [];

  // Long case age
  if (features.caseAge && features.caseAge > 168) {
    // > 7 days
    risks.push('case_age_high');
  }

  // Long time since last event
  if (features.timeSinceLastEvent && features.timeSinceLastEvent > 48) {
    risks.push('stalled_case');
  }

  // Credit hold detected
  if (features.hasCreditHold) {
    risks.push('credit_hold');
  }

  // Rework detected
  if (features.hasRework) {
    risks.push('rework_detected');
  }

  // Multiple loops
  if (features.loopCount && features.loopCount > 2) {
    risks.push('excessive_loops');
  }

  // Backtracks
  if (features.backtrackCount && features.backtrackCount > 0) {
    risks.push('process_backtrack');
  }

  // Low progress with high age
  if (
    features.progressScore &&
    features.caseAge &&
    features.progressScore < 0.3 &&
    features.caseAge > 72
  ) {
    risks.push('slow_progress');
  }

  // High resource changes
  if (features.resourceChanges && features.resourceChanges > 5) {
    risks.push('high_handoffs');
  }

  // Weekend processing
  if (features.isWeekend) {
    risks.push('weekend_processing');
  }

  // Check for specific risky activities in events
  for (const event of events) {
    const activity = normalizeActivity(event.activity);
    if (activity.includes('reject') || activity.includes('cancel') || activity.includes('error')) {
      if (!risks.includes('rejection_detected')) {
        risks.push('rejection_detected');
      }
    }
    if (activity.includes('block') || activity.includes('hold')) {
      if (!risks.includes('block_detected')) {
        risks.push('block_detected');
      }
    }
  }

  return risks;
}

/**
 * Detects process type from events
 */
function detectProcessType(events: ProcessEvent[]): 'O2C' | 'P2P' | 'unknown' {
  const activities = events.map(e => normalizeActivity(e.activity));
  const combined = activities.join(' ');

  // P2P indicators
  const p2pIndicators = [
    'purchase',
    'requisition',
    'goods_receipt',
    'service_entry',
    'vendor',
    'srm',
  ];
  const p2pScore = p2pIndicators.filter(i => combined.includes(i)).length;

  // O2C indicators
  const o2cIndicators = ['sales', 'order_created', 'delivery', 'billing', 'customer', 'shipping'];
  const o2cScore = o2cIndicators.filter(i => combined.includes(i)).length;

  if (p2pScore > o2cScore) return 'P2P';
  if (o2cScore > p2pScore) return 'O2C';
  return 'unknown';
}

/**
 * Extracts features from a single case
 */
export function extractFeatures(processCase: ProcessCase): CaseFeatures {
  const { caseId, events } = processCase;

  if (events.length === 0) {
    return createEmptyFeatures(caseId);
  }

  // Sort events by timestamp
  const sortedEvents = [...events].sort(
    (a, b) => parseTimestamp(a.timestamp).getTime() - parseTimestamp(b.timestamp).getTime()
  );

  const firstEvent = sortedEvents[0];
  const lastEvent = sortedEvents[sortedEvents.length - 1];
  if (!firstEvent || !lastEvent) {
    return createEmptyFeatures(caseId);
  }
  const now = new Date();

  // Temporal features
  const caseAge =
    (now.getTime() - parseTimestamp(firstEvent.timestamp).getTime()) / (1000 * 60 * 60);
  const timeSinceLastEvent =
    (now.getTime() - parseTimestamp(lastEvent.timestamp).getTime()) / (1000 * 60 * 60);

  // Calculate average time between events
  let totalTimeBetween = 0;
  for (let i = 1; i < sortedEvents.length; i++) {
    totalTimeBetween += hoursBetween(sortedEvents[i - 1]!.timestamp, sortedEvents[i]!.timestamp);
  }
  const avgTimeBetweenEvents =
    sortedEvents.length > 1 ? totalTimeBetween / (sortedEvents.length - 1) : 0;

  // Activity features
  const activities = sortedEvents.map(e => normalizeActivity(e.activity));
  const uniqueActivities = new Set(activities).size;

  // Check for specific activities
  const hasDeliveryCreated = activities.some(
    a => a.includes('delivery') || a.includes('outbound') || a.includes('shipping')
  );
  const hasGoodsIssued = activities.some(
    a => a.includes('goods_issue') || a.includes('pgi') || a.includes('post_goods')
  );
  const hasInvoiceCreated = activities.some(
    a => a.includes('invoice') || a.includes('billing') || a.includes('bill')
  );
  const hasCreditCheck = activities.some(a => a.includes('credit_check'));
  const hasCreditHold = activities.some(
    a => a.includes('credit') && (a.includes('hold') || a.includes('block'))
  );

  // P2P specific
  const hasPurchaseOrder = activities.some(
    a => a.includes('purchase_order') || a.includes('create_po')
  );
  const hasGoodsReceipt = activities.some(
    a => a.includes('goods_receipt') || a.includes('record_goods')
  );
  const hasServiceEntry = activities.some(a => a.includes('service_entry') || a.includes('ses'));

  // Resource features
  const resources = sortedEvents.map(e => e.resource).filter((r): r is string => r !== undefined);
  const uniqueResources = new Set(resources).size;
  let resourceChanges = 0;
  for (let i = 1; i < resources.length; i++) {
    if (resources[i] !== resources[i - 1]) resourceChanges++;
  }

  // Sequence features
  const currentActivity = activities[activities.length - 1] || '';
  const previousActivity = activities.length > 1 ? activities[activities.length - 2]! : null;

  // Pattern features
  const hasRework = detectRework(sortedEvents);
  const loopCount = countLoops(sortedEvents);

  // Detect process type and calculate backtracks
  const processType = detectProcessType(sortedEvents);
  const milestones = processType === 'P2P' ? P2P_MILESTONES : O2C_MILESTONES;
  const backtrackCount = countBacktracks(sortedEvents, milestones);

  // Time features
  const startDate = parseTimestamp(firstEvent.timestamp);
  const weekdayStart = startDate.getDay();
  const hourStart = startDate.getHours();
  const isWeekend = weekdayStart === 0 || weekdayStart === 6;

  // Progress score
  const progressScore = calculateProgress(sortedEvents, milestones);

  // Build partial features for complexity calculation
  const partialFeatures: Partial<CaseFeatures> = {
    eventCount: sortedEvents.length,
    uniqueActivities,
    hasRework,
    loopCount,
    backtrackCount,
    caseAge,
    timeSinceLastEvent,
    progressScore,
    resourceChanges,
    hasCreditHold,
    isWeekend,
  };

  const complexityScore = calculateComplexity(partialFeatures);
  const riskIndicators = identifyRiskIndicators(sortedEvents, partialFeatures);

  return {
    caseId,
    caseAge,
    eventCount: sortedEvents.length,
    avgTimeBetweenEvents,
    timeSinceLastEvent,
    uniqueActivities,
    hasDeliveryCreated,
    hasGoodsIssued,
    hasInvoiceCreated,
    hasCreditCheck,
    hasCreditHold,
    currentActivity,
    previousActivity,
    activitySequenceLength: activities.length,
    uniqueResources,
    resourceChanges,
    hasRework,
    loopCount,
    backtrackCount,
    weekdayStart,
    hourStart,
    isWeekend,
    hasPurchaseOrder,
    hasGoodsReceipt,
    hasServiceEntry,
    progressScore,
    complexityScore,
    riskIndicators,
  };
}

/**
 * Creates empty features for a case with no events
 */
function createEmptyFeatures(caseId: string): CaseFeatures {
  return {
    caseId,
    caseAge: 0,
    eventCount: 0,
    avgTimeBetweenEvents: 0,
    timeSinceLastEvent: 0,
    uniqueActivities: 0,
    hasDeliveryCreated: false,
    hasGoodsIssued: false,
    hasInvoiceCreated: false,
    hasCreditCheck: false,
    hasCreditHold: false,
    currentActivity: '',
    previousActivity: null,
    activitySequenceLength: 0,
    uniqueResources: 0,
    resourceChanges: 0,
    hasRework: false,
    loopCount: 0,
    backtrackCount: 0,
    weekdayStart: 0,
    hourStart: 0,
    isWeekend: false,
    hasPurchaseOrder: false,
    hasGoodsReceipt: false,
    hasServiceEntry: false,
    progressScore: 0,
    complexityScore: 0,
    riskIndicators: [],
  };
}

/**
 * Extracts features from multiple cases
 */
export function extractBatchFeatures(cases: ProcessCase[]): CaseFeatures[] {
  return cases.map(extractFeatures);
}

/**
 * Gets feature names for model training
 */
export function getFeatureNames(): string[] {
  return [
    'caseAge',
    'eventCount',
    'avgTimeBetweenEvents',
    'timeSinceLastEvent',
    'uniqueActivities',
    'hasDeliveryCreated',
    'hasGoodsIssued',
    'hasInvoiceCreated',
    'hasCreditCheck',
    'hasCreditHold',
    'activitySequenceLength',
    'uniqueResources',
    'resourceChanges',
    'hasRework',
    'loopCount',
    'backtrackCount',
    'weekdayStart',
    'hourStart',
    'isWeekend',
    'hasPurchaseOrder',
    'hasGoodsReceipt',
    'hasServiceEntry',
    'progressScore',
    'complexityScore',
    'riskIndicatorCount',
  ];
}

/**
 * Converts features to numeric array for ML models
 */
export function featuresToArray(features: CaseFeatures): number[] {
  return [
    features.caseAge,
    features.eventCount,
    features.avgTimeBetweenEvents,
    features.timeSinceLastEvent,
    features.uniqueActivities,
    features.hasDeliveryCreated ? 1 : 0,
    features.hasGoodsIssued ? 1 : 0,
    features.hasInvoiceCreated ? 1 : 0,
    features.hasCreditCheck ? 1 : 0,
    features.hasCreditHold ? 1 : 0,
    features.activitySequenceLength,
    features.uniqueResources,
    features.resourceChanges,
    features.hasRework ? 1 : 0,
    features.loopCount,
    features.backtrackCount,
    features.weekdayStart,
    features.hourStart,
    features.isWeekend ? 1 : 0,
    features.hasPurchaseOrder ? 1 : 0,
    features.hasGoodsReceipt ? 1 : 0,
    features.hasServiceEntry ? 1 : 0,
    features.progressScore,
    features.complexityScore,
    features.riskIndicators.length,
  ];
}
