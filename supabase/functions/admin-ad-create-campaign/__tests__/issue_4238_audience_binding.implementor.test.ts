// Issue #4238 wave 2 — T10: create-time defence in depth. A tampered
// targeting snapshot (an audience id that is not the plan's own, selected,
// ready list audience) is refused with 409 audience_binding_mismatch before
// any provider call. Invariant I-4238-AUDIENCE-SERVER-BOUND is declared in
// ad-plan/__tests__/issue_4238_audience_binding.implementor.test.ts.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  audienceBindingMismatch,
  compiledAudienceIds,
  type PlatformBindingRow,
} from "../../_shared/adListAudienceRules.ts";

const BRAND = "4238aaaa-0000-4000-8000-000000000001";
const OTHER = "4238bbbb-0000-4000-8000-000000000002";
const own: PlatformBindingRow = {
  provider_audience_id: "111",
  platform: "meta",
  state: "ready",
  audience_key: `brand:${BRAND}:guests`,
  owner_kind: "host",
  brand_id: BRAND,
};

const check = (compiled: Record<string, unknown>, rows: PlatformBindingRow[], keys = [own.audience_key], ownerKind = "host") =>
  audienceBindingMismatch({ platform: "meta", compiled, includeKeys: keys, ownerKind, planBrandId: BRAND, rows });

Deno.test("T10 the plan's own ready audience binds", () => {
  assertEquals(check({ custom_audiences: [{ id: "111" }] }, [own]), false);
  assertEquals(check({}, [], []), false, "no selection, no ids: fine");
});

Deno.test("T10 SC-9 a tampered snapshot id is a mismatch", () => {
  assertEquals(check({ custom_audiences: [{ id: "999" }] }, [own]), true);
  assertEquals(check({ custom_audiences: [{ id: "111" }, { id: "999" }] }, [own]), true);
  assertEquals(check({ excluded_custom_audiences: [{ id: "999" }] }, [own]), true, "exclusions are checked too");
  assertEquals(check({ custom_audiences: [{ id: "999" }] }, [], []), true, "ids with no selection");
});

Deno.test("T10 another brand's audience never binds to a Host plan, even if selected", () => {
  const theirs: PlatformBindingRow = { ...own, provider_audience_id: "999", audience_key: `brand:${OTHER}:guests`, brand_id: OTHER };
  assertEquals(check({ custom_audiences: [{ id: "999" }] }, [theirs], [theirs.audience_key]), true);
  // Admin (mingla) plans may bind any brand's audience they selected.
  assertEquals(check({ custom_audiences: [{ id: "999" }] }, [theirs], [theirs.audience_key], "mingla"), false);
});

Deno.test("T10 a selected audience that stopped being ready since freeze is a mismatch", () => {
  assertEquals(check({ custom_audiences: [{ id: "111" }] }, [{ ...own, state: "too_small" }]), true);
});

Deno.test("T10 every platform's id field is read", () => {
  assertEquals(compiledAudienceIds("tiktok", { audience_ids: ["1"], excluded_audience_ids: ["2"] }), ["1", "2"]);
  assertEquals(compiledAudienceIds("snapchat", { segment_include_ids: ["3"], segment_exclude_ids: ["4"] }), ["3", "4"]);
  assertEquals(compiledAudienceIds("google", { user_list_ids: ["5"] }), ["5"]);
  assertEquals(compiledAudienceIds("reddit", { custom_audience_ids: ["6"] }), ["6"]);
});

Deno.test("T10 create checks the binding before it builds provider targeting or calls a provider", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const check = source.indexOf("audienceBindingMismatch({");
  const refusal = source.indexOf('detail: "audience_binding_mismatch"');
  const execution = source.indexOf("frozenExecutionTargeting = providerExecutionTargeting(");
  const firstProviderCreate = source.indexOf("createCampaign(", execution);
  assert(check > 0 && refusal > check && execution > refusal && firstProviderCreate > execution);
  // Staged event plans carry the same resolved ids into prospecting.
  assertEquals(
    [...source.matchAll(/prospectingAudienceIds: boundProspectingAudienceIds/g)].length,
    3,
  );
});
