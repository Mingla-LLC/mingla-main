// @ts-nocheck
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const COMPONENTS = [
  "app-mobile/src/components/activity/SavedTab.tsx",
  "app-mobile/src/components/activity/ProposeDateTimeModal.tsx",
  "app-mobile/src/components/expandedCard/ActionButtons.tsx",
];

Deno.test("ORCH-1021: scheduling paths do not expose weak closed/unknown escape copy", async () => {
  for (const path of COMPONENTS) {
    const source = await Deno.readTextFile(path);
    assert(!source.includes("Schedule Anyway"), `${path} still contains Schedule Anyway`);
    assert(!source.includes("schedule_anyway"), `${path} still references schedule_anyway`);
    assert(!source.toLowerCase().includes("may be closed"), `${path} still says may be closed`);
    assert(!source.toLowerCase().includes("appears to be closed"), `${path} still says appears to be closed`);
  }
});

Deno.test("ORCH-1021: single-card scheduling paths use decisive shared helper", async () => {
  const savedTab = await Deno.readTextFile("app-mobile/src/components/activity/SavedTab.tsx");
  const modal = await Deno.readTextFile("app-mobile/src/components/activity/ProposeDateTimeModal.tsx");
  const actionButtons = await Deno.readTextFile("app-mobile/src/components/expandedCard/ActionButtons.tsx");

  assert(savedTab.includes("checkSingleCardSchedulingAvailability"));
  assert(modal.includes("checkSingleCardSchedulingAvailability"));
  assert(actionButtons.includes("checkSingleCardSchedulingAvailability"));
  assert(actionButtons.includes("checkAllCuratedStopsOpen"));
  assertEquals((actionButtons.match(/isPlaceOpenAt/g) ?? []).length, 0);
});
