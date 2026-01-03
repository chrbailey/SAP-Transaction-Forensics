/**
 * Tests for ask_process tool
 *
 * Tests the natural language query tool for SAP process data.
 * Uses Jest with ESM support.
 */

import { AskProcessSchema, askProcessTool } from '../tools/ask_process.js';

describe('AskProcessSchema', () => {
  describe('input validation', () => {
    it('should accept valid input with all fields', () => {
      const input = {
        question: 'Why are orders from sales org 1000 taking longer?',
        include_patterns: true,
        include_sample_data: false,
      };

      const result = AskProcessSchema.parse(input);

      expect(result.question).toBe(input.question);
      expect(result.include_patterns).toBe(true);
      expect(result.include_sample_data).toBe(false);
    });

    it('should apply defaults for optional fields', () => {
      const input = {
        question: 'What patterns correlate with delivery delays?',
      };

      const result = AskProcessSchema.parse(input);

      expect(result.include_patterns).toBe(true);
      expect(result.include_sample_data).toBe(true);
    });

    it('should reject questions shorter than 10 characters', () => {
      const input = { question: 'Why?' };

      expect(() => AskProcessSchema.parse(input)).toThrow();
    });

    it('should reject empty questions', () => {
      const input = { question: '' };

      expect(() => AskProcessSchema.parse(input)).toThrow();
    });

    it('should reject missing question field', () => {
      const input = {};

      expect(() => AskProcessSchema.parse(input)).toThrow();
    });

    it('should reject non-string question', () => {
      const input = { question: 12345 };

      expect(() => AskProcessSchema.parse(input)).toThrow();
    });

    it('should reject non-boolean include_patterns', () => {
      const input = {
        question: 'What is the average order processing time?',
        include_patterns: 'yes',
      };

      expect(() => AskProcessSchema.parse(input)).toThrow();
    });

    it('should accept exactly 10 character question', () => {
      const input = { question: '1234567890' };

      const result = AskProcessSchema.parse(input);
      expect(result.question).toBe('1234567890');
    });

    it('should accept very long questions', () => {
      const longQuestion = 'Why are ' + 'orders '.repeat(100) + 'delayed?';
      const input = { question: longQuestion };

      const result = AskProcessSchema.parse(input);
      expect(result.question).toBe(longQuestion);
    });
  });
});

describe('askProcessTool', () => {
  it('should have correct tool definition', () => {
    expect(askProcessTool.name).toBe('ask_process');
    expect(askProcessTool.description).toContain('natural language');
    expect(askProcessTool.inputSchema.required).toContain('question');
    expect(askProcessTool.inputSchema.properties).toHaveProperty('question');
    expect(askProcessTool.inputSchema.properties).toHaveProperty('include_patterns');
    expect(askProcessTool.inputSchema.properties).toHaveProperty('include_sample_data');
  });

  it('should have string type for question property', () => {
    expect(askProcessTool.inputSchema.properties.question.type).toBe('string');
  });

  it('should have boolean type for include_patterns property', () => {
    expect(askProcessTool.inputSchema.properties.include_patterns.type).toBe('boolean');
  });

  it('should have boolean type for include_sample_data property', () => {
    expect(askProcessTool.inputSchema.properties.include_sample_data.type).toBe('boolean');
  });

  it('should include example questions in description', () => {
    expect(askProcessTool.description).toContain('Example questions');
  });
});

describe('Keyword extraction logic', () => {
  // Test the keyword extraction patterns used in ask_process
  const stopWords = new Set([
    'what',
    'why',
    'how',
    'when',
    'where',
    'which',
    'who',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'the',
    'a',
    'an',
    'and',
    'or',
    'but',
    'in',
    'on',
    'at',
    'to',
    'for',
    'of',
    'with',
    'by',
    'from',
    'as',
    'about',
    'into',
    'through',
    'our',
    'my',
    'their',
    'this',
    'that',
    'these',
    'those',
    'most',
    'more',
    'many',
    'much',
    'some',
    'any',
    'all',
  ]);

  function extractKeywords(question: string): string[] {
    const words = question
      .toLowerCase()
      .replace(/[?.,!]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));

    return [...new Set(words)].slice(0, 3);
  }

  it('should extract meaningful keywords from question', () => {
    const question = 'Which customers have credit holds on their orders?';
    const keywords = extractKeywords(question);

    expect(keywords).toContain('customers');
    expect(keywords).toContain('credit');
    expect(keywords).toContain('holds');
  });

  it('should filter out stop words', () => {
    const question = 'What is the average processing time?';
    const keywords = extractKeywords(question);

    expect(keywords).not.toContain('what');
    expect(keywords).not.toContain('the');
    expect(keywords).toContain('average');
    expect(keywords).toContain('processing');
  });

  it('should filter out short words', () => {
    const question = 'Why are SO items late?';
    const keywords = extractKeywords(question);

    expect(keywords).not.toContain('are');
    expect(keywords).not.toContain('SO');
    expect(keywords).toContain('items');
    expect(keywords).toContain('late');
  });

  it('should return max 3 keywords', () => {
    const question = 'Which customers have credit holds and delivery delays on their sales orders?';
    const keywords = extractKeywords(question);

    expect(keywords.length).toBeLessThanOrEqual(3);
  });

  it('should handle empty question', () => {
    const keywords = extractKeywords('');
    expect(keywords).toEqual([]);
  });

  it('should handle question with only stop words', () => {
    const question = 'What is the for this?';
    const keywords = extractKeywords(question);

    // Only 'this' passes length check but is a stop word
    expect(keywords).toEqual([]);
  });

  it('should remove punctuation before filtering', () => {
    const question = 'Why are orders delayed? What is happening!';
    const keywords = extractKeywords(question);

    expect(keywords).toContain('orders');
    expect(keywords).toContain('delayed');
    expect(keywords).toContain('happening');
  });
});

describe('Process Query Context Building', () => {
  // Test the context structure that would be passed to LLM
  interface ProcessQueryContext {
    orderCount: number;
    deliveryCount: number;
    invoiceCount: number;
    dateRange: {
      from: string;
      to: string;
    };
    salesOrgs: string[];
    patterns?: Array<{
      name: string;
      description: string;
      occurrence: number;
      confidence: string;
    }>;
  }

  function buildMockContext(includePatterns: boolean): ProcessQueryContext {
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const context: ProcessQueryContext = {
      orderCount: 1500,
      deliveryCount: 1200,
      invoiceCount: 1100,
      dateRange: {
        from: oneYearAgo.toISOString().split('T')[0]!,
        to: now.toISOString().split('T')[0]!,
      },
      salesOrgs: ['1000', '2000'],
    };

    if (includePatterns) {
      context.patterns = [
        {
          name: 'Credit Hold Escalation',
          description: 'Orders with CREDIT HOLD have 3.2x longer cycles',
          occurrence: 234,
          confidence: 'HIGH',
        },
      ];
    }

    return context;
  }

  it('should include basic statistics in context', () => {
    const context = buildMockContext(false);

    expect(context.orderCount).toBe(1500);
    expect(context.deliveryCount).toBe(1200);
    expect(context.invoiceCount).toBe(1100);
  });

  it('should include date range in context', () => {
    const context = buildMockContext(false);

    expect(context.dateRange).toHaveProperty('from');
    expect(context.dateRange).toHaveProperty('to');
    expect(context.dateRange.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(context.dateRange.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should include sales orgs in context', () => {
    const context = buildMockContext(false);

    expect(context.salesOrgs).toContain('1000');
    expect(context.salesOrgs).toContain('2000');
  });

  it('should include patterns when requested', () => {
    const context = buildMockContext(true);

    expect(context.patterns).toBeDefined();
    expect(context.patterns?.length).toBeGreaterThan(0);
    expect(context.patterns?.[0]).toHaveProperty('name');
    expect(context.patterns?.[0]).toHaveProperty('description');
    expect(context.patterns?.[0]).toHaveProperty('occurrence');
    expect(context.patterns?.[0]).toHaveProperty('confidence');
  });

  it('should exclude patterns when not requested', () => {
    const context = buildMockContext(false);

    expect(context.patterns).toBeUndefined();
  });
});
