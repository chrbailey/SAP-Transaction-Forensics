import { parseFrame, quickValidate, defaultSAPFrame, validateFrame } from '../validator.js';

describe('Frame Validator', () => {
  describe('parseFrame', () => {
    it('should parse a valid frame', () => {
      const frame = parseFrame('⊕◐◀α');
      expect(frame.raw).toBe('⊕◐◀α');
      expect(frame.valid).toBe(true);
      expect(frame.mode?.name).toBe('strict');
      expect(frame.domain?.name).toBe('operational');
      expect(frame.action?.name).toBe('retrieve');
      expect(frame.entity?.name).toBe('primary');
    });

    it('should handle neutral mode', () => {
      const frame = parseFrame('⊘◊▲β');
      expect(frame.mode?.name).toBe('neutral');
      expect(frame.domain?.name).toBe('financial');
      expect(frame.action?.name).toBe('analyze');
      expect(frame.entity?.name).toBe('secondary');
    });

    it('should detect forbidden mode', () => {
      const frame = parseFrame('⊗◐◀α');
      expect(frame.mode?.name).toBe('forbidden');
    });

    it('should handle unknown symbols', () => {
      const frame = parseFrame('⊕◐◀αXY');
      expect(frame.parseErrors.some(e => e.includes('Unknown'))).toBe(true);
    });
  });

  describe('quickValidate', () => {
    it('should validate a proper frame', () => {
      const result = quickValidate('⊘◐◀α');
      expect(result.valid).toBe(true);
      expect(result.blocked).toBe(false);
    });

    it('should block forbidden mode', () => {
      const result = quickValidate('⊗◐◀α');
      expect(result.valid).toBe(true);
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('Forbidden');
    });

    it('should reject empty frame', () => {
      const result = quickValidate('');
      expect(result.valid).toBe(false);
    });

    it('should reject frame without mode', () => {
      const result = quickValidate('◐◀α');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Mode');
    });
  });

  describe('validateFrame', () => {
    it('should produce validation report', () => {
      const frame = parseFrame('⊕◐◀α');
      const report = validateFrame(frame);
      expect(report.valid).toBe(true);
      const errors = report.results.filter(r => r.severity === 'error' && !r.passed);
      expect(errors).toHaveLength(0);
    });

    it('should report missing components', () => {
      const frame = parseFrame('⊕');
      const report = validateFrame(frame);
      expect(report.valid).toBe(false);
      // Check that parse errors include domain
      expect(frame.parseErrors.some(e => e.toLowerCase().includes('domain'))).toBe(true);
    });

    it('should flag unknown symbols in parse errors', () => {
      const frame = parseFrame('⊕◐◀αXYZ');
      expect(frame.parseErrors.some(w => w.includes('Unknown'))).toBe(true);
    });
  });

  describe('defaultSAPFrame', () => {
    it('should generate frame for search_doc_text', () => {
      const frame = defaultSAPFrame('search_doc_text');
      expect(frame).toContain('◐'); // operational
      expect(frame).toContain('▲'); // analyze
    });

    it('should generate frame for get_sales_doc_header', () => {
      const frame = defaultSAPFrame('get_sales_doc_header');
      expect(frame).toContain('◊'); // financial
      expect(frame).toContain('◀'); // retrieve
    });

    it('should generate frame for get_master_stub', () => {
      const frame = defaultSAPFrame('get_master_stub');
      expect(frame).toContain('●'); // validate
    });

    it('should respect mode parameter', () => {
      const strict = defaultSAPFrame('search_doc_text', 'strict');
      const flexible = defaultSAPFrame('search_doc_text', 'flexible');
      expect(strict).toContain('⊕');
      expect(flexible).toContain('⊖');
    });

    it('should default to neutral for unknown tools', () => {
      const frame = defaultSAPFrame('unknown_tool');
      expect(frame).toContain('⊘');
    });
  });
});
