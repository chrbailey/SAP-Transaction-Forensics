/**
 * SAP RFC Error Handling
 *
 * Provides specialized error classes for RFC operations and utilities
 * for mapping SAP ABAP exceptions to JavaScript errors.
 */

/**
 * RFC-specific error with SAP context
 */
export class RFCError extends Error {
  /** SAP RFC error code (e.g., 'RFC_COMMUNICATION_FAILURE') */
  readonly rfcCode: string;

  /** Original ABAP message if available */
  readonly abapMessage: string;

  /** ABAP message type (E=Error, W=Warning, I=Info, A=Abort, S=Success) */
  readonly abapMsgType: string;

  /** ABAP message class */
  readonly abapMsgClass: string;

  /** ABAP message number */
  readonly abapMsgNumber: string;

  /** Whether this error is retryable */
  readonly retryable: boolean;

  /** Original error for debugging */
  readonly originalError?: unknown;

  constructor(
    message: string,
    options: {
      rfcCode?: string;
      abapMessage?: string;
      abapMsgType?: string;
      abapMsgClass?: string;
      abapMsgNumber?: string;
      retryable?: boolean;
      originalError?: unknown;
    } = {}
  ) {
    super(message);
    this.name = 'RFCError';
    this.rfcCode = options.rfcCode || 'UNKNOWN';
    this.abapMessage = options.abapMessage || '';
    this.abapMsgType = options.abapMsgType || 'E';
    this.abapMsgClass = options.abapMsgClass || '';
    this.abapMsgNumber = options.abapMsgNumber || '';
    this.retryable = options.retryable ?? false;
    this.originalError = options.originalError;
  }

  /**
   * Create a structured representation for logging
   */
  toLogObject(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      rfcCode: this.rfcCode,
      abapMessage: this.abapMessage,
      abapMsgType: this.abapMsgType,
      abapMsgClass: this.abapMsgClass,
      abapMsgNumber: this.abapMsgNumber,
      retryable: this.retryable,
      stack: this.stack,
    };
  }
}

/**
 * Connection-specific error
 */
export class RFCConnectionError extends RFCError {
  constructor(message: string, options: ConstructorParameters<typeof RFCError>[1] = {}) {
    super(message, { ...options, retryable: options.retryable ?? true });
    this.name = 'RFCConnectionError';
  }
}

/**
 * Authorization/permission error
 */
export class RFCAuthorizationError extends RFCError {
  constructor(message: string, options: ConstructorParameters<typeof RFCError>[1] = {}) {
    super(message, { ...options, retryable: false });
    this.name = 'RFCAuthorizationError';
  }
}

/**
 * Timeout error
 */
export class RFCTimeoutError extends RFCError {
  constructor(message: string, options: ConstructorParameters<typeof RFCError>[1] = {}) {
    super(message, { ...options, retryable: true });
    this.name = 'RFCTimeoutError';
  }
}

/**
 * Not found error (e.g., document doesn't exist)
 */
export class RFCNotFoundError extends RFCError {
  constructor(message: string, options: ConstructorParameters<typeof RFCError>[1] = {}) {
    super(message, { ...options, retryable: false });
    this.name = 'RFCNotFoundError';
  }
}

/**
 * Known SAP RFC error codes and their categories
 */
const RFC_ERROR_CODES: Record<string, { category: string; retryable: boolean }> = {
  // Connection errors (usually retryable)
  RFC_COMMUNICATION_FAILURE: { category: 'connection', retryable: true },
  RFC_INVALID_HANDLE: { category: 'connection', retryable: true },
  RFC_CONNECTION_BROKEN: { category: 'connection', retryable: true },
  RFC_TIMEOUT: { category: 'timeout', retryable: true },

  // Authentication errors (not retryable)
  RFC_LOGON_FAILURE: { category: 'auth', retryable: false },
  RFC_AUTHORIZATION_FAILURE: { category: 'auth', retryable: false },
  RFC_NOT_AUTHORIZED: { category: 'auth', retryable: false },

  // Data errors (not retryable)
  RFC_TABLE_MOVE_ERROR: { category: 'data', retryable: false },
  RFC_MEMORY_INSUFFICIENT: { category: 'resource', retryable: true },
  RFC_ABAP_RUNTIME_FAILURE: { category: 'abap', retryable: false },
  RFC_ABAP_MESSAGE: { category: 'abap', retryable: false },
  RFC_ABAP_EXCEPTION: { category: 'abap', retryable: false },

  // System errors
  RFC_UNKNOWN_ERROR: { category: 'unknown', retryable: false },
};

/**
 * Map an unknown error (from node-rfc or catch block) to an RFCError
 */
export function mapSAPException(error: unknown): RFCError {
  // Already an RFCError
  if (error instanceof RFCError) {
    return error;
  }

  // Handle node-rfc error objects
  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;

    // node-rfc returns errors with specific structure
    const rfcCode = (err.code as string) || (err.key as string) || 'UNKNOWN';
    const message = (err.message as string) || String(error);

    // Check for ABAP message details (common in BAPI returns)
    const abapDetails = {
      abapMessage: (err.abapMsgV1 as string) || (err.message as string) || '',
      abapMsgType: (err.abapMsgType as string) || 'E',
      abapMsgClass: (err.abapMsgClass as string) || '',
      abapMsgNumber: (err.abapMsgNumber as string) || '',
    };

    // Determine error category
    const errorInfo = RFC_ERROR_CODES[rfcCode] || { category: 'unknown', retryable: false };

    // Create appropriate error subclass
    switch (errorInfo.category) {
      case 'connection':
        return new RFCConnectionError(message, {
          rfcCode,
          ...abapDetails,
          retryable: true,
          originalError: error,
        });

      case 'auth':
        return new RFCAuthorizationError(message, {
          rfcCode,
          ...abapDetails,
          retryable: false,
          originalError: error,
        });

      case 'timeout':
        return new RFCTimeoutError(message, {
          rfcCode,
          ...abapDetails,
          retryable: true,
          originalError: error,
        });

      default:
        return new RFCError(message, {
          rfcCode,
          ...abapDetails,
          retryable: errorInfo.retryable,
          originalError: error,
        });
    }
  }

  // Handle string errors
  if (typeof error === 'string') {
    return new RFCError(error, { retryable: false });
  }

  // Fallback
  return new RFCError(String(error), { retryable: false, originalError: error });
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof RFCError) {
    return error.retryable;
  }

  // Check for common network errors
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('socket hang up')
    );
  }

  return false;
}

/**
 * Check if an error indicates the document/entity was not found
 */
export function isNotFoundError(error: unknown): boolean {
  if (error instanceof RFCNotFoundError) {
    return true;
  }

  if (error instanceof RFCError) {
    // Common SAP "not found" indicators
    const message = error.message.toLowerCase();
    return (
      message.includes('not found') ||
      message.includes('does not exist') ||
      message.includes('no data') ||
      error.abapMsgNumber === '001' // Common "not found" message number
    );
  }

  return false;
}

/**
 * Extract return messages from BAPI responses
 * BAPIs return a RETURN table/structure with messages
 */
export function extractBapiErrors(
  returnData: unknown
): { hasErrors: boolean; messages: Array<{ type: string; message: string }> } {
  const messages: Array<{ type: string; message: string }> = [];
  let hasErrors = false;

  // Handle RETURN structure (single message)
  if (typeof returnData === 'object' && returnData !== null && !Array.isArray(returnData)) {
    const ret = returnData as Record<string, unknown>;
    if (ret.TYPE && ret.MESSAGE) {
      const type = String(ret.TYPE);
      messages.push({ type, message: String(ret.MESSAGE) });
      if (type === 'E' || type === 'A') {
        hasErrors = true;
      }
    }
  }

  // Handle RETURN table (array of messages)
  if (Array.isArray(returnData)) {
    for (const item of returnData) {
      if (typeof item === 'object' && item !== null) {
        const ret = item as Record<string, unknown>;
        if (ret.TYPE && ret.MESSAGE) {
          const type = String(ret.TYPE);
          messages.push({ type, message: String(ret.MESSAGE) });
          if (type === 'E' || type === 'A') {
            hasErrors = true;
          }
        }
      }
    }
  }

  return { hasErrors, messages };
}

/**
 * Create an RFCError from BAPI return messages
 */
export function createErrorFromBapiReturn(returnData: unknown, context: string): RFCError | null {
  const { hasErrors, messages } = extractBapiErrors(returnData);

  if (!hasErrors) {
    return null;
  }

  // Find the first error message
  const errorMsg = messages.find((m) => m.type === 'E' || m.type === 'A');

  if (errorMsg) {
    // Check for common "not found" patterns
    if (
      errorMsg.message.toLowerCase().includes('not found') ||
      errorMsg.message.toLowerCase().includes('does not exist')
    ) {
      return new RFCNotFoundError(`${context}: ${errorMsg.message}`, {
        abapMsgType: errorMsg.type,
      });
    }

    return new RFCError(`${context}: ${errorMsg.message}`, {
      abapMsgType: errorMsg.type,
      abapMessage: errorMsg.message,
    });
  }

  return null;
}
