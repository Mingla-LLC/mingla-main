// issue #2468 [maps-deep-link-coordinates] — IMPLEMENTOR happy-path regression.
//
// Deno-runnable: `mapsDeepLink.ts` imports NOTHING (the platform is injected),
// which is the whole point — the same builder runs on RN, react-native-web,
// Node and here. Mirrors the harness of `mapboxStaticProxyUrl.orch1165.test.ts`,
// its sibling in this package.
//
// Run:
//   deno test --no-check --allow-read \
//     packages/offering-rendering/__tests__/issue_2468_maps_deep_link.test.ts
//
// WHAT IS PROVED
//   T-1  coordinates present → the coordinate-anchored URL, per platform.
//   T-2  no coordinates + a label → the text form, per platform (unchanged
//        pre-#2468 behaviour — the honest fallback).
//   T-3  neither → null, so the caller DISABLES the control (Constitution #1).
//   T-4  PRIVACY: a hidden-address event NEVER yields a coordinate URL, even
//        when the host over-supplies `locationGeo`.
//   T-5  the exact production case from the issue resolves to the stored pin.
//   T-6  no product call site composes a maps URL inline any more.
//
// FAILS-ON-REVERT (verified by true LINE DELETION, recorded in the report):
//   delete the `if (geo !== null)` branch in buildMapsDeepLink → T-1/T-5 fail;
//   delete the `if (params.addressHidden) return null;` line in
//   selectVenueMapsTarget → T-4 fails; re-inline any host URL → T-6 fails.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildMapsDeepLink,
  buildMapsUrl,
  canOpenMapsTarget,
  selectVenueMapsTarget,
} from "../mapsDeepLink.ts";

// The production event from the issue: `We Go Again Exhibition`
// (3014ea7e-f3e0-40d0-b112-a51f4e37e964), location_geo (3.423375, 6.43273).
const DIDI = { lat: 6.43273, lng: 3.423375 };
const DIDI_NAME = "Didi Museum ";
const DIDI_ADDRESS = "Akin Adesola Street 175, Lagos 10, Lagos, Nigeria";

Deno.test("#2468 T-1: coordinates present → the pin is the anchor on every platform", () => {
  const ios = buildMapsDeepLink({
    geo: DIDI,
    label: "Didi Museum",
    platform: "ios",
  });
  assert(ios !== null);
  assertEquals(ios.url, "maps://?ll=6.43273,3.423375&q=Didi%20Museum");
  assertEquals(ios.coordinateAnchored, true);

  const android = buildMapsDeepLink({
    geo: DIDI,
    label: "Didi Museum",
    platform: "android",
  });
  assert(android !== null);
  assertEquals(
    android.url,
    "geo:6.43273,3.423375?q=6.43273,3.423375(Didi%20Museum)",
  );
  assertEquals(android.coordinateAnchored, true);

  const web = buildMapsDeepLink({
    geo: DIDI,
    label: "Didi Museum",
    platform: "web",
  });
  assert(web !== null);
  assertEquals(
    web.url,
    "https://www.google.com/maps/search/?api=1&query=6.43273,3.423375",
  );
  assertEquals(web.coordinateAnchored, true);

  // Every platform carries a real https fallback, so the #1605 dead-tap class
  // (Platform.select with no web key → undefined → silent no-op) cannot return.
  for (const link of [ios, android, web]) {
    assertStringIncludes(link.fallbackUrl, "https://www.google.com/maps/");
    assertStringIncludes(link.fallbackUrl, "6.43273,3.423375");
  }

  // The LABEL never reaches the coordinate slot — a provider cannot re-geocode
  // its way off the pin no matter what the label says.
  const hostile = buildMapsDeepLink({
    geo: DIDI,
    label: "London Eye",
    platform: "web",
  });
  assertEquals(
    hostile?.url,
    "https://www.google.com/maps/search/?api=1&query=6.43273,3.423375",
  );
});

Deno.test("#2468 T-1b: an unusable coordinate is NOT treated as a pin", () => {
  // Out of range, non-finite, and the repo's own 0,0 sentinel all fall back to
  // the honest text path rather than dropping a confident wrong pin.
  for (
    const geo of [
      { lat: 91, lng: 0.1 },
      { lat: 10, lng: 181 },
      { lat: Number.NaN, lng: 3.4 },
      { lat: 0, lng: 0 },
    ]
  ) {
    const link = buildMapsDeepLink({ geo, label: "Somewhere", platform: "ios" });
    assertEquals(link?.coordinateAnchored, false, JSON.stringify(geo));
    assertEquals(link?.url, "maps://?q=Somewhere");
  }
});

Deno.test("#2468 T-2: no coordinates + a label → the pre-#2468 text form, unchanged", () => {
  assertEquals(
    buildMapsUrl({ geo: null, label: DIDI_ADDRESS, platform: "ios" }),
    `maps://?q=${encodeURIComponent(DIDI_ADDRESS)}`,
  );
  assertEquals(
    buildMapsUrl({ geo: null, label: DIDI_ADDRESS, platform: "android" }),
    `geo:0,0?q=${encodeURIComponent(DIDI_ADDRESS)}`,
  );
  assertEquals(
    buildMapsUrl({ geo: null, label: DIDI_ADDRESS, platform: "web" }),
    `https://www.google.com/maps/search/?api=1&query=${
      encodeURIComponent(DIDI_ADDRESS)
    }`,
  );
  assertEquals(
    buildMapsDeepLink({ geo: null, label: DIDI_ADDRESS, platform: "ios" })
      ?.coordinateAnchored,
    false,
  );
});

Deno.test("#2468 T-3: neither a coordinate nor a label → null, so the control is DISABLED", () => {
  for (const platform of ["ios", "android", "web"]) {
    assertEquals(buildMapsDeepLink({ geo: null, label: null, platform }), null);
    assertEquals(buildMapsDeepLink({ geo: null, label: "   ", platform }), null);
    assertEquals(buildMapsUrl({ platform }), null);
  }
  assertEquals(canOpenMapsTarget(null), false);
  assertEquals(canOpenMapsTarget({ label: "", geo: null }), false);
  assertEquals(canOpenMapsTarget({ label: null, geo: DIDI }), true);
  assertEquals(canOpenMapsTarget({ label: "Somewhere", geo: null }), true);
});

Deno.test("#2468 T-4 PRIVACY: a hidden address NEVER yields a coordinate URL", () => {
  // The host over-supplies the exact pin on purpose. The anon RPC nulls
  // `locationGeo` in this case, but the AUTHENTICATED business read path maps
  // it from the row unconditionally — so the renderer must not trust its props.
  const hidden = selectVenueMapsTarget({
    venueName: DIDI_NAME,
    address: DIDI_ADDRESS,
    addressHidden: true,
    locationGeo: DIDI,
  });
  assertEquals(hidden, null, "hidden address must disable the control outright");
  assertEquals(canOpenMapsTarget(hidden), false);

  // And nothing downstream can resurrect it: a null target produces no URL.
  assertEquals(
    buildMapsDeepLink({
      geo: hidden?.geo ?? null,
      label: hidden?.label ?? null,
      platform: "ios",
    }),
    null,
  );

  // No venue name → no card, no link (the card's own render gate).
  assertEquals(
    selectVenueMapsTarget({
      venueName: null,
      address: DIDI_ADDRESS,
      addressHidden: false,
      locationGeo: DIDI,
    }),
    null,
  );

  // Revealed → the pin IS carried, with the composed label.
  const shown = selectVenueMapsTarget({
    venueName: DIDI_NAME,
    address: DIDI_ADDRESS,
    addressHidden: false,
    locationGeo: DIDI,
  });
  assertEquals(shown, {
    label: `Didi Museum, ${DIDI_ADDRESS}`,
    geo: DIDI,
  });
});

Deno.test("#2468 T-5: the reported production case lands on the stored pin", () => {
  const target = selectVenueMapsTarget({
    venueName: DIDI_NAME,
    address: DIDI_ADDRESS,
    addressHidden: false,
    locationGeo: DIDI,
  });
  assert(target !== null);
  const ios = buildMapsDeepLink({ ...target, platform: "ios" });
  assert(ios !== null);
  // The old link was the free text "Didi Museum , Akin Adesola Street 175,
  // Lagos 10, Lagos, Nigeria", which Apple resolved to Alverton Street, London
  // SE8 on a London-located device. The coordinate can no longer be re-guessed.
  assertStringIncludes(ios.url, "ll=6.43273,3.423375");
  assert(
    !ios.url.startsWith("maps://?q="),
    `must not be a free-text query, got: ${ios.url}`,
  );
});

Deno.test("#2468 T-6: NO product call site composes a maps URL inline", async () => {
  const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
  // Every surface named in #2468 plus the ones audited alongside it.
  const CALL_SITES = [
    "packages/offering-rendering/EventOfferingBody.tsx",
    "packages/offering-rendering/RsvpOfferingBody.tsx",
    "packages/offering-rendering/PublicEventPage.tsx",
    "packages/brand-rendering/PublicVenueScreen.tsx",
    "mingla-business/src/components/event/PublicEventPage.tsx",
    "mingla-business/app/rsvp/[id]/preview.tsx",
    "mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx",
    "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
    "app-mobile/src/components/ExpandedCardModal.tsx",
    "app-mobile/src/components/expandedCard/PracticalDetailsSection.tsx",
    "app-mobile/src/components/expandedCard/TimelineSection.tsx",
    "app-mobile/src/components/activity/RsvpPassSheet.tsx",
    "app-mobile/src/components/activity/CalendarTab.tsx",
    "app-mobile/app/b/[brandSlug]/v/[venueSlug].tsx",
  ];

  // COMMENTS ARE NOT CODE. Every one of these files carries a #2468 comment
  // quoting the URL shape it used to build, and a scan that flagged those would
  // be a gate nobody could keep green. Block comments go first, then any line
  // whose content is a line comment.
  const stripComments = (source: string): string =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        return !t.startsWith("//") && !t.startsWith("*");
      })
      .join("\n");

  // A URL LITERAL, not a mention: the opening quote/backtick is what separates
  // `const url = "maps://…"` from prose about the URL that is gone.
  const INLINE_URL = /["\'`](?:maps:|geo:|https:\/\/(?:www\.google|maps\.google))/;

  for (const relative of CALL_SITES) {
    const raw = await Deno.readTextFile(REPO_ROOT + relative);
    // VACUITY GUARD — a typo'd path or an empty read must FAIL, not "pass".
    // Every file in this list was touched by #2468 and says so.
    assertStringIncludes(raw, "2468", `${relative} was not read (or not fixed)`);
    const code = stripComments(raw);
    assert(code.length > 500, `${relative} stripped to nothing — bad harness`);

    const offenders = code
      .split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => INLINE_URL.test(line));
    assertEquals(
      offenders,
      [],
      `${relative} still builds a maps URL inline: ${JSON.stringify(offenders)}`,
    );
  }
});
