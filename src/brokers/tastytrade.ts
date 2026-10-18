import type { BrokerAdapter, DryRunResult, OptionLeg, ParsedOrder, PlaceResult } from "../types";

// Sandbox: https://api.cert.tastyworks.com  Production: https://api.tastyworks.com
const BASE = process.env.TASTYTRADE_BASE_URL ?? "https://api.tastyworks.com";

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is not set`);
  return v;
}

/** OCC symbol: root padded to 6, YYMMDD, C/P, strike x1000 padded to 8. */
export function occSymbol(leg: OptionLeg): string {
  const root = leg.underlying.padEnd(6, " ");
  const [y, m, d] = leg.expiration.split("-");
  const cp = leg.optionType === "CALL" ? "C" : "P";
  const strike = Math.round(leg.strike * 1000).toString().padStart(8, "0");
  return `${root}${y.slice(2)}${m}${d}${cp}${strike}`;
}

export function buildPayload(order: ParsedOrder) {
  return {
    "time-in-force": order.timeInForce,
    "order-type": "Limit",
    price: order.price.toFixed(2),
    "price-effect": order.priceEffect === "DEBIT" ? "Debit" : "Credit",
    legs: order.legs.map((l) => ({
      "instrument-type": "Equity Option",
      symbol: occSymbol(l),
      action: `${l.side === "BUY" ? "Buy" : "Sell"} to ${l.effect === "OPEN" ? "Open" : "Close"}`,
      quantity: l.quantity,
    })),
  };
}

let sessionToken: string | null = null;

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "trading-automation" },
    body: JSON.stringify({
      login: env("TASTYTRADE_USERNAME"),
      password: env("TASTYTRADE_PASSWORD"),
      "remember-me": false,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: { "session-token"?: string } };
  if (!res.ok || !json.data?.["session-token"]) {
    throw new Error(`tastytrade login failed (${res.status})`);
  }
  sessionToken = json.data["session-token"];
  return sessionToken;
}

async function request(path: string, method: "GET" | "POST", body?: unknown, retried = false): Promise<any> {
  const token = sessionToken ?? (await login());
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: token, "user-agent": "trading-automation" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && !retried) {
    sessionToken = null;
    return request(path, method, body, true);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`tastytrade: ${msg}`);
  }
  return json;
}

function accountPath(): string {
  return `/accounts/${encodeURIComponent(env("TASTYTRADE_ACCOUNT_NUMBER"))}`;
}

export const tastytradeAdapter: BrokerAdapter = {
  name: "tastytrade",
  enabled: () => process.env.TASTYTRADE_ENABLED === "1",

  async dryRun(order): Promise<DryRunResult> {
    const json = await request(`${accountPath()}/orders/dry-run`, "POST", buildPayload(order));
    const d = json.data ?? {};
    return {
      ok: true,
      buyingPowerChange: d["buying-power-effect"]?.["change-in-buying-power"] ?? null,
      fees: d["fee-calculation"]?.["total-fees"] ?? null,
      warnings: (d.warnings ?? []).map((w: { message?: string }) => w.message ?? String(w)),
    };
  },

  async place(order): Promise<PlaceResult> {
    const json = await request(`${accountPath()}/orders`, "POST", buildPayload(order));
    const o = json.data?.order ?? {};
    return { orderId: String(o.id ?? ""), status: String(o.status ?? "unknown") };
  },
};

