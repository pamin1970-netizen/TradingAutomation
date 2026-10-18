import { describe, expect, test } from "bun:test";
import { checkGuardrails, notionalUsd, type Limits } from "./guardrails";
import { consumePreview, createPreview } from "./approvals";
import type { ParsedOrder } from "./types";

const limits: Limits = { maxContracts: 10, maxOrderValue: 500, dailyCap: 2000, allowlist: new Set(["SPY"]) };
const order = (price: number, qty = 1, underlying = "SPY"): ParsedOrder => ({
  legs: [{ underlying, expiration: "2026-12-18", strike: 500, optionType: "CALL", side: "BUY", effect: "OPEN", quantity: qty }],
  price,
  priceEffect: "DEBIT",
  timeInForce: "Day",
});

describe("guardrails", () => {
  test("notional = price x 100 x max qty", () => {
    expect(notionalUsd(order(1.25, 2))).toBe(250);
  });
  test("blocks order over max value, not allowlisted, or over daily cap", () => {
    expect(checkGuardrails(order(6), limits, 0).length).toBeGreaterThan(0);
    expect(checkGuardrails(order(1, 1, "TSLA"), limits, 0).join()).toContain("allowlist");
    expect(checkGuardrails(order(4), limits, 1900).join()).toContain("Daily cap");
  });
  test("allows a valid order", () => {
    expect(checkGuardrails(order(1.25), limits, 0)).toEqual([]);
  });
});

describe("approvals", () => {
  test("single use", () => {
    const p = createPreview("tastytrade", order(1));
    expect(consumePreview(p.id, "tastytrade").ok).toBe(true);
    expect(consumePreview(p.id, "tastytrade").ok).toBe(false);
  });
  test("expires after 60s", () => {
    const p = createPreview("tastytrade", order(1), 0);
    expect(consumePreview(p.id, "tastytrade", 60_001).ok).toBe(false);
  });
  test("bound to broker", () => {
    const p = createPreview("tastytrade", order(1));
    expect(consumePreview(p.id, "robinhood").ok).toBe(false);
  });
});

