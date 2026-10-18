// Structured audit events, written to stdout so Railway captures them.
// Never log credentials or session tokens. Move to Postgres in a later PR.
export function audit(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
}

