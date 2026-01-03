// ═══════════════════════════════════════════════════════════════════════════
// REFERENCE PROCESS MODELS
// Pre-built process models for SAP O2C and P2P conformance checking
// ═══════════════════════════════════════════════════════════════════════════

import { ReferenceModel } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// ORDER-TO-CASH (O2C) MODELS
// SAP SD (Sales & Distribution) process models
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Simple O2C Model
 * Basic order-to-cash flow without optional steps
 */
export const O2C_SIMPLE_MODEL: ReferenceModel = {
  id: 'o2c-simple',
  name: 'O2C Simple Model',
  version: '1.0',
  processType: 'O2C',
  description: 'Basic Order-to-Cash: Order → Delivery → Goods Issue → Invoice',
  activities: [
    {
      id: 'order_created',
      name: 'Sales Order Created',
      required: true,
      order: 1,
      sapTransactions: ['VA01', 'VA02'],
    },
    {
      id: 'delivery_created',
      name: 'Delivery Created',
      required: true,
      order: 2,
      allowedPredecessors: ['order_created'],
      sapTransactions: ['VL01N', 'VL02N'],
    },
    {
      id: 'goods_issued',
      name: 'Goods Issued',
      required: true,
      order: 3,
      allowedPredecessors: ['delivery_created'],
      sapTransactions: ['VL02N'],
    },
    {
      id: 'invoice_created',
      name: 'Invoice Created',
      required: true,
      order: 4,
      allowedPredecessors: ['goods_issued'],
      sapTransactions: ['VF01', 'VF02'],
    },
  ],
  activityMappings: {
    // SAP document categories
    C: 'order_created',
    J: 'delivery_created',
    M: 'invoice_created',
    // Common names
    order: 'order_created',
    sales: 'order_created',
    order_created: 'order_created',
    delivery: 'delivery_created',
    delivery_created: 'delivery_created',
    goods_issued: 'goods_issued',
    gi: 'goods_issued',
    invoice: 'invoice_created',
    invoice_created: 'invoice_created',
    billing: 'invoice_created',
  },
};

/**
 * Detailed O2C Model
 * Full order-to-cash flow with optional steps
 */
export const O2C_DETAILED_MODEL: ReferenceModel = {
  id: 'o2c-detailed',
  name: 'O2C Detailed Model',
  version: '1.0',
  processType: 'O2C',
  description: 'Full Order-to-Cash including credit check, picking, packing, and payment',
  activities: [
    {
      id: 'order_created',
      name: 'Sales Order Created',
      required: true,
      order: 1,
      sapTransactions: ['VA01'],
    },
    {
      id: 'credit_check',
      name: 'Credit Check',
      required: false,
      order: 2,
      allowedPredecessors: ['order_created'],
      sapTransactions: ['FD32', 'VKM1'],
    },
    {
      id: 'order_confirmed',
      name: 'Order Confirmed',
      required: false,
      order: 3,
      allowedPredecessors: ['order_created', 'credit_check'],
    },
    {
      id: 'delivery_created',
      name: 'Delivery Created',
      required: true,
      order: 4,
      allowedPredecessors: ['order_created', 'order_confirmed'],
      sapTransactions: ['VL01N'],
    },
    {
      id: 'picking',
      name: 'Picking Completed',
      required: false,
      order: 5,
      allowedPredecessors: ['delivery_created'],
      sapTransactions: ['LT03'],
    },
    {
      id: 'packing',
      name: 'Packing Completed',
      required: false,
      order: 6,
      allowedPredecessors: ['picking', 'delivery_created'],
      sapTransactions: ['VLPOD'],
    },
    {
      id: 'goods_issued',
      name: 'Goods Issued',
      required: true,
      order: 7,
      allowedPredecessors: ['packing', 'picking', 'delivery_created'],
      sapTransactions: ['VL02N'],
    },
    {
      id: 'invoice_created',
      name: 'Invoice Created',
      required: true,
      order: 8,
      allowedPredecessors: ['goods_issued'],
      sapTransactions: ['VF01'],
    },
    {
      id: 'payment_received',
      name: 'Payment Received',
      required: false,
      order: 9,
      allowedPredecessors: ['invoice_created'],
      sapTransactions: ['F-28', 'F-32'],
    },
  ],
  activityMappings: {
    ...O2C_SIMPLE_MODEL.activityMappings,
    credit_check: 'credit_check',
    credit: 'credit_check',
    order_confirmed: 'order_confirmed',
    confirmed: 'order_confirmed',
    picking: 'picking',
    pick: 'picking',
    packing: 'packing',
    pack: 'packing',
    payment: 'payment_received',
    payment_received: 'payment_received',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// PURCHASE-TO-PAY (P2P) MODELS
// SAP MM (Materials Management) process models
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Simple P2P Model
 * Basic purchase-to-pay flow
 */
export const P2P_SIMPLE_MODEL: ReferenceModel = {
  id: 'p2p-simple',
  name: 'P2P Simple Model',
  version: '1.0',
  processType: 'P2P',
  description: 'Basic Purchase-to-Pay: PO → Goods Receipt → Invoice → Payment',
  activities: [
    {
      id: 'po_created',
      name: 'Purchase Order Created',
      required: true,
      order: 1,
      sapTransactions: ['ME21N', 'ME22N'],
    },
    {
      id: 'goods_receipt',
      name: 'Goods Receipt',
      required: true,
      order: 2,
      allowedPredecessors: ['po_created'],
      sapTransactions: ['MIGO', 'MB01'],
    },
    {
      id: 'invoice_receipt',
      name: 'Invoice Receipt',
      required: true,
      order: 3,
      allowedPredecessors: ['goods_receipt'],
      sapTransactions: ['MIRO', 'MIR7'],
    },
    {
      id: 'invoice_cleared',
      name: 'Invoice Cleared',
      required: true,
      order: 4,
      allowedPredecessors: ['invoice_receipt'],
      sapTransactions: ['F-53', 'F110'],
    },
  ],
  activityMappings: {
    // BPI Challenge 2019 activities
    'Create Purchase Order Item': 'po_created',
    'Record Goods Receipt': 'goods_receipt',
    'Record Invoice Receipt': 'invoice_receipt',
    'Clear Invoice': 'invoice_cleared',
    // Service entry = goods receipt equivalent
    'Record Service Entry Sheet': 'goods_receipt',
    // Vendor invoice activities
    'Vendor creates invoice': 'invoice_receipt',
    'Vendor creates debit memo': 'invoice_receipt',
    // SRM activities (map to PO for simple model)
    'SRM: Created': 'po_created',
    'SRM: In Transfer to Execution Syst.': 'po_created',
    'SRM: Complete': 'po_created',
    'SRM: Document Completed': 'po_created',
    'SRM: Ordered': 'po_created',
    'SRM: Change was Transmitted': 'po_created',
    'SRM: Awaiting Approval': 'po_created',
    // Common variations
    po_created: 'po_created',
    purchase_order: 'po_created',
    goods_receipt: 'goods_receipt',
    gr: 'goods_receipt',
    invoice_receipt: 'invoice_receipt',
    invoice: 'invoice_receipt',
    invoice_cleared: 'invoice_cleared',
    payment: 'invoice_cleared',
  },
};

/**
 * Detailed P2P Model with SRM
 * Full purchase-to-pay flow including requisition and approval
 */
export const P2P_DETAILED_MODEL: ReferenceModel = {
  id: 'p2p-detailed',
  name: 'P2P Detailed Model with SRM',
  version: '1.0',
  processType: 'P2P',
  description: 'Full P2P: Requisition → Approval → PO → GR → Invoice Verification → Payment',
  activities: [
    {
      id: 'pr_created',
      name: 'Purchase Requisition Created',
      required: false,
      order: 1,
      sapTransactions: ['ME51N', 'ME52N'],
    },
    {
      id: 'srm_created',
      name: 'SRM Shopping Cart Created',
      required: false,
      order: 2,
      allowedPredecessors: ['pr_created'],
    },
    {
      id: 'approval_pending',
      name: 'Awaiting Approval',
      required: false,
      order: 3,
      allowedPredecessors: ['pr_created', 'srm_created'],
    },
    {
      id: 'approval_complete',
      name: 'Approval Complete',
      required: false,
      order: 4,
      allowedPredecessors: ['approval_pending'],
    },
    {
      id: 'po_created',
      name: 'Purchase Order Created',
      required: true,
      order: 5,
      allowedPredecessors: ['pr_created', 'approval_complete', 'srm_created'],
      sapTransactions: ['ME21N'],
    },
    {
      id: 'order_confirmed',
      name: 'Order Confirmation Received',
      required: false,
      order: 6,
      allowedPredecessors: ['po_created'],
    },
    {
      id: 'goods_receipt',
      name: 'Goods Receipt',
      required: true,
      order: 7,
      allowedPredecessors: ['po_created', 'order_confirmed'],
      sapTransactions: ['MIGO'],
    },
    {
      id: 'invoice_receipt',
      name: 'Invoice Receipt',
      required: true,
      order: 8,
      allowedPredecessors: ['goods_receipt', 'po_created'],
      sapTransactions: ['MIRO'],
    },
    {
      id: 'three_way_match',
      name: '3-Way Match Verification',
      required: false,
      order: 9,
      allowedPredecessors: ['invoice_receipt'],
    },
    {
      id: 'invoice_cleared',
      name: 'Invoice Cleared/Payment',
      required: true,
      order: 10,
      allowedPredecessors: ['invoice_receipt', 'three_way_match'],
      sapTransactions: ['F-53', 'F110'],
    },
  ],
  activityMappings: {
    // BPI Challenge 2019 activities (exact matches)
    'Create Purchase Requisition Item': 'pr_created',
    'Create Purchase Order Item': 'po_created',
    'Record Goods Receipt': 'goods_receipt',
    'Record Invoice Receipt': 'invoice_receipt',
    'Vendor creates invoice': 'invoice_receipt',
    'Clear Invoice': 'invoice_cleared',
    'SRM: Created': 'srm_created',
    'SRM: Complete': 'approval_complete',
    'SRM: Awaiting Approval': 'approval_pending',
    'SRM: Document Completed': 'approval_complete',
    'SRM: In Transfer to Execution Syst.': 'po_created',
    'Receive Order Confirmation': 'order_confirmed',
    // Service entry activities
    'Record Service Entry Sheet': 'goods_receipt', // Service equivalent of GR
    // SRM additional activities
    'SRM: Ordered': 'srm_created',
    'SRM: Change was Transmitted': 'srm_created',
    // Vendor activities
    'Vendor creates debit memo': 'invoice_receipt',
    // Cancel/delete activities (map to special handling)
    'Cancel Goods Receipt': 'goods_receipt_cancel',
    'Cancel Invoice Receipt': 'invoice_receipt_cancel',
    'Delete Purchase Order Item': 'po_deleted',
    // Change activities
    'Change Quantity': 'change_quantity',
    'Change Price': 'change_price',
    'Change Approval for Purchase Order': 'approval_pending',
    // Common variations
    po_created: 'po_created',
    purchase_order: 'po_created',
    goods_receipt: 'goods_receipt',
    gr: 'goods_receipt',
    invoice_receipt: 'invoice_receipt',
    invoice: 'invoice_receipt',
    invoice_cleared: 'invoice_cleared',
    payment: 'invoice_cleared',
    pr_created: 'pr_created',
    requisition: 'pr_created',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// MODEL REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * All available reference models
 */
export const REFERENCE_MODELS: Record<string, ReferenceModel> = {
  'o2c-simple': O2C_SIMPLE_MODEL,
  'o2c-detailed': O2C_DETAILED_MODEL,
  'p2p-simple': P2P_SIMPLE_MODEL,
  'p2p-detailed': P2P_DETAILED_MODEL,
};

/**
 * Get default model for a process type
 */
export function getDefaultModel(processType: 'O2C' | 'P2P'): ReferenceModel {
  return processType === 'O2C' ? O2C_SIMPLE_MODEL : P2P_SIMPLE_MODEL;
}

/**
 * Get model by ID
 */
export function getModelById(modelId: string): ReferenceModel | undefined {
  return REFERENCE_MODELS[modelId];
}

/**
 * List available models for a process type
 */
export function listModels(processType?: 'O2C' | 'P2P'): ReferenceModel[] {
  const models = Object.values(REFERENCE_MODELS);
  if (processType) {
    return models.filter(m => m.processType === processType);
  }
  return models;
}
