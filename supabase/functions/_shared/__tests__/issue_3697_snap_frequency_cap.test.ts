import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { buildSnapchatAdSquadBody } from "../snapchat.ts";
import { AdApiError } from "../adChannelCore.ts";

const input = {
  name: "Retarget",
  optimizationGoal: "IMPRESSIONS",
  countries: ["NG"],
  budgetCents: 500,
  pixelId: "pixel-1",
  nowMs: Date.UTC(2026, 9, 22),
};

Deno.test("#3697 Snap sends the documented 3 impressions per 7 days cap", () => {
  const body = buildSnapchatAdSquadBody("campaign-1", {
    ...input,
    frequencyCap: { impressions: 3, days: 7 },
  });
  assertEquals(body.cap_and_exclusion_config, {
    frequency_cap_config: [{
      frequency_cap_count: 3,
      frequency_cap_type: "IMPRESSIONS",
      time_interval: 7,
      frequency_cap_interval: "DAYS",
    }],
  });
});

Deno.test("#3697 Snap omits caps for traffic and refuses a forced unsupported cap", () => {
  assertEquals(
    buildSnapchatAdSquadBody("campaign-1", {
      ...input,
      optimizationGoal: "PIXEL_PAGE_VIEW",
    }).cap_and_exclusion_config,
    undefined,
  );
  assertThrows(
    () =>
      buildSnapchatAdSquadBody("campaign-1", {
        ...input,
        optimizationGoal: "PIXEL_PAGE_VIEW",
        frequencyCap: { impressions: 3, days: 7 },
      }),
    AdApiError,
    "frequency cap",
  );
});
