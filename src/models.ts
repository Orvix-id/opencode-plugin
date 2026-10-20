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
  return upstreamID.startsWith(MODEL_PREFIX)
    ? upstreamID.slice(MODEL_PREFIX.length)
    : upstreamID;
}

/**
 * Builds the OpenCode model record for one Coding model.
 *
 * `supportsPromptCacheKey` makes OpenCode send a session-derived
 * `prompt_cache_key`. Orvix replaces it with its own session hash today, but
 * it costs nothing and keeps any pass-through upstream cache-aware.
 */
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
    name: `${known?.name ?? id} (Orvix)`,
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
      const response = await fetchImpl(
        `${baseURL.replace(/\/+$/, "")}/models`,
        {
          headers: { authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
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
          /(?:embed|rerank)/i.test(raw.id)
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
                ? `${raw.name} (Orvix)`
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
    ids = Object.keys(KNOWN_MODELS).map((id) => `${MODEL_PREFIX}${id}`);
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
