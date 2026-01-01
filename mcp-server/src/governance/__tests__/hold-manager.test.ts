import { HoldManager } from '../hold-manager.js';
import { DEFAULT_GOVERNANCE_CONFIG, ExecuteRequest } from '../types.js';

describe('HoldManager', () => {
  let manager: HoldManager;

  beforeEach(() => {
    manager = new HoldManager(DEFAULT_GOVERNANCE_CONFIG);
  });

  afterEach(() => {
    manager.reset();
  });

  describe('shouldHold - date range', () => {
    it('should not hold for narrow date ranges', () => {
      const request: ExecuteRequest = {
        agentId: 'test',
        frame: '⊘◐◀α',
        tool: 'search_doc_text',
        params: {
          date_from: '2024-01-01',
          date_to: '2024-01-30',
          pattern: 'test',
        },
      };
      expect(manager.shouldHold(request)).toBeNull();
    });

    it('should hold for broad date ranges (>90 days)', () => {
      const request: ExecuteRequest = {
        agentId: 'test',
        frame: '⊘◐◀α',
        tool: 'search_doc_text',
        params: {
          date_from: '2024-01-01',
          date_to: '2024-06-01',
          pattern: 'test',
        },
      };
      const result = manager.shouldHold(request);
      expect(result).not.toBeNull();
      expect(result?.reason).toBe('broad_date_range');
    });
  });

  describe('shouldHold - row limits', () => {
    it('should not hold for normal row limits', () => {
      const request: ExecuteRequest = {
        agentId: 'test',
        frame: '⊘◐◀α',
        tool: 'search_doc_text',
        params: { pattern: 'test', limit: 100 },
      };
      expect(manager.shouldHold(request)).toBeNull();
    });

    it('should hold for high row limits (>500)', () => {
      const request: ExecuteRequest = {
        agentId: 'test',
        frame: '⊘◐◀α',
        tool: 'search_doc_text',
        params: { pattern: 'test', limit: 1000 },
      };
      const result = manager.shouldHold(request);
      expect(result).not.toBeNull();
      expect(result?.reason).toBe('high_row_limit');
    });
  });

  describe('shouldHold - sensitive patterns', () => {
    it('should hold for credit card searches', () => {
      const request: ExecuteRequest = {
        agentId: 'test',
        frame: '⊘◐◀α',
        tool: 'search_doc_text',
        params: { pattern: 'credit card' },
      };
      const result = manager.shouldHold(request);
      expect(result).not.toBeNull();
      expect(result?.reason).toBe('sensitive_text_search');
    });

    it('should hold for SSN searches', () => {
      const request: ExecuteRequest = {
        agentId: 'test',
        frame: '⊘◐◀α',
        tool: 'search_doc_text',
        params: { pattern: 'social security' },
      };
      const result = manager.shouldHold(request);
      expect(result).not.toBeNull();
      expect(result?.reason).toBe('sensitive_text_search');
    });
  });

  describe('createHold', () => {
    it('should create a hold with proper structure', () => {
      const request: ExecuteRequest = {
        agentId: 'test',
        frame: '⊘◐◀α',
        tool: 'search_doc_text',
        params: { pattern: 'test' },
      };

      const hold = manager.createHold(
        request,
        'broad_date_range',
        'medium',
        { days: 120 }
      );

      expect(hold.holdId).toMatch(/^hold_/);
      expect(hold.status).toBe('pending');
      expect(hold.severity).toBe('medium');
      expect(hold.evidence).toEqual({ days: 120 });
    });
  });

  describe('approve and reject', () => {
    it('should approve a pending hold', () => {
      const request: ExecuteRequest = {
        agentId: 'test',
        frame: '⊘◐◀α',
        tool: 'search_doc_text',
        params: { pattern: 'test' },
      };

      const hold = manager.createHold(request, 'broad_date_range', 'medium', {});
      const decision = manager.approve(hold.holdId, 'admin@example.com');

      expect(decision).not.toBeNull();
      expect(decision?.approved).toBe(true);
      expect(decision?.approvedBy).toBe('admin@example.com');
    });

    it('should reject a pending hold', () => {
      const request: ExecuteRequest = {
        agentId: 'test',
        frame: '⊘◐◀α',
        tool: 'search_doc_text',
        params: { pattern: 'test' },
      };

      const hold = manager.createHold(request, 'broad_date_range', 'medium', {});
      const decision = manager.reject(hold.holdId, 'admin@example.com', 'Not allowed');

      expect(decision).not.toBeNull();
      expect(decision?.approved).toBe(false);
      expect(decision?.reason).toBe('Not allowed');
    });

    it('should return null for non-existent hold', () => {
      expect(manager.approve('fake-id', 'admin')).toBeNull();
      expect(manager.reject('fake-id', 'admin', 'reason')).toBeNull();
    });
  });

  describe('listPendingHolds', () => {
    it('should list only pending holds', () => {
      const request: ExecuteRequest = {
        agentId: 'test',
        frame: '⊘◐◀α',
        tool: 'search_doc_text',
        params: { pattern: 'test' },
      };

      const hold1 = manager.createHold(request, 'broad_date_range', 'medium', {});
      const hold2 = manager.createHold(request, 'high_row_limit', 'high', {});
      manager.approve(hold1.holdId, 'admin');

      const pending = manager.listPendingHolds();
      expect(pending).toHaveLength(1);
      expect(pending[0]!.holdId).toBe(hold2.holdId);
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', () => {
      const request: ExecuteRequest = {
        agentId: 'test',
        frame: '⊘◐◀α',
        tool: 'search_doc_text',
        params: { pattern: 'test' },
      };

      const hold1 = manager.createHold(request, 'broad_date_range', 'medium', {});
      const hold2 = manager.createHold(request, 'high_row_limit', 'high', {});
      manager.createHold(request, 'sensitive_text_search', 'critical', {});
      manager.approve(hold1.holdId, 'admin');
      manager.reject(hold2.holdId, 'admin', 'reason');

      const stats = manager.getStats();
      expect(stats.total).toBe(3);
      expect(stats.pending).toBe(1);
      expect(stats.approved).toBe(1);
      expect(stats.rejected).toBe(1);
    });
  });
});
