/**
 * FI/CO Forensic Assessment Report Generator
 *
 * Produces a structured markdown report combining findings from all
 * forensic analysis tools: journal entries, SoD, GL balances, and
 * document review.
 *
 * Output is client-ready for SAP pre-migration assessments.
 */

import {
  ForensicAssessment,
  ForensicSeverity,
  ForensicConfig,
  DEFAULT_FORENSIC_CONFIG,
  JournalEntryAnomaly,
  SoDConflict,
  GLBalanceResult,
  FICoDataset,
} from '../types/fi-co.js';

// ============================================================================
// Report Generation
// ============================================================================

/**
 * Generate a complete forensic assessment from analysis results
 */
export function buildAssessment(
  dataset: FICoDataset,
  anomalies: JournalEntryAnomaly[],
  sodConflicts: SoDConflict[],
  glResult: GLBalanceResult,
  config: ForensicConfig = DEFAULT_FORENSIC_CONFIG
): ForensicAssessment {
  // Count findings by severity
  const allSeverities = [...anomalies.map(a => a.severity), ...sodConflicts.map(c => c.severity)];

  const severityCounts = {
    critical: allSeverities.filter(s => s === 'critical').length,
    high: allSeverities.filter(s => s === 'high').length,
    medium: allSeverities.filter(s => s === 'medium').length,
    low: allSeverities.filter(s => s === 'low').length,
  };

  // Determine overall risk
  let overallRisk: ForensicSeverity = 'low';
  if (severityCounts.critical > 0) overallRisk = 'critical';
  else if (severityCounts.high > 3) overallRisk = 'high';
  else if (severityCounts.high > 0 || severityCounts.medium > 5) overallRisk = 'medium';

  // Build key concerns
  const keyConcerns: string[] = [];
  if (sodConflicts.length > 0) {
    keyConcerns.push(`${sodConflicts.length} segregation of duties conflict(s) detected`);
  }
  const weekendCount = anomalies.filter(a => a.anomaly_type === 'weekend_posting').length;
  if (weekendCount > 0) {
    keyConcerns.push(`${weekendCount} journal entries posted on weekends/holidays`);
  }
  const backdatedCount = anomalies.filter(a => a.anomaly_type === 'backdated_entry').length;
  if (backdatedCount > 0) {
    keyConcerns.push(`${backdatedCount} backdated journal entries identified`);
  }
  const roundCount = anomalies.filter(a => a.anomaly_type === 'round_amount').length;
  if (roundCount > 0) {
    keyConcerns.push(`${roundCount} round-amount entries flagged for review`);
  }
  if (glResult.suspense_flags.length > 0) {
    keyConcerns.push(
      `${glResult.suspense_flags.length} suspense account(s) with unexpected balances`
    );
  }
  if (glResult.intercompany_mismatches.length > 0) {
    keyConcerns.push(
      `${glResult.intercompany_mismatches.length} intercompany balance mismatch(es)`
    );
  }

  // Build recommendations
  const recommendations = buildRecommendations(anomalies, sodConflicts, glResult);

  // Determine company and year from data
  const companyCode = dataset.bkpf[0]?.BUKRS || 'N/A';
  const fiscalYear = dataset.bkpf[0]?.GJAHR || 'N/A';
  const periods = dataset.bkpf.map(d => d.MONAT).filter(Boolean);
  const periodRange =
    periods.length > 0
      ? `${Math.min(...periods.map(Number))} - ${Math.max(...periods.map(Number))}`
      : 'N/A';

  return {
    metadata: {
      generated_at: new Date().toISOString(),
      company_code: companyCode,
      fiscal_year: fiscalYear,
      period_range: periodRange,
      total_documents_analyzed: dataset.bkpf.length,
      total_line_items_analyzed: dataset.bseg.length,
      config_used: config,
    },
    executive_summary: {
      overall_risk_rating: overallRisk,
      total_anomalies: anomalies.length + sodConflicts.length,
      critical_findings: severityCounts.critical,
      high_findings: severityCounts.high,
      medium_findings: severityCounts.medium,
      low_findings: severityCounts.low,
      key_concerns: keyConcerns,
    },
    journal_entry_anomalies: anomalies,
    sod_conflicts: sodConflicts,
    gl_analysis: glResult,
    recommendations,
  };
}

/**
 * Build recommendations based on findings
 */
function buildRecommendations(
  anomalies: JournalEntryAnomaly[],
  sodConflicts: SoDConflict[],
  glResult: GLBalanceResult
): ForensicAssessment['recommendations'] {
  const recs: ForensicAssessment['recommendations'] = [];

  // SoD recommendations
  if (sodConflicts.length > 0) {
    const postAndApprove = sodConflicts.filter(c => c.conflict_type === 'post_and_approve');
    if (postAndApprove.length > 0) {
      recs.push({
        priority: 'critical',
        category: 'Segregation of Duties',
        recommendation:
          'Implement dual-control for journal entry posting. No user should be able to both create and approve journal entries without a secondary review.',
        affected_items: postAndApprove.length,
      });
    }

    const parkAndPost = sodConflicts.filter(c => c.conflict_type === 'park_and_post');
    if (parkAndPost.length > 0) {
      recs.push({
        priority: 'high',
        category: 'Segregation of Duties',
        recommendation:
          'Enforce separation between document parking and posting. Configure SAP workflow to require different users for FBV1 (park) and FBV2 (post).',
        affected_items: parkAndPost.length,
      });
    }

    const vendorPay = sodConflicts.filter(
      c => c.conflict_type === 'vendor_master_and_payment' || c.conflict_type === 'create_and_pay'
    );
    if (vendorPay.length > 0) {
      recs.push({
        priority: 'critical',
        category: 'Segregation of Duties',
        recommendation:
          'Separate vendor master data maintenance from payment processing. Users with access to XK01/XK02 should not run F110 payment programs.',
        affected_items: vendorPay.length,
      });
    }
  }

  // Weekend posting recommendations
  const weekendPostings = anomalies.filter(
    a => a.anomaly_type === 'weekend_posting' || a.anomaly_type === 'holiday_posting'
  );
  if (weekendPostings.length > 0) {
    recs.push({
      priority: weekendPostings.length > 10 ? 'high' : 'medium',
      category: 'Posting Controls',
      recommendation:
        'Review weekend and holiday postings for authorization. Consider implementing posting period restrictions (OB52) to prevent out-of-hours entries unless explicitly approved.',
      affected_items: weekendPostings.length,
    });
  }

  // Backdated entries
  const backdated = anomalies.filter(a => a.anomaly_type === 'backdated_entry');
  if (backdated.length > 0) {
    recs.push({
      priority: backdated.some(a => a.severity === 'critical') ? 'critical' : 'high',
      category: 'Posting Controls',
      recommendation:
        'Investigate backdated journal entries where posting date significantly precedes creation date. Tighten posting period controls and require manager approval for backdated entries.',
      affected_items: backdated.length,
    });
  }

  // Round amounts
  const roundAmounts = anomalies.filter(a => a.anomaly_type === 'round_amount');
  if (roundAmounts.length > 0) {
    recs.push({
      priority: 'medium',
      category: 'Journal Entry Review',
      recommendation:
        'Review round-amount journal entries for legitimacy. While some round amounts are normal (provisions, accruals), a high concentration may indicate estimation or fabrication.',
      affected_items: roundAmounts.length,
    });
  }

  // Split-below-threshold
  const splits = anomalies.filter(a => a.anomaly_type === 'split_below_threshold');
  if (splits.length > 0) {
    recs.push({
      priority: 'high',
      category: 'Authorization Controls',
      recommendation:
        'Investigate potential split transactions designed to circumvent approval thresholds. Consider implementing cumulative daily limits per user in addition to per-document thresholds.',
      affected_items: splits.length,
    });
  }

  // Suspense accounts
  if (glResult.suspense_flags.length > 0) {
    recs.push({
      priority: 'high',
      category: 'GL Accounts',
      recommendation:
        'Clear suspense accounts with unexpected balances. Implement monthly reconciliation procedures and set automated alerts for suspense account activity.',
      affected_items: glResult.suspense_flags.length,
    });
  }

  // Intercompany
  if (glResult.intercompany_mismatches.length > 0) {
    recs.push({
      priority: 'high',
      category: 'Intercompany',
      recommendation:
        'Resolve intercompany balance discrepancies before migration. Implement automated intercompany reconciliation processes in the target system.',
      affected_items: glResult.intercompany_mismatches.length,
    });
  }

  // Sort by priority
  const priorityOrder: Record<ForensicSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  recs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return recs;
}

// ============================================================================
// Markdown Report Rendering
// ============================================================================

/**
 * Render a ForensicAssessment as a client-ready markdown report
 */
export function renderAssessmentReport(assessment: ForensicAssessment): string {
  const lines: string[] = [];

  // Title
  lines.push('# SAP FI/CO Forensic Assessment Report');
  lines.push('');
  lines.push(`**Company Code:** ${assessment.metadata.company_code}`);
  lines.push(`**Fiscal Year:** ${assessment.metadata.fiscal_year}`);
  lines.push(`**Period Range:** ${assessment.metadata.period_range}`);
  lines.push(
    `**Generated:** ${new Date(assessment.metadata.generated_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })}`
  );
  lines.push('');
  lines.push('---');
  lines.push('');

  // Executive Summary
  lines.push('## Executive Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(
    `| **Overall Risk Rating** | ${renderSeverityBadge(assessment.executive_summary.overall_risk_rating)} |`
  );
  lines.push(
    `| Documents Analyzed | ${assessment.metadata.total_documents_analyzed.toLocaleString()} |`
  );
  lines.push(
    `| Line Items Analyzed | ${assessment.metadata.total_line_items_analyzed.toLocaleString()} |`
  );
  lines.push(`| Total Findings | ${assessment.executive_summary.total_anomalies} |`);
  lines.push(`| Critical | ${assessment.executive_summary.critical_findings} |`);
  lines.push(`| High | ${assessment.executive_summary.high_findings} |`);
  lines.push(`| Medium | ${assessment.executive_summary.medium_findings} |`);
  lines.push(`| Low | ${assessment.executive_summary.low_findings} |`);
  lines.push('');

  if (assessment.executive_summary.key_concerns.length > 0) {
    lines.push('### Key Concerns');
    lines.push('');
    for (const concern of assessment.executive_summary.key_concerns) {
      lines.push(`- ${concern}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // Section 1: Journal Entry Anomalies
  lines.push('## 1. Journal Entry Analysis');
  lines.push('');

  if (assessment.journal_entry_anomalies.length === 0) {
    lines.push('No journal entry anomalies detected.');
    lines.push('');
  } else {
    // Group by type
    const byType = groupBy(assessment.journal_entry_anomalies, a => a.anomaly_type);
    lines.push(
      `**${assessment.journal_entry_anomalies.length} anomalies detected** across ${Object.keys(byType).length} categories.`
    );
    lines.push('');

    // Summary table
    lines.push('| Category | Count | Highest Severity |');
    lines.push('|----------|------:|------------------|');
    for (const [type, items] of Object.entries(byType)) {
      const maxSev = getMaxSeverity(items.map(i => i.severity));
      lines.push(
        `| ${formatAnomalyType(type)} | ${items.length} | ${renderSeverityBadge(maxSev)} |`
      );
    }
    lines.push('');

    // Top 10 by risk score
    const topAnomalies = [...assessment.journal_entry_anomalies]
      .sort((a, b) => b.risk_score - a.risk_score)
      .slice(0, 10);

    lines.push('### Top Findings by Risk Score');
    lines.push('');
    lines.push('| # | Document | Type | User | Amount | Score | Severity |');
    lines.push('|---|----------|------|------|-------:|------:|----------|');
    topAnomalies.forEach((a, i) => {
      lines.push(
        `| ${i + 1} | ${a.document_key} | ${formatAnomalyType(a.anomaly_type)} | ${a.user} | ${formatAmount(a.amount, a.currency)} | ${a.risk_score} | ${renderSeverityBadge(a.severity)} |`
      );
    });
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // Section 2: Segregation of Duties
  lines.push('## 2. Segregation of Duties Analysis');
  lines.push('');

  if (assessment.sod_conflicts.length === 0) {
    lines.push('No segregation of duties conflicts detected.');
    lines.push('');
  } else {
    lines.push(`**${assessment.sod_conflicts.length} SoD conflict(s) identified.**`);
    lines.push('');

    for (const conflict of assessment.sod_conflicts) {
      lines.push(
        `### ${renderSeverityBadge(conflict.severity)} ${formatSoDType(conflict.conflict_type)}`
      );
      lines.push('');
      lines.push(`- **User:** ${conflict.user}`);
      lines.push(`- **Description:** ${conflict.description}`);
      lines.push(`- **Occurrences:** ${conflict.occurrence_count}`);
      lines.push(
        `- **Action 1:** ${conflict.action_1.description}${conflict.action_1.tcode ? ` (${conflict.action_1.tcode})` : ''}`
      );
      lines.push(
        `- **Action 2:** ${conflict.action_2.description}${conflict.action_2.tcode ? ` (${conflict.action_2.tcode})` : ''}`
      );
      if (conflict.sample_documents.length > 0) {
        lines.push(`- **Sample Documents:** ${conflict.sample_documents.slice(0, 5).join(', ')}`);
      }
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');

  // Section 3: GL Balance Analysis
  lines.push('## 3. General Ledger Analysis');
  lines.push('');
  lines.push(
    `**${assessment.gl_analysis.total_accounts} accounts analyzed** for company code ${assessment.gl_analysis.company_code}, fiscal year ${assessment.gl_analysis.fiscal_year}.`
  );
  lines.push('');

  // Trial balance summary
  if (assessment.gl_analysis.trial_balance.length > 0) {
    const totalDebit = assessment.gl_analysis.trial_balance.reduce(
      (sum, e) => sum + e.total_debit,
      0
    );
    const totalCredit = assessment.gl_analysis.trial_balance.reduce(
      (sum, e) => sum + e.total_credit,
      0
    );
    const netBalance = Math.abs(totalDebit - totalCredit);

    lines.push('### Trial Balance Summary');
    lines.push('');
    lines.push(`| | Amount |`);
    lines.push(`|--|------:|`);
    lines.push(`| Total Debits | ${formatAmount(totalDebit)} |`);
    lines.push(`| Total Credits | ${formatAmount(totalCredit)} |`);
    lines.push(`| Net Difference | ${formatAmount(netBalance)} |`);
    lines.push(`| Balance Status | ${netBalance < 0.01 ? 'Balanced' : '**UNBALANCED**'} |`);
    lines.push('');
  }

  // Variance flags
  if (assessment.gl_analysis.variances.length > 0) {
    lines.push('### Significant Balance Variances');
    lines.push('');
    lines.push('| Account | Description | Period | Variance | % Change | Severity |');
    lines.push('|---------|-------------|--------|--------:|--------:|----------|');
    for (const v of assessment.gl_analysis.variances.slice(0, 15)) {
      lines.push(
        `| ${v.account} | ${v.account_description || ''} | ${v.period} | ${formatAmount(v.variance_amount)} | ${v.variance_percent.toFixed(1)}% | ${renderSeverityBadge(v.severity)} |`
      );
    }
    if (assessment.gl_analysis.variances.length > 15) {
      lines.push(`| *...and ${assessment.gl_analysis.variances.length - 15} more* | | | | | |`);
    }
    lines.push('');
  }

  // Suspense accounts
  if (assessment.gl_analysis.suspense_flags.length > 0) {
    lines.push('### Suspense Account Alerts');
    lines.push('');
    for (const flag of assessment.gl_analysis.suspense_flags) {
      lines.push(
        `- **${flag.account}** (${flag.account_description || 'N/A'}): Balance ${formatAmount(flag.balance, flag.currency)} — ${flag.reason}`
      );
    }
    lines.push('');
  }

  // Intercompany mismatches
  if (assessment.gl_analysis.intercompany_mismatches.length > 0) {
    lines.push('### Intercompany Balance Mismatches');
    lines.push('');
    lines.push('| Company 1 | Company 2 | Account | Balance 1 | Balance 2 | Difference |');
    lines.push('|-----------|-----------|---------|--------:|--------:|----------:|');
    for (const m of assessment.gl_analysis.intercompany_mismatches) {
      lines.push(
        `| ${m.company_1} | ${m.company_2} | ${m.account} | ${formatAmount(m.balance_1)} | ${formatAmount(m.balance_2)} | ${formatAmount(m.difference)} |`
      );
    }
    lines.push('');
  }

  // Aging
  if (assessment.gl_analysis.aging_summary) {
    const aging = assessment.gl_analysis.aging_summary;
    lines.push('### Open Items Aging');
    lines.push('');
    lines.push('| Bucket | Amount |');
    lines.push('|--------|------:|');
    lines.push(`| Current | ${formatAmount(aging.current)} |`);
    lines.push(`| 1-30 Days | ${formatAmount(aging.days_30)} |`);
    lines.push(`| 31-60 Days | ${formatAmount(aging.days_60)} |`);
    lines.push(`| 61-90 Days | ${formatAmount(aging.days_90)} |`);
    lines.push(`| Over 90 Days | ${formatAmount(aging.over_90)} |`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // Section 4: Recommendations
  lines.push('## 4. Recommendations');
  lines.push('');

  if (assessment.recommendations.length === 0) {
    lines.push('No specific recommendations at this time.');
  } else {
    for (const [i, rec] of assessment.recommendations.entries()) {
      lines.push(`### ${i + 1}. ${renderSeverityBadge(rec.priority)} ${rec.category}`);
      lines.push('');
      lines.push(rec.recommendation);
      lines.push('');
      lines.push(`*Affected items: ${rec.affected_items}*`);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push('*This report was generated by the SAP FI/CO Forensic Analysis Toolkit.*');
  lines.push(
    `*Analysis configuration: Round amount threshold=${assessment.metadata.config_used.round_amount_threshold}, ` +
      `Backdate threshold=${assessment.metadata.config_used.backdate_days_threshold} days, ` +
      `Approval threshold=${formatAmount(assessment.metadata.config_used.approval_threshold, assessment.metadata.config_used.approval_threshold_currency)}*`
  );
  lines.push('');

  return lines.join('\n');
}

// ============================================================================
// Formatting Helpers
// ============================================================================

function renderSeverityBadge(severity: ForensicSeverity): string {
  switch (severity) {
    case 'critical':
      return '**[CRITICAL]**';
    case 'high':
      return '**[HIGH]**';
    case 'medium':
      return '[MEDIUM]';
    case 'low':
      return '[LOW]';
  }
}

function formatAmount(amount: number, currency?: string): string {
  const formatted = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = amount < 0 ? '-' : '';
  return currency ? `${sign}${formatted} ${currency}` : `${sign}${formatted}`;
}

function formatAnomalyType(type: string): string {
  const labels: Record<string, string> = {
    weekend_posting: 'Weekend Posting',
    holiday_posting: 'Holiday Posting',
    round_amount: 'Round Amount',
    backdated_entry: 'Backdated Entry',
    period_end_spike: 'Period-End Spike',
    manual_entry: 'Manual Entry',
    unusual_posting_key: 'Unusual Posting Key',
    split_below_threshold: 'Split Below Threshold',
    large_amount: 'Large Amount',
    unusual_time: 'Unusual Time',
    reversal_pattern: 'Reversal Pattern',
  };
  return labels[type] || type;
}

function formatSoDType(type: string): string {
  const labels: Record<string, string> = {
    post_and_approve: 'Post & Approve Conflict',
    create_and_pay: 'Create & Pay Conflict',
    park_and_post: 'Park & Post Conflict',
    vendor_master_and_payment: 'Vendor Master & Payment Conflict',
    create_and_modify: 'Create & Modify Conflict',
    post_and_reverse: 'Post & Reverse Conflict',
  };
  return labels[type] || type;
}

function getMaxSeverity(severities: ForensicSeverity[]): ForensicSeverity {
  const order: ForensicSeverity[] = ['critical', 'high', 'medium', 'low'];
  for (const level of order) {
    if (severities.includes(level)) return level;
  }
  return 'low';
}

function groupBy<T>(arr: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of arr) {
    const key = keyFn(item);
    if (!result[key]) result[key] = [];
    result[key].push(item);
  }
  return result;
}
