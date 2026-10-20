# @orvix-id/opencode

[OpenCode](https://opencode.ai) plugin for **Orvix**, supporting OpenCode **1.18.29+** and **2.0.21+**.
One installation registers two independent providers:

| Provider | Endpoint | Environment variable | Required scope |
| --- | --- | --- | --- |
| `orvix` | `https://api.orvix.id/v1` | `ORVIX_API_KEY` | `ai:invoke` |
| `orvix-coding` | `https://api.orvix.id/coding/v1` | `ORVIX_CODING_API_KEY` | `coding:invoke` |

Choose the route explicitly. The plugin never switches endpoints on an error. Orvix determines
funding from your eligible plan, campaign, or other applicable balance; the Coding endpoint is not
exclusive to Coding Plan subscribers. General discovery preserves managed and BYOK model IDs.

### One key for both routes

If your key has both `ai:invoke` and `coding:invoke`, only set:

```bash
export ORVIX_API_KEY="your-key"
```

Coding falls back to this shared key. Set `ORVIX_CODING_API_KEY` to override it with a separate
Coding key. In v2, a key stored through the provider's `/connect` takes precedence over environment
variables. The general provider never borrows the Coding key. A rejected key is not retried with
another credential: 401/403 produces a provider-specific diagnostic and no discovered models for
that provider, while the other provider continues loading. Explicit user model overrides remain.

## OpenCode v1

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@orvix-id/opencode"],
  "model": "orvix-coding/deepseek-v4-flash"
}
```

Set `ORVIX_API_KEY` and/or `ORVIX_CODING_API_KEY` for the providers you use. V1 uses the
OpenAI-compatible AI SDK driver. Coding requests carry session identity through a request-local
header that the plugin's fetch adapter removes and translates into `session_id` in the JSON body.
No process-global session state is used. Custom fetch implementations are wrapped, not discarded.

## OpenCode v2

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@orvix-id/opencode"],
  "model": "orvix/deepseek-v4-flash"
}
```

Use `/connect orvix` or `/connect orvix-coding`, or the environment variables above. V2 uses
OpenCode's native OpenAI-compatible driver. Existing `orvix-coding/*` configuration remains valid.

Replace `opencode-provider-orvix` in your plugin list when migrating from the community plugin;
both register `orvix`. Keep your existing `orvix/*` model selections and `ORVIX_API_KEY`.
Do not load both plugins for the same provider. Restart OpenCode after installation or configuration
changes. Discovery runs at startup; restart after changing keys or plan entitlements as well.

For local endpoints, set `ORVIX_BASE_URL` and/or `ORVIX_CODING_BASE_URL`. V1 also respects
`provider.<id>.options.baseURL`. An authenticated empty catalog stays empty.

Using Pi or Oh My Pi instead? See [@orvix-id/pi](https://github.com/Orvix-id/pi-plugin) and
[@orvix-id/omp](https://github.com/Orvix-id/omp-plugin).

## Coding setup (v2)

1. **Create a Coding key.** In [platform.orvix.id/api-keys](https://platform.orvix.id/api-keys), create a key and
   tick **Orvix Coding** (`coding:invoke`). The default AI Router scope (`ai:invoke`) is not enough; Coding
   endpoints answer `401 coding:invoke scope required`.
2. **Expose the key** to OpenCode:

   ```bash
   export ORVIX_CODING_API_KEY="orv-sk_live_..."
   ```

   Put it in your shell profile or secret manager rather than typing it into commands you share.
3. **Install the plugin:**

   ```bash
   opencode plugin add @orvix-id/opencode
   ```

   or add it to `~/.config/opencode/opencode.json` yourself:

   ```jsonc
   {
     "plugins": ["@orvix-id/opencode"],
     "model": "orvix-coding/glm-5.2"
   }
   ```

4. **Pick a model:** `opencode -m orvix-coding/deepseek-v4-flash`. Models with reasoning profiles expose variants,
   for example `orvix-coding/glm-5.2#high`.

The v2 adapter needs OpenCode 2.0.21 or newer; v1 needs 1.18.29 or newer.

## Models

The model list comes from `GET /coding/v1/models` when the key is available, so it always matches your plan.
Without network access the plugin falls back to the lineup it shipped with. Model ids drop the `orvix/` prefix:
`orvix-coding/glm-5.2` calls `orvix/glm-5.2`.

## What the plugin does

| Piece | Why |
| --- | --- |
| Provider `orvix-coding` on OpenCode's built-in OpenAI-compatible driver | Streaming, tool calls, and usage accounting stay OpenCode's own. |
| `session_id` added to every agent and compaction request | Orvix keeps a session on the same upstream route and prompt cache only when the request body carries `session_id`. OpenCode's session id is reused, so follow-up requests hit the cache. |
| `prompt_cache_key` enabled for every model | Lets cache-aware upstreams group the session as well. |
| `x-orvix-coding-client` header | Reports the client name and plugin version. Used for diagnostics only. |

Session title requests are sent without `session_id`; they use a different, very small prompt.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Model unavailable: orvix-coding/...` | The plugin did not load. Check `plugins` in `opencode.json` and run `opencode` with `--print-logs`. |
| `401 coding:invoke scope required` | The key was created without the **Orvix Coding** scope. |
| `429 coding_concurrency_exceeded` | Too many Coding requests in flight at once. OpenCode retries automatically; `retry_after` is a few seconds. |
| `429 coding_quota_exceeded` | A 5-hour, weekly, or monthly window is used up. `resets_at` says when. |

## Development

```bash
bun install
bun run check        # tsc + bun test
bun run probe        # 3 real OpenCode turns against a local mock, reports prefix reuse per request
```

## License

MIT
