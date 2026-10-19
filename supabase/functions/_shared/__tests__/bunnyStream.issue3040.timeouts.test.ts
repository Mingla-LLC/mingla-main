// Issue #3040 (T-B6, B-6) — every Bunny control-plane call has a hard deadline.
// MINGLA-INVARIANT: I-VIDEO-BOUNDED-IO | issue #3040 | every outbound provider call has a timeout
//
// FAILS ON REVERT: call `fetch` directly (no fetchWithTimeout) in any helper and
// its test below never settles before the deadline assertion.
import {
  BUNNY_TIMEOUTS_MS,
  bunnyCreateVideo,
  bunnyDeleteVideo,
  bunnyFetchLibrarySettings,
  bunnyFindVideoByTitle,
  bunnyGetVideo,
} from "../bunnyStream.ts";
import { assert, withEnv } from "./issue3040_fakeSupabase.ts";

const ENV = {
  BUNNY_STREAM_LIBRARY_ID: "3040",
  BUNNY_STREAM_API_KEY: "test-library-key",
  BUNNY_ACCOUNT_API_KEY: "test-account-key",
};
// A transport that never answers and ignores abort: only the race can end it.
const hang = (() => new Promise<Response>(() => {})) as typeof fetch;
const TIMEOUT_MS = 40;

const settlesWithin = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  const started = Date.now();
  let guard: number | undefined;
  const result = await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      guard = setTimeout(() => reject(new Error(`${label} hung past its deadline`)), 1_000);
    }),
  ]).finally(() => clearTimeout(guard));
  assert(Date.now() - started < 1_000, `${label} took too long`);
  return result;
};

Deno.test("#3040 the default deadlines match the lane contract", () => {
  assert(BUNNY_TIMEOUTS_MS.create === 10_000, "create");
  assert(BUNNY_TIMEOUTS_MS.findByTitle === 8_000, "findByTitle");
  assert(BUNNY_TIMEOUTS_MS.get === 8_000, "get");
  assert(BUNNY_TIMEOUTS_MS.delete === 8_000, "delete");
  assert(BUNNY_TIMEOUTS_MS.settings === 5_000, "settings");
});

Deno.test("#3040 a hanging Bunny never holds any helper past its deadline", async () => {
  await withEnv(ENV, async () => {
    const options = { timeoutMs: TIMEOUT_MS, fetchImpl: hang };
    const create = await settlesWithin(bunnyCreateVideo("job", options), "create");
    assert(!create.ok && create.reason === "bunny_create_network_TimeoutError" && create.retryable, JSON.stringify(create));
    const find = await settlesWithin(bunnyFindVideoByTitle("job", options), "findByTitle");
    assert(!find.ok && find.reason === "bunny_lookup_network_TimeoutError", JSON.stringify(find));
    const get = await settlesWithin(bunnyGetVideo("guid-3040", options), "get");
    assert(!get.ok && get.status === 0 && get.reason === "bunny_get_network_TimeoutError", JSON.stringify(get));
    const del = await settlesWithin(bunnyDeleteVideo("guid-3040", options), "delete");
    assert(!del.ok && del.reason === "bunny_delete_network_TimeoutError", JSON.stringify(del));
    const settings = await settlesWithin(bunnyFetchLibrarySettings(TIMEOUT_MS, hang), "settings");
    assert(!settings.ok && settings.reason === "bunny_settings_network_TimeoutError", JSON.stringify(settings));
  });
});

Deno.test("#3040 library settings fail closed and parse the two lane settings", async () => {
  await withEnv(ENV, async () => {
    const answer = (body: unknown) =>
      (() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))) as typeof fetch;
    const ok = await bunnyFetchLibrarySettings(TIMEOUT_MS, answer({ EnabledResolutions: "240p,720p,1080p", EnableMP4Fallback: true }));
    assert(ok.ok && ok.settings.mp4Fallback && ok.settings.enabledResolutions.includes("1080p"), JSON.stringify(ok));
    const malformed = await bunnyFetchLibrarySettings(TIMEOUT_MS, answer({ EnabledResolutions: "720p" }));
    assert(!malformed.ok && malformed.reason === "bunny_settings_malformed", "a missing MP4 flag must not read as a default");
  });
});
