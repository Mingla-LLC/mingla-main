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
// ---------------------------------------------------------------------------
// issue #2553 [gmaps-label] EXTENSION — G-1..G-6, appended below the #2468
// tests. Same ground, same file, on purpose: #2553 asked whether Google can be
// made to show the VENUE NAME instead of `6.43273,3.423375`, and the answer —
// runtime-proved from a device in London against this very event — is that no
// Google URL form carries a coordinate anchor AND a label. The candidate that
// looks right (`query=<lat>,<lng>(<label>)`) makes Google STRIKE THE COORDINATE
// THROUGH and resolve the label: "Eiffel Tower" landed in PARIS on web and iOS.
// That is #2468 wearing a friendly label, which is why the guard belongs HERE,
// next to the assertions it protects, and not in a file of its own.
//   G-1  the exact Google URL per platform for a geo target
//   G-2  LOAD-BEARING: Google's https `query` is the coordinate pair and
//        NOTHING else, across every platform x every shape of label
//   G-3  ANTI-VACUITY TWIN: the G-2 predicate is shown to REJECT each form
//        runtime-proved to mis-resolve, and to ACCEPT the shipped one
//   G-4  Android keeps the one documented labelled form, coordinate first
//   G-5  Apple carries the name and Google must not — the asymmetry pinned
//   G-6  the no-coordinate honest text fallback is unchanged
//
// FAILS-ON-REVERT (verified by true LINE DELETION, recorded in the report):
//   delete the `if (geo !== null)` branch in buildMapsDeepLink → T-1/T-5 fail;
//   delete the `if (params.addressHidden) return null;` line in
//   selectVenueMapsTarget → T-4 fails; re-inline any host URL → T-6 fails.
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildMapsAppLink,
  buildMapsDeepLink,
  buildMapsUrl,
  canOpenMapsTarget,
  listMapsAppChoices,
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

// ===========================================================================
// issue #2553 [gmaps-label] — THE GUARD.
//
// Nothing shipped for #2553: every Google URL form was runtime-tested against
// the DIDI event above, from a simulator located in London (the far-from-Lagos
// condition that exposed #2468), and each one either discarded the coordinate
// or discarded the label. Full evidence lives in the module's own comment block.
//
// The DECISION is the fragile thing. It reads like a one-line cosmetic bug, it
// will be re-reported, and the obvious "fix" — the venue name in Google's
// `query` — is the Paris resolution. These tests make that fix impossible to
// merge quietly.
//
// FAILS-ON-REVERT: delete the `if (geo !== null) { … }` block from
// `buildMapsAppLink`'s Google arm in mapsDeepLink.ts. Execution falls through
// to the text path, the Google URL becomes `?api=1&query=Didi%20Museum` — the
// exact #2468 free-text form — and G-1, G-2, G-4 and G-5 go red.
// ===========================================================================

const PAIR = "6.43273,3.423375";
const PLATFORMS = ["ios", "android", "web"] as const;

/**
 * THE PREDICATE THE GUARD RESTS ON.
 *
 * True ⇔ this https Google URL is anchored on `expectedPair` and the pair is
 * the ENTIRE query — no label smuggled in beside it, in parentheses or
 * otherwise, and no second parameter that could out-rank it.
 *
 * Written against the PARSED url, never the raw string, precisely so it cannot
 * be satisfied by a substring coincidence: `query=6.43273,3.423375(Didi Museum)`
 * CONTAINS the pair and is still the Paris bug.
 */
const isPureCoordinateGoogleUrl = (
  url: string,
  expectedPair: string,
): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (!parsed.hostname.endsWith("google.com")) return false;
  // `q` is Google's legacy SEARCH slot. Its presence at all means someone
  // reached for the Apple-shaped `ll=…&q=…` form, which runtime-resolved to
  // Paris (`!3d48.8583701!4d2.2944813`). There is no safe use of it here.
  if (parsed.searchParams.has("q")) return false;
  const query = parsed.searchParams.get("query");
  if (query === null) return false;
  return query === expectedPair;
};

Deno.test("#2553 G-1: the Google link is the coordinate form on every platform", () => {
  const ios = buildMapsAppLink({
    app: "google",
    geo: DIDI,
    label: "Didi Museum",
    platform: "ios",
  });
  assertEquals(
    ios?.url,
    `https://www.google.com/maps/search/?api=1&query=${PAIR}`,
    "iOS Google must stay on the coordinate-only https form",
  );

  const web = buildMapsAppLink({
    app: "google",
    geo: DIDI,
    label: "Didi Museum",
    platform: "web",
  });
  assertEquals(
    web?.url,
    `https://www.google.com/maps/search/?api=1&query=${PAIR}`,
    "web Google must stay on the coordinate-only https form",
  );

  const android = buildMapsAppLink({
    app: "google",
    geo: DIDI,
    label: "Didi Museum",
    platform: "android",
  });
  assertEquals(
    android?.url,
    `geo:${PAIR}?q=${PAIR}(Didi%20Museum)`,
    "Android keeps the documented geo: intent, label included",
  );

  for (const platform of PLATFORMS) {
    const choice = buildMapsAppLink({
      app: "google",
      geo: DIDI,
      label: "Didi Museum",
      platform,
    });
    assertEquals(
      choice?.coordinateAnchored,
      true,
      `${platform}: a stored coordinate must report coordinateAnchored`,
    );
  }
});

Deno.test("#2553 G-2: Google's query is the coordinate pair and nothing else", () => {
  // Deliberately hostile labels: a plain name, one whose parentheses collide
  // with the geo: label wrapper, an accented one, and one naming a world-famous
  // place 5,000km away — the exact probe that exposed the Paris resolution.
  const labels = ["Didi Museum", "The Shed (Brixton)", "Café Neu", "Eiffel Tower", null];

  for (const label of labels) {
    for (const platform of PLATFORMS) {
      const choice = buildMapsAppLink({
        app: "google",
        geo: DIDI,
        label,
        platform,
      });
      assert(choice !== null, `${platform}/${label}: expected a Google choice`);

      // The https form is what iOS and web OPEN, and Android's fallback.
      assert(
        isPureCoordinateGoogleUrl(choice.fallbackUrl, PAIR),
        `${platform}/${label}: Google https fallback is not purely coordinate-anchored — got ${choice.fallbackUrl}`,
      );

      // Not one character of the label may reach the https URL. A label that
      // cannot reach the query cannot re-geocode the pin.
      if (label !== null) {
        const firstWord = label.split(/[\s(]+/)[0];
        assert(
          !choice.fallbackUrl.includes(firstWord),
          `${platform}/${label}: label text leaked into the Google https URL — ${choice.fallbackUrl}`,
        );
      }

      if (platform !== "android") {
        assert(
          isPureCoordinateGoogleUrl(choice.url, PAIR),
          `${platform}/${label}: primary Google url is not purely coordinate-anchored — got ${choice.url}`,
        );
      }
    }
  }

  // The chooser path must not launder a different URL in.
  for (const platform of PLATFORMS) {
    const google = listMapsAppChoices({
      geo: DIDI,
      label: "Didi Museum",
      platform,
    }).find((c) => c.id === "google");
    assert(google !== undefined, `${platform}: chooser dropped Google`);
    assert(
      isPureCoordinateGoogleUrl(google.fallbackUrl, PAIR),
      `${platform}: chooser's Google fallback drifted from the coordinate form`,
    );
  }
});

Deno.test("#2553 G-3: the guard rejects every form proven to mis-resolve", () => {
  // Runtime-proved: Google struck the coordinate through ("Partial match") and
  // offered the Eiffel Tower in Paris. This is #2468 wearing a label.
  assertEquals(
    isPureCoordinateGoogleUrl(
      `https://www.google.com/maps/search/?api=1&query=${PAIR}(Didi%20Museum)`,
      PAIR,
    ),
    false,
    "parenthesised label inside `query` must be rejected — it re-geocodes",
  );

  // Runtime-proved: resolved to !3d48.8583701!4d2.2944813 — Paris. `ll` ignored.
  assertEquals(
    isPureCoordinateGoogleUrl(
      `https://maps.google.com/?ll=${PAIR}&q=Didi%20Museum`,
      PAIR,
    ),
    false,
    "the Apple-shaped ll=&q= form must be rejected — Google ignores `ll`",
  );

  // The original #2468 defect, unadorned.
  assertEquals(
    isPureCoordinateGoogleUrl(
      "https://www.google.com/maps/search/?api=1&query=Didi%20Museum",
      PAIR,
    ),
    false,
    "a free-text query must be rejected",
  );

  // A DIFFERENT coordinate must not satisfy a guard asked about ours.
  assertEquals(
    isPureCoordinateGoogleUrl(
      "https://www.google.com/maps/search/?api=1&query=48.8583701,2.2944813",
      PAIR,
    ),
    false,
    "the guard must compare the actual pair, not merely 'looks like a coordinate'",
  );

  // ...and the real shipped URL must still be ACCEPTED, or the predicate is
  // simply always-false and proves nothing at all (#2113's bug class).
  assertEquals(
    isPureCoordinateGoogleUrl(
      `https://www.google.com/maps/search/?api=1&query=${PAIR}`,
      PAIR,
    ),
    true,
    "the shipped URL must PASS — a cannot-pass guard carries no information",
  );
});

Deno.test("#2553 G-4: Android keeps its label, and the coordinate outranks it", () => {
  const android = buildMapsAppLink({
    app: "google",
    geo: DIDI,
    label: "Eiffel Tower",
    platform: "android",
  });
  assert(android !== null);

  // The authority is the segment BEFORE the `?`. A label cannot reach it.
  const [authority, queryPart] = android.url.split("?");
  assertEquals(
    authority,
    `geo:${PAIR}`,
    "the geo: authority must be the stored coordinate",
  );
  assert(
    queryPart.startsWith(`q=${PAIR}(`),
    `the geo: query must lead with the coordinate — got ${queryPart}`,
  );
  assertStringIncludes(
    android.url,
    "(Eiffel%20Tower)",
    "Android must still carry the human label Android documents",
  );
  assertEquals(android.coordinateAnchored, true);

  // Structural parentheses in a venue name must not close the wrapper early.
  const parens = buildMapsAppLink({
    app: "google",
    geo: DIDI,
    label: "The Shed (Brixton)",
    platform: "android",
  });
  assertEquals(
    parens?.url,
    `geo:${PAIR}?q=${PAIR}(The%20Shed%20%28Brixton%29)`,
    "inner parentheses must be percent-escaped so the wrapper stays balanced",
  );
});

Deno.test("#2553 G-5: Apple anchors AND labels, which is why the gap is Google's", () => {
  const apple = buildMapsAppLink({
    app: "apple",
    geo: DIDI,
    label: "Didi Museum",
    platform: "ios",
  });
  assertEquals(
    apple?.url,
    `maps://?ll=${PAIR}&q=Didi%20Museum`,
    "Apple must keep BOTH the ll anchor and the q label",
  );
  assertEquals(apple?.coordinateAnchored, true);

  // The asymmetry IS the finding: Apple's link carries the name, Google's
  // cannot. If these two ever agree, someone has changed one of them.
  const google = buildMapsAppLink({
    app: "google",
    geo: DIDI,
    label: "Didi Museum",
    platform: "ios",
  });
  assertNotEquals(
    apple?.url,
    google?.url,
    "Apple and Google links are different shapes by necessity",
  );
  assertStringIncludes(
    apple!.url,
    "Didi",
    "Apple carries the venue name (its q= is a pure display label)",
  );
  assert(
    !google!.url.includes("Didi"),
    "Google must NOT carry the venue name (its query= is a search slot)",
  );
});

Deno.test("#2553 G-6: with no coordinate, the honest text fallback still applies", () => {
  const web = buildMapsAppLink({
    app: "google",
    geo: null,
    label: "Didi Museum",
    platform: "web",
  });
  assertEquals(
    web?.url,
    "https://www.google.com/maps/search/?api=1&query=Didi%20Museum",
    "no pin ⇒ text search is the honest fallback, not a fabricated coordinate",
  );
  assertEquals(
    web?.coordinateAnchored,
    false,
    "the text fallback must declare itself NOT coordinate-anchored",
  );

  // And nothing at all is still nothing — never a dead tap.
  assertEquals(
    buildMapsAppLink({
      app: "google",
      geo: null,
      label: null,
      platform: "web",
    }),
    null,
    "no coordinate and no label must return null, not an empty search",
  );
});
