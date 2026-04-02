/**
 * Shadow Gap Detector
 *
 * Detects activities in the actual event log that have NO counterpart in
 * either the reference models or documented rules. These are "shadow
 * processes" — things people do that nobody documented or expected.
 *
 * Shadow processes are potentially unauthorized workarounds, manual
 * overrides, or undocumented procedures.
 */

import type { ReferenceStep, WorkflowRule, ActualEvent, GapFinding, GapSeverity } from './types.js';

/** Admin user-ID patterns (case-insensitive match) */
const ADMIN_USER_PATTERNS = [/^admin$/i, /^batch$/i, /^rfc/i, /^system$/i, /^sap/i];

/** Activity-name keywords that indicate admin-level operations */
const ADMIN_ACTIVITY_KEYWORDS = ['config', 'maintain', 'customize', 'transport', 'change_master'];

/** Business-hours boundaries (inclusive start, exclusive end) */
const BUSINESS_HOUR_START = 7; // 07:00
const BUSINESS_HOUR_END = 19; // 19:00 (7 PM)

let gapIdCounter = 0;

function nextGapId(): string {
  gapIdCounter += 1;
  return `shadow-${gapIdCounter}`;
}

/** Reset the ID counter — useful for deterministic tests */
export function _resetGapIdCounter(): void {
  gapIdCounter = 0;
}

export class ShadowGapDetector {
  /**
   * Find activities in actual events that don't appear in reference steps
   * OR documented rules.
   */
  detectGaps(
    referenceSteps: ReferenceStep[],
    documentedRules: WorkflowRule[],
    actualEvents: ActualEvent[]
  ): GapFinding[] {
    const knownActivities = this.buildKnownActivities(referenceSteps, documentedRules);

    // Filter to events whose normalized activity is not in the known set
    const unknownEvents = actualEvents.filter(
      e => !knownActivities.has(this.normalizeActivity(e.activityName))
    );

    if (unknownEvents.length === 0) return [];

    // Group unknown events by normalized activity name
    const grouped = new Map<string, ActualEvent[]>();
    for (const event of unknownEvents) {
      const key = this.normalizeActivity(event.activityName);
      const list = grouped.get(key);
      if (list) {
        list.push(event);
      } else {
        grouped.set(key, [event]);
      }
    }

    const findings: GapFinding[] = [];

    // High-privilege and after-hours detectors produce their own findings
    const highPriv = this.detectHighPrivilegeShadow(unknownEvents);
    const afterHrs = this.detectAfterHoursShadow(unknownEvents);

    // Track which events are already covered by specialised detectors
    const coveredKeys = new Set<string>();
    for (const f of [...highPriv, ...afterHrs]) {
      // The expectedRule field holds the normalized activity key
      if (f.expectedRule) coveredKeys.add(f.expectedRule);
    }

    findings.push(...highPriv, ...afterHrs);

    // For remaining groups not already covered, apply volume / default severity
    for (const [normalizedName, events] of grouped) {
      if (coveredKeys.has(normalizedName)) continue;

      const severity = this.defaultSeverity(events);
      const sample = events[0]!;

      findings.push({
        id: nextGapId(),
        gapType: 'shadow',
        severity,
        confidence: 0.7,
        title: `Shadow activity: ${sample.activityName}`,
        description:
          `Activity "${sample.activityName}" (${events.length} occurrence(s)) ` +
          `has no counterpart in reference models or documented rules.`,
        expectedSource: 'reference',
        expectedRule: normalizedName,
        expectedBehavior: 'Activity should map to a known reference step or documented rule',
        actualBehavior: `"${sample.activityName}" executed ${events.length} time(s)`,
        actualEvents: events.map(e => e.caseId),
        frequency: events.length,
        materiality: 0.3,
        recency: 0.5,
        detectedAt: new Date().toISOString(),
        systemScope: sample.systemType,
      });
    }

    return findings;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Build a set of all "known" activity names from reference + documented */
  private buildKnownActivities(steps: ReferenceStep[], rules: WorkflowRule[]): Set<string> {
    const known = new Set<string>();

    for (const step of steps) {
      known.add(this.normalizeActivity(step.activityName));
    }

    for (const rule of rules) {
      // Extract activity names from rule parameters if present
      const actName = rule.parameters['activityName'];
      if (typeof actName === 'string') {
        known.add(this.normalizeActivity(actName));
      }
      // Also index the rule text's first phrase as a potential activity
      // (defensive — real matching relies on the parameter)
    }

    return known;
  }

  /**
   * Normalize activity names for fuzzy matching.
   *
   * - lowercase
   * - replace spaces, hyphens, dots with underscores
   * - collapse multiple underscores
   * - trim leading/trailing underscores
   */
  normalizeActivity(name: string): string {
    return name
      .toLowerCase()
      .replace(/[\s\-.]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  /** Detect high-privilege shadow activities (admin actions, config changes) */
  private detectHighPrivilegeShadow(unknownEvents: ActualEvent[]): GapFinding[] {
    const findings: GapFinding[] = [];
    const grouped = new Map<string, ActualEvent[]>();

    for (const event of unknownEvents) {
      if (!this.isHighPrivilege(event)) continue;
      const key = this.normalizeActivity(event.activityName);
      const list = grouped.get(key);
      if (list) {
        list.push(event);
      } else {
        grouped.set(key, [event]);
      }
    }

    for (const [normalizedName, events] of grouped) {
      const sample = events[0]!;

      findings.push({
        id: nextGapId(),
        gapType: 'shadow',
        severity: 'HIGH',
        confidence: 0.85,
        title: `High-privilege shadow activity: ${sample.activityName}`,
        description:
          `Admin/power-user "${sample.userId}" performed undocumented activity ` +
          `"${sample.activityName}" (${events.length} occurrence(s)).`,
        expectedSource: 'reference',
        expectedRule: normalizedName,
        expectedBehavior: 'Activity should map to a known reference step or documented rule',
        actualBehavior: `"${sample.activityName}" executed by privileged user "${sample.userId}"`,
        actualEvents: events.map(e => e.caseId),
        frequency: events.length,
        materiality: 0.7,
        recency: 0.5,
        detectedAt: new Date().toISOString(),
        systemScope: sample.systemType,
      });
    }

    return findings;
  }

  /** Detect after-hours shadow activities */
  private detectAfterHoursShadow(unknownEvents: ActualEvent[]): GapFinding[] {
    const findings: GapFinding[] = [];
    const grouped = new Map<string, ActualEvent[]>();

    for (const event of unknownEvents) {
      // Skip events already covered by high-privilege detector
      if (this.isHighPrivilege(event)) continue;
      if (!this.isAfterHours(event.timestamp)) continue;

      const key = this.normalizeActivity(event.activityName);
      const list = grouped.get(key);
      if (list) {
        list.push(event);
      } else {
        grouped.set(key, [event]);
      }
    }

    for (const [normalizedName, events] of grouped) {
      const sample = events[0]!;

      findings.push({
        id: nextGapId(),
        gapType: 'shadow',
        severity: 'HIGH',
        confidence: 0.8,
        title: `After-hours shadow activity: ${sample.activityName}`,
        description:
          `Undocumented activity "${sample.activityName}" performed outside ` +
          `business hours (${events.length} occurrence(s)).`,
        expectedSource: 'reference',
        expectedRule: normalizedName,
        expectedBehavior: 'Activity should map to a known reference step or documented rule',
        actualBehavior:
          `"${sample.activityName}" executed outside business hours ` +
          `(before ${BUSINESS_HOUR_START}:00 or after ${BUSINESS_HOUR_END}:00)`,
        actualEvents: events.map(e => e.caseId),
        frequency: events.length,
        materiality: 0.5,
        recency: 0.5,
        detectedAt: new Date().toISOString(),
        systemScope: sample.systemType,
      });
    }

    return findings;
  }

  // -----------------------------------------------------------------------
  // Internal classification helpers
  // -----------------------------------------------------------------------

  private isHighPrivilege(event: ActualEvent): boolean {
    const uid = event.userId;
    if (ADMIN_USER_PATTERNS.some(p => p.test(uid))) return true;

    const normAct = this.normalizeActivity(event.activityName);
    if (ADMIN_ACTIVITY_KEYWORDS.some(kw => normAct.includes(kw))) return true;

    return false;
  }

  private isAfterHours(timestamp: string): boolean {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return false;
    const hour = d.getUTCHours();
    return hour < BUSINESS_HOUR_START || hour >= BUSINESS_HOUR_END;
  }

  private defaultSeverity(events: ActualEvent[]): GapSeverity {
    if (events.length > 10) return 'MEDIUM';
    if (events.length === 1) return 'INFO';
    return 'LOW';
  }
}
