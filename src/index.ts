import type { Context, Plugin } from "@opencode/plugin/promise/plugin";
import {
  CLIENT_HEADER,
  CLIENT_NAME,
  CLIENT_VERSION_HEADER,
  PLUGIN_VERSION,
  PROVIDER_ID,
  PROVIDER_PACKAGE,
} from "./constants.ts";
import { resolveProviderModels } from "./models.ts";
import { wantsSession, withSessionID } from "./session.ts";
import {
  routes,
  credentialEnvNames,
  environmentKey,
  type Route,
} from "./routes.ts";
import { server } from "./v1.ts";

export async function resolveApiKey(
  ctx: Context,
  route: Route,
): Promise<string | undefined> {
  try {
    const connection = await ctx.integration.connection.active(route.id);
    if (connection) {
      const credential = await ctx.integration.connection.resolve(connection);
      if (credential?.type === "key" && credential.key) return credential.key;
    }
  } catch {
    // Fall through to the environment.
  }
  return environmentKey(route);
}

// A plain object rather than `Plugin.define(...)`: `define` only returns its
// argument, and importing it would make `@opencode/plugin` (and its large
// dependency tree) a runtime dependency of every install.
const plugin: Plugin = {
  id: PROVIDER_ID,
  async setup(ctx) {
    for (const route of routes) {
      const PROVIDER_ID = route.id;
      const PROVIDER_NAME = route.name;
      const baseURL = process.env[route.baseEnv] || route.baseURL;

      // `/connect orvix-coding` stores a key; `ORVIX_CODING_API_KEY` also works.
      await ctx.integration.transform((editor) => {
        if (!editor.get(PROVIDER_ID)) {
          editor.update(PROVIDER_ID, (integration) => {
            integration.name = PROVIDER_NAME;
          });
        }
        editor.method.update({
          integrationID: PROVIDER_ID,
          method: { type: "env", names: credentialEnvNames(route) },
        });
        editor.method.update({
          integrationID: PROVIDER_ID,
          method: { type: "key", label: `API key (${route.scope})` },
        });
      });

      const models = await resolveProviderModels(
        baseURL,
        await resolveApiKey(ctx, route),
        fetch,
        route.id,
      );

      await ctx.provider.transform((editor) => {
        // Transforms replay on every registry rebuild: keep this synchronous and idempotent.
        if (!editor.get(PROVIDER_ID)) {
          editor.add({
            info: {
              id: PROVIDER_ID,
              name: PROVIDER_NAME,
              integrationID: PROVIDER_ID,
              activation: "auto",
              package: PROVIDER_PACKAGE,
              settings: { baseURL },
            } as never,
            models,
          });
        } else {
          const existing = editor.get(PROVIDER_ID)!;
          const ids = new Set(existing.models.keys());
          editor.models.set(PROVIDER_ID, [
            ...existing.models.values(),
            ...models.filter((model) => !ids.has(model.id)),
          ]);
        }
      });

      const scope = { providerID: PROVIDER_ID };

      await ctx.session.hook(
        "model.request",
        (input) => {
          input.headers[CLIENT_HEADER] = CLIENT_NAME;
          input.headers[CLIENT_VERSION_HEADER] = PLUGIN_VERSION;
        },
        scope,
      );

      await ctx.session.hook(
        "http.request",
        async (input) => {
          if (route.id !== "orvix-coding" || !wantsSession(input.kind)) return;
          input.request = await withSessionID(input.request, input.sessionID);
        },
        scope,
      );
    }
  },
};

export default { ...plugin, server };
