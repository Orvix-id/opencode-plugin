import { describe, expect, test } from "bun:test";
import { wantsSession, withSessionID } from "../src/session.ts";

const URL = "http://localhost/coding/v1/chat/completions";
const json = (body: unknown) =>
  new Request(URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("withSessionID", () => {
  test("adds session_id and keeps the rest of the body", async () => {
    const out = await withSessionID(json({ model: "orvix/glm-5.2", messages: [] }), "ses_abc");
    expect(await out.json()).toEqual({ model: "orvix/glm-5.2", messages: [], session_id: "ses_abc" });
    expect(out.headers.get("content-type")).toBe("application/json");
  });

  test("keeps a client-provided session_id", async () => {
    const out = await withSessionID(json({ session_id: "mine" }), "ses_abc");
    expect((await out.json()).session_id).toBe("mine");
  });

  test("leaves non-JSON and non-POST requests alone", async () => {
    const get = new Request(URL);
    expect(await withSessionID(get, "ses_abc")).toBe(get);
    const text = new Request(URL, { method: "POST", body: "hi", headers: { "content-type": "text/plain" } });
    expect(await withSessionID(text, "ses_abc")).toBe(text);
  });
});

test("titles skip session affinity", () => {
  expect(wantsSession("primary")).toBe(true);
  expect(wantsSession("compaction")).toBe(true);
  expect(wantsSession("title")).toBe(false);
});
