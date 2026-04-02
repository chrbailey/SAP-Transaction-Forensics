/**
 * NetSuite User Optimization Audit Extraction Paths
 *
 * Three deterministic extraction paths for NetSuite user audits:
 *   1. User Activity  — employee records + login audit for dormant detection
 *   2. Transaction Summary — per-user transaction volumes for role classification
 *   3. Login History — login audit trail for access pattern analysis
 *
 * All queries use SuiteQL (NetSuite's SQL dialect). Field names follow
 * NetSuite record conventions (lowercase with underscores in aliases,
 * native table names in FROM/JOIN).
 */

import type { ExtractionPath } from '../types.js';

// ============================================================================
// Path 1: User Activity (employee + loginaudit)
// ============================================================================

const netsuiteUserActivity: ExtractionPath = {
  id: 'netsuite.user-audit.user-activity',
  version: '1.0',
  name: 'NetSuite User Activity',
  description:
    'Extract all users with system access and their login activity — ' +
    'dormant user detection, license optimization',
  systemType: 'NetSuite',
  domain: 'user-audit',
  queryType: 'sql',
  query:
    'SELECT ' +
    'e.id AS employee_id, ' +
    "e.firstname || ' ' || e.lastname AS full_name, " +
    'e.email, ' +
    'e.isinactive AS is_inactive, ' +
    'e.giveaccess AS has_access, ' +
    'e.supervisor, ' +
    'r.name AS role_name, ' +
    'e.subsidiary, ' +
    'e.department, ' +
    'la.date AS last_login_date, ' +
    'BUILTIN.DF(la.date) AS last_login_formatted, ' +
    'CASE ' +
    "WHEN la.date IS NULL THEN 'NEVER' " +
    "WHEN la.date < SYSDATE - :dormant_days THEN 'DORMANT' " +
    "ELSE 'ACTIVE' " +
    'END AS login_status ' +
    'FROM employee e ' +
    'LEFT JOIN employeeroles er ON e.id = er.employee ' +
    'LEFT JOIN role r ON er.role = r.id ' +
    'LEFT JOIN (' +
    'SELECT user_id, MAX(date) AS date ' +
    'FROM loginaudit ' +
    'GROUP BY user_id' +
    ') la ON e.id = la.user_id ' +
    "WHERE e.giveaccess = 'T' " +
    'ORDER BY la.date ASC NULLS FIRST',
  parameters: [
    {
      name: 'dormant_days',
      type: 'number',
      required: false,
      description: 'Days since last login to classify as dormant',
      defaultValue: '90',
    },
  ],
  expectedFields: [
    {
      name: 'employee_id',
      type: 'string',
      netsuiteName: 'e.id',
      description: 'Employee internal ID',
    },
    {
      name: 'full_name',
      type: 'string',
      netsuiteName: 'firstname || lastname',
      description: 'Employee full name',
    },
    {
      name: 'email',
      type: 'string',
      netsuiteName: 'e.email',
      description: 'Employee email address',
    },
    {
      name: 'is_inactive',
      type: 'boolean',
      netsuiteName: 'e.isinactive',
      description: 'Whether the employee record is inactive',
    },
    {
      name: 'has_access',
      type: 'boolean',
      netsuiteName: 'e.giveaccess',
      description: 'Whether the employee has system login access',
    },
    {
      name: 'supervisor',
      type: 'string',
      netsuiteName: 'e.supervisor',
      description: 'Supervisor internal ID',
    },
    {
      name: 'role_name',
      type: 'string',
      netsuiteName: 'r.name',
      description: 'Assigned role name',
    },
    {
      name: 'subsidiary',
      type: 'string',
      netsuiteName: 'e.subsidiary',
      description: 'Subsidiary assignment',
    },
    {
      name: 'department',
      type: 'string',
      netsuiteName: 'e.department',
      description: 'Department assignment',
    },
    {
      name: 'last_login_date',
      type: 'date',
      netsuiteName: 'la.date',
      description: 'Most recent login timestamp',
    },
    {
      name: 'last_login_formatted',
      type: 'string',
      netsuiteName: 'BUILTIN.DF(la.date)',
      description: 'Last login date formatted via BUILTIN.DF',
    },
    {
      name: 'login_status',
      type: 'string',
      netsuiteName: 'CASE expression',
      description: 'Computed login status: ACTIVE, DORMANT, or NEVER',
    },
  ],
  testData: {
    inputParams: { dormant_days: '90' },
  },
};

// ============================================================================
// Path 2: Transaction Summary (transaction + employee)
// ============================================================================

const netsuiteTransactionSummary: ExtractionPath = {
  id: 'netsuite.user-audit.transaction-summary',
  version: '1.0',
  name: 'NetSuite Transaction Summary',
  description:
    'Extract per-user transaction summary — data entry detection, ' +
    'approval-only detection, report consumer identification',
  systemType: 'NetSuite',
  domain: 'user-audit',
  queryType: 'sql',
  query:
    'SELECT ' +
    't.createdby AS user_id, ' +
    "e.firstname || ' ' || e.lastname AS user_name, " +
    't.type AS record_type, ' +
    'BUILTIN.DF(t.type) AS record_type_name, ' +
    'COUNT(*) AS transaction_count, ' +
    'MIN(t.trandate) AS first_transaction, ' +
    'MAX(t.trandate) AS last_transaction, ' +
    'COUNT(DISTINCT t.type) AS distinct_types ' +
    'FROM transaction t ' +
    'INNER JOIN employee e ON t.createdby = e.id ' +
    'WHERE t.trandate >= SYSDATE - :lookback_days ' +
    'GROUP BY t.createdby, e.firstname, e.lastname, t.type, BUILTIN.DF(t.type) ' +
    'ORDER BY transaction_count DESC',
  parameters: [
    {
      name: 'lookback_days',
      type: 'number',
      required: false,
      description: 'Days to look back for transactions',
      defaultValue: '365',
    },
  ],
  expectedFields: [
    {
      name: 'user_id',
      type: 'string',
      netsuiteName: 't.createdby',
      description: 'User who created the transaction',
    },
    {
      name: 'user_name',
      type: 'string',
      netsuiteName: 'firstname || lastname',
      description: 'User full name',
    },
    {
      name: 'record_type',
      type: 'string',
      netsuiteName: 't.type',
      description: 'Transaction type internal ID',
    },
    {
      name: 'record_type_name',
      type: 'string',
      netsuiteName: 'BUILTIN.DF(t.type)',
      description: 'Transaction type display name',
    },
    {
      name: 'transaction_count',
      type: 'number',
      netsuiteName: 'COUNT(*)',
      description: 'Number of transactions of this type by this user',
    },
    {
      name: 'first_transaction',
      type: 'date',
      netsuiteName: 'MIN(t.trandate)',
      description: 'Earliest transaction date in the period',
    },
    {
      name: 'last_transaction',
      type: 'date',
      netsuiteName: 'MAX(t.trandate)',
      description: 'Most recent transaction date in the period',
    },
    {
      name: 'distinct_types',
      type: 'number',
      netsuiteName: 'COUNT(DISTINCT t.type)',
      description: 'Number of distinct transaction types by this user',
    },
  ],
  testData: {
    inputParams: { lookback_days: '365' },
  },
};

// ============================================================================
// Path 3: Login History (loginaudit + employee)
// ============================================================================

const netsuiteLoginHistory: ExtractionPath = {
  id: 'netsuite.user-audit.login-history',
  version: '1.0',
  name: 'NetSuite Login History',
  description:
    'Extract login audit trail — access pattern analysis, ' +
    'shared account detection, off-hours access',
  systemType: 'NetSuite',
  domain: 'user-audit',
  queryType: 'sql',
  query:
    'SELECT ' +
    'la.user_id, ' +
    "e.firstname || ' ' || e.lastname AS user_name, " +
    'la.date AS login_date, ' +
    'la.role AS login_role, ' +
    'la.status AS login_status, ' +
    'COUNT(*) OVER (PARTITION BY la.user_id) AS total_logins, ' +
    'MIN(la.date) OVER (PARTITION BY la.user_id) AS first_login, ' +
    'MAX(la.date) OVER (PARTITION BY la.user_id) AS last_login ' +
    'FROM loginaudit la ' +
    'INNER JOIN employee e ON la.user_id = e.id ' +
    'WHERE la.date >= SYSDATE - :lookback_days ' +
    'ORDER BY la.date DESC',
  parameters: [
    {
      name: 'lookback_days',
      type: 'number',
      required: false,
      description: 'Days to look back for login records',
      defaultValue: '90',
    },
  ],
  expectedFields: [
    {
      name: 'user_id',
      type: 'string',
      netsuiteName: 'la.user_id',
      description: 'Employee internal ID',
    },
    {
      name: 'user_name',
      type: 'string',
      netsuiteName: 'firstname || lastname',
      description: 'Employee full name',
    },
    { name: 'login_date', type: 'date', netsuiteName: 'la.date', description: 'Login timestamp' },
    {
      name: 'login_role',
      type: 'string',
      netsuiteName: 'la.role',
      description: 'Role used for this login session',
    },
    {
      name: 'login_status',
      type: 'string',
      netsuiteName: 'la.status',
      description: 'Login outcome status (success/failure)',
    },
    {
      name: 'total_logins',
      type: 'number',
      netsuiteName: 'COUNT(*) OVER',
      description: 'Total logins for this user in the period',
    },
    {
      name: 'first_login',
      type: 'date',
      netsuiteName: 'MIN(la.date) OVER',
      description: 'Earliest login for this user in the period',
    },
    {
      name: 'last_login',
      type: 'date',
      netsuiteName: 'MAX(la.date) OVER',
      description: 'Most recent login for this user in the period',
    },
  ],
  testData: {
    inputParams: { lookback_days: '90' },
  },
};

// ============================================================================
// Export
// ============================================================================

export const NETSUITE_USER_AUDIT_PATHS: ExtractionPath[] = [
  netsuiteUserActivity,
  netsuiteTransactionSummary,
  netsuiteLoginHistory,
];
