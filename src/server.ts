import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { audit } from "./audit";
import { consumePreview, createPreview } from "./approvals";
import { checkGuardrails, limitsFromEnv, notionalUsd } from "./guardrails";
import { parseOrder } from "./parser";
import { robinhoodAdapter } from "./brokers/robinhood";
import { tastytradeAdapter } from "./brokers/tastytrade";
import type { BrokerAdapter } from "./types";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
if (ADMIN_TOKEN.length < 32) throw new Error("ADMIN_TOKEN must be set (32+ characters)");

const limits = limitsFromEnv();
const readOnly = process.env.READ_ONLY === "1";
let killSwitch = process.env.KILL_SWITCH === "1";
let spent = { day: "", usd: 0 };

const brokers: Record<string, BrokerAdapter> = {
  tastytrade: tastytradeAdapter,
  robinhood: robinhoodAdapter,
};

function spentToday(): number {
  const day = new Date().toISOString().slice(0, 10);
  if (spent.day !== day) spent = { day, usd: 0 };
  return spent.usd;
}

function authorized(header: string | undefined): boolean {
  const expected = Buffer.from(`Bearer ${ADMIN_TOKEN}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.use("/api/*", async (c, next) => {
  if (!authorized(c.req.header("authorization"))) return c.json({ error: "unauthorized" }, 401);
  await next();
});

app.get("/api/status", (c) =>
  c.json({
    killSwitch,
    readOnly,
    brokers: Object.values(brokers).map((b) => ({ name: b.name, enabled: b.enabled() })),
    spentToday: spentToday(),
    limits: { ...limits, allowlist: limits.allowlist ? [...limits.allowlist] : null },
  }),
);

app.post("/api/kill", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.enabled !== "boolean") return c.json({ error: "enabled must be boolean" }, 400);
  killSwitch = body.enabled;
  audit("kill_switch", { enabled: killSwitch });
  return c.json({ killSwitch });
});

app.post("/api/parse", async (c) => {
  const { text } = await c.req.json().catch(() => ({ text: "" }));
  const result = parseOrder(String(text ?? ""));
  return result.ok ? c.json(result.order) : c.json({ errors: result.errors }, 422);
});

// Parse -> guardrails -> broker dry run -> single-use approval token (60s).
app.post("/api/preview", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (killSwitch) return c.json({ error: "kill switch is on" }, 423);

  const broker = brokers[body.broker];
  if (!broker) return c.json({ error: "unknown broker" }, 400);
  if (!broker.enabled()) return c.json({ error: `${broker.name} is disabled` }, 403);

  const parsed = parseOrder(String(body.text ?? ""));
  if (!parsed.ok) return c.json({ errors: parsed.errors }, 422);

  const violations = checkGuardrails(parsed.order, limits, spentToday());
  if (violations.length > 0) return c.json({ errors: violations }, 422);

  let dryRun;
  try {
    dryRun = await broker.dryRun(parsed.order);
  } catch (err) {
    audit("dry_run_failed", { broker: broker.name, error: String(err) });
    return c.json({ error: String(err instanceof Error ? err.message : err) }, 502);
  }

  const preview = createPreview(broker.name, parsed.order);
  audit("preview", { broker: broker.name, previewId: preview.id, notional: notionalUsd(parsed.order) });
  return c.json({
    previewId: preview.id,
    expiresAt: new Date(preview.expiresAt).toISOString(),
    order: parsed.order,
    notional: notionalUsd(parsed.order),
    dryRun,
  });
});

// Placing requires the approval id from a fresh preview. Used once, then gone.
app.post("/api/previews/:id/place", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (readOnly) return c.json({ error: "read-only mode" }, 403);
  if (killSwitch) return c.json({ error: "kill switch is on" }, 423);

  const broker = brokers[body.broker];
  if (!broker) return c.json({ error: "unknown broker" }, 400);

  const approval = consumePreview(c.req.param("id"), broker.name);
  if (!approval.ok) return c.json({ error: approval.error }, 409);

  const { order } = approval.preview;
  const violations = checkGuardrails(order, limits, spentToday());
  if (violations.length > 0) return c.json({ errors: violations }, 422);

  audit("place_attempt", { broker: broker.name, previewId: approval.preview.id });
  try {
    const result = await broker.place(order);
    spent.usd = Math.round((spent.usd + notionalUsd(order)) * 100) / 100;
    audit("placed", { broker: broker.name, previewId: approval.preview.id, ...result });
    return c.json(result);
  } catch (err) {
    audit("place_failed", { broker: broker.name, previewId: approval.preview.id, error: String(err) });
    return c.json({ error: String(err instanceof Error ? err.message : err) }, 502);
  }
});

export default {
  port: Number(process.env.PORT) || 3000,
  fetch: app.fetch,
};

