import { calculatePromptScores } from '/Volumes/OWC drive/Dev/prompt-optimizer/src/utils/metrics.js';

const good = `# Code Review Assistant

## Role
You are an expert code reviewer with 10+ years of TypeScript experience.

## Task
Review the provided code for security vulnerabilities and performance issues.

## Output Format
Return JSON: { "issues": [{ "severity": "high|medium|low", "line": 42, "description": "..." }] }

## Constraints
- Focus on functional issues only
- Limit to 5 most critical issues`;

const bad = 'review this code and tell me if there are any problems with it or whatever. make it better somehow. thanks';

const simple = 'Write a function to sort an array';

console.log('GOOD prompt scores:', calculatePromptScores(good));
console.log('BAD prompt scores:', calculatePromptScores(bad));
console.log('SIMPLE prompt scores:', calculatePromptScores(simple));
