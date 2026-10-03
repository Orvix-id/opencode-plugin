/**
 * Cache probe: how cache-friendly is OpenCode + this plugin?
 *
 * Starts a mock `/coding/v1` server, runs real `opencode run` turns against it
 * through the plugin (isolated config/data dirs), and reports for each request:
 *   - whether `session_id` reached the body (what Orvix needs for affinity)
 *   - how many leading bytes match the previous request of the same session
 *     (an upstream prompt cache can only hit on an identical prefix)
 *
 * The mock answers the first request of a turn with one tool call and the
 * follow-up with text, so each turn produces a growing in-turn prefix too.
 *
 *   bun scripts/cache-probe.ts [turns=3]
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const turns = Number(process.argv[2] ?? 3);
const pluginPath = resolve(import.meta.dir, "..");
const MODEL = "orvix/glm-5.3-flash";

type Logged = {
  n: number;
  kind: string;
  session: string | undefined;
  bodySession: string | undefined;
  headers: Record<string, string>;
  prefixText: string;
  messages: number;
  tools: number;
};
const log: Logged[] = [];

function sse(chunks: unknown[]): Response {
  const text = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(text, { headers: { "content-type": "text/event-stream" } });
}

function chunk(delta: Record<string, unknown>, finish: string | null = null, usage?: unknown) {
  return {
    id: "chatcmpl-probe",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(usage ? { usage } : {}),
  };
}

/** First required string property of a tool's JSON schema, filled with `value`. */
function argsFor(tool: any, value: string): string {
  const params = tool?.function?.parameters ?? {};
  const required: string[] = params.required ?? Object.keys(params.properties ?? {});
  const key = required.find((k) => params.properties?.[k]?.type === "string") ?? required[0];
  return JSON.stringify(key ? { [key]: value } : {});
}

const workdir = mkdtempSync(join(tmpdir(), "orvix-probe-work-"));
writeFileSync(join(workdir, "hello.txt"), "hello from the cache probe\n");

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname.endsWith("/models")) {
      return Response.json({ object: "list", data: [{ id: MODEL, object: "model", owned_by: "orvix" }] });
    }
    if (req.method !== "POST" || !url.pathname.endsWith("/chat/completions")) {
      return new Response("not found", { status: 404 });
    }
    const body = (await req.json()) as any;
    const headers: Record<string, string> = {};
    for (const [k, v] of req.headers) {
      if (k === "authorization") headers[k] = v.startsWith("Bearer ") ? "Bearer <redacted>" : "<redacted>";
      else if (k.startsWith("x-")) headers[k] = v;
    }
    const tools: any[] = body.tools ?? [];
    const messages: any[] = body.messages ?? [];
    const kind = tools.length === 0 ? "aux" : "agent";
    const { session_id, ...rest } = body;
    log.push({
      n: log.length + 1,
      kind,
      session: req.headers.get("x-opencode-session-id") ?? undefined,
      bodySession: typeof session_id === "string" ? session_id : undefined,
      headers,
      // What a provider cache keys on: tools + messages, in send order.
      prefixText: JSON.stringify({ tools: rest.tools, messages: rest.messages }),
      messages: messages.length,
      tools: tools.length,
    });

    const usage = { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 };
    const last = messages.at(-1);
    const read = tools.find((t) => t?.function?.name === "read");
    if (kind === "agent" && last?.role !== "tool" && read) {
      return sse([
        chunk({ role: "assistant", tool_calls: [{ index: 0, id: `call_${log.length}`, type: "function", function: { name: "read", arguments: argsFor(read, join(workdir, "hello.txt")) } }] }),
        chunk({}, "tool_calls", usage),
      ]);
    }
    return sse([chunk({ role: "assistant", content: kind === "aux" ? "Probe title" : "Done." }), chunk({}, "stop", usage)]);
  },
});

const home = mkdtempSync(join(tmpdir(), "orvix-probe-home-"));
const env: Record<string, string> = {
  ...(process.env as Record<string, string>),
  XDG_CONFIG_HOME: join(home, "config"),
  XDG_DATA_HOME: join(home, "data"),
  XDG_STATE_HOME: join(home, "state"),
  XDG_CACHE_HOME: join(home, "cache"),
  ORVIX_CODING_BASE_URL: `http://127.0.0.1:${server.port}/coding/v1`,
  ORVIX_CODING_API_KEY: "probe-test-key",
};
delete env.ORVIX_API_KEY;
mkdirSync(join(home, "config", "opencode"), { recursive: true });
writeFileSync(
  join(home, "config", "opencode", "opencode.json"),
  JSON.stringify({ $schema: "https://opencode.ai/config.json", plugins: [pluginPath], model: "orvix-coding/glm-5.3-flash" }, null, 2),
);

async function run(args: string[]) {
  const proc = Bun.spawn(["opencode", "run", "--standalone", "--auto", "-m", "orvix-coding/glm-5.3-flash", ...args], {
    cwd: workdir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) {
    console.error(`opencode exited ${code}\n${out}\n${err}`);
    server.stop(true);
    process.exit(1);
  }
}

const prompts = ["Read hello.txt and tell me what it says.", "Read it again please.", "One more time, read hello.txt."];
for (let i = 0; i < turns; i++) {
  await run([...(i === 0 ? [] : ["--continue"]), prompts[i % prompts.length]!]);
}
server.stop(true);

function common(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

console.log(`\nrequests: ${log.length}  (mock at port ${server.port}, workdir ${workdir})\n`);
console.log("  #  kind   msgs  session_id in body   prefix reused from previous agent request");
let prev: Logged | undefined;
let reused = 0;
let total = 0;
for (const r of log) {
  let note = "-";
  if (r.kind === "agent") {
    if (prev && prev.session === r.session) {
      const same = common(prev.prefixText, r.prefixText);
      const full = same === prev.prefixText.length - 2; // previous body minus the closing `]}`
      note = `${same}/${prev.prefixText.length} bytes ${full || same >= prev.prefixText.length - 2 ? "(full prefix)" : "(BROKEN)"}`;
      reused += same;
      total += r.prefixText.length;
    }
    prev = r;
  }
  const ok = r.bodySession && r.bodySession === r.session ? "yes" : r.bodySession ? "mismatch" : "no";
  console.log(`${String(r.n).padStart(3)}  ${r.kind.padEnd(5)}  ${String(r.messages).padStart(4)}  ${ok.padEnd(19)}  ${note}`);
}
if (total) console.log(`\nbyte-level prefix reuse across follow-up agent requests: ${((100 * reused) / total).toFixed(1)}%`);
console.log("\nheaders seen on the first agent request:");
console.log(log.find((r) => r.kind === "agent")?.headers);
