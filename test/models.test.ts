import { expect, test } from "bun:test";
import { KNOWN_MODELS, fallbackModelIDs } from "../src/constants.ts";
import {
  displayName,
  isNonChatModel,
  localID,
  resolveModels,
  retryDelayMs,
  toModelInfo,
} from "../src/models.ts";

test("strips the funding prefix for the local id only", () => {
  const info = toModelInfo("orvix/glm-5.2") as any;
  expect(localID("orvix/glm-5.2")).toBe("glm-5.2");
  expect(info.id).toBe("glm-5.2");
  expect(info.modelID).toBe("orvix/glm-5.2");
  expect(info.providerID).toBe("orvix-coding");
  expect(info.name).toBe("GLM 5.2 (Orvix Coding)");
  expect((toModelInfo("orvix/glm-5.2", "orvix") as any).name).toBe(
    "GLM 5.2 (Orvix)",
  );
  expect(info.compatibility.supportsPromptCacheKey).toBe(true);
  expect(info.variants.map((v: any) => v.id)).toContain("high");
});

test("unknown models get conservative defaults", () => {
  const info = toModelInfo("orvix/new-model") as any;
  expect(info.name).toBe("New Model (Orvix Coding)");
  expect(info.variants).toEqual([]);
});

test("uses the live list when reachable", async () => {
  const fake = (async () =>
    Response.json({
      data: [{ id: "orvix/glm-5.3-flash" }],
    })) as unknown as typeof fetch;
  const models = await resolveModels("https://x/coding/v1", "k", fake);
  expect(models.map((m) => m.id)).toEqual(["glm-5.3-flash"] as any);
});

test("falls back to the known lineup without a key or on server failure", async () => {
  let calls = 0;
  const failing = (async () => {
    calls++;
    return new Response("no", { status: 503, headers: { "retry-after": "0" } });
  }) as unknown as typeof fetch;
  const coding = fallbackModelIDs("orvix-coding");
  expect((await resolveModels("https://x/coding/v1", undefined)).length).toBe(
    coding.length,
  );
  expect(
    (await resolveModels("https://x/coding/v1", "k", failing)).length,
  ).toBe(coding.length);
  // Transient failures are retried twice before falling back.
  expect(calls).toBe(3);
});

test("Coding fallback is the Coding lineup; general fallback is the whole catalogue", () => {
  const coding = fallbackModelIDs("orvix-coding");
  expect(coding).toContain("deepseek-v4.1-flash");
  expect(coding).not.toContain("claude-opus-5.5");
  expect(coding.every((id) => KNOWN_MODELS[id]?.coding)).toBe(true);
  expect(fallbackModelIDs("orvix").length).toBe(
    Object.keys(KNOWN_MODELS).length,
  );
});

test("retries a rate-limited catalogue read instead of falling back", async () => {
  let calls = 0;
  const flaky = (async () => {
    calls++;
    return calls === 1
      ? new Response("slow down", {
          status: 429,
          headers: { "retry-after": "0" },
        })
      : Response.json({ data: [{ id: "orvix/hy3" }] });
  }) as unknown as typeof fetch;
  const models = await resolveModels("https://x/coding/v1", "k", flaky);
  expect(models.map((m) => m.id)).toEqual(["hy3"] as any);
  expect(calls).toBe(2);
  expect(retryDelayMs(0)).toBe(250);
  expect(retryDelayMs(5, "60")).toBe(5_000);
});

test("non-chat routes stay out of the picker", async () => {
  for (const id of [
    "orvix/flux-2-pro",
    "orvix/midjourney",
    "orvix/gpt-image-2",
    "orvix/seedream-5.0-pro",
    "text-embedding-3-large",
    "orvix/grok-imagine-image",
  ])
    expect(isNonChatModel(id)).toBe(true);
  for (const id of [
    "orvix/gpt-6-sol",
    "orvix/qwen-3.8-omni-flash",
    "my-byok-chat",
  ])
    expect(isNonChatModel(id)).toBe(false);
  const listing = (async () =>
    Response.json({
      data: [{ id: "orvix/flux-2-pro" }, { id: "orvix/glm-5.2" }],
    })) as unknown as typeof fetch;
  const models = await resolveModels("https://x/v1", "k", listing, "orvix");
  expect(models.map((m) => m.id)).toEqual(["glm-5.2"] as any);
});

test("verified reasoning profiles and readable names", () => {
  const flash = toModelInfo("orvix/deepseek-v4.1-flash") as any;
  expect(flash.variants.map((v: any) => v.id)).toEqual([
    "none",
    "low",
    "high",
    "max",
  ]);
  expect(flash.capabilities.input).toEqual(["text", "image"]);
  expect(displayName("orvix/mimo-v3-flash")).toBe("MiMo V3 Flash");
  expect(displayName("deepseek-v5")).toBe("DeepSeek V5");
});

test("auth errors do not silently expose fallback models", async () => {
  const failing = (async () =>
    new Response("no", { status: 401 })) as unknown as typeof fetch;
  await expect(resolveModels("https://x/v1", "bad", failing)).rejects.toThrow(
    "check API key and scope",
  );
});
