// #4111 Wave A — subscribe confirm landing: GET never mutates (mail scanners
// open links), POST confirms by the token's SHA-256, and the page comes from
// the shared landing-page shell.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createSubscribeConfirmHandler } from "../handler.ts";
import { sha256Hex } from "../../_shared/brandEnquiry.ts";

const TOKEN = "C".repeat(43);

function harness(result: Record<string, unknown>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const handle = createSubscribeConfirmHandler({
    rpc: (name, args) => {
      calls.push({ name, args });
      return Promise.resolve({ data: result, error: null });
    },
    log: () => {},
  });
  return { handle, calls };
}

Deno.test("#4111 GET shows the confirm button and changes nothing", async () => {
  const h = harness({ status: "confirmed" });
  const res = await h.handle(new Request(`https://x.test/public-brand-subscribe-confirm/${TOKEN}`));
  assertEquals(res.status, 200);
  assertEquals(h.calls.length, 0);
  const html = await res.text();
  assert(html.includes("Yes, keep me posted") && html.includes('method="POST"'));
  assertEquals(res.headers.get("x-frame-options"), "DENY");
});

Deno.test("#4111 POST confirms by hashed token; JSON callers get the outcome", async () => {
  const h = harness({ status: "confirmed", channel: "email", outcome: "subscribed", brand_name: "Lantern <Room>", brand_slug: "lantern" });
  const html = await h.handle(new Request(`https://x.test/public-brand-subscribe-confirm/${TOKEN}`, { method: "POST" }));
  assertEquals(html.status, 200);
  assertEquals(h.calls[0].args.p_token_hash, await sha256Hex(TOKEN));
  const page = await html.text();
  assert(page.includes("Lantern &lt;Room&gt;") && !page.includes("Lantern <Room>"), "brand name must be escaped");

  const json = await h.handle(new Request("https://x.test/public-brand-subscribe-confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: TOKEN }),
  }));
  assertEquals(await json.json(), {
    status: "confirmed", channel: "email", outcome: "subscribed", brand_name: "Lantern <Room>", brand_slug: "lantern",
  });

  const expired = harness({ status: "expired", brand_name: "Lantern Room" });
  assertEquals((await expired.handle(new Request(`https://x.test/c/${TOKEN}`, { method: "POST" }))).status, 410);
});
