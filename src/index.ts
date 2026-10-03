import { Plugin } from "@opencode/plugin";
import type { Context } from "@opencode/plugin/promise/plugin";
import {
  API_KEY_ENV,
  BASE_URL_ENV,
  CLIENT_HEADER,
  CLIENT_NAME,
  CLIENT_VERSION_HEADER,
  DEFAULT_BASE_URL,
  PLUGIN_VERSION,
  PROVIDER_ID,
  PROVIDER_NAME,
  PROVIDER_PACKAGE,
} from "./constants.ts";
import { resolveModels } from "./models.ts";
import { wantsSession, withSessionID } from "./session.ts";

async function resolveApiKey(ctx: Context): Promise<string | undefined> {
  try {
    const connection = await ctx.integration.connection.active(PROVIDER_ID);
    if (connection) {
      const credential = await ctx.integration.connection.resolve(connection);
      if (credential?.type === "key" && credential.key) return credential.key;
    }
  } catch {
    // Fall through to the environment.
  }
  return process.env[API_KEY_ENV] || undefined;
}

export default Plugin.define({
  id: PROVIDER_ID,
  async setup(ctx) {
    const baseURL = process.env[BASE_URL_ENV] || DEFAULT_BASE_URL;

    // `/connect orvix-coding` stores a key; `ORVIX_CODING_API_KEY` also works.
    await ctx.integration.transform((editor) => {
      if (!editor.get(PROVIDER_ID)) {
        editor.update(PROVIDER_ID, (integration) => {
          integration.name = PROVIDER_NAME;
        });
      }
      editor.method.update({
        integrationID: PROVIDER_ID,
        method: { type: "env", names: [API_KEY_ENV] },
      });
      editor.method.update({
        integrationID: PROVIDER_ID,
        method: { type: "key", label: "Coding API key (coding:invoke)" },
      });
    });

    const models = await resolveModels(baseURL, await resolveApiKey(ctx));

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
        if (!wantsSession(input.kind)) return;
        input.request = await withSessionID(input.request, input.sessionID);
      },
      scope,
    );
  },
});
