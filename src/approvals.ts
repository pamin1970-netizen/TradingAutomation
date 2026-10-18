import { createHash, randomBytes } from "node:crypto";
import type { ParsedOrder } from "./types";

export const APPROVAL_TTL_MS = 60_000;

export interface Preview {
  id: string;
  broker: string;
  order: ParsedOrder;
  hash: string;
  expiresAt: number;
  used: boolean;
}

const previews = new Map<string, Preview>();

function hashOrder(broker: string, order: ParsedOrder): string {
  return createHash("sha256").update(JSON.stringify({ broker, order })).digest("hex");
}

function prune(now: number) {
  for (const [id, p] of previews) {
    if (p.used || p.expiresAt <= now) previews.delete(id);
  }
}

export function createPreview(broker: string, order: ParsedOrder, now = Date.now()): Preview {
  prune(now);
  const preview: Preview = {
    id: randomBytes(16).toString("hex"),
    broker,
    order,
    hash: hashOrder(broker, order),
    expiresAt: now + APPROVAL_TTL_MS,
    used: false,
  };
  previews.set(preview.id, preview);
  return preview;
}

/**
 * Single-use approval. The order placed is the one stored at preview time,
 * never a body supplied at approval time, so edits require a new preview.
 */
export function consumePreview(
  id: string,
  broker: string,
  now = Date.now(),
): { ok: true; preview: Preview } | { ok: false; error: string } {
  const p = previews.get(id);
  if (!p) return { ok: false, error: "Unknown or already-used approval." };
  if (p.used) return { ok: false, error: "Approval already used." };
  if (p.expiresAt <= now) {
    previews.delete(id);
    return { ok: false, error: "Approval expired. Preview again." };
  }
  if (p.broker !== broker) return { ok: false, error: "Broker mismatch." };
  if (hashOrder(p.broker, p.order) !== p.hash) return { ok: false, error: "Order integrity check failed." };
  p.used = true;
  previews.delete(id);
  return { ok: true, preview: p };
}

