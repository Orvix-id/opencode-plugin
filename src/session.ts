/**
 * Cache affinity for the Coding Plan.
 *
 * `/coding/v1/chat/completions` reads the sticky session only from a top-level
 * `session_id` body field. Without it the handler skips route affinity and the
 * prompt cache (`x-orvix-cache-affinity: disabled`). OpenCode already knows the
 * session, so it is copied into the body here.
 */

/** Request kinds that reuse the session's prompt prefix. Titles do not. */
const CACHED_KINDS = new Set(["primary", "compaction", "generate"]);

export function wantsSession(kind: string): boolean {
  return CACHED_KINDS.has(kind);
}

/**
 * Returns a copy of `request` whose JSON body carries `session_id`.
 *
 * Leaves the request untouched when it is not a JSON POST or already has a
 * non-empty `session_id`, so a client that sets its own stays authoritative.
 */
export async function withSessionID(request: Request, sessionID: string): Promise<Request> {
  if (request.method !== "POST") return request;
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return request;

  const text = await request.clone().text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return request;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return request;
  const record = body as Record<string, unknown>;
  if (typeof record.session_id === "string" && record.session_id.trim()) return request;

  record.session_id = sessionID;
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request, { body: JSON.stringify(record), headers });
}
