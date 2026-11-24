import type { Model } from "@opencode/plugin";
import {
  DEFAULT_CONTEXT,
  DEFAULT_OUTPUT,
  KNOWN_MODELS,
  MODEL_PREFIX,
  PROVIDER_ID,
  fallbackModelIDs,
} from "./constants.ts";

/** Stable epoch: V2 requires `time.released` but only uses it for ordering. */
const RELEASED = 1_700_000_000_000;

/** `orvix/glm-5.2` -> `glm-5.2`, so users pick `orvix-coding/glm-5.2`. */
export function localID(upstreamID: string): string {
  return upstreamID.startsWith(MODEL_PREFIX)
    ? upstreamID.slice(MODEL_PREFIX.length)
    : upstreamID;
}

// Casing for recurring model-family tokens that plain capitalization gets
// wrong, so ids this release does not know still read like vendor names.
const FAMILY_TOKENS = new Map<string, string>([
  ["ai", "AI"],
  ["gpt", "GPT"],
  ["glm", "GLM"],
  ["vl", "VL"],
  ["mimo", "MiMo"],
  ["deepseek", "DeepSeek"],
  ["minimax", "MiniMax"],
]);

/** `qwen-3.9-max` -> `Qwen 3.9 Max`, for models missing from KNOWN_MODELS. */
export function displayName(id: string): string {
  const parts = localID(id)
    .split(/[-/\s]+/)
    .filter(Boolean);
  if (!parts.length) return id;
  return parts
    .map((part) => {
      const family = FAMILY_TOKENS.get(part.toLowerCase());
      if (family) return family;
      if (/^v\d+(?:\.\d+)?$/i.test(part)) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

/**
 * Image, video, audio, embedding and rerank routes are listed by `/v1/models`
 * (managed ones such as `orvix/flux-2-pro`, and arbitrary BYOK ids) but cannot
 * serve chat completions, so they stay out of the picker.
 */
export function isNonChatModel(id: string): boolean {
  const value = id.trim().toLowerCase();
  return (
    Boolean(value) &&
    /(?:^|[-/])(embed(?:ding)?s?|image|imagine|video|audio|voice|rerank|flux|midjourney|seedream)(?:[-/.]|$)/.test(
      value,
    )
  );
}

/** Rate limits and gateway hiccups at startup should not drop to the fallback lineup. */
function isTransient(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export function retryDelayMs(
  attempt: number,
  retryAfter: string | null = null,
): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0)
      return Math.min(5_000, seconds * 1_000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date))
      return Math.max(0, Math.min(5_000, date - Date.now()));
  }
  return Math.min(2_000, 250 * 2 ** Math.max(0, attempt));
}

async function fetchCatalog(
  baseURL: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const signal = AbortSignal.timeout(10_000);
  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(`${baseURL.replace(/\/+$/, "")}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (attempt >= 2 || !isTransient(response.status)) return response;
    await response.body?.cancel();
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        retryDelayMs(attempt, response.headers.get("retry-after")),
      ),
    );
  }
}

/**
 * Builds the OpenCode model record for one Coding model.
 *
 * `supportsPromptCacheKey` makes OpenCode send a session-derived
 * `prompt_cache_key`. Orvix replaces it with its own session hash today, but
 * it costs nothing and keeps any pass-through upstream cache-aware.
 */
/**
 * Picker suffix. Both providers list the same model ids, and picking the
 * general one by mistake bills Orvix Credits instead of the Coding Plan
 * ("insufficient Orvix Credits" for plan-only users), so the suffix names
 * the provider.
 */
export function nameSuffix(providerID: string): string {
  return providerID === PROVIDER_ID ? "(Orvix Coding)" : "(Orvix)";
}

export function toModelInfo(
  upstreamID: string,
  providerID = PROVIDER_ID,
): Model.Info {
  const id = localID(upstreamID);
  const known = KNOWN_MODELS[id];
  return {
    id,
    modelID: upstreamID,
    providerID,
    // Suffixed so Orvix models never look like OpenCode's built-in ones in the picker.
    name: `${known?.name ?? displayName(id)} ${nameSuffix(providerID)}`,
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
    limit: {
      context: DEFAULT_CONTEXT,
      output: known?.output ?? DEFAULT_OUTPUT,
    },
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
  providerID: string = PROVIDER_ID,
): Promise<Model.Info[]> {
  let ids: string[] = [];
  if (apiKey) {
    try {
      const response = await fetchCatalog(baseURL, apiKey, fetchImpl);
      if (response.status === 401 || response.status === 403) {
        throw new CredentialError(
          `Orvix ${providerID}: /models returned ${response.status}; check API key and scope`,
        );
      }
      if (!response.ok)
        throw new Error(`Orvix /models returned ${response.status}`);
      const payload = (await response.json()) as {
        data?: Array<Record<string, any>>;
      };
      if (!Array.isArray(payload.data))
        throw new Error("Invalid Orvix model catalog");
      return payload.data.flatMap((raw) => {
        if (!raw || typeof raw.id !== "string" || !raw.id.trim()) return [];
        const caps = raw.capabilities ?? {};
        if (
          (caps.image_generation === true && caps.tools !== true) ||
          isNonChatModel(raw.id)
        )
          return [];
        const model = toModelInfo(raw.id, providerID);
        const known = KNOWN_MODELS[localID(raw.id)];
        const context = Number(raw.context_length ?? raw.max_context_tokens);
        const output = Number(
          raw.max_completion_tokens ??
            raw.max_output_tokens ??
            caps.max_output_tokens,
        );
        return [
          {
            ...model,
            name:
              typeof raw.name === "string" && raw.name.trim()
                ? `${raw.name.replace(/^Orvix(?::|\s)\s*/i, "").trim() || raw.name} ${nameSuffix(providerID)}`
                : model.name,
            limit: {
              ...model.limit,
              context:
                Number.isFinite(context) && context > 0
                  ? context
                  : model.limit.context,
              output:
                Number.isFinite(output) && output > 0
                  ? output
                  : model.limit.output,
            },
            capabilities: {
              ...model.capabilities,
              tools:
                typeof caps.tools === "boolean"
                  ? caps.tools
                  : known !== undefined,
              input:
                typeof caps.vision === "boolean"
                  ? caps.vision
                    ? ["text", "image"]
                    : ["text"]
                  : model.capabilities.input,
            },
          } as Model.Info,
        ];
      });
    } catch (error) {
      if (error instanceof CredentialError) throw error;
      ids = [];
    }
  }
  if (ids.length === 0)
    ids = fallbackModelIDs(providerID).map((id) => `${MODEL_PREFIX}${id}`);
  return ids.map((id) => toModelInfo(id, providerID));
}

export class CredentialError extends Error {}

/** A rejected credential disables discovery only for its own provider. */
export async function resolveProviderModels(
  ...args: Parameters<typeof resolveModels>
): Promise<Model.Info[]> {
  try {
    return await resolveModels(...args);
  } catch (error) {
    if (!(error instanceof CredentialError)) throw error;
    console.warn(error.message);
    return [];
  }
}
