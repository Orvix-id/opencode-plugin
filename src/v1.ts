import type { Plugin } from "@opencode-ai/plugin";
import { routes, credentialEnvNames, environmentKey } from "./routes.ts";
import { resolveProviderModels } from "./models.ts";
import { withSessionID } from "./session.ts";
import {
  CLIENT_HEADER,
  CLIENT_NAME,
  CLIENT_VERSION_HEADER,
  PLUGIN_VERSION,
} from "./constants.ts";

const SESSION_HEADER = "x-orvix-plugin-session";

/** A request-local header carries the session across the V1 AI SDK boundary. */
export function codingFetch(
  baseURL: string,
  transport: typeof fetch = fetch,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    let request = new Request(input, init);
    const session = request.headers.get(SESSION_HEADER);
    const headers = new Headers(request.headers);
    headers.delete(SESSION_HEADER);
    request = new Request(request, { headers });
    const target = new URL(request.url);
    const base = new URL(baseURL);
    if (
      session &&
      target.origin === base.origin &&
      target.pathname === `${base.pathname.replace(/\/$/, "")}/chat/completions`
    ) {
      request = await withSessionID(request, session);
    }
    return transport(request);
  }) as typeof fetch;
}

export const server: Plugin = async () => ({
  async config(config) {
    config.provider ??= {};
    for (const route of routes) {
      const provider = (config.provider[route.id] ??= {});
      provider.npm ??= "@ai-sdk/openai-compatible";
      provider.name ??= route.name;
      provider.env ??= credentialEnvNames(route);
      provider.options ??= {};
      const baseURL = String(
        provider.options.baseURL ?? process.env[route.baseEnv] ?? route.baseURL,
      );
      provider.options.baseURL = baseURL;
      if (route.id === "orvix-coding") {
        provider.options.fetch = codingFetch(
          baseURL,
          provider.options.fetch as typeof fetch | undefined,
        );
      }
      const models = await resolveProviderModels(
        baseURL,
        typeof provider.options.apiKey === "string"
          ? provider.options.apiKey
          : environmentKey(route),
        fetch,
        route.id,
      );
      provider.models = {
        ...Object.fromEntries(
          models.map((model) => [
            model.id,
            {
              id: model.modelID,
              name: model.name,
              limit: model.limit,
              tool_call: model.capabilities.tools,
              modalities: {
                input: model.capabilities.input,
                output: model.capabilities.output,
              },
              variants: Object.fromEntries(
                (model.variants ?? []).map((variant) => [
                  variant.id,
                  variant.body,
                ]),
              ),
            },
          ]),
        ),
        ...provider.models,
      } as typeof provider.models;
    }
  },
  async "chat.headers"(input, output) {
    if (!routes.some((route) => route.id === input.model.providerID)) return;
    output.headers[CLIENT_HEADER] = CLIENT_NAME;
    output.headers[CLIENT_VERSION_HEADER] = PLUGIN_VERSION;
    if (input.model.providerID === "orvix-coding")
      output.headers[SESSION_HEADER] = input.sessionID;
  },
});
