// #4452 T-5.12 (SC-77): a signed click 302s to the original URL and records it;
// a tampered, replayed-for-another-send or non-http link 302s home and records nothing.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { clickUrl, openPixelUrl } from "./sign.ts";
import { handleTrack } from "./track.ts";

const SECRET = "test-secret-4452";
const SEND = "4452c000-0000-4000-8000-000000000001";
const OTHER = "4452c000-0000-4000-8000-000000000002";
const BASE = "https://x.supabase.co/functions/v1/forms-track";

function deps() {
  const seen: Array<[string, string]> = [];
  return { seen, d: { secret: SECRET, record: (s: string, k: "open" | "click") => (seen.push([s, k]), Promise.resolve()) } };
}

Deno.test("SC-77 a signed click redirects to the original URL and records the click", async () => {
  const { seen, d } = deps();
  const link = await clickUrl(BASE, SECRET, SEND, "https://usemingla.com/schedule/creators?x=1");
  const res = await handleTrack(new Request(link), d);
  assertEquals(res.status, 302);
  assertEquals(res.headers.get("location"), "https://usemingla.com/schedule/creators?x=1");
  assertEquals(seen, [[SEND, "click"]]);
});

Deno.test("SC-77 tampered, replayed or unsafe links go home and record nothing", async () => {
  const { seen, d } = deps();
  const link = new URL(await clickUrl(BASE, SECRET, SEND, "https://usemingla.com/download"));
  const tampered = new URL(link); tampered.searchParams.set("u", "https://evil.example/");
  const replayed = new URL(link); replayed.searchParams.set("s", OTHER);
  const js = `${BASE}?s=${SEND}&u=${encodeURIComponent("javascript:alert(1)")}&h=${link.searchParams.get("h")}`;
  const slashes = `${BASE}?s=${SEND}&u=${encodeURIComponent("//evil.example")}&h=${link.searchParams.get("h")}`;
  for (const u of [tampered.toString(), replayed.toString(), js, slashes, `${BASE}?s=${SEND}`]) {
    const res = await handleTrack(new Request(u), d);
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "https://usemingla.com");
  }
  assertEquals(seen.length, 0);
});

Deno.test("the open pixel records a first open only with a valid signature", async () => {
  const { seen, d } = deps();
  const ok = await handleTrack(new Request(await openPixelUrl(BASE, SECRET, SEND)), d);
  assertEquals(ok.headers.get("content-type"), "image/gif");
  await handleTrack(new Request(`${BASE}?o=${SEND}.forged`), d);
  assertEquals(seen, [[SEND, "open"]]);
});
