// issue #2508 [maps-app-chooser] — implementor happy-path regression suite.
//
// WHAT THIS PINS
//   T-1  the chooser offers EXACTLY the apps that can open on each platform
//        (ios: Apple + Google · android: Google only · web: Google + Apple)
//   T-2  BOTH options stay coordinate-anchored when a coordinate exists — the
//        chooser picks the APP, never the accuracy (#2468 must not be undone)
//   T-3  the honest text fallback still applies when there is NO coordinate
//   T-4  Android is never offered Apple Maps, and never gets a one-row chooser
//   T-5  web never emits `maps://` from a browser
//   T-6  PRIVACY — a withheld address exposes NEITHER control, from the SAME
//        single predicate, with no second gate anywhere
//   T-7  the copy text is the human ADDRESS (what you paste into Waze/Uber),
//        and it is derived from the GATED target, not from a raw address prop
//   T-8  structural: every renderer feeds the chooser the gated target, and
//        every host mount point wires the copy effect (no surface silently
//        ships without it)
//   T-9  #2468 NON-REGRESSION — `buildMapsDeepLink` is byte-identical, and the
//        Android link the chooser would use is byte-identical to it
//
// FAILS-ON-REVERT (real line deletion, not a comment-out):
//   delete the `if (params.app === "apple") { if (platform === "android") return null;`
//     line in mapsDeepLink.ts        → T-1 and T-4 fail
//   delete the `if (geo !== null)` branch of buildMapsAppLink
//                                    → T-2 fails
//   delete `selectAddressCopyText`'s `if (target === null …) return null`
//                                    → T-6 fails
//   drop `onCopyAddress` from any host mount point
//                                    → T-8 fails
//
// Deno, so it runs beside the #2468 suites in the SAME registered workflow job
// and needs no React/react-native runtime.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildMapsAppLink,
  buildMapsDeepLink,
  listMapsAppChoices,
  selectAddressCopyText,
  selectVenueMapsTarget,
  type MapsAppId,
} from "../mapsDeepLink.ts";

// The SAME production event #2468 was proven against: `We Go Again Exhibition`
// (3014ea7e-f3e0-40d0-b112-a51f4e37e964), stored pin lat 6.43273 / lng 3.423375,
// Victoria Island Lagos. Its free-text form resolved to a flat in south London.
const DIDI = { lat: 6.43273, lng: 3.423375 };
const PAIR = "6.43273,3.423375";
const VENUE = "Didi Museum";
const ADDRESS = "Akin Adesola Street 175, Lagos 10, Lagos, Nigeria";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

const readRepoFile = async (relative: string): Promise<string> => {
  const source = await Deno.readTextFile(REPO_ROOT + relative);
  // VACUITY GUARD — a wrong path must FAIL, not silently pass an empty string.
  assert(
    source.length > 500,
    `${relative} was not read (got ${source.length} bytes)`,
  );
  return source;
};

const idsFor = (platform: string): MapsAppId[] =>
  listMapsAppChoices({ geo: DIDI, label: VENUE, platform }).map((c) => c.id);

// ---------------------------------------------------------------------------
// T-1 — the platform matrix. Exactly the openable apps, in order.
// ---------------------------------------------------------------------------
Deno.test("#2508 T-1: the chooser offers exactly the apps that can open, per platform", () => {
  assertEquals(idsFor("ios"), ["apple", "google"]);
  assertEquals(idsFor("android"), ["google"]);
  assertEquals(idsFor("web"), ["google", "apple"]);

  // An unknown platform normalises to web, so it can never fall through to an
  // empty list (which would disable the control on a surface that works).
  assertEquals(idsFor("windows"), ["google", "apple"]);

  // Every entry carries the app's REAL name — the sheet and the accessibility
  // label read the same string.
  const ios = listMapsAppChoices({ geo: DIDI, label: VENUE, platform: "ios" });
  assertEquals(ios.map((c) => c.label), ["Apple Maps", "Google Maps"]);
});

// ---------------------------------------------------------------------------
// T-2 — BOTH options stay coordinate-anchored. This is the #2468 promise.
// ---------------------------------------------------------------------------
Deno.test("#2508 T-2: with a coordinate, EVERY choice is anchored on the pin and carries no free text", () => {
  for (const platform of ["ios", "android", "web"]) {
    const choices = listMapsAppChoices({
      geo: DIDI,
      label: `${VENUE}, ${ADDRESS}`,
      platform,
    });
    assert(choices.length > 0, `${platform} produced no choice`);
    for (const choice of choices) {
      assertEquals(
        choice.coordinateAnchored,
        true,
        `${platform}/${choice.id} lost its coordinate anchor`,
      );
      // The pin is in BOTH the primary url and the https fallback, so no arm
      // of the open path can be re-geocoded.
      assertStringIncludes(choice.url, PAIR, `${platform}/${choice.id} url`);
      assertStringIncludes(
        choice.fallbackUrl,
        PAIR,
        `${platform}/${choice.id} fallbackUrl`,
      );
      // The street is never the SEARCH TERM. #2468's own iOS form deliberately
      // carries the composed "<venue>, <address>" in `q=` — but as the pin's
      // CAPTION, with `ll=` as the authority ahead of it, which Apple resolves
      // as a label and never re-geocodes. What must never come back are the
      // three TEXT-ONLY shapes, where the address IS the query and the provider
      // re-geocodes it (that is what put a Lagos event on Alverton Street, SE8):
      assert(
        !/^maps:\/\/\?q=/.test(choice.url),
        `${platform}/${choice.id} fell back to Apple's text-only search`,
      );
      assert(
        !choice.url.startsWith("geo:0,0?q="),
        `${platform}/${choice.id} fell back to Android's no-coordinate sentinel`,
      );
      for (const url of [choice.url, choice.fallbackUrl]) {
        const query = /[?&]query=([^&]*)/.exec(url)?.[1];
        if (query !== undefined) {
          assertEquals(
            query,
            PAIR,
            `${platform}/${choice.id} sent Google a free-text query`,
          );
        }
      }
    }
  }

  // The exact shapes the issue specifies.
  const apple = buildMapsAppLink({
    app: "apple",
    geo: DIDI,
    label: VENUE,
    platform: "ios",
  });
  assert(apple !== null);
  assertEquals(apple.url, `maps://?ll=${PAIR}&q=Didi%20Museum`);
  assertEquals(
    apple.fallbackUrl,
    `https://maps.apple.com/?ll=${PAIR}&q=Didi%20Museum`,
  );

  const google = buildMapsAppLink({
    app: "google",
    geo: DIDI,
    label: VENUE,
    platform: "ios",
  });
  assert(google !== null);
  assertEquals(
    google.url,
    `https://www.google.com/maps/search/?api=1&query=${PAIR}`,
  );
});

// ---------------------------------------------------------------------------
// T-3 — no coordinate ⇒ the honest text fallback, unchanged.
// ---------------------------------------------------------------------------
Deno.test("#2508 T-3: no coordinate → the honest text fallback still applies to every app", () => {
  const encoded = encodeURIComponent(ADDRESS);

  const appleIos = buildMapsAppLink({
    app: "apple",
    geo: null,
    label: ADDRESS,
    platform: "ios",
  });
  assert(appleIos !== null);
  assertEquals(appleIos.url, `maps://?q=${encoded}`);
  assertEquals(appleIos.coordinateAnchored, false);

  const googleAndroid = buildMapsAppLink({
    app: "google",
    geo: null,
    label: ADDRESS,
    platform: "android",
  });
  assert(googleAndroid !== null);
  assertEquals(googleAndroid.url, `geo:0,0?q=${encoded}`);
  assertEquals(googleAndroid.coordinateAnchored, false);

  const googleWeb = buildMapsAppLink({
    app: "google",
    geo: null,
    label: ADDRESS,
    platform: "web",
  });
  assert(googleWeb !== null);
  assertEquals(
    googleWeb.url,
    `https://www.google.com/maps/search/?api=1&query=${encoded}`,
  );

  // (0,0) is still rejected as this repo's "no coordinate" sentinel, so it
  // takes the text path rather than dropping a confident pin in the Gulf of
  // Guinea — the chooser inherits that, it does not re-decide it.
  const sentinel = buildMapsAppLink({
    app: "apple",
    geo: { lat: 0, lng: 0 },
    label: ADDRESS,
    platform: "ios",
  });
  assert(sentinel !== null);
  assertEquals(sentinel.coordinateAnchored, false);

  // Nothing to open at all ⇒ null for every app, so no dead option can render.
  for (const app of ["apple", "google"] as MapsAppId[]) {
    for (const platform of ["ios", "android", "web"]) {
      assertEquals(
        buildMapsAppLink({ app, geo: null, label: null, platform }),
        null,
      );
      assertEquals(
        buildMapsAppLink({ app, geo: null, label: "   ", platform }),
        null,
      );
    }
    void app;
  }
  assertEquals(
    listMapsAppChoices({ geo: null, label: null, platform: "ios" }).length,
    0,
  );
});

// ---------------------------------------------------------------------------
// T-4 — Android never sees Apple Maps, and never gets a one-row chooser.
// ---------------------------------------------------------------------------
Deno.test("#2508 T-4: Apple Maps does not exist on Android, so Android is never offered it", () => {
  assertEquals(
    buildMapsAppLink({
      app: "apple",
      geo: DIDI,
      label: VENUE,
      platform: "android",
    }),
    null,
    "an Apple option on Android would be a tap that cannot open",
  );
  // Even with no coordinate — the platform, not the data, is the reason.
  assertEquals(
    buildMapsAppLink({
      app: "apple",
      geo: null,
      label: ADDRESS,
      platform: "android",
    }),
    null,
  );

  const android = listMapsAppChoices({
    geo: DIDI,
    label: VENUE,
    platform: "android",
  });
  assert(!android.some((c) => c.id === "apple"));
  // ONE choice ⇒ the renderer opens directly instead of drawing a one-row
  // sheet. The `geo:` intent already makes ANDROID ITSELF offer Google Maps,
  // Waze and anything else installed, which is better than we could draw.
  assertEquals(android.length, 1);

  // The component enforces that, not just the data.
  return readRepoFile("packages/offering-rendering/VenueMapsActions.tsx").then(
    (source) => {
      assertStringIncludes(
        source,
        "if (choices.length > 1) {",
        "requestOpenMaps must only ask when there is more than one openable app",
      );
      assertStringIncludes(
        source,
        "if (!actions.offersChoice) return null;",
        "the chooser must not mount when there is nothing to choose between",
      );
    },
  );
});

// ---------------------------------------------------------------------------
// T-5 — web never gambles on a custom scheme.
// ---------------------------------------------------------------------------
Deno.test("#2508 T-5: web never emits maps:// — every web choice is a real https URL", () => {
  for (const label of [VENUE, null]) {
    const choices = listMapsAppChoices({ geo: DIDI, label, platform: "web" });
    for (const choice of choices) {
      assert(
        !choice.url.startsWith("maps://"),
        `web/${choice.id} emitted a browser-unreliable custom scheme`,
      );
      assert(choice.url.startsWith("https://"), `web/${choice.id} url`);
      assertEquals(
        choice.url,
        choice.fallbackUrl,
        `web/${choice.id} should already BE its own fallback`,
      );
    }
  }
  const apple = buildMapsAppLink({
    app: "apple",
    geo: DIDI,
    label: VENUE,
    platform: "web",
  });
  assert(apple !== null);
  assertEquals(apple.url, `https://maps.apple.com/?ll=${PAIR}&q=Didi%20Museum`);
});

// ---------------------------------------------------------------------------
// T-6 — PRIVACY. The single highest-severity assertion in this suite.
// ---------------------------------------------------------------------------
Deno.test("#2508 T-6 PRIVACY: a withheld address exposes NEITHER the chooser NOR the copy button", () => {
  const hidden = selectVenueMapsTarget({
    venueName: VENUE,
    address: ADDRESS,
    addressHidden: true,
    locationGeo: DIDI,
  });
  // The ONE predicate. It is null, and everything hangs off it.
  assertEquals(hidden, null);

  // No chooser: there is no target to list choices for.
  assertEquals(
    listMapsAppChoices({
      geo: hidden?.geo ?? null,
      label: hidden?.label ?? null,
      platform: "ios",
    }).length,
    0,
    "a hidden-address event must offer no map app at all",
  );

  // No copy button: there is no text to copy.
  assertEquals(
    selectAddressCopyText(hidden),
    null,
    "a hidden-address event must expose no copy text",
  );
  assertEquals(selectAddressCopyText(null), null);
  assertEquals(selectAddressCopyText(undefined), null);

  // ...and the same offering with the address REVEALED gets both, so the test
  // above is not passing because the fixture is simply empty.
  const shown = selectVenueMapsTarget({
    venueName: VENUE,
    address: ADDRESS,
    addressHidden: false,
    locationGeo: DIDI,
  });
  assert(shown !== null);
  assert(listMapsAppChoices({ ...shown, platform: "ios" }).length === 2);
  assertEquals(selectAddressCopyText(shown), `${VENUE}, ${ADDRESS}`);
});

Deno.test("#2508 T-6b PRIVACY: the two controls share ONE gate — there is no second predicate", async () => {
  const source = await readRepoFile(
    "packages/offering-rendering/VenueMapsActions.tsx",
  );
  // Both affordances derive from `target`, the already-gated value.
  assertStringIncludes(source, "const copyText = selectAddressCopyText(target);");
  assertStringIncludes(source, "if (target === null) return [];");

  // Scan the CODE, not the prose: the file's header comment legitimately NAMES
  // the props it must never accept, and a substring check over the whole file
  // would pass or fail on documentation instead of behaviour.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  assert(code.length > 1500, "comment stripping ate the module");
  // The module must NOT be able to re-derive an address or a pin of its own:
  // it never takes `locationGeo`, and it never re-evaluates the hide predicate.
  for (const forbidden of [
    "locationGeo",
    "hideAddressUntilTicket",
    "addressRevealed",
    "addressHidden",
  ]) {
    assert(
      !code.includes(forbidden),
      `VenueMapsActions must not know about \`${forbidden}\` — the gate is upstream`,
    );
  }
});

// ---------------------------------------------------------------------------
// T-7 — copy puts the HUMAN ADDRESS on the clipboard, not a URL or a pin.
// ---------------------------------------------------------------------------
Deno.test("#2508 T-7: the copy text is the human address, so it pastes into Waze / Uber / a message", () => {
  const target = selectVenueMapsTarget({
    venueName: VENUE,
    address: ADDRESS,
    addressHidden: false,
    locationGeo: DIDI,
  });
  assert(target !== null);
  const copied = selectAddressCopyText(target);
  assertEquals(copied, "Didi Museum, Akin Adesola Street 175, Lagos 10, Lagos, Nigeria");
  // Deliberately NOT a URL and NOT a coordinate pair — the user is pasting it
  // somewhere that expects an address.
  assert(copied !== null);
  assert(!copied.includes("http"));
  assert(!copied.includes(PAIR));

  // Whitespace-only labels are not "something to copy".
  assertEquals(selectAddressCopyText({ label: "   ", geo: DIDI }), null);
  // A pin with no label has nothing human to paste, so no copy button.
  assertEquals(selectAddressCopyText({ label: null, geo: DIDI }), null);
});

// ---------------------------------------------------------------------------
// T-8 — structural. Every renderer, every host, no silent gap.
// ---------------------------------------------------------------------------
Deno.test("#2508 T-8: every public renderer feeds the chooser the GATED target", async () => {
  const RENDERERS = [
    "packages/offering-rendering/EventOfferingBody.tsx",
    "packages/offering-rendering/RsvpOfferingBody.tsx",
    "packages/offering-rendering/PublicEventPage.tsx",
  ];
  for (const relative of RENDERERS) {
    const source = await readRepoFile(relative);
    assertStringIncludes(
      source,
      "selectVenueMapsTarget({",
      `${relative} must still build its target through the privacy gate`,
    );
    assertStringIncludes(
      source,
      "useVenueMapsActions({",
      `${relative} must drive both controls from the shared controller`,
    );
    assertStringIncludes(
      source,
      "target: venueMapsTarget,",
      `${relative} must feed the controller the GATED target, nothing else`,
    );
    assertStringIncludes(
      source,
      "<VenueCopyAddressButton",
      `${relative} must render the copy button`,
    );
    assertStringIncludes(
      source,
      "<MapsAppChooserDialog",
      `${relative} must render the chooser`,
    );
    // The renderers still must not reach the URL builder themselves (#2468 A-5).
    assert(!/\bbuildMapsDeepLink\s*\(/.test(source), `${relative} bypass`);
    assert(!/\bbuildMapsUrl\s*\(/.test(source), `${relative} bypass`);
  }

  // The venue page lives in the sibling package and must behave identically.
  const venue = await readRepoFile("packages/brand-rendering/PublicVenueScreen.tsx");
  assertStringIncludes(venue, "useVenueMapsActions({");
  assertStringIncludes(venue, "<VenueCopyAddressButton");
  assertStringIncludes(venue, "<MapsAppChooserDialog");
});

Deno.test("#2508 T-8b: every host mount point wires the copy effect — no surface ships without it", async () => {
  // If a host renders one of the shared bodies but forgets `onCopyAddress`,
  // the copy button silently does not render on that surface and nobody
  // notices. Each entry is [file, how many mount points must carry it].
  const HOSTS: Array<[string, number]> = [
    ["app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx", 3],
    ["app-mobile/app/b/[brandSlug]/v/[venueSlug].tsx", 1],
    ["mingla-business/src/components/event/PublicEventPage.tsx", 3],
    ["mingla-business/app/rsvp/[id]/preview.tsx", 1],
    ["mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx", 1],
    ["mingla-business/src/components/event/FoundationEventPreview.tsx", 1],
    ["mingla-business/src/components/event/FoundationRsvpPreview.tsx", 1],
  ];
  for (const [relative, expected] of HOSTS) {
    const source = await readRepoFile(relative);
    const wired = source.split(/onCopyAddress[=:]/).length - 1;
    assert(
      wired >= expected,
      `${relative} wires onCopyAddress ${wired}× but has ${expected} mount point(s) — a surface would ship with no copy button`,
    );
  }

  // And each app owns a real clipboard effect for it to call.
  for (const util of [
    "app-mobile/src/utils/copyAddressText.ts",
    "mingla-business/src/utils/copyAddressText.ts",
  ]) {
    const source = await readRepoFile(util);
    assertStringIncludes(source, "export async function copyAddressText");
    // It must THROW rather than resolve on a copy that did not happen, or the
    // button would confirm a copy the user never got (Constitution #3).
    // Quote-agnostic: a formatter must not be able to red this gate.
    assert(
      /throw new Error\(["']clipboard_unavailable["']\)/.test(source),
      `${util} must throw when there is no clipboard, never resolve silently`,
    );
  }
});

// ---------------------------------------------------------------------------
// T-9 — #2468 NON-REGRESSION. The chooser must not have moved the pin.
// ---------------------------------------------------------------------------
Deno.test("#2508 T-9: #2468's default link is byte-identical, and Android's link is unchanged", () => {
  // The exact strings issue_2468_maps_deep_link.test.ts T-1 pins. Repeated here
  // deliberately: #2508 is the change most likely to disturb them.
  const ios = buildMapsDeepLink({ geo: DIDI, label: VENUE, platform: "ios" });
  assert(ios !== null);
  assertEquals(ios.url, `maps://?ll=${PAIR}&q=Didi%20Museum`);

  const android = buildMapsDeepLink({
    geo: DIDI,
    label: VENUE,
    platform: "android",
  });
  assert(android !== null);
  assertEquals(android.url, `geo:${PAIR}?q=${PAIR}(Didi%20Museum)`);

  const web = buildMapsDeepLink({ geo: DIDI, label: VENUE, platform: "web" });
  assert(web !== null);
  assertEquals(
    web.url,
    `https://www.google.com/maps/search/?api=1&query=${PAIR}`,
  );

  // Android's single choice resolves to the SAME url the default path emits,
  // so an Android guest's experience is bit-for-bit what #2468 shipped.
  const androidChoice = buildMapsAppLink({
    app: "google",
    geo: DIDI,
    label: VENUE,
    platform: "android",
  });
  assert(androidChoice !== null);
  assertEquals(androidChoice.url, android.url);
  assertEquals(androidChoice.fallbackUrl, android.fallbackUrl);

  // A venue whose name closes the Android label wrapper early is still escaped
  // in the ONE place that builds the wrapper (tester P3-2 on PR #2479).
  const shed = buildMapsAppLink({
    app: "google",
    geo: DIDI,
    label: "The Shed (Brixton)",
    platform: "android",
  });
  assert(shed !== null);
  assertStringIncludes(shed.url, "%28Brixton%29");
});
