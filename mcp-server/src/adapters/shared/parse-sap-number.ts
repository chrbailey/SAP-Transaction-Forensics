/**
 * Shared SAP numeric parser.
 *
 * SAP amounts arrive in locale-dependent forms depending on the extracting
 * user's profile:
 *   - US/standard:  1,234.56   (comma = thousands, period = decimal)
 *   - European:     1.234,56   (period = thousands, comma = decimal)
 * plus SAP's trailing-minus negatives (`1234.56-`) and occasional
 * parenthesized negatives / leading ISO currency codes.
 *
 * The previous `ecc_rfc/mappers.ts` implementation did a blind
 * `replace(/,/g, '.')`, which turned BOTH `1.234,56` and `1,234.56` into
 * `1.234` — a silent 1000x (or larger) error feeding every FI/CO threshold.
 * This parser uses a last-separator-wins rule (the right-most of `.` / `,` is
 * the decimal separator) so both conventions parse correctly.
 *
 * Irreducible ambiguity: a lone grouping like `1,234` (no decimal part) could
 * mean 1234 (US thousands) or 1.234 (EU decimal). Last-separator-wins treats it
 * as a decimal — matching the historical CSV-adapter behavior. Callers that
 * know their source's locale should pass an explicit format in a future change;
 * see the roadmap in docs/GOVERNMENT-READINESS-REVIEW.md.
 */
export function parseSAPNumber(value: string | number): number {
  if (typeof value === 'number') {
    return value;
  }
  if (!value || value.trim() === '') {
    return 0;
  }

  let trimmed = value.trim();

  // Strip leading/trailing ISO currency codes (e.g. "EUR 1.234,56").
  trimmed = trimmed.replace(/[A-Z]{3}\s*/g, '').trim();

  // Normalize negative notations: trailing minus, parentheses, leading minus.
  let negative = false;
  if (trimmed.endsWith('-')) {
    negative = true;
    trimmed = trimmed.slice(0, -1);
  }
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    negative = true;
    trimmed = trimmed.slice(1, -1);
  }
  if (trimmed.startsWith('-')) {
    negative = true;
    trimmed = trimmed.slice(1);
  }

  // Last-separator-wins: whichever of ',' / '.' appears right-most is the
  // decimal separator; the other is grouping and is removed.
  const lastComma = trimmed.lastIndexOf(',');
  const lastPeriod = trimmed.lastIndexOf('.');

  let parsed: number;
  if (lastComma > lastPeriod) {
    // European: comma is the decimal separator.
    parsed = parseFloat(trimmed.replace(/\./g, '').replace(',', '.'));
  } else {
    // US/standard (or no separators): period is the decimal separator.
    parsed = parseFloat(trimmed.replace(/,/g, ''));
  }

  if (isNaN(parsed)) {
    return 0;
  }
  return negative ? -parsed : parsed;
}
