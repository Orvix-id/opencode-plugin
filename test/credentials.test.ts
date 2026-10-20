import { expect, test, spyOn } from "bun:test";
import { environmentKey, credentialEnvNames, routes } from "../src/routes.ts";
import { resolveApiKey } from "../src/index.ts";
import { server } from "../src/v1.ts";

test("shared environment fallback, Coding override and stored-key precedence", async () => {
  const old = [process.env.ORVIX_API_KEY, process.env.ORVIX_CODING_API_KEY];
  try {
    process.env.ORVIX_API_KEY = "shared";
    delete process.env.ORVIX_CODING_API_KEY;
    expect(environmentKey(routes[0])).toBe("shared");
    expect(environmentKey(routes[1])).toBe("shared");
    expect(credentialEnvNames(routes[1])).toEqual([
      "ORVIX_CODING_API_KEY",
      "ORVIX_API_KEY",
    ]);
    process.env.ORVIX_CODING_API_KEY = "dedicated";
    expect(environmentKey(routes[1])).toBe("dedicated");
    const ctx = {
      integration: {
        connection: {
          active: async () => ({}),
          resolve: async () => ({ type: "key", key: "stored" }),
        },
      },
    };
    expect(await resolveApiKey(ctx as never, routes[1])).toBe("stored");
    delete process.env.ORVIX_API_KEY;
    expect(environmentKey(routes[0])).toBeUndefined();
  } finally {
    ["ORVIX_API_KEY", "ORVIX_CODING_API_KEY"].forEach((key, i) => {
      if (old[i] === undefined) delete process.env[key];
      else process.env[key] = old[i];
    });
  }
});

test("V1 uses the shared key for discovery and isolates either provider's scope rejection", async () => {
  const old = [process.env.ORVIX_API_KEY, process.env.ORVIX_CODING_API_KEY];
  const originalFetch = globalThis.fetch;
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  try {
    process.env.ORVIX_API_KEY = "shared";
    delete process.env.ORVIX_CODING_API_KEY;
    for (const denied of ["orvix", "orvix-coding"]) {
      globalThis.fetch = (async (url: string, init: RequestInit) => {
        expect(new Headers(init.headers).get("authorization")).toBe(
          "Bearer shared",
        );
        const id = url.includes("/coding/") ? "orvix-coding" : "orvix";
        return id === denied
          ? new Response(null, { status: 403 })
          : Response.json({ data: [{ id: "orvix/live-model" }] });
      }) as typeof fetch;
      const config: any = {};
      await (
        await server({} as never)
      ).config!(config);
      expect(Object.keys(config.provider[denied].models)).toEqual([]);
      const allowed = denied === "orvix" ? "orvix-coding" : "orvix";
      expect(Object.keys(config.provider[allowed].models)).toEqual([
        "live-model",
      ]);
      expect(config.provider["orvix-coding"].env).toEqual([
        "ORVIX_CODING_API_KEY",
        "ORVIX_API_KEY",
      ]);
    }
    expect(warning).toHaveBeenCalledTimes(2);
  } finally {
    globalThis.fetch = originalFetch;
    warning.mockRestore();
    ["ORVIX_API_KEY", "ORVIX_CODING_API_KEY"].forEach((key, i) => {
      if (old[i] === undefined) delete process.env[key];
      else process.env[key] = old[i];
    });
  }
});
