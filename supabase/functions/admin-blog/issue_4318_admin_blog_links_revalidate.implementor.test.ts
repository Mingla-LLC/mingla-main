import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { isLinksRevalidated, linksRevalidateRequest, MARKETING_REVALIDATE_PATH } from "./model.ts";

const SECRET = "s".repeat(32);

Deno.test("#4318 admin-blog asks the marketing revalidate route for the links tag only", () => {
  const request = linksRevalidateRequest("https://usemingla.com", SECRET);
  assertEquals(request.url, "https://usemingla.com/api/blog/revalidate");
  assertEquals(MARKETING_REVALIDATE_PATH, "/api/blog/revalidate");
  assertEquals(request.init.method, "POST");
  assertEquals(request.init.headers, { "x-mingla-revalidate-secret": SECRET, "Content-Type": "application/json" });
  assertEquals(JSON.parse(String(request.init.body)), { tag: "links" });
});

Deno.test("#4318 admin-blog reports a /links refresh only on the route's exact success", () => {
  assertEquals(isLinksRevalidated(200, { revalidated: true, tag: "links" }), true);
  for (const [status, payload] of [
    [200, { revalidated: true, tag: "blog" }],
    [200, { revalidated: false, tag: "links" }],
    [200, { revalidated: "true", tag: "links" }],
    [200, null],
    [200, "ok"],
    [401, { error: "unauthorized" }],
    [400, { error: "unknown_tag" }],
    [500, { revalidated: true, tag: "links" }],
  ] as const) {
    assertEquals(isLinksRevalidated(status, payload), false, JSON.stringify([status, payload]));
  }
});

Deno.test("#4318 admin-blog wires revalidate_links behind the Support write guard with the governed secret", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const guard = source.indexOf('if (!permissions.data?.can_write) return json({ error: "forbidden" }, 403);');
  const action = source.indexOf('if (body.action === "revalidate_links")');
  if (guard < 0 || action < 0 || action < guard) throw new Error("revalidate_links must sit after the can_write guard");
  const block = source.slice(action, source.indexOf('return json({ error: "action_unknown" }', action));
  if (!block.includes("linksRevalidateRequest(MARKETING_ORIGIN, REVALIDATE_SECRET)")) throw new Error("revalidate_links must use the governed secret and the shared request builder");
  if (!block.includes("isLinksRevalidated(")) throw new Error("revalidate_links must check the exact success answer");
  if (/x-mingla-revalidate-secret/.test(block)) throw new Error("the secret header must come only from linksRevalidateRequest");
});
