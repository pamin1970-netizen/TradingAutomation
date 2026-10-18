import type { Effect, OptionLeg, ParsedOrder, Side } from "./types";

// Leg line:   BUY 2 SPY 2026-12-18 500 CALL TO OPEN
//             SELL 2 SPY 12/18/2026 510 P TO CLOSE
const LEG_RE =
  /^(BUY|SELL)\s+(\d+)\s+([A-Z]{1,6})\s+(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\s+(\d+(?:\.\d+)?)\s*(CALL|PUT|C|P)\s+TO\s+(OPEN|CLOSE)$/i;

// Price line: @ 1.25 DEBIT   or   LIMIT 1.25 CREDIT
const PRICE_RE = /^(?:LIMIT|@)\s*(\d+(?:\.\d+)?)\s+(DEBIT|CREDIT)$/i;

export const MAX_LEGS = 4;

export type ParseResult =
  | { ok: true; order: ParsedOrder }
  | { ok: false; errors: string[] };

function normalizeDate(raw: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  let y: string, m: string, d: string;
  if (iso) [, y, m, d] = iso as unknown as [string, string, string, string];
  else if (us) {
    y = us[3];
    m = us[1].padStart(2, "0");
    d = us[2].padStart(2, "0");
  } else return null;
  const candidate = `${y}-${m}-${d}`;
  const date = new Date(`${candidate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== candidate) {
    return null;
  }
  return candidate;
}

/**
 * Deterministic parser for plain-text option orders. Every leg must state
 * TO OPEN or TO CLOSE explicitly: ambiguity is rejected, never guessed.
 */
export function parseOrder(text: string): ParseResult {
  const lines = text
    .split(/\r?\n|;/)
    .map((l) => l.trim().replace(/\s+/g, " "))
    .filter(Boolean);

  const errors: string[] = [];
  const legs: OptionLeg[] = [];
  let price: { value: number; effect: "DEBIT" | "CREDIT" } | null = null;
  let priceLines = 0;

  lines.forEach((line, i) => {
    const p = PRICE_RE.exec(line);
    if (p) {
      priceLines++;
      price = { value: Number(p[1]), effect: p[2].toUpperCase() as "DEBIT" | "CREDIT" };
      return;
    }
    const m = LEG_RE.exec(line);
    if (!m) {
      errors.push(
        `Line ${i + 1}: cannot parse "${line}". Leg example: "BUY 1 SPY 2026-12-18 500 CALL TO OPEN". Price example: "@ 1.25 DEBIT".`,
      );
      return;
    }
    const expiration = normalizeDate(m[4]);
    if (!expiration) {
      errors.push(`Line ${i + 1}: invalid expiration "${m[4]}".`);
      return;
    }
    const strike = Number(m[5]);
    if (!(strike > 0)) {
      errors.push(`Line ${i + 1}: strike must be positive.`);
      return;
    }
    const quantity = Number(m[2]);
    if (!Number.isInteger(quantity) || quantity < 1) {
      errors.push(`Line ${i + 1}: quantity must be a positive whole number.`);
      return;
    }
    legs.push({
      underlying: m[3].toUpperCase(),
      expiration,
      strike,
      optionType: m[6].toUpperCase().startsWith("C") ? "CALL" : "PUT",
      side: m[1].toUpperCase() as Side,
      effect: m[7].toUpperCase() as Effect,
      quantity,
    });
  });

  if (legs.length === 0) errors.push("No option legs found.");
  if (legs.length > MAX_LEGS) errors.push(`Too many legs: ${legs.length}. Max is ${MAX_LEGS}.`);
  if (new Set(legs.map((l) => l.underlying)).size > 1) {
    errors.push("All legs must share one underlying.");
  }
  if (priceLines !== 1 || price === null) {
    errors.push('Exactly one net price line is required, e.g. "@ 1.25 DEBIT".');
  } else if (!((price as { value: number }).value > 0)) {
    errors.push("Net price must be positive. Use DEBIT or CREDIT to set direction.");
  }

  if (errors.length > 0 || price === null) return { ok: false, errors };
  const p = price as { value: number; effect: "DEBIT" | "CREDIT" };
  return {
    ok: true,
    order: { legs, price: p.value, priceEffect: p.effect, timeInForce: "Day" },
  };
}

