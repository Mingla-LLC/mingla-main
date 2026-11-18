// MINGLA-INVARIANT: I-4238-PAST-BUYERS-QUESTION | issue #4238 | ad-plan adds the "can't leave out your N past buyers yet" line (and a broader verdict) only when the brand's own left-out audience has member_count > 0; with 0 past buyers no line and no broader verdict.
/**
 * #4238 honest Review questions, server side.
 *
 *   P1  0 past buyers: no line, verdict stays exact.
 *   P2  buyers present and the app's list not ready: the line carries the
 *       count and the verdict becomes broader; a ready app gets nothing.
 *   P3  plural and singular wording.
 *   P4  resolvePlanAudienceRefs sums member_count of this brand's own
 *       left-out audiences only.
 *   K1  hostAdWideningKind: past buyers / area / mixed.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyPastBuyersQuestion,
  resolvePlanAudienceRefs,
} from "../../ad-plan/index.ts";
import {
  HOST_AD_PAST_BUYERS_LINE,
  hostAdPastBuyersLine,
  hostAdWideningKind,
} from "../hostAdWidening.ts";

const rows = () => [
  { platform: "meta", verdict: "exact", wideningSummary: [] as string[] },
  { platform: "snapchat", verdict: "exact", wideningSummary: [] as string[] },
  { platform: "google", verdict: "exact", wideningSummary: [] as string[] },
];

Deno.test("P1 0 past buyers: no line and no broader verdict", () => {
  const compiled = rows();
  applyPastBuyersQuestion(compiled, {
    wantsExclude: true,
    excludeNotReady: ["meta", "snapchat", "google"],
    excludeMemberCount: 0,
  });
  assert(compiled.every((row) => row.verdict === "exact"));
  assert(compiled.every((row) => row.wideningSummary.length === 0));
});

Deno.test("P2 buyers present, list not ready: the line with the count, broader", () => {
  const compiled = rows();
  applyPastBuyersQuestion(compiled, {
    wantsExclude: true,
    excludeNotReady: ["snapchat"],
    excludeMemberCount: 38,
  });
  assertEquals(compiled[0].verdict, "exact");
  assertEquals(compiled[0].wideningSummary, []);
  assertEquals(compiled[1].verdict, "broader");
  assertEquals(compiled[1].wideningSummary, [
    "Snapchat can't leave out your 38 past buyers yet, so they may see this ad.",
  ]);
  // Google has no left-out list at all.
  assertEquals(compiled[2].verdict, "broader");
  assertEquals(compiled[2].wideningSummary, [
    "Google can't leave out your 38 past buyers yet, so they may see this ad.",
  ]);
});

Deno.test("P2b nothing to leave out when the Host did not ask", () => {
  const compiled = rows();
  applyPastBuyersQuestion(compiled, {
    wantsExclude: false,
    excludeNotReady: ["snapchat"],
    excludeMemberCount: 38,
  });
  assert(compiled.every((row) => row.verdict === "exact"));
});

Deno.test("P3 plural and singular", () => {
  assertEquals(
    hostAdPastBuyersLine("Facebook & Instagram", 1),
    "Facebook & Instagram can't leave out your 1 past buyer yet, so they may see this ad.",
  );
  assertEquals(
    hostAdPastBuyersLine("TikTok", 1204),
    "TikTok can't leave out your 1,204 past buyers yet, so they may see this ad.",
  );
  assert(HOST_AD_PAST_BUYERS_LINE.test(hostAdPastBuyersLine("TikTok", 1)));
  assert(HOST_AD_PAST_BUYERS_LINE.test(hostAdPastBuyersLine("TikTok", 1204)));
});

function fakeDb(defs: Record<string, unknown>[]) {
  return {
    from(table: string) {
      const builder = {
        select: () => builder,
        in: () =>
          Promise.resolve({
            data: table === "ad_list_audiences" ? defs : [],
            error: null,
          }),
      };
      return builder;
    },
  };
}

Deno.test("P4 member count comes from this brand's own left-out audiences", async () => {
  const result = await resolvePlanAudienceRefs(
    fakeDb([
      {
        id: "a1",
        audience_key: "brand:b1:guests",
        owner_kind: "host",
        brand_id: "b1",
        status: "active",
        member_count: 38,
      },
      {
        id: "a2",
        audience_key: "brand:b2:guests",
        owner_kind: "host",
        brand_id: "b2",
        status: "active",
        member_count: 500,
      },
    ]),
    { owner_kind: "host", brand_id: "b1" },
    {
      audience_selection: {
        include_keys: [],
        exclude_keys: ["brand:b1:guests", "brand:b2:guests"],
      },
    },
    ["snapchat"],
  );
  assertEquals(result.excludeMemberCount, 38);
  assertEquals(result.excludeNotReady, ["snapchat"]);

  const empty = await resolvePlanAudienceRefs(
    fakeDb([{
      id: "a1",
      audience_key: "brand:b1:guests",
      owner_kind: "host",
      brand_id: "b1",
      status: "active",
      member_count: 0,
    }]),
    { owner_kind: "host", brand_id: "b1" },
    { audience_selection: { include_keys: [], exclude_keys: ["brand:b1:guests"] } },
    ["snapchat"],
  );
  assertEquals(empty.excludeMemberCount, 0);
});

Deno.test("K1 the reason behind a wider group", () => {
  const buyers = hostAdPastBuyersLine("Snapchat", 38);
  const area = "TikTok uses the wider area around your pin.";
  assertEquals(hostAdWideningKind([buyers]), "past_buyers");
  assertEquals(hostAdWideningKind([area]), "area");
  assertEquals(hostAdWideningKind([buyers, area]), "mixed");
  assertEquals(hostAdWideningKind([]), "area");
});
