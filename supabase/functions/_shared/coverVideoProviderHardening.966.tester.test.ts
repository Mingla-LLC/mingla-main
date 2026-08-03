// #966 — TESTER-AUTHORED adversarial regression (fails-on-revert).
//
// AXIS (distinct from the implementor's 5a `coverVideoProviderDefault.966.test.ts`):
//   5a attacks the DEFAULT-RESOLUTION axis — an ABSENT provider env, and a stale
//   FLAT env var `EVENT_COVER_VIDEO_PROVIDER=cloudinary`.
//   This test attacks the MALFORMED / WRONG-TYPE / BUNDLE-EMBEDDED garbage-config
//   ROBUSTNESS + NEVER-THROWS axis: it drives `coverVideoProvider()` through the
//   runtime-config BUNDLE path (`MINGLA_RUNTIME_CONFIG_JSON`) with adversarial
//   payloads — unparseable JSON, a wrong-typed provider field, a provider value
//   planted INSIDE a valid bundle, an injection-shaped non-JSON blob, and a huge
//   deeply-nested object — and proves that the Bunny hard-wire holds and never
//   throws under ANY of them.
//
// INVARIANT UNDER TEST (I-PROPOSED-966): coverVideoProvider() is Bunny-only and
// no runtime-config value — however malformed — can route cover-video away from
// Bunny, and the resolver never throws on the host path.
//
// FAILS-ON-REVERT: restoring the pre-#966 body
//   `(resolveRuntimeString("event_cover_video_provider","EVENT_COVER_VIDEO_PROVIDER") ?? "cloudinary") === "bunny" ? "bunny" : "cloudinary"`
//   makes the BUNDLE-EMBEDDED-"cloudinary" case return "cloudinary" (read from the
//   parsed bundle) and the malformed/wrong-type/non-JSON cases fall back through the
//   absent flat env to the `?? "cloudinary"` default — turning every assertion RED.
//
// Run: deno test --allow-env supabase/functions/_shared/coverVideoProviderHardening.966.tester.test.ts
import { coverVideoProvider } from "./eventCoverVideo.ts";
import { RUNTIME_CONFIG_BUNDLE } from "./runtimeConfig.ts";

const BUNDLE = RUNTIME_CONFIG_BUNDLE; // "MINGLA_RUNTIME_CONFIG_JSON"
const FLAT = "EVENT_COVER_VIDEO_PROVIDER";

// Run `fn` with a hermetic env: the bundle set to `bundleValue`, the flat
// provider env DELETED (so the reverted resolver would hit its `?? "cloudinary"`
// fallback), then restore both regardless of outcome.
const withBundle = (bundleValue: string, fn: () => void): void => {
  const prevBundle = Deno.env.get(BUNDLE);
  const prevFlat = Deno.env.get(FLAT);
  Deno.env.delete(FLAT);
  Deno.env.set(BUNDLE, bundleValue);
  try {
    fn();
  } finally {
    if (prevBundle === undefined) Deno.env.delete(BUNDLE);
    else Deno.env.set(BUNDLE, prevBundle);
    if (prevFlat === undefined) Deno.env.delete(FLAT);
    else Deno.env.set(FLAT, prevFlat);
  }
};

// Each case pairs a human label with an adversarial bundle payload.
const adversarialBundles: Array<[string, string]> = [
  ["unparseable JSON (truncated brace)", "{ not-valid-json"],
  ["injection-shaped non-JSON blob", "cloudinary'; DROP TABLE jobs; --"],
  ["empty string bundle", ""],
  ["JSON null literal", "null"],
  ["JSON array where an object is expected", "[\"cloudinary\"]"],
  [
    "valid bundle EMBEDDING event_cover_video_provider:\"cloudinary\"",
    JSON.stringify({ event_cover_video_provider: "cloudinary" }),
  ],
  [
    "wrong-typed provider field (number 42)",
    JSON.stringify({ event_cover_video_provider: 42 }),
  ],
  [
    "wrong-typed provider field (nested object)",
    JSON.stringify({ event_cover_video_provider: { evil: true } }),
  ],
  [
    "huge deeply-nested garbage object",
    JSON.stringify({
      event_cover_video_provider: "cloudinary",
      junk: Array.from({ length: 500 }, (_, i) => ({ i, nested: { deep: { deeper: i } } })),
    }),
  ],
];

for (const [label, bundle] of adversarialBundles) {
  Deno.test(`#966 tester-adversarial: malformed/garbage config [${label}] never routes away from bunny and never throws`, () => {
    withBundle(bundle, () => {
      let result: string;
      // never-throws sub-invariant: the resolver must not raise on the host path.
      try {
        result = coverVideoProvider();
      } catch (err) {
        throw new Error(
          `coverVideoProvider() threw under adversarial config [${label}]: ${String(err)}`,
        );
      }
      if (result !== "bunny") {
        throw new Error(
          `adversarial config [${label}] routed cover-video to "${result}" — MUST be "bunny" (hard-wired, #966)`,
        );
      }
    });
  });
}
