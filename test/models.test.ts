import { expect, test } from "bun:test";
import { KNOWN_MODELS } from "../src/constants.ts";
import { localID, resolveModels, toModelInfo } from "../src/models.ts";

test("strips the funding prefix for the local id only", () => {
  const info = toModelInfo("orvix/glm-5.2") as any;
  expect(localID("orvix/glm-5.2")).toBe("glm-5.2");
  expect(info.id).toBe("glm-5.2");
  expect(info.modelID).toBe("orvix/glm-5.2");
  expect(info.providerID).toBe("orvix-coding");
  expect(info.compatibility.supportsPromptCacheKey).toBe(true);
  expect(info.variants.map((v: any) => v.id)).toContain("high");
});

test("unknown models get conservative defaults", () => {
  const info = toModelInfo("orvix/new-model") as any;
  expect(info.name).toBe("new-model");
  expect(info.variants).toEqual([]);
});

test("uses the live list when reachable", async () => {
  const fake = (async () => Response.json({ data: [{ id: "orvix/glm-5.3-flash" }] })) as unknown as typeof fetch;
  const models = await resolveModels("https://x/coding/v1", "k", fake);
  expect(models.map((m) => m.id)).toEqual(["glm-5.3-flash"] as any);
});

test("falls back to the known lineup without a key or on error", async () => {
  const failing = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
  expect((await resolveModels("https://x/coding/v1", undefined)).length).toBe(Object.keys(KNOWN_MODELS).length);
  expect((await resolveModels("https://x/coding/v1", "k", failing)).length).toBe(Object.keys(KNOWN_MODELS).length);
});
