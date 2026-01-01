/**
 * Type declarations for node-rfc
 *
 * The node-rfc package is an optional dependency that provides SAP NetWeaver RFC SDK
 * connectivity. These declarations provide minimal typing for our usage.
 *
 * @see https://github.com/SAP/node-rfc
 */

declare module 'node-rfc' {
  /**
   * RFC Client for connecting to SAP systems
   */
  export class Client {
    /**
     * Create a new RFC Client with connection parameters
     */
    constructor(connectionParams: Record<string, unknown>);

    /**
     * Open the connection to SAP
     */
    open(): Promise<void>;

    /**
     * Close the connection
     */
    close(): Promise<void>;

    /**
     * Call an RFC function module
     * @param functionName - The name of the RFC function module
     * @param params - The import parameters
     * @returns The export parameters from the function
     */
    call(functionName: string, params: Record<string, unknown>): Promise<unknown>;

    /**
     * Whether the connection is alive
     */
    readonly alive: boolean;
  }

  /**
   * RFC connection options
   */
  export interface RfcConnectionParameters {
    ashost?: string;
    sysnr?: string;
    client?: string;
    user?: string;
    passwd?: string;
    lang?: string;
    trace?: string;
    dest?: string;
    mshost?: string;
    msserv?: string;
    sysid?: string;
    group?: string;
    saprouter?: string;
  }
}
