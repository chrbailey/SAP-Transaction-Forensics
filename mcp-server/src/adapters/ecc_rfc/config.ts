/**
 * SAP ECC RFC Connection Configuration
 *
 * Loads configuration from environment variables for SAP RFC connections.
 * All sensitive values (passwords) are loaded from environment only.
 */

/**
 * RFC Connection Parameters matching node-rfc Client requirements
 */
export interface ECCConnectionConfig {
  /** SAP Application Server hostname */
  ashost: string;
  /** System number (e.g., '00') */
  sysnr: string;
  /** SAP Client (e.g., '100') */
  client: string;
  /** RFC username */
  user: string;
  /** RFC password (sensitive) */
  passwd: string;
  /** Login language (default: 'EN') */
  lang: string;
  /** Connection pool size (default: 5) */
  poolSize: number;
  /** RFC trace level 0-3 (default: 0) */
  trace: number;
  /** Connection timeout in ms (default: 30000) */
  timeout: number;
}

/**
 * Configuration validation errors
 */
export class ConfigValidationError extends Error {
  readonly missingFields: string[];

  constructor(message: string, missingFields: string[]) {
    super(message);
    this.name = 'ConfigValidationError';
    this.missingFields = missingFields;
  }
}

/**
 * Required environment variable names
 */
const REQUIRED_VARS = [
  'SAP_RFC_ASHOST',
  'SAP_RFC_SYSNR',
  'SAP_RFC_CLIENT',
  'SAP_RFC_USER',
  'SAP_RFC_PASSWD',
] as const;

/**
 * Load and validate ECC RFC configuration from environment variables.
 *
 * Required environment variables:
 * - SAP_RFC_ASHOST: SAP Application Server hostname
 * - SAP_RFC_SYSNR: System number
 * - SAP_RFC_CLIENT: SAP Client
 * - SAP_RFC_USER: RFC username
 * - SAP_RFC_PASSWD: RFC password
 *
 * Optional environment variables:
 * - SAP_RFC_LANG: Language (default: 'EN')
 * - SAP_RFC_POOL_SIZE: Connection pool size (default: 5)
 * - SAP_RFC_TRACE: Trace level 0-3 (default: 0)
 * - SAP_RFC_TIMEOUT: Connection timeout in ms (default: 30000)
 *
 * @throws ConfigValidationError if required variables are missing
 */
export function loadECCConfig(): ECCConnectionConfig {
  const env = process.env;

  // Check for missing required variables
  const missing = REQUIRED_VARS.filter(name => !env[name]);

  if (missing.length > 0) {
    throw new ConfigValidationError(
      `Missing required SAP RFC configuration: ${missing.join(', ')}. ` +
        'Please set the following environment variables: ' +
        missing.map(name => `${name}=<value>`).join(', '),
      missing as unknown as string[]
    );
  }

  // Parse optional numeric values with defaults
  const poolSize = parseInt(env.SAP_RFC_POOL_SIZE || '5', 10);
  const trace = parseInt(env.SAP_RFC_TRACE || '0', 10);
  const timeout = parseInt(env.SAP_RFC_TIMEOUT || '30000', 10);

  // Validate numeric ranges
  if (poolSize < 1 || poolSize > 50) {
    throw new ConfigValidationError('SAP_RFC_POOL_SIZE must be between 1 and 50', []);
  }

  if (trace < 0 || trace > 3) {
    throw new ConfigValidationError('SAP_RFC_TRACE must be between 0 and 3', []);
  }

  if (timeout < 1000 || timeout > 300000) {
    throw new ConfigValidationError('SAP_RFC_TIMEOUT must be between 1000 and 300000 ms', []);
  }

  return {
    ashost: env.SAP_RFC_ASHOST!,
    sysnr: env.SAP_RFC_SYSNR!,
    client: env.SAP_RFC_CLIENT!,
    user: env.SAP_RFC_USER!,
    passwd: env.SAP_RFC_PASSWD!,
    lang: env.SAP_RFC_LANG || 'EN',
    poolSize,
    trace,
    timeout,
  };
}

/**
 * Get connection parameters formatted for node-rfc Client
 */
export function toRfcConnectionParams(
  config: ECCConnectionConfig
): Record<string, string | number> {
  return {
    ashost: config.ashost,
    sysnr: config.sysnr,
    client: config.client,
    user: config.user,
    passwd: config.passwd,
    lang: config.lang,
    trace: config.trace.toString(),
  };
}

/**
 * Create a sanitized version of config for logging (no password)
 */
export function sanitizeConfigForLogging(config: ECCConnectionConfig): Record<string, unknown> {
  return {
    ashost: config.ashost,
    sysnr: config.sysnr,
    client: config.client,
    user: config.user,
    passwd: '***REDACTED***',
    lang: config.lang,
    poolSize: config.poolSize,
    trace: config.trace,
    timeout: config.timeout,
  };
}

/**
 * Check if RFC configuration is available (environment variables set)
 * without throwing an error
 */
export function isRFCConfigAvailable(): boolean {
  return REQUIRED_VARS.every(name => !!process.env[name]);
}
