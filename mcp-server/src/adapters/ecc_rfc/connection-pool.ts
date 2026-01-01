/**
 * SAP RFC Connection Pool
 *
 * Manages a pool of RFC Client connections for efficient resource usage.
 * Implements connection validation, auto-reconnection, and graceful shutdown.
 */

import type { ECCConnectionConfig } from './config.js';
import { toRfcConnectionParams, sanitizeConfigForLogging } from './config.js';
import { RFCConnectionError, RFCError, mapSAPException } from './errors.js';

/**
 * RFC Client interface matching node-rfc Client
 * We use an interface to allow mocking and conditional loading
 */
export interface RFCClientInterface {
  open(): Promise<void>;
  close(): Promise<void>;
  call(functionName: string, params: Record<string, unknown>): Promise<unknown>;
  readonly alive: boolean;
}

/**
 * Wrapper around a pooled RFC connection
 */
interface PooledConnection {
  /** The RFC client instance */
  client: RFCClientInterface;
  /** When this connection was created */
  createdAt: Date;
  /** When this connection was last used */
  lastUsedAt: Date;
  /** Whether this connection is currently in use */
  inUse: boolean;
  /** Unique ID for logging/debugging */
  id: number;
}

/**
 * Pool statistics for monitoring
 */
export interface PoolStats {
  /** Total connections in pool */
  total: number;
  /** Connections currently in use */
  inUse: number;
  /** Connections available for use */
  available: number;
  /** Connections created since pool start */
  connectionsCreated: number;
  /** Connections closed due to errors or staleness */
  connectionsClosed: number;
  /** Total RFC calls made through the pool */
  totalCalls: number;
  /** Pool creation time */
  createdAt: Date;
}

/**
 * Pool configuration options
 */
export interface PoolOptions {
  /** Maximum connections in pool (default: from config.poolSize) */
  maxSize?: number;
  /** Connection idle timeout in ms before pruning (default: 300000 = 5 min) */
  idleTimeoutMs?: number;
  /** Connection max age in ms before forced reconnect (default: 3600000 = 1 hour) */
  maxAgeMs?: number;
  /** How often to check for stale connections in ms (default: 60000 = 1 min) */
  pruneIntervalMs?: number;
  /** Timeout for acquiring a connection from pool in ms (default: 30000) */
  acquireTimeoutMs?: number;
}

/**
 * Manages a pool of RFC connections to SAP ECC
 */
export class RFCConnectionPool {
  private readonly config: ECCConnectionConfig;
  private readonly options: Required<PoolOptions>;
  private readonly connections: PooledConnection[] = [];
  private RFCClientClass: (new (params: Record<string, unknown>) => RFCClientInterface) | null = null;
  private rfcAvailable: boolean = false;

  private connectionIdCounter: number = 0;
  private stats: {
    connectionsCreated: number;
    connectionsClosed: number;
    totalCalls: number;
    createdAt: Date;
  };

  private pruneInterval: NodeJS.Timeout | null = null;
  private isShuttingDown: boolean = false;
  private initialized: boolean = false;

  private readonly logger: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    debug: (msg: string, meta?: Record<string, unknown>) => void;
  };

  constructor(
    config: ECCConnectionConfig,
    options: PoolOptions = {},
    logger?: {
      info: (msg: string, meta?: Record<string, unknown>) => void;
      error: (msg: string, meta?: Record<string, unknown>) => void;
      warn: (msg: string, meta?: Record<string, unknown>) => void;
      debug: (msg: string, meta?: Record<string, unknown>) => void;
    }
  ) {
    this.config = config;
    this.options = {
      maxSize: options.maxSize ?? config.poolSize,
      idleTimeoutMs: options.idleTimeoutMs ?? 300000, // 5 minutes
      maxAgeMs: options.maxAgeMs ?? 3600000, // 1 hour
      pruneIntervalMs: options.pruneIntervalMs ?? 60000, // 1 minute
      acquireTimeoutMs: options.acquireTimeoutMs ?? config.timeout,
    };

    this.stats = {
      connectionsCreated: 0,
      connectionsClosed: 0,
      totalCalls: 0,
      createdAt: new Date(),
    };

    // Default logger that does nothing (can be overridden)
    this.logger = logger ?? {
      info: () => {},
      error: () => {},
      warn: () => {},
      debug: () => {},
    };
  }

  /**
   * Initialize the pool by loading node-rfc and creating initial connections
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info('Initializing RFC connection pool', {
      config: sanitizeConfigForLogging(this.config),
      poolOptions: this.options,
    });

    // Try to load node-rfc dynamically
    try {
      const nodeRfc = await import('node-rfc');
      this.RFCClientClass = nodeRfc.Client as unknown as new (
        params: Record<string, unknown>
      ) => RFCClientInterface;
      this.rfcAvailable = true;
      this.logger.info('node-rfc loaded successfully');
    } catch (err) {
      this.rfcAvailable = false;
      this.logger.warn('node-rfc not available - RFC adapter will not function', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new RFCConnectionError(
        'SAP NetWeaver RFC SDK not available. Please install node-rfc and the SAP NW RFC SDK.',
        { originalError: err }
      );
    }

    // Create one initial connection to validate config
    try {
      const conn = await this.createConnection();
      this.connections.push(conn);
      this.logger.info('Initial RFC connection established successfully');
    } catch (err) {
      const rfcErr = mapSAPException(err);
      this.logger.error('Failed to establish initial RFC connection', {
        error: rfcErr.toLogObject(),
      });
      throw rfcErr;
    }

    // Start the pruning interval
    this.pruneInterval = setInterval(() => {
      this.pruneStaleConnections().catch((err) => {
        this.logger.error('Error during connection pruning', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.options.pruneIntervalMs);

    this.initialized = true;
  }

  /**
   * Check if RFC is available (SDK installed)
   */
  isAvailable(): boolean {
    return this.rfcAvailable;
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    const inUse = this.connections.filter((c) => c.inUse).length;
    return {
      total: this.connections.length,
      inUse,
      available: this.connections.length - inUse,
      connectionsCreated: this.stats.connectionsCreated,
      connectionsClosed: this.stats.connectionsClosed,
      totalCalls: this.stats.totalCalls,
      createdAt: this.stats.createdAt,
    };
  }

  /**
   * Acquire a connection from the pool.
   * Creates a new connection if none available and pool not at max size.
   */
  async acquire(): Promise<{ connection: PooledConnection; release: () => void }> {
    if (!this.initialized) {
      throw new RFCConnectionError('Connection pool not initialized');
    }

    if (this.isShuttingDown) {
      throw new RFCConnectionError('Connection pool is shutting down');
    }

    const startTime = Date.now();

    while (Date.now() - startTime < this.options.acquireTimeoutMs) {
      // Try to find an available connection
      const available = this.connections.find((c) => !c.inUse && c.client.alive);

      if (available) {
        available.inUse = true;
        available.lastUsedAt = new Date();
        this.logger.debug('Acquired existing connection', { connectionId: available.id });

        return {
          connection: available,
          release: () => this.releaseConnection(available),
        };
      }

      // Try to create a new connection if pool not full
      if (this.connections.length < this.options.maxSize) {
        try {
          const conn = await this.createConnection();
          conn.inUse = true;
          this.connections.push(conn);
          this.logger.debug('Created and acquired new connection', { connectionId: conn.id });

          return {
            connection: conn,
            release: () => this.releaseConnection(conn),
          };
        } catch (err) {
          const rfcErr = mapSAPException(err);
          this.logger.error('Failed to create new connection', { error: rfcErr.toLogObject() });
          throw rfcErr;
        }
      }

      // Pool is full, wait a bit and retry
      await this.sleep(100);
    }

    throw new RFCConnectionError(
      `Timeout waiting for available connection (pool size: ${this.connections.length}, all in use)`,
      { rfcCode: 'POOL_EXHAUSTED', retryable: true }
    );
  }

  /**
   * Execute an RFC call with automatic connection management
   */
  async call<T>(functionName: string, params: Record<string, unknown>): Promise<T> {
    const { connection, release } = await this.acquire();

    try {
      this.logger.debug('Executing RFC call', { functionName, connectionId: connection.id });
      const result = await connection.client.call(functionName, params);
      this.stats.totalCalls++;
      return result as T;
    } catch (err) {
      const rfcErr = mapSAPException(err);
      this.logger.error('RFC call failed', {
        functionName,
        connectionId: connection.id,
        error: rfcErr.toLogObject(),
      });

      // If connection error, mark connection as dead
      if (rfcErr instanceof RFCConnectionError) {
        await this.removeConnection(connection, 'connection error');
      }

      throw rfcErr;
    } finally {
      release();
    }
  }

  /**
   * Shutdown the pool gracefully
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    this.logger.info('Shutting down RFC connection pool');

    // Stop the prune interval
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = null;
    }

    // Wait for in-use connections (with timeout)
    const waitStart = Date.now();
    while (
      this.connections.some((c) => c.inUse) &&
      Date.now() - waitStart < 10000 // 10 second max wait
    ) {
      await this.sleep(100);
    }

    // Close all connections
    const closePromises = this.connections.map(async (conn) => {
      try {
        await conn.client.close();
        this.stats.connectionsClosed++;
      } catch (err) {
        this.logger.warn('Error closing connection during shutdown', {
          connectionId: conn.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    await Promise.all(closePromises);
    this.connections.length = 0;

    this.logger.info('RFC connection pool shutdown complete', {
      stats: this.getStats(),
    });

    this.initialized = false;
  }

  /**
   * Create a new RFC connection
   */
  private async createConnection(): Promise<PooledConnection> {
    if (!this.RFCClientClass) {
      throw new RFCConnectionError('RFC Client class not available');
    }

    const connectionParams = toRfcConnectionParams(this.config);
    const client = new this.RFCClientClass(connectionParams);

    await client.open();

    this.stats.connectionsCreated++;
    const id = ++this.connectionIdCounter;

    this.logger.debug('Created new RFC connection', { connectionId: id });

    return {
      client,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      inUse: false,
      id,
    };
  }

  /**
   * Release a connection back to the pool
   */
  private releaseConnection(connection: PooledConnection): void {
    connection.inUse = false;
    connection.lastUsedAt = new Date();
    this.logger.debug('Released connection', { connectionId: connection.id });
  }

  /**
   * Remove a connection from the pool
   */
  private async removeConnection(connection: PooledConnection, reason: string): Promise<void> {
    const index = this.connections.indexOf(connection);
    if (index === -1) {
      return;
    }

    this.connections.splice(index, 1);
    this.logger.debug('Removed connection from pool', { connectionId: connection.id, reason });

    try {
      await connection.client.close();
    } catch {
      // Ignore close errors
    }

    this.stats.connectionsClosed++;
  }

  /**
   * Prune stale and idle connections
   */
  private async pruneStaleConnections(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    const now = Date.now();
    const toPrune: PooledConnection[] = [];

    for (const conn of this.connections) {
      // Skip connections in use
      if (conn.inUse) {
        continue;
      }

      // Check if connection is too old
      const age = now - conn.createdAt.getTime();
      if (age > this.options.maxAgeMs) {
        toPrune.push(conn);
        continue;
      }

      // Check if connection has been idle too long
      const idle = now - conn.lastUsedAt.getTime();
      if (idle > this.options.idleTimeoutMs) {
        // Keep at least one connection
        if (this.connections.length - toPrune.length > 1) {
          toPrune.push(conn);
        }
      }

      // Check if connection is dead
      if (!conn.client.alive) {
        toPrune.push(conn);
      }
    }

    for (const conn of toPrune) {
      await this.removeConnection(conn, 'stale/idle');
    }

    if (toPrune.length > 0) {
      this.logger.debug('Pruned stale connections', { count: toPrune.length });
    }
  }

  /**
   * Helper to sleep for a given number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
