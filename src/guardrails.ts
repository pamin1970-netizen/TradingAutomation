import type { ParsedOrder } from "./types";

export interface Limits {
  maxContracts: number; // total contracts across legs
  maxOrderValue: number; // USD notional per order
  dailyCap: number; // USD notional per UTC day (in-memory, resets on restart)
  allowlist: Set<string> | null; // null = any underlying
}

export function limitsFromEnv(env: Record<string, string | undefined> = process.env): Limits {
  const num = (k: string, d: number) => {
    const v = env[k] === undefined ? d : Number(env[k]);
    if (!(v > 0)) throw new Error(`${k} must be a positive number`);
    return v;
  };
  const list = env.SYMBOL_ALLOWLIST?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  return {
    maxContracts: num("MAX_CONTRACTS", 10),
    maxOrderValue: num("MAX_ORDER_VALUE_USD", 500),
    dailyCap: num("DAILY_CAP_USD", 2000),
    allowlist: list && list.length > 0 ? new Set(list) : null,
  };
}

/** Option contracts are 100 shares. Notional = net price x 100 x largest leg quantity. */
export function notionalUsd(order: ParsedOrder): number {
  const maxQty = Math.max(...order.legs.map((l) => l.quantity));
  return Math.round(order.price * 100 * maxQty * 100) / 100;
}

export function checkGuardrails(order: ParsedOrder, limits: Limits, spentToday: number): string[] {
  const errors: string[] = [];
  const contracts = order.legs.reduce((s, l) => s + l.quantity, 0);
  if (contracts > limits.maxContracts) {
    errors.push(`Total contracts ${contracts} exceeds max ${limits.maxContracts}.`);
  }
  const notional = notionalUsd(order);
  if (notional > limits.maxOrderValue) {
    errors.push(`Order value $${notional} exceeds max $${limits.maxOrderValue}.`);
  }
  if (spentToday + notional > limits.dailyCap) {
    errors.push(`Daily cap $${limits.dailyCap} would be exceeded (spent today $${spentToday}).`);
  }
  if (limits.allowlist) {
    for (const leg of order.legs) {
      if (!limits.allowlist.has(leg.underlying)) {
        errors.push(`Underlying ${leg.underlying} is not in the symbol allowlist.`);
      }
    }
  }
  return errors;
}

