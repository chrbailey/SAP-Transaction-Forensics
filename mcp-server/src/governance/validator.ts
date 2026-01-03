// ═══════════════════════════════════════════════════════════════════════════
// SAP WORKFLOW MINING - PROMPTSPEAK FRAME VALIDATOR
// ═══════════════════════════════════════════════════════════════════════════

import { ParsedFrame, ValidationReport, ValidationResult, SYMBOL_ONTOLOGY } from './types.js';

/**
 * Parse a PromptSpeak frame string into structured components.
 *
 * Valid SAP frame format: ⊕◐◀α (mode + domain + action + entity)
 * - Mode is required and must be first
 * - Domain is required for SAP operations
 * - Action indicates operation type (retrieve, analyze, validate)
 * - Entity indicates agent level
 * - Optional constraint can appear after domain
 */
export function parseFrame(rawFrame: string): ParsedFrame {
  const result: ParsedFrame = {
    raw: rawFrame,
    mode: null,
    domain: null,
    action: null,
    constraint: null,
    entity: null,
    valid: false,
    parseErrors: [],
  };

  if (!rawFrame || rawFrame.trim().length === 0) {
    result.parseErrors.push('Empty frame');
    return result;
  }

  const symbols = [...rawFrame.trim()];

  for (const symbol of symbols) {
    const definition = SYMBOL_ONTOLOGY[symbol];

    if (!definition) {
      result.parseErrors.push(`Unknown symbol: ${symbol}`);
      continue;
    }

    switch (definition.category) {
      case 'mode':
        if (result.mode) {
          result.parseErrors.push('Multiple modes not allowed');
        } else {
          result.mode = definition;
        }
        break;
      case 'domain':
        if (result.domain) {
          result.parseErrors.push('Multiple domains not allowed');
        } else {
          result.domain = definition;
        }
        break;
      case 'action':
        if (result.action) {
          result.parseErrors.push('Multiple actions not allowed');
        } else {
          result.action = definition;
        }
        break;
      case 'constraint':
        if (result.constraint) {
          result.parseErrors.push('Multiple constraints not allowed');
        } else {
          result.constraint = definition;
        }
        break;
      case 'entity':
        if (result.entity) {
          result.parseErrors.push('Multiple entities not allowed');
        } else {
          result.entity = definition;
        }
        break;
    }
  }

  // Check required components
  if (!result.mode) {
    result.parseErrors.push('Mode is required (⊕, ⊘, ⊖, or ⊗)');
  }
  if (!result.domain) {
    result.parseErrors.push('Domain is required (◊ or ◐)');
  }
  if (!result.action) {
    result.parseErrors.push('Action is required (◀, ▲, or ●)');
  }

  // Check mode is first
  if (result.mode && symbols[0] !== result.mode.symbol) {
    result.parseErrors.push('Mode must be first symbol in frame');
  }

  result.valid = result.parseErrors.length === 0;
  return result;
}

/**
 * Validate a parsed frame against semantic rules.
 */
export function validateFrame(frame: ParsedFrame): ValidationReport {
  const results: ValidationResult[] = [];

  // Rule 1: Structural validity (already checked in parse)
  results.push({
    passed: frame.valid,
    severity: frame.valid ? 'info' : 'error',
    code: 'STRUCT-001',
    message: frame.valid
      ? 'Frame structure is valid'
      : `Parse errors: ${frame.parseErrors.join('; ')}`,
  });

  // Rule 2: Forbidden mode cannot have execute action
  if (frame.mode?.name === 'forbidden' && frame.action) {
    results.push({
      passed: false,
      severity: 'error',
      code: 'SEM-001',
      message: 'Forbidden mode (⊗) cannot have an action',
    });
  } else {
    results.push({
      passed: true,
      severity: 'info',
      code: 'SEM-001',
      message: 'Mode-action combination is valid',
    });
  }

  // Rule 3: Forbidden constraint blocks action
  if (frame.constraint?.name === 'forbidden' && frame.action) {
    results.push({
      passed: false,
      severity: 'warning',
      code: 'SEM-002',
      message: 'Forbidden constraint (⛔) will block the action',
    });
  }

  // Rule 4: Financial domain requires strict mode for SAP
  if (frame.domain?.name === 'financial' && frame.mode?.name === 'flexible') {
    results.push({
      passed: false,
      severity: 'warning',
      code: 'SAP-001',
      message: 'Financial operations should use strict (⊕) or neutral (⊘) mode',
    });
  } else {
    results.push({
      passed: true,
      severity: 'info',
      code: 'SAP-001',
      message: 'Domain-mode combination is appropriate for SAP',
    });
  }

  const valid = results.every(r => r.passed || r.severity !== 'error');

  return {
    valid,
    frame: frame.raw,
    results,
    timestamp: Date.now(),
  };
}

/**
 * Quick validation for tool execution context.
 */
export function quickValidate(frame: string): {
  valid: boolean;
  blocked: boolean;
  reason?: string;
} {
  const parsed = parseFrame(frame);

  if (!parsed.valid) {
    return {
      valid: false,
      blocked: true,
      reason: parsed.parseErrors.join('; '),
    };
  }

  // Forbidden mode blocks everything
  if (parsed.mode?.name === 'forbidden') {
    return {
      valid: true,
      blocked: true,
      reason: 'Forbidden mode blocks all actions',
    };
  }

  // Forbidden constraint blocks action
  if (parsed.constraint?.name === 'forbidden') {
    return {
      valid: true,
      blocked: true,
      reason: 'Forbidden constraint blocks action',
    };
  }

  return { valid: true, blocked: false };
}

/**
 * Generate a default frame for SAP operations.
 */
export function defaultSAPFrame(
  tool: string,
  mode: 'strict' | 'neutral' | 'flexible' = 'neutral'
): string {
  const modeSymbol = mode === 'strict' ? '⊕' : mode === 'flexible' ? '⊖' : '⊘';

  // Determine domain based on tool
  const financialTools = ['get_invoice_timing', 'get_sales_doc_header'];
  const domain = financialTools.includes(tool) ? '◊' : '◐';

  // Determine action based on tool type
  let action = '◀'; // retrieve by default
  if (tool.startsWith('search_')) action = '▲'; // analyze for search
  if (tool === 'get_master_stub') action = '●'; // validate for master data

  return `${modeSymbol}${domain}${action}α`;
}
