import type { Model } from "@opencode/plugin";
import {
  DEFAULT_CONTEXT,
  DEFAULT_OUTPUT,
  KNOWN_MODELS,
  MODEL_PREFIX,
  PROVIDER_ID,
} from "./constants.ts";

/** Stable epoch: V2 requires `time.released` but only uses it for ordering. */
const RELEASED = 1_700_000_000_000;

/** `orvix/glm-5.2` -> `glm-5.2`, so users pick `orvix-coding/glm-5.2`. */
export function localID(upstreamID: string): string {
  return upstreamID.startsWith(MODEL_PREFIX) ? upstreamID.slice(MODEL_PREFIX.length) : upstreamID;
}

/**
 * Builds the OpenCode model record for one Coding model.
 *
 * `supportsPromptCacheKey` makes OpenCode send a session-derived
 * `prompt_cache_key`. Orvix replaces it with its own session hash today, but
 * it costs nothing and keeps any pass-through upstream cache-aware.
 */
export function toModelInfo(upstreamID: string): Model.Info {
  const id = localID(upstreamID);
  const known = KNOWN_MODELS[id];
  return {
    id,
    modelID: `${MODEL_PREFIX}${id}`,
    providerID: PROVIDER_ID,
    name: known?.name ?? id,
    compatibility: { supportsPromptCacheKey: true },
    capabilities: {
      tools: true,
      input: known?.image ? ["text", "image"] : ["text"],
      output: ["text"],
    },
    variants: (known?.efforts ?? []).map((effort) => ({
      id: effort,
      body: { reasoning_effort: effort },
    })),
    time: { released: RELEASED },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: DEFAULT_CONTEXT, output: known?.output ?? DEFAULT_OUTPUT },
  } as unknown as Model.Info;
}

/** Ids from `GET {baseURL}/models`, the Coding allowlist (not the `/v1` catalogue). */
export async function fetchModelIDs(
  baseURL: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const res = await fetchImpl(`${baseURL.replace(/\/+$/, "")}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GET /models returned ${res.status}`);
  const body = (await res.json()) as { data?: Array<{ id?: unknown }> };
  return (body.data ?? [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

/** Live list when reachable, otherwise the known lineup. */
export async function resolveModels(
  baseURL: string,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Model.Info[]> {
  let ids: string[] = [];
  if (apiKey) {
    try {
      ids = await fetchModelIDs(baseURL, apiKey, fetchImpl);
    } catch {
      ids = [];
    }
  }
  if (ids.length === 0) ids = Object.keys(KNOWN_MODELS).map((id) => `${MODEL_PREFIX}${id}`);
  return ids.map(toModelInfo);
}
