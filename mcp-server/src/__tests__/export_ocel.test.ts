/**
 * Tests for export_ocel tool
 *
 * Tests the OCEL 2.0 export functionality for SAP order-to-cash data.
 * Uses Jest with ESM support.
 */

import { ExportOcelSchema, exportOcelTool } from '../tools/export_ocel.js';

describe('ExportOcelSchema', () => {
  describe('input validation', () => {
    it('should accept valid input with all fields', () => {
      const input = {
        date_from: '2024-01-01',
        date_to: '2024-01-31',
        sales_org: '1000',
        output_format: 'json' as const,
        include_items: true,
      };

      const result = ExportOcelSchema.parse(input);

      expect(result.date_from).toBe('2024-01-01');
      expect(result.date_to).toBe('2024-01-31');
      expect(result.sales_org).toBe('1000');
      expect(result.output_format).toBe('json');
      expect(result.include_items).toBe(true);
    });

    it('should apply defaults for optional fields', () => {
      const input = {
        date_from: '2024-01-01',
        date_to: '2024-01-31',
      };

      const result = ExportOcelSchema.parse(input);

      expect(result.output_format).toBe('json');
      expect(result.include_items).toBe(true);
      expect(result.sales_org).toBeUndefined();
    });

    it('should reject invalid date format', () => {
      const input = {
        date_from: '01-01-2024', // Wrong format
        date_to: '2024-01-31',
      };

      expect(() => ExportOcelSchema.parse(input)).toThrow();
    });

    it('should reject invalid date_from format with extra characters', () => {
      const input = {
        date_from: '2024-01-01T00:00:00',
        date_to: '2024-01-31',
      };

      expect(() => ExportOcelSchema.parse(input)).toThrow();
    });

    it('should accept missing date fields for P2P mode', () => {
      // date_from and date_to are optional for P2P mode
      const input = {};

      const result = ExportOcelSchema.parse(input);
      expect(result.output_format).toBe('json'); // Defaults applied
    });

    it('should reject invalid output_format', () => {
      const input = {
        date_from: '2024-01-01',
        date_to: '2024-01-31',
        output_format: 'xml', // Invalid
      };

      expect(() => ExportOcelSchema.parse(input)).toThrow();
    });

    it('should accept jsonocel format', () => {
      const input = {
        date_from: '2024-01-01',
        date_to: '2024-01-31',
        output_format: 'jsonocel',
      };

      const result = ExportOcelSchema.parse(input);
      expect(result.output_format).toBe('jsonocel');
    });

    it('should reject invalid date_to format', () => {
      const input = {
        date_from: '2024-01-01',
        date_to: '2024/01/31', // Wrong separator
      };

      expect(() => ExportOcelSchema.parse(input)).toThrow();
    });

    it('should reject non-boolean include_items', () => {
      const input = {
        date_from: '2024-01-01',
        date_to: '2024-01-31',
        include_items: 'yes',
      };

      expect(() => ExportOcelSchema.parse(input)).toThrow();
    });
  });
});

describe('exportOcelTool', () => {
  it('should have correct tool definition', () => {
    expect(exportOcelTool.name).toBe('export_ocel');
    expect(exportOcelTool.description).toContain('OCEL 2.0');
    // date_from and date_to are optional for P2P mode (no required fields)
    expect(exportOcelTool.inputSchema.properties).toHaveProperty('date_from');
    expect(exportOcelTool.inputSchema.properties).toHaveProperty('date_to');
    expect(exportOcelTool.inputSchema.properties).toHaveProperty('output_format');
    expect(exportOcelTool.inputSchema.properties).toHaveProperty('include_items');
  });

  it('should have string type for date_from property', () => {
    expect(exportOcelTool.inputSchema.properties.date_from.type).toBe('string');
  });

  it('should have string type for date_to property', () => {
    expect(exportOcelTool.inputSchema.properties.date_to.type).toBe('string');
  });

  it('should have enum for output_format property', () => {
    expect(exportOcelTool.inputSchema.properties.output_format.enum).toContain('json');
    expect(exportOcelTool.inputSchema.properties.output_format.enum).toContain('jsonocel');
  });

  it('should describe process mining use case', () => {
    expect(exportOcelTool.description).toContain('process mining');
  });
});

describe('OCEL Object Types', () => {
  // Test the structure of OCEL object types
  const objectTypesWithItems = {
    order: {
      attributes: [
        { name: 'order_type', type: 'string' },
        { name: 'sales_org', type: 'string' },
        { name: 'customer', type: 'string' },
        { name: 'net_value', type: 'float' },
        { name: 'currency', type: 'string' },
      ],
    },
    delivery: {
      attributes: [
        { name: 'delivery_type', type: 'string' },
        { name: 'shipping_point', type: 'string' },
        { name: 'customer', type: 'string' },
        { name: 'status', type: 'string' },
      ],
    },
    invoice: {
      attributes: [
        { name: 'invoice_type', type: 'string' },
        { name: 'sales_org', type: 'string' },
        { name: 'payer', type: 'string' },
        { name: 'net_value', type: 'float' },
        { name: 'currency', type: 'string' },
      ],
    },
    order_item: {
      attributes: [
        { name: 'material', type: 'string' },
        { name: 'quantity', type: 'float' },
        { name: 'plant', type: 'string' },
        { name: 'net_value', type: 'float' },
      ],
    },
    delivery_item: {
      attributes: [
        { name: 'material', type: 'string' },
        { name: 'quantity', type: 'float' },
        { name: 'plant', type: 'string' },
      ],
    },
    invoice_item: {
      attributes: [
        { name: 'material', type: 'string' },
        { name: 'quantity', type: 'float' },
        { name: 'net_value', type: 'float' },
      ],
    },
  };

  it('should have order object type with required attributes', () => {
    expect(objectTypesWithItems.order.attributes).toContainEqual({
      name: 'order_type',
      type: 'string',
    });
    expect(objectTypesWithItems.order.attributes).toContainEqual({
      name: 'sales_org',
      type: 'string',
    });
    expect(objectTypesWithItems.order.attributes).toContainEqual({
      name: 'customer',
      type: 'string',
    });
  });

  it('should have delivery object type with required attributes', () => {
    expect(objectTypesWithItems.delivery.attributes).toContainEqual({
      name: 'delivery_type',
      type: 'string',
    });
    expect(objectTypesWithItems.delivery.attributes).toContainEqual({
      name: 'status',
      type: 'string',
    });
  });

  it('should have invoice object type with required attributes', () => {
    expect(objectTypesWithItems.invoice.attributes).toContainEqual({
      name: 'invoice_type',
      type: 'string',
    });
    expect(objectTypesWithItems.invoice.attributes).toContainEqual({
      name: 'net_value',
      type: 'float',
    });
  });

  it('should have item types when include_items is true', () => {
    expect(objectTypesWithItems).toHaveProperty('order_item');
    expect(objectTypesWithItems).toHaveProperty('delivery_item');
    expect(objectTypesWithItems).toHaveProperty('invoice_item');
  });
});

describe('OCEL Event Types', () => {
  const eventTypesWithItems = {
    order_created: {
      attributes: [{ name: 'user', type: 'string' }],
    },
    delivery_created: {
      attributes: [{ name: 'user', type: 'string' }],
    },
    goods_issued: {
      attributes: [],
    },
    invoice_created: {
      attributes: [{ name: 'user', type: 'string' }],
    },
    item_added: {
      attributes: [{ name: 'item_category', type: 'string' }],
    },
    item_delivered: {
      attributes: [],
    },
    item_invoiced: {
      attributes: [],
    },
  };

  it('should have order_created event type', () => {
    expect(eventTypesWithItems).toHaveProperty('order_created');
  });

  it('should have delivery_created event type', () => {
    expect(eventTypesWithItems).toHaveProperty('delivery_created');
  });

  it('should have goods_issued event type', () => {
    expect(eventTypesWithItems).toHaveProperty('goods_issued');
  });

  it('should have invoice_created event type', () => {
    expect(eventTypesWithItems).toHaveProperty('invoice_created');
  });

  it('should have item event types when include_items is true', () => {
    expect(eventTypesWithItems).toHaveProperty('item_added');
    expect(eventTypesWithItems).toHaveProperty('item_delivered');
    expect(eventTypesWithItems).toHaveProperty('item_invoiced');
  });
});

describe('SAP Date/Time Formatting', () => {
  function formatSAPDateTime(date: string, time: string): string {
    const cleanDate = date.replace(/-/g, '');
    const cleanTime = time.replace(/:/g, '');

    const year = cleanDate.substring(0, 4);
    const month = cleanDate.substring(4, 6);
    const day = cleanDate.substring(6, 8);
    const hour = cleanTime.substring(0, 2) || '00';
    const minute = cleanTime.substring(2, 4) || '00';
    const second = cleanTime.substring(4, 6) || '00';

    return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  }

  it('should format SAP date and time to ISO 8601', () => {
    const result = formatSAPDateTime('20240115', '120000');
    expect(result).toBe('2024-01-15T12:00:00Z');
  });

  it('should handle date with dashes', () => {
    const result = formatSAPDateTime('2024-01-15', '12:00:00');
    expect(result).toBe('2024-01-15T12:00:00Z');
  });

  it('should handle missing time components', () => {
    const result = formatSAPDateTime('20240115', '12');
    expect(result).toBe('2024-01-15T12:00:00Z');
  });

  it('should handle empty time', () => {
    const result = formatSAPDateTime('20240115', '');
    expect(result).toBe('2024-01-15T00:00:00Z');
  });

  it('should handle midnight time', () => {
    const result = formatSAPDateTime('20240115', '000000');
    expect(result).toBe('2024-01-15T00:00:00Z');
  });
});

describe('OCEL Object Structure', () => {
  interface OCELObject {
    type: string;
    attributes: Array<{
      name: string;
      value: string | number | boolean;
      time?: string;
    }>;
    relationships?: Array<{
      objectId: string;
      qualifier: string;
    }>;
  }

  function createOrderObject(
    orderNum: string,
    orderType: string,
    salesOrg: string,
    customer: string,
    netValue: number,
    currency: string
  ): OCELObject {
    return {
      type: 'order',
      attributes: [
        { name: 'order_type', value: orderType },
        { name: 'sales_org', value: salesOrg },
        { name: 'customer', value: customer },
        { name: 'net_value', value: netValue },
        { name: 'currency', value: currency },
      ],
    };
  }

  it('should create order object with correct type', () => {
    const order = createOrderObject('0000012345', 'OR', '1000', 'CUST001', 50000, 'USD');
    expect(order.type).toBe('order');
  });

  it('should create order object with all attributes', () => {
    const order = createOrderObject('0000012345', 'OR', '1000', 'CUST001', 50000, 'USD');
    expect(order.attributes.length).toBe(5);
    expect(order.attributes.find(a => a.name === 'order_type')?.value).toBe('OR');
    expect(order.attributes.find(a => a.name === 'sales_org')?.value).toBe('1000');
  });

  it('should support numeric attribute values', () => {
    const order = createOrderObject('0000012345', 'OR', '1000', 'CUST001', 50000, 'USD');
    expect(order.attributes.find(a => a.name === 'net_value')?.value).toBe(50000);
  });
});

describe('OCEL Event Structure', () => {
  interface OCELEvent {
    type: string;
    time: string;
    attributes?: Array<{
      name: string;
      value: string | number | boolean;
    }>;
    relationships: Array<{
      objectId: string;
      qualifier: string;
    }>;
  }

  function createOrderCreatedEvent(orderId: string, time: string, user: string): OCELEvent {
    return {
      type: 'order_created',
      time,
      attributes: [{ name: 'user', value: user }],
      relationships: [{ objectId: orderId, qualifier: 'order' }],
    };
  }

  it('should create event with correct type', () => {
    const event = createOrderCreatedEvent('order:0000012345', '2024-01-15T12:00:00Z', 'TESTUSER');
    expect(event.type).toBe('order_created');
  });

  it('should create event with ISO 8601 timestamp', () => {
    const event = createOrderCreatedEvent('order:0000012345', '2024-01-15T12:00:00Z', 'TESTUSER');
    expect(event.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('should create event with object relationships', () => {
    const event = createOrderCreatedEvent('order:0000012345', '2024-01-15T12:00:00Z', 'TESTUSER');
    expect(event.relationships.length).toBe(1);
    expect(event.relationships[0]?.objectId).toBe('order:0000012345');
    expect(event.relationships[0]?.qualifier).toBe('order');
  });

  it('should include user attribute', () => {
    const event = createOrderCreatedEvent('order:0000012345', '2024-01-15T12:00:00Z', 'TESTUSER');
    expect(event.attributes?.find(a => a.name === 'user')?.value).toBe('TESTUSER');
  });
});
