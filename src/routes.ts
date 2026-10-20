export const routes = [
  {
    id: "orvix",
    name: "Orvix",
    env: "ORVIX_API_KEY",
    baseEnv: "ORVIX_BASE_URL",
    baseURL: "https://api.orvix.id/v1",
    scope: "ai:invoke",
  },
  {
    id: "orvix-coding",
    name: "Orvix Coding",
    env: "ORVIX_CODING_API_KEY",
    baseEnv: "ORVIX_CODING_BASE_URL",
    baseURL: "https://api.orvix.id/coding/v1",
    scope: "coding:invoke",
  },
] as const;
export type Route = (typeof routes)[number];

export function credentialEnvNames(route: Route): string[] {
  return route.id === "orvix-coding"
    ? [route.env, "ORVIX_API_KEY"]
    : [route.env];
}

export function environmentKey(route: Route): string | undefined {
  return credentialEnvNames(route)
    .map((name) => process.env[name])
    .find(Boolean);
}
