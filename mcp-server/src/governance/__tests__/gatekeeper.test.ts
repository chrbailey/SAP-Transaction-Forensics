import { Gatekeeper } from '../gatekeeper.js';

describe('Gatekeeper', () => {
  let gatekeeper: Gatekeeper;

  beforeEach(() => {
    gatekeeper = new Gatekeeper();
    gatekeeper.reset();
  });

  describe('execute - basic flow', () => {
    it('should allow valid requests', () => {
      const result = gatekeeper.execute({
        agentId: 'test',
        frame: '⊘◐◀α',
        tool: 'get_doc_text',
        params: { doc_number: '123' },
      });

      expect(result.success).toBe(true);
      expect(result.allowed).toBe(true);
      expect(result.held).toBe(false);
    });

    it('should block halted agents', () => {
      gatekeeper.haltAgent('test', 'security concern');

      const result = gatekeeper.execute({
        agentId: 'test',
        frame: '⊘◐◀α',
        tool: 'get_doc_text',
        params: { doc_number: '123' },
      });

      expect(result.success).toBe(false);
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('halted');
    });

    it('should block forbidden frames', () => {
      const result = gatekeeper.execute({
        agentId: 'test',
        frame: '⊗◐◀α',
        tool: 'get_doc_text',
        params: { doc_number: '123' },
      });

      expect(result.success).toBe(false);
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('Forbidden');
    });
  });

  describe('execute - holds', () => {
    it('should hold broad date range requests', () => {
      const result = gatekeeper.execute({
        agentId: 'test',
        frame: '⊘◐◀α',
        tool: 'search_doc_text',
        params: {
          pattern: 'test',
          date_from: '2024-01-01',
          date_to: '2024-12-31',
        },
      });

      expect(result.held).toBe(true);
      expect(result.holdRequest).toBeDefined();
      expect(result.holdRequest?.reason).toBe('broad_date_range');
    });

    it('should bypass hold when approved', () => {
      // First request gets held
      const result1 = gatekeeper.execute({
        agentId: 'test',
        frame: '⊘◐◀α',
        tool: 'search_doc_text',
        params: {
          pattern: 'test',
          date_from: '2024-01-01',
          date_to: '2024-12-31',
        },
      });

      expect(result1.held).toBe(true);

      // Approve the hold
      const approved = gatekeeper.approveHold(
        result1.holdRequest!.holdId,
        'admin@example.com'
      );

      expect(approved).not.toBeNull();
      expect(approved?.allowed).toBe(true);
    });
  });

  describe('precheck', () => {
    it('should report what would happen without executing', () => {
      const result = gatekeeper.precheck({
        agentId: 'test',
        frame: '⊘◐◀α',
        tool: 'get_doc_text',
        params: { doc_number: '123' },
      });

      expect(result.wouldAllow).toBe(true);
      expect(result.wouldHold).toBe(false);
    });

    it('should detect potential holds', () => {
      const result = gatekeeper.precheck({
        agentId: 'test',
        frame: '⊘◐◀α',
        tool: 'search_doc_text',
        params: {
          pattern: 'test',
          limit: 1000,
        },
      });

      expect(result.wouldAllow).toBe(false);
      expect(result.wouldHold).toBe(true);
    });
  });

  describe('agent control', () => {
    it('should halt and resume agents', () => {
      gatekeeper.haltAgent('test', 'testing');
      expect(gatekeeper.getAgentStatus('test').isAllowed).toBe(false);

      gatekeeper.resumeAgent('test');
      expect(gatekeeper.getAgentStatus('test').isAllowed).toBe(true);
    });

    it('should provide agent status with halt reason', () => {
      gatekeeper.haltAgent('test', 'suspicious activity');
      const status = gatekeeper.getAgentStatus('test');

      expect(status.state).toBe('open');
      expect(status.haltReason).toBe('suspicious activity');
    });
  });

  describe('holds management', () => {
    it('should list pending holds', () => {
      gatekeeper.execute({
        agentId: 'test',
        frame: '⊘◐◀α',
        tool: 'search_doc_text',
        params: { pattern: 'credit card' },
      });

      const holds = gatekeeper.listHolds();
      expect(holds.length).toBeGreaterThan(0);
    });

    it('should reject holds', () => {
      const result = gatekeeper.execute({
        agentId: 'test',
        frame: '⊘◐◀α',
        tool: 'search_doc_text',
        params: { pattern: 'credit card' },
      });

      const rejected = gatekeeper.rejectHold(
        result.holdRequest!.holdId,
        'admin@example.com',
        'Not authorized'
      );

      expect(rejected).toBe(true);
    });
  });

  describe('stats and audit', () => {
    it('should provide governance statistics', () => {
      // Generate some activity
      gatekeeper.execute({
        agentId: 'test',
        frame: '⊘◐◀α',
        tool: 'get_doc_text',
        params: { doc_number: '123' },
      });

      const stats = gatekeeper.getStats();
      expect(stats.auditEntries).toBeGreaterThan(0);
    });

    it('should track audit log', () => {
      gatekeeper.execute({
        agentId: 'test',
        frame: '⊘◐◀α',
        tool: 'get_doc_text',
        params: { doc_number: '123' },
      });

      const audit = gatekeeper.getAuditLog();
      expect(audit.length).toBeGreaterThan(0);
      expect(audit[0]!.tool).toBe('get_doc_text');
    });
  });

  describe('default frame generation', () => {
    it('should use default frame when none provided', () => {
      const result = gatekeeper.execute({
        agentId: 'test',
        frame: '',
        tool: 'get_doc_text',
        params: { doc_number: '123' },
      });

      expect(result.success).toBe(true);
    });
  });
});
