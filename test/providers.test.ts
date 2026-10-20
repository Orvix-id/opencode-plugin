import { expect, test } from "bun:test";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import plugin from "../src/index.ts";
import { server, codingFetch } from "../src/v1.ts";
import { resolveModels, toModelInfo } from "../src/models.ts";

test("dual entrypoint and V1 register both routes without overwriting user models", async () => {
  expect(typeof plugin.setup).toBe("function");
  expect(plugin.server).toBe(server);
  const hooks = await server({} as never);
  const config: any = {
    provider: { orvix: { models: { custom: { id: "custom" } } } },
  };
  // Keep this test independent of operator credentials and networks.
  const old = [process.env.ORVIX_API_KEY, process.env.ORVIX_CODING_API_KEY];
  delete process.env.ORVIX_API_KEY;
  delete process.env.ORVIX_CODING_API_KEY;
  try {
    await hooks.config!(config);
    expect(config.provider.orvix.options.baseURL).toBe(
      "https://api.orvix.id/v1",
    );
    expect(config.provider["orvix-coding"].options.baseURL).toBe(
      "https://api.orvix.id/coding/v1",
    );
    expect(config.provider.orvix.models.custom.id).toBe("custom");
  } finally {
    for (const [index, key] of [
      "ORVIX_API_KEY",
      "ORVIX_CODING_API_KEY",
    ].entries()) {
      if (old[index] === undefined) delete process.env[key];
      else process.env[key] = old[index];
    }
  }
});

test("general route preserves BYOK IDs and successful empty catalogs", async () => {
  expect(String(toModelInfo("my-byok-model", "orvix").modelID)).toBe(
    "my-byok-model",
  );
  const transport = (async () =>
    Response.json({ data: [] })) as unknown as typeof fetch;
  expect(
    await resolveModels("https://example.com/v1", "test", transport, "orvix"),
  ).toEqual([]);
});

test("V2 registers both routes and scopes body rewriting to Coding", async () => {
  const records = new Map<string, any>();
  const hooks: any[] = [];
  const editor = {
    get: (id: string) => records.get(id),
    add: ({ info, models }: any) =>
      records.set(info.id, {
        provider: info,
        models: new Map(models.map((m: any) => [m.id, m])),
      }),
    models: {
      set: (id: string, models: any[]) => {
        records.get(id).models = new Map(models.map((m) => [m.id, m]));
      },
    },
  };
  const previous = [
    process.env.ORVIX_API_KEY,
    process.env.ORVIX_CODING_API_KEY,
  ];
  delete process.env.ORVIX_API_KEY;
  delete process.env.ORVIX_CODING_API_KEY;
  try {
    await plugin.setup({
      integration: {
        transform: async (fn: any) =>
          fn({ get: () => true, method: { update() {} } }),
        connection: { active: async () => undefined },
      },
      provider: {
        transform: async (fn: any) => {
          fn(editor);
          fn(editor);
        },
      },
      session: {
        hook: async (kind: string, callback: any, scope: any) =>
          hooks.push({ kind, callback, scope }),
      },
    } as never);
    expect([...records.keys()]).toEqual(["orvix", "orvix-coding"]);
    for (const id of records.keys()) {
      const input = {
        kind: "primary",
        sessionID: "test-session",
        request: new Request(`https://example.com/${id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"model":"orvix/test"}',
        }),
      };
      await hooks
        .find((h) => h.kind === "http.request" && h.scope.providerID === id)
        .callback(input);
      expect((await input.request.json()).session_id).toBe(
        id === "orvix-coding" ? "test-session" : undefined,
      );
    }
  } finally {
    for (const [index, key] of [
      "ORVIX_API_KEY",
      "ORVIX_CODING_API_KEY",
    ].entries()) {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    }
  }
});

test("V1 AI SDK sends isolated Coding sessions in JSON and strips transport header", async () => {
  const bodies: any[] = [];
  const transport = (async (input: Request) => {
    expect(input.headers.has("x-orvix-plugin-session")).toBe(false);
    bodies.push(await input.json());
    return Response.json({
      id: "test",
      object: "chat.completion",
      created: 1,
      model: "orvix/test",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "ok" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  }) as unknown as typeof fetch;
  const provider = createOpenAICompatible({
    name: "orvix-coding",
    baseURL: "https://example.com/coding/v1",
    apiKey: "test",
    fetch: codingFetch("https://example.com/coding/v1", transport),
  });
  const hooks = await server({} as never);
  await Promise.all(
    ["session-a", "session-b"].map(async (sessionID) => {
      const output = { headers: {} };
      await hooks["chat.headers"]!(
        { sessionID, model: { providerID: "orvix-coding" } } as never,
        output,
      );
      await generateText({
        model: provider("orvix/test"),
        prompt: "hello",
        headers: output.headers,
        maxRetries: 0,
      });
    }),
  );
  expect(bodies.map((body) => body.session_id).sort()).toEqual([
    "session-a",
    "session-b",
  ]);
  expect(bodies.every((body) => body.model === "orvix/test")).toBe(true);
});
