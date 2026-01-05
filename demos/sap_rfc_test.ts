#!/usr/bin/env npx tsx
/**
 * SAP RFC Connection Test
 *
 * Tests connectivity to a real SAP system via RFC.
 * Use this script to verify your SAP connection before running the MCP server.
 *
 * Prerequisites:
 *   1. SAP NetWeaver RFC SDK installed (nwrfcsdk folder)
 *   2. node-rfc package installed: npm install node-rfc
 *   3. Environment variables configured (see .env.rfc.example)
 *
 * Required Environment Variables:
 *   SAP_RFC_ASHOST  - SAP Application Server hostname
 *   SAP_RFC_SYSNR   - System number (e.g., '00')
 *   SAP_RFC_CLIENT  - SAP Client (e.g., '100')
 *   SAP_RFC_USER    - RFC username
 *   SAP_RFC_PASSWD  - RFC password
 *
 * Usage:
 *   cd mcp-server
 *   npx tsx ../demos/sap_rfc_test.ts
 *
 * Or with inline environment variables:
 *   SAP_RFC_ASHOST=sap.example.com SAP_RFC_SYSNR=00 SAP_RFC_CLIENT=100 \
 *   SAP_RFC_USER=RFC_USER SAP_RFC_PASSWD=secret npx tsx ../demos/sap_rfc_test.ts
 */

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

function printHeader(text: string): void {
  console.log(`\n${colors.bright}${colors.cyan}${'═'.repeat(70)}${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}  ${text}${colors.reset}`);
  console.log(`${colors.cyan}${'═'.repeat(70)}${colors.reset}\n`);
}

function printSuccess(text: string): void {
  console.log(`${colors.green}✓ ${text}${colors.reset}`);
}

function printError(text: string): void {
  console.log(`${colors.red}✗ ${text}${colors.reset}`);
}

function printInfo(label: string, value: string): void {
  console.log(`  ${colors.dim}${label}:${colors.reset} ${colors.cyan}${value}${colors.reset}`);
}

function printWarning(text: string): void {
  console.log(`${colors.yellow}⚠ ${text}${colors.reset}`);
}

// Configuration validation
interface RFCConfig {
  ashost: string;
  sysnr: string;
  client: string;
  user: string;
  passwd: string;
  lang: string;
}

function validateConfig(): RFCConfig | null {
  const required = [
    'SAP_RFC_ASHOST',
    'SAP_RFC_SYSNR',
    'SAP_RFC_CLIENT',
    'SAP_RFC_USER',
    'SAP_RFC_PASSWD',
  ];

  const missing = required.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    printError('Missing required environment variables:');
    for (const name of missing) {
      console.log(`  ${colors.yellow}${name}${colors.reset}`);
    }
    console.log();
    console.log(`${colors.dim}Set these variables or use .env.rfc file:${colors.reset}`);
    console.log(`  ${colors.cyan}cp .env.rfc.example .env.rfc${colors.reset}`);
    console.log(`  ${colors.cyan}# Edit .env.rfc with your SAP credentials${colors.reset}`);
    console.log(`  ${colors.cyan}source .env.rfc${colors.reset}`);
    return null;
  }

  return {
    ashost: process.env.SAP_RFC_ASHOST!,
    sysnr: process.env.SAP_RFC_SYSNR!,
    client: process.env.SAP_RFC_CLIENT!,
    user: process.env.SAP_RFC_USER!,
    passwd: process.env.SAP_RFC_PASSWD!,
    lang: process.env.SAP_RFC_LANG || 'EN',
  };
}

async function testConnection(): Promise<void> {
  printHeader('SAP RFC Connection Test');

  // Step 1: Validate configuration
  console.log(`${colors.bright}Step 1: Checking configuration...${colors.reset}\n`);

  const config = validateConfig();
  if (!config) {
    process.exit(1);
  }

  printSuccess('Configuration validated');
  printInfo('Host', config.ashost);
  printInfo('System', config.sysnr);
  printInfo('Client', config.client);
  printInfo('User', config.user);
  printInfo('Language', config.lang);
  console.log();

  // Step 2: Load node-rfc
  console.log(`${colors.bright}Step 2: Loading node-rfc library...${colors.reset}\n`);

  let Client: typeof import('node-rfc').Client;
  try {
    const nodeRfc = await import('node-rfc');
    Client = nodeRfc.Client;
    printSuccess('node-rfc loaded successfully');
  } catch (error) {
    const err = error as Error;
    printError('Failed to load node-rfc');
    console.log();
    console.log(`${colors.dim}Error: ${err.message}${colors.reset}`);
    console.log();
    console.log(`${colors.yellow}To fix this:${colors.reset}`);
    console.log(`  1. Install SAP NetWeaver RFC SDK from SAP Support Portal`);
    console.log(`  2. Set SAPNWRFC_HOME environment variable`);
    console.log(`  3. Run: ${colors.cyan}npm install node-rfc${colors.reset}`);
    console.log();
    console.log(`${colors.dim}See docs/adapter_guide.md for detailed instructions${colors.reset}`);
    process.exit(1);
  }
  console.log();

  // Step 3: Test connection
  console.log(`${colors.bright}Step 3: Connecting to SAP...${colors.reset}\n`);

  const client = new Client({
    ashost: config.ashost,
    sysnr: config.sysnr,
    client: config.client,
    user: config.user,
    passwd: config.passwd,
    lang: config.lang,
  });

  try {
    await client.open();
    printSuccess('Connected to SAP system');
  } catch (error) {
    const err = error as Error & { code?: string; key?: string };
    printError('Connection failed');
    console.log();
    console.log(`${colors.dim}Error: ${err.message}${colors.reset}`);
    if (err.code) {
      console.log(`${colors.dim}Code: ${err.code}${colors.reset}`);
    }
    if (err.key) {
      console.log(`${colors.dim}Key: ${err.key}${colors.reset}`);
    }
    console.log();

    // Common error suggestions
    if (err.message.includes('COMMUNICATION_FAILURE')) {
      console.log(`${colors.yellow}Possible causes:${colors.reset}`);
      console.log(`  • SAP host is not reachable (check firewall)`);
      console.log(`  • Wrong hostname or system number`);
      console.log(`  • SAP system is not running`);
    } else if (err.message.includes('LOGON_FAILURE')) {
      console.log(`${colors.yellow}Possible causes:${colors.reset}`);
      console.log(`  • Wrong username or password`);
      console.log(`  • User is locked`);
      console.log(`  • Wrong client number`);
    }

    process.exit(1);
  }
  console.log();

  // Step 4: Get system info
  console.log(`${colors.bright}Step 4: Getting system information...${colors.reset}\n`);

  try {
    const sysInfo = await client.call('RFC_SYSTEM_INFO', {});
    const rfcsiExport = sysInfo.RFCSI_EXPORT as Record<string, string>;

    printSuccess('System info retrieved');
    printInfo('SAP Release', rfcsiExport.RFCSAPRL || 'N/A');
    printInfo('Database', rfcsiExport.RFCDBSYS || 'N/A');
    printInfo('Host', rfcsiExport.RFCHOST || 'N/A');
    printInfo('Instance', rfcsiExport.RFCSYSID || 'N/A');
    printInfo('Kernel', rfcsiExport.RFCKERNRL || 'N/A');
  } catch (error) {
    printWarning('Could not retrieve system info (non-critical)');
  }
  console.log();

  // Step 5: Test authorization (try a harmless BAPI)
  console.log(`${colors.bright}Step 5: Testing BAPI authorization...${colors.reset}\n`);

  const bapisToTest = [
    { name: 'BAPI_SALESORDER_GETLIST', desc: 'Sales Order List' },
    { name: 'BAPI_CUSTOMER_GETDETAIL2', desc: 'Customer Master' },
    { name: 'BAPI_MATERIAL_GET_DETAIL', desc: 'Material Master' },
    { name: 'RFC_READ_TABLE', desc: 'Table Read' },
  ];

  let authSuccess = 0;
  let authFail = 0;

  for (const bapi of bapisToTest) {
    try {
      // Just call with minimal params to check if function is available
      // Most will fail with "missing params" but NOT "no authorization"
      await client.call(bapi.name, {});
      printSuccess(`${bapi.desc} (${bapi.name})`);
      authSuccess++;
    } catch (error) {
      const err = error as Error & { code?: string; key?: string };
      // Check if it's an auth error vs normal param error
      if (err.key === 'RFC_AUTHORIZATION_FAILURE' || err.message.includes('authorization')) {
        printError(`${bapi.desc} (${bapi.name}) - No authorization`);
        authFail++;
      } else {
        // Other errors (missing params, etc.) mean the function is accessible
        printSuccess(`${bapi.desc} (${bapi.name})`);
        authSuccess++;
      }
    }
  }
  console.log();

  if (authFail > 0) {
    printWarning(`${authFail} BAPI(s) require additional authorization`);
    console.log(`${colors.dim}Check S_RFC authorization object for RFC user${colors.reset}`);
    console.log();
  }

  // Step 6: Test a real data call (if authorized)
  console.log(`${colors.bright}Step 6: Testing data retrieval...${colors.reset}\n`);

  try {
    const result = await client.call('BAPI_SALESORDER_GETLIST', {
      MAX_ROWS: 1,
      DOCUMENT_DATE_LOW: '20200101',
      DOCUMENT_DATE_HIGH: '20991231',
    });

    const orders = result.SALES_ORDERS as Array<Record<string, unknown>>;
    if (orders && orders.length > 0) {
      printSuccess(`Found ${orders.length} sales order(s)`);
      const order = orders[0];
      printInfo('Sample Order', String(order.SD_DOC || 'N/A'));
      printInfo('Customer', String(order.SOLD_TO || 'N/A'));
      printInfo('Date', String(order.DOC_DATE || 'N/A'));
    } else {
      printWarning('No sales orders found in date range');
      console.log(`${colors.dim}This is normal for empty/new systems${colors.reset}`);
    }
  } catch (error) {
    const err = error as Error;
    printWarning('Could not retrieve sales orders');
    console.log(`${colors.dim}Error: ${err.message}${colors.reset}`);
    console.log(`${colors.dim}This might be an authorization issue${colors.reset}`);
  }
  console.log();

  // Cleanup
  await client.close();

  // Summary
  printHeader('Connection Test Complete');

  console.log(`${colors.bright}Results:${colors.reset}`);
  printSuccess('RFC connection successful');
  printSuccess('System accessible');
  console.log(`  ${colors.dim}BAPIs authorized: ${authSuccess}/${bapisToTest.length}${colors.reset}`);
  console.log();

  console.log(`${colors.bright}Next steps:${colors.reset}`);
  console.log(`  1. Start the MCP server with RFC adapter:`);
  console.log(`     ${colors.cyan}SAP_ADAPTER=ecc_rfc npm start${colors.reset}`);
  console.log();
  console.log(`  2. Or use Docker with RFC profile:`);
  console.log(`     ${colors.cyan}docker compose --profile rfc up${colors.reset}`);
  console.log();
  console.log(`${colors.dim}See docs/adapter_guide.md for full documentation${colors.reset}\n`);
}

// Run the test
testConnection().catch((error) => {
  printError(`Unexpected error: ${error.message}`);
  process.exit(1);
});
