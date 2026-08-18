// #2107 tester adversarial proof — server half.
//
// The attack surface here is narrow but unforgiving: this endpoint is the only
// thing that can tell an installed app to block itself. Anything it says that
// the client believes must be exactly what the operator wrote, and anything
// ambiguous must degrade to `silent`.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  interpretOtaPolicyRow,
  isOtaUpdateMode,
  isSupportedRuntimeVersion,
} from "./appOtaPolicy.ts";

const row = (overrides: Record<string, unknown> = {}) => ({
  app_id: "explorer",
  platform: "ios",
  runtime_version: "1.1.4",
  mode: "acknowledge",
  message: "A required update is ready.",
  updated_at: "2026-08-17T12:00:00.000Z",
  ...overrides,
});

Deno.test("#2107 adversarial: another lane's row can never be served as this lane's", () => {
  // A row leaking across runtimes is the exact shape of the bootstrap disaster:
  // a 1.1.4 requirement answered to a 1.1.2 caller blocks a lane that has no
  // update to take.
  assertEquals(
    interpretOtaPolicyRow(row({ runtime_version: "1.1.4" }), "explorer", "ios", "1.1.2"),
    null,
  );
  assertEquals(
    interpretOtaPolicyRow(row({ app_id: "business" }), "explorer", "ios", "1.1.4"),
    null,
  );
  assertEquals(
    interpretOtaPolicyRow(row({ platform: "android" }), "explorer", "ios", "1.1.4"),
    null,
  );
});

Deno.test("#2107 adversarial: a mode nobody named is not a mode", () => {
  for (
    const mode of [
      "ACKNOWLEDGE",
      " acknowledge",
      "acknowledge ",
      "force-restart",
      "block",
      true,
      0,
      {},
    ]
  ) {
    assertEquals(isOtaUpdateMode(mode), false);
    assertEquals(interpretOtaPolicyRow(row({ mode }), "explorer", "ios", "1.1.4"), null);
  }
});

Deno.test("#2107 adversarial: version-shaped junk cannot address a lane", () => {
  for (
    const value of [
      "1.1.4-beta",
      "1.1.4.1",
      "1.1.04",
      " 1.1.4",
      "1.1.4\n",
      "",
      undefined,
      123,
    ]
  ) {
    assertEquals(isSupportedRuntimeVersion(value), false);
  }
});

Deno.test("#2107 adversarial: an empty message never fabricates blocking copy server-side", () => {
  // The client supplies its own fallback string. The server must not silently
  // invent user-facing copy, and an empty message must not invalidate a real
  // policy row either.
  const policy = interpretOtaPolicyRow(row({ message: "" }), "explorer", "ios", "1.1.4");
  assertEquals(policy?.mode, "acknowledge");
  assertEquals(policy?.message, "");
});

Deno.test("#2107 adversarial: undefined and null rows both mean silent, never blocking", () => {
  for (const absent of [null, undefined]) {
    const policy = interpretOtaPolicyRow(absent, "business", "android", "1.1.3");
    assertEquals(policy?.mode, "silent");
  }
});
