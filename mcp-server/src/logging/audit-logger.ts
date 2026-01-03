/**
 * Audit Logger
 *
 * Provides comprehensive audit logging for all MCP tool calls.
 * Every tool invocation is logged with:
 * - Timestamp (ISO 8601 format)
 * - Unique request ID for tracing
 * - Tool name
 * - Parameters (sanitized to remove sensitive data)
 * - Row count returned
 * - Duration in milliseconds
 * - Success/failure status
 * - Error details if applicable
 */

import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Audit log entry structure
 */
export interface AuditLogEntry {
  timestamp: string;
  request_id: string;
  tool_name: string;
  adapter_name?: string;
  params: Record<string, unknown>;
  row_count?: number;
  duration_ms?: number;
  success: boolean;
  error_message?: string;
  error_type?: string;
  policy_violations?: Array<{
    violation: string;
    details?: Record<string, unknown>;
  }>;
}

/**
 * Configure the winston logger
 */
const logDir = join(__dirname, '..', '..');
const auditLogPath = join(logDir, 'audit.log');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    winston.format.json()
  ),
  defaultMeta: { service: 'sap-workflow-mining-mcp' },
  transports: [
    // Console transport for development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const requestIdValue = meta['request_id'];
          const requestId =
            typeof requestIdValue === 'string' ? `[${requestIdValue.slice(0, 8)}]` : '';
          const toolValue = meta['tool_name'];
          const tool = typeof toolValue === 'string' ? `<${toolValue}>` : '';
          return `${timestamp} ${level} ${requestId} ${tool} ${message}`;
        })
      ),
      level: process.env['LOG_LEVEL'] || 'info',
    }),
    // File transport for persistent audit log
    new winston.transports.File({
      filename: auditLogPath,
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
        winston.format.json()
      ),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true,
    }),
  ],
});

/**
 * Fields that should never be logged
 */
const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /auth/i,
  /key/i,
  /credential/i,
  /apikey/i,
];

/**
 * Sanitize parameters for logging
 * Removes or masks potentially sensitive values
 */
function sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    // Check if key matches sensitive patterns
    const isSensitive = SENSITIVE_FIELD_PATTERNS.some(pattern => pattern.test(key));

    if (isSensitive) {
      sanitized[key] = '***REDACTED***';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeParams(value as Record<string, unknown>);
    } else if (typeof value === 'string' && value.length > 500) {
      // Truncate very long strings
      sanitized[key] = value.slice(0, 500) + '...[truncated]';
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return uuidv4();
}

/**
 * Log tool call start
 */
export function logToolStart(
  requestId: string,
  toolName: string,
  params: Record<string, unknown>,
  adapterName?: string
): void {
  const sanitizedParams = sanitizeParams(params);

  logger.info('Tool call started', {
    type: 'tool_start',
    request_id: requestId,
    tool_name: toolName,
    adapter_name: adapterName,
    params: sanitizedParams,
  });
}

/**
 * Log successful tool completion
 */
export function logToolSuccess(
  requestId: string,
  toolName: string,
  rowCount: number,
  durationMs: number
): void {
  logger.info('Tool call completed', {
    type: 'tool_success',
    request_id: requestId,
    tool_name: toolName,
    row_count: rowCount,
    duration_ms: durationMs,
  });
}

/**
 * Log tool call error
 */
export function logToolError(
  requestId: string,
  toolName: string,
  error: Error | string,
  durationMs: number
): void {
  const errorMessage = error instanceof Error ? error.message : error;
  const errorType = error instanceof Error ? error.constructor.name : 'UnknownError';

  logger.error('Tool call failed', {
    type: 'tool_error',
    request_id: requestId,
    tool_name: toolName,
    error_message: errorMessage,
    error_type: errorType,
    duration_ms: durationMs,
  });
}

/**
 * Log policy violation
 */
export function logPolicyViolation(
  requestId: string,
  toolName: string,
  violation: string,
  details?: Record<string, unknown>
): void {
  logger.warn('Policy violation', {
    type: 'policy_violation',
    request_id: requestId,
    tool_name: toolName,
    violation,
    details,
  });
}

/**
 * Log server lifecycle events
 */
export function logServerEvent(
  event: 'start' | 'stop' | 'error' | 'ready',
  details?: Record<string, unknown>
): void {
  const level = event === 'error' ? 'error' : 'info';
  logger.log(level, `Server ${event}`, {
    type: `server_${event}`,
    ...details,
  });
}

/**
 * Audit context for a single tool call
 * Provides convenient tracking and logging methods
 */
export class AuditContext {
  readonly requestId: string;
  readonly toolName: string;
  readonly startTime: number;
  private readonly params: Record<string, unknown>;
  private readonly adapterName?: string;
  private policyViolations: Array<{ violation: string; details?: Record<string, unknown> }> = [];
  private completed = false;

  constructor(
    toolName: string,
    params: Record<string, unknown>,
    adapterName?: string,
    requestId?: string
  ) {
    this.requestId = requestId || generateRequestId();
    this.toolName = toolName;
    this.params = params;
    if (adapterName) {
      this.adapterName = adapterName;
    }
    this.startTime = Date.now();

    // Log start
    logToolStart(this.requestId, toolName, params, adapterName);
  }

  /**
   * Record a policy violation during this request
   */
  policyViolation(violation: string, details?: Record<string, unknown>): void {
    this.policyViolations.push({
      violation,
      ...(details ? { details } : {}),
    });
    logPolicyViolation(this.requestId, this.toolName, violation, details);
  }

  /**
   * Mark the request as successful
   */
  success(rowCount: number): void {
    if (this.completed) return;
    this.completed = true;

    const durationMs = Date.now() - this.startTime;
    logToolSuccess(this.requestId, this.toolName, rowCount, durationMs);
  }

  /**
   * Mark the request as failed
   */
  error(err: Error | string): void {
    if (this.completed) return;
    this.completed = true;

    const durationMs = Date.now() - this.startTime;
    logToolError(this.requestId, this.toolName, err, durationMs);
  }

  /**
   * Get elapsed time in milliseconds
   */
  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get summary of policy violations
   */
  getPolicyViolations(): Array<{ violation: string; details?: Record<string, unknown> }> {
    return [...this.policyViolations];
  }

  /**
   * Create a structured audit log entry
   */
  toAuditEntry(success: boolean, rowCount?: number, errorMessage?: string): AuditLogEntry {
    return {
      timestamp: new Date(this.startTime).toISOString(),
      request_id: this.requestId,
      tool_name: this.toolName,
      ...(this.adapterName ? { adapter_name: this.adapterName } : {}),
      params: sanitizeParams(this.params),
      ...(rowCount !== undefined ? { row_count: rowCount } : {}),
      duration_ms: Date.now() - this.startTime,
      success,
      ...(errorMessage ? { error_message: errorMessage } : {}),
      ...(this.policyViolations.length > 0 ? { policy_violations: this.policyViolations } : {}),
    };
  }
}

/**
 * Create an audit context for a tool call
 */
export function createAuditContext(
  toolName: string,
  params: Record<string, unknown>,
  adapterName?: string,
  requestId?: string
): AuditContext {
  return new AuditContext(toolName, params, adapterName, requestId);
}

/**
 * Export the logger instance for direct access if needed
 */
export { logger as auditLogger };

export default {
  createAuditContext,
  generateRequestId,
  logToolStart,
  logToolSuccess,
  logToolError,
  logPolicyViolation,
  logServerEvent,
};
