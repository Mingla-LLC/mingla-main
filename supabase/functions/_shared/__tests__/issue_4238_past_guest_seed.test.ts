/**
 * #4238 W3 T-3 — the past-guests starting audience stays off until staff
 * switch it on with a privacy-review reference.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { hostPastGuestSeedKeys } from "../adHostPlanRules.ts";

const KEYS = ["brand:b:guests", "brand:b:guests_lookalike"];
const on = { past_guest_seed_enabled: true };

Deno.test("SC-T3: with the switch off, no list id enters a Mingla-chosen plan", () => {
  for (
    const extra of [{}, { past_guest_seed_enabled: false }, {
      past_guest_seed_enabled: "true",
    }, null]
  ) {
    assertEquals(
      hostPastGuestSeedKeys({
        audienceChoice: "mingla",
        platforms: ["meta"],
        connections: [{ platform: "meta", extra }],
        readyListKeys: KEYS,
      }),
      [],
    );
  }
});

Deno.test("T-3: on for every chosen app + Mingla's choice + a ready list → the seed is added", () => {
  assertEquals(
    hostPastGuestSeedKeys({
      audienceChoice: "mingla",
      platforms: ["meta", "snapchat"],
      connections: [{ platform: "meta", extra: on }, {
        platform: "snapchat",
        extra: on,
      }],
      readyListKeys: KEYS,
    }),
    KEYS,
  );
});

Deno.test("T-3 adversarial: the Host's own audience choice, one app off, or no ready list → no seed", () => {
  const connections = [{ platform: "meta", extra: on }, {
    platform: "tiktok",
    extra: {},
  }];
  assertEquals(
    hostPastGuestSeedKeys({
      audienceChoice: "host",
      platforms: ["meta"],
      connections,
      readyListKeys: KEYS,
    }),
    [],
  );
  assertEquals(
    hostPastGuestSeedKeys({
      audienceChoice: undefined,
      platforms: ["meta"],
      connections,
      readyListKeys: KEYS,
    }),
    [],
  );
  assertEquals(
    hostPastGuestSeedKeys({
      audienceChoice: "mingla",
      platforms: ["meta", "tiktok"],
      connections,
      readyListKeys: KEYS,
    }),
    [],
  );
  assertEquals(
    hostPastGuestSeedKeys({
      audienceChoice: "mingla",
      platforms: ["meta"],
      connections,
      readyListKeys: [],
    }),
    [],
  );
});
