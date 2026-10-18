import { describe, expect, test } from "bun:test";
import { parseOrder } from "./parser";
import { occSymbol } from "./brokers/tastytrade";

describe("parseOrder", () => {
  test("parses a single leg", () => {
    const r = parseOrder("BUY 1 SPY 2026-12-18 500 CALL TO OPEN\n@ 1.25 DEBIT");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.order.legs[0]).toMatchObject({ underlying: "SPY", optionType: "CALL", side: "BUY", effect: "OPEN", quantity: 1 });
      expect(r.order.price).toBe(1.25);
      expect(r.order.priceEffect).toBe("DEBIT");
    }
  });

  test("parses a 4-leg iron condor and US dates", () => {
    const text = [
      "BUY 1 SPY 12/18/2026 480 P TO OPEN",
      "SELL 1 SPY 12/18/2026 490 P TO OPEN",
      "SELL 1 SPY 12/18/2026 510 C TO OPEN",
      "BUY 1 SPY 12/18/2026 520 C TO OPEN",
      "LIMIT 2.10 CREDIT",
    ].join("\n");
    const r = parseOrder(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.order.legs.map((l) => l.expiration)).toEqual(Array(4).fill("2026-12-18"));
  });

  test("rejects more than 4 legs", () => {
    const leg = "BUY 1 SPY 2026-12-18 500 CALL TO OPEN";
    const r = parseOrder([leg, leg, leg, leg, leg, "@ 1 DEBIT"].join("\n"));
    expect(r.ok).toBe(false);
  });

  test("rejects a leg without explicit TO OPEN / TO CLOSE", () => {
    const r = parseOrder("BUY 1 SPY 2026-12-18 500 CALL\n@ 1.25 DEBIT");
    expect(r.ok).toBe(false);
  });

  test("rejects a missing price and mixed underlyings", () => {
    expect(parseOrder("BUY 1 SPY 2026-12-18 500 CALL TO OPEN").ok).toBe(false);
    const mixed = parseOrder("BUY 1 SPY 2026-12-18 500 CALL TO OPEN\nBUY 1 QQQ 2026-12-18 500 CALL TO OPEN\n@ 1 DEBIT");
    expect(mixed.ok).toBe(false);
  });

  test("rejects impossible dates and zero quantity", () => {
    expect(parseOrder("BUY 1 SPY 2026-02-30 500 CALL TO OPEN\n@ 1 DEBIT").ok).toBe(false);
    expect(parseOrder("BUY 0 SPY 2026-12-18 500 CALL TO OPEN\n@ 1 DEBIT").ok).toBe(false);
  });
});

describe("occSymbol", () => {
  test("builds OCC symbol", () => {
    expect(occSymbol({ underlying: "SPY", expiration: "2026-12-18", strike: 500, optionType: "CALL", side: "BUY", effect: "OPEN", quantity: 1 })).toBe("SPY   261218C00500000");
  });
});

