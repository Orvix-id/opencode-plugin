/** Provider and integration id. Separate from `orvix` so it can sit next to a `/v1` provider. */
export const PROVIDER_ID = "orvix-coding";
export const PROVIDER_NAME = "Orvix Coding";

/**
 * OpenAI-compatible Coding Plan alias. OpenCode appends `/chat/completions`,
 * which lands on `POST /coding/v1/chat/completions` (scope `coding:invoke`).
 * `ORVIX_CODING_BASE_URL` overrides it for local probes.
 */
export const DEFAULT_BASE_URL = "https://api.orvix.id/coding/v1";
export const BASE_URL_ENV = "ORVIX_CODING_BASE_URL";
export const API_KEY_ENV = "ORVIX_CODING_API_KEY";

/**
 * OpenCode v2's native OpenAI-compatible driver. Unlike `aisdk:` packages it
 * sends the session affinity headers and honours `supportsPromptCacheKey`.
 */
export const PROVIDER_PACKAGE = "@opencode/ai/providers/openai-compatible";

/** Observability-only headers. Orvix records the client name and version and uses them for nothing else. */
export const CLIENT_HEADER = "x-orvix-coding-client";
export const CLIENT_VERSION_HEADER = "x-orvix-coding-client-version";
export const CLIENT_NAME = "opencode";
export const PLUGIN_VERSION = "0.3.0";

/** Upstream ids from `/coding/v1/models` carry this funding prefix. */
export const MODEL_PREFIX = "orvix/";

type Effort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface KnownModel {
  name: string;
  output: number;
  image: boolean;
  efforts?: readonly Effort[];
  /** On the Coding allowlist (`/coding/v1/models`) as of the last sync. */
  coding?: true;
}

/**
 * Context window used for every model until `/models` reports one.
 * Too high and requests fail upstream; too low and OpenCode compacts early,
 * which also throws the prompt cache away.
 */
export const DEFAULT_CONTEXT = 200_000;
export const DEFAULT_OUTPUT = 32_768;

// Reasoning profiles verified against the live API (carried over from the
// community `opencode-provider-orvix` plugin, last verified 2026-11-09).
// Orvix forwards `reasoning_effort` upstream, so a value the upstream rejects
// surfaces as a 502: only list efforts a model is known to accept.
const FULL: readonly Effort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const MUSE: readonly Effort[] = ["minimal", "low", "medium", "high", "xhigh"];
const LUNA: readonly Effort[] = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const LADDER4: readonly Effort[] = ["none", "low", "high", "max"];
const LADDER3: readonly Effort[] = ["none", "low", "high"];

/**
 * Model metadata, synced with the managed catalogue on 2026-11-24.
 *
 * `/models` stays authoritative for which ids exist; these entries supply
 * display names, output ceilings, image input and reasoning profiles, and
 * the offline fallback lineup (`coding: true` for the Coding provider,
 * every entry for the general provider). Image and video generation models
 * are deliberately absent: they are not chat models.
 */
export const KNOWN_MODELS: Record<string, KnownModel> = {
  // Coding Plan lineup.
  "deepseek-v4.1-flash": {
    name: "DeepSeek V4.1 Flash",
    output: 131_072,
    image: true,
    efforts: LADDER4,
    coding: true,
  },
  "deepseek-v4-flash": {
    name: "DeepSeek V4 Flash",
    output: 384_000,
    image: false,
    coding: true,
  },
  "deepseek-v4-pro": {
    name: "DeepSeek V4 Pro",
    output: 384_000,
    image: false,
    efforts: LADDER4,
    coding: true,
  },
  "glm-5.2": {
    name: "GLM 5.2",
    output: 32_768,
    image: false,
    efforts: FULL,
    coding: true,
  },
  "glm-5.3-flash": {
    name: "GLM 5.3 Flash",
    output: 131_072,
    image: true,
    efforts: LADDER4,
    coding: true,
  },
  "gpt-5.6-luna": {
    name: "GPT-5.6 Luna",
    output: 128_000,
    image: true,
    efforts: LUNA,
    coding: true,
  },
  "gpt-5.6-sol": {
    name: "GPT-5.6 Sol",
    output: 128_000,
    image: true,
    efforts: FULL,
    coding: true,
  },
  "gpt-5.6-terra": {
    name: "GPT-5.6 Terra",
    output: 128_000,
    image: true,
    efforts: FULL,
    coding: true,
  },
  "gpt-6-luna": {
    name: "GPT-6 Luna",
    output: 128_000,
    image: true,
    coding: true,
  },
  "gpt-6-sol": {
    name: "GPT-6 Sol",
    output: 128_000,
    image: true,
    coding: true,
  },
  hy3: { name: "Hy3", output: 32_768, image: false, coding: true },
  "mimo-v2.6-pro": {
    name: "MiMo V2.6 Pro",
    output: 128_000,
    image: false,
    efforts: LADDER3,
    coding: true,
  },
  "minimax-m3": {
    name: "MiniMax M3",
    output: 32_768,
    image: false,
    coding: true,
  },
  "muse-spark-1.3": {
    name: "Muse Spark 1.3",
    output: 80_000,
    image: true,
    efforts: MUSE,
    coding: true,
  },
  "qwen-3.8-flash": {
    name: "Qwen 3.8 Flash",
    output: 65_536,
    image: false,
    coding: true,
  },
  "qwen-3.8-max": {
    name: "Qwen 3.8 Max",
    output: 32_768,
    image: true,
    coding: true,
  },

  // General API (`/v1`) only.
  "claude-fable-5.1": {
    name: "Claude Fable 5.1",
    output: 128_000,
    image: true,
  },
  "claude-haiku-5.5": { name: "Claude Haiku 5.5", output: 32_768, image: true },
  "claude-opus-5": { name: "Claude Opus 5", output: 65_536, image: true },
  "claude-opus-5.5": { name: "Claude Opus 5.5", output: 128_000, image: true },
  "claude-sonnet-5": { name: "Claude Sonnet 5", output: 32_768, image: true },
  "claude-sonnet-5.5": {
    name: "Claude Sonnet 5.5",
    output: 32_768,
    image: true,
  },
  "deepseek-v4.1-flash-uncensored": {
    name: "DeepSeek V4.1 Flash (Uncensored)",
    output: 131_072,
    image: false,
  },
  "gemini-3.7-flash": { name: "Gemini 3.7 Flash", output: 32_000, image: true },
  "gemini-3.8-flash": { name: "Gemini 3.8 Flash", output: 32_000, image: true },
  "gemini-4-argon": { name: "Gemini 4 Argon", output: 65_536, image: true },
  "glm-5.3-flash-uncensored": {
    name: "GLM 5.3 Flash (Uncensored)",
    output: 131_072,
    image: false,
  },
  "gpt-6-astra": { name: "GPT-6 Astra", output: 128_000, image: true },
  "gpt-6-astra-fast": {
    name: "GPT-6 Astra Fast",
    output: 128_000,
    image: true,
  },
  "grok-4.7": {
    name: "Grok 4.7",
    output: 32_768,
    image: true,
    efforts: LADDER3,
  },
  jev: { name: "Jev", output: 32_000, image: false },
  "kimi-k3": {
    name: "Kimi K3",
    output: 16_384,
    image: false,
    efforts: LADDER3,
  },
  "mimo-v2.6-flash": {
    name: "MiMo V2.6 Flash",
    output: 32_768,
    image: true,
    efforts: LADDER3,
  },
  "minimax-m3.1-flash": {
    name: "MiniMax M3.1 Flash",
    output: 32_768,
    image: false,
    efforts: LADDER3,
  },
  "muse-wonder-1.0": { name: "Muse Wonder 1.0", output: 32_768, image: true },
  "nemotron-3-ultra-550b": {
    name: "Nemotron 3 Ultra 550B",
    output: 32_768,
    image: false,
  },
  "qwen-3.8-omni-flash": {
    name: "Qwen 3.8 Omni Flash",
    output: 32_768,
    image: true,
  },
};

/** Ids the provider falls back to when `/models` cannot be read. */
export function fallbackModelIDs(providerID: string): string[] {
  return Object.entries(KNOWN_MODELS)
    .filter(([, model]) => providerID !== PROVIDER_ID || model.coding)
    .map(([id]) => id);
}
