// #966 — implementor happy-path regression (fails-on-revert).
//
// Proves the #966 flip: coverVideoProvider() is HARD-WIRED to "bunny" and no
// longer reads the runtime-config field, so neither a MISSING config nor a
// stale/drifted "cloudinary" value can ever route cover-video to the retired
// provider.
//
// FAILS-ON-REVERT: restoring the prior body
//   `(resolveRuntimeString("event_cover_video_provider", "EVENT_COVER_VIDEO_PROVIDER") ?? "cloudinary") === "bunny" ? "bunny" : "cloudinary"`
// makes T-1 return "cloudinary" (no env → the `?? "cloudinary"` default) and T-2
// return "cloudinary" (reads the stale env), turning both RED.
//
// Run: deno test --allow-env supabase/functions/_shared/coverVideoProviderDefault.966.test.ts
import { coverVideoProvider, providerConfigured } from "./eventCoverVideo.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const withEnv = (
  vars: Record<string, string | null>,
  run: () => void,
): void => {
  const keys = Object.keys(vars);
  const prev = new Map<string, string | undefined>();
  for (const key of keys) prev.set(key, Deno.env.get(key));
  try {
    for (const key of keys) {
      const value = vars[key];
      if (value === null) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
    run();
  } finally {
    for (const key of keys) {
      const original = prev.get(key);
      if (original === undefined) Deno.env.delete(key);
      else Deno.env.set(key, original);
    }
  }
};

Deno.test("#966 T-1 coverVideoProvider() resolves to bunny with NO provider env / config bundle", () => {
  withEnv(
    { EVENT_COVER_VIDEO_PROVIDER: null, MINGLA_RUNTIME_CONFIG_JSON: null },
    () => {
      assert(
        coverVideoProvider() === "bunny",
        `expected "bunny" with no config, got "${coverVideoProvider()}"`,
      );
    },
  );
});

Deno.test("#966 T-2 coverVideoProvider() IGNORES a stale 'cloudinary' config and still returns bunny", () => {
  withEnv(
    { EVENT_COVER_VIDEO_PROVIDER: "cloudinary", MINGLA_RUNTIME_CONFIG_JSON: null },
    () => {
      assert(
        coverVideoProvider() === "bunny",
        `a stale 'cloudinary' provider config must not route away from bunny, got "${coverVideoProvider()}"`,
      );
    },
  );
});

Deno.test("#966 T-3 providerConfigured() returns a boolean and does not throw (Bunny-only)", () => {
  const result = providerConfigured();
  assert(typeof result === "boolean", "providerConfigured() must return a boolean");
});
