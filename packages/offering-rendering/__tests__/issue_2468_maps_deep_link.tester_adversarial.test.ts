// issue #2468 [maps-deep-link-coordinates] + #2469 [explorer-venue-name-duplicated]
// — TESTER ADVERSARIAL regression.
//
// DIFFERENT ANGLE FROM THE IMPLEMENTOR SUITES, DELIBERATELY.
//
// `issue_2468_maps_deep_link.test.ts` (T-1..T-6) and
// `issue_2469_explorer_parsed_location.test.ts` (E-1..E-5) walk the happy path:
// one good coordinate, one hidden-address case, one production row, per
// platform. They prove the fix WORKS.
//
// This suite assumes the fix is BROKEN and attacks the seams instead:
//
//   A-1  hostile coordinate SHAPES the database can actually hand us —
//        Postgres `point` parsed to STRINGS, the raw `{x,y}` shape, `-0`,
//        NaN/Infinity. A silently-accepted bad shape re-opens #2468.
//   A-2  the lat/lng envelope at its exact boundaries (inclusive vs exclusive),
//        and (0, lng) / (lat, 0) which are REAL places and must survive the
//        (0,0) sentinel rejection.
//   A-3  a SWAPPED lat/lng is undetectable — pinned so nobody adds a "helpful"
//        silent swap heuristic that would corrupt valid S/W coordinates.
//   A-4  PRIVACY as an exhaustive 16-row matrix, not one example: every
//        addressHidden row must yield null AND leak no coordinate digit.
//   A-5  PRIVACY structurally: `selectVenueMapsTarget` is the ONLY lock, so no
//        event renderer may reach `buildMapsDeepLink` with a raw `locationGeo`.
//   A-6  `cityGeo` cannot become the pin even when a caller force-feeds it.
//   A-7  FALLBACK HONESTY — a coordinate-less event must open the text form and
//        must never fabricate a pin (Constitution #9).
//   A-8  the #1605 WEB ARM generalized: NO platform string, known or unknown,
//        may produce an undefined/relative URL (Constitution #1, dead taps).
//   A-9  LABEL HOSTILITY — `&`, `?`, `#`, `%`, newlines, emoji must never
//        corrupt the coordinate that anchors the link.
//   A-10 #2469's un-doubling invariant under MALFORMED theme shapes.
//   A-11 the seed -> canonical handoff cannot flip the rendered address
//        mid-flight on a cold /e/ open.
//   A-12 the shared extractor is the fix for the read path that still doubles.
//
// Run:
//   deno test --no-check --allow-read \
//     packages/offering-rendering/__tests__/issue_2468_maps_deep_link.tester_adversarial.test.ts
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildMapsDeepLink,
  canOpenMapsTarget,
  normalizeMapsGeo,
  selectVenueMapsTarget,
} from "../mapsDeepLink.ts";
import {
  extractPublicEventLocation,
  mapPublicEventSeedRow,
} from "../../../app-mobile/src/services/publicEventSeedService.ts";

// Production truth for `We Go Again Exhibition`
// (3014ea7e-f3e0-40d0-b112-a51f4e37e964): location_geo (3.423375, 6.43273),
// i.e. lat 6.43273 / lng 3.423375 — Didi Museum, Victoria Island, Lagos.
const LAT = 6.43273;
const LNG = 3.423375;
const DIDI = { lat: LAT, lng: LNG };
const VENUE = "Didi Museum ";
const ADDRESS = "Akin Adesola Street 175, Lagos 10, Lagos, Nigeria";
const COMBINED = `${VENUE} · ${ADDRESS}`;

const PLATFORMS = ["ios", "android", "web"] as const;

// ---------------------------------------------------------------------------
// A-1 — hostile coordinate SHAPES
// ---------------------------------------------------------------------------
// `publicEventSeedService.parseLocationGeoPoint` reads a Postgres `point` that
// arrives either as the string "(lng,lat)" or as `{x,y}`. If ANY of those raw
// shapes reached `normalizeMapsGeo` un-parsed and were accepted, the URL would
// carry `ll=undefined,undefined` (a dead pin) or `ll=NaN,NaN`. Rejecting them
// is what forces the honest text path instead.
Deno.test("#2468 A-1: DB-shaped junk is rejected, never stringified into a pin", () => {
  const rejected: Array<[string, unknown]> = [
    // Postgres point parsed but left as STRINGS (the most likely real leak:
    // PostgREST hands numerics back as strings in several paths).
    ["string coordinates", { lat: "6.43273", lng: "3.423375" }],
    ["one string half", { lat: 6.43273, lng: "3.423375" }],
    // The raw pg point shape, never mapped to lat/lng.
    ["raw {x,y} point", { x: 3.423375, y: 6.43273 }],
    // The regex in parseLocationGeoPoint accepts "1.2.3" and Number()s it to NaN.
    ["NaN halves", { lat: NaN, lng: NaN }],
    ["one NaN half", { lat: 6.43273, lng: NaN }],
    ["Infinity", { lat: Infinity, lng: 3.423375 }],
    ["-Infinity", { lat: -Infinity, lng: -Infinity }],
    ["null halves", { lat: null, lng: null }],
    ["undefined halves", { lat: undefined, lng: undefined }],
    ["empty object", {}],
    ["null geo", null],
    ["undefined geo", undefined],
    // The repo's own "I hold no coordinate" idiom.
    ["exact (0,0) sentinel", { lat: 0, lng: 0 }],
    // -0 === 0 in JS, so the sentinel guard must still catch the signed zero.
    ["signed-zero sentinel", { lat: -0, lng: -0 }],
  ];

  for (const [what, geo] of rejected) {
    assertEquals(
      normalizeMapsGeo(geo as never),
      null,
      `${what} must be rejected as a coordinate`,
    );
    // And the link built from it must take the TEXT path, not emit junk.
    for (const platform of PLATFORMS) {
      const link = buildMapsDeepLink({ geo: geo as never, label: VENUE, platform });
      assert(link !== null, `${what} + a label must still open something`);
      assertEquals(
        link.coordinateAnchored,
        false,
        `${what} must NOT be reported as coordinate-anchored`,
      );
      assert(
        !link.url.includes("undefined") && !link.url.includes("NaN"),
        `${what} leaked junk into ${platform} url: ${link.url}`,
      );
      assert(
        !link.fallbackUrl.includes("undefined") &&
          !link.fallbackUrl.includes("NaN"),
        `${what} leaked junk into ${platform} fallbackUrl: ${link.fallbackUrl}`,
      );
    }
  }
});

// A signed zero on ONE half is a real coordinate (the equator / the prime
// meridian), and it must serialize as "0", never "-0" — `maps://?ll=-0,3.42`
// is not a URL any provider promises to parse.
Deno.test("#2468 A-1b: a signed zero on one half survives and serializes as 0", () => {
  const geo = normalizeMapsGeo({ lat: -0, lng: LNG });
  assert(geo !== null, "(-0, lng) is a real place on the equator");
  const ios = buildMapsDeepLink({ geo, label: null, platform: "ios" });
  assert(ios !== null);
  assertEquals(ios.url, `maps://?ll=0,${LNG}`);
  assert(!ios.url.includes("-0,"), `signed zero leaked: ${ios.url}`);
});

// ---------------------------------------------------------------------------
// A-2 — envelope boundaries
// ---------------------------------------------------------------------------
Deno.test("#2468 A-2: the lat/lng envelope is inclusive at its edges, exclusive beyond", () => {
  const accepted = [
    { lat: 90, lng: 180 },
    { lat: -90, lng: -180 },
    { lat: 0, lng: 180 },
    // (0, lng) and (lat, 0) are REAL places — only EXACT (0,0) is the sentinel.
    { lat: 0, lng: LNG },
    { lat: LAT, lng: 0 },
  ];
  for (const geo of accepted) {
    assertEquals(
      normalizeMapsGeo(geo),
      geo,
      `${JSON.stringify(geo)} is inside the envelope and must be kept`,
    );
  }

  const rejected = [
    { lat: 90.0000001, lng: 0 },
    { lat: -90.0000001, lng: 0 },
    { lat: 0, lng: 180.0000001 },
    { lat: 0, lng: -180.0000001 },
    // A latitude that is really a longitude — out of range, so this one IS
    // caught. See A-3 for the case that is not.
    { lat: 137.5, lng: 3.42 },
  ];
  for (const geo of rejected) {
    assertEquals(
      normalizeMapsGeo(geo),
      null,
      `${JSON.stringify(geo)} is outside the envelope and must be rejected`,
    );
  }
});

// ---------------------------------------------------------------------------
// A-3 — a swapped pair is UNDETECTABLE, and must stay that way
// ---------------------------------------------------------------------------
// The Lagos pin swapped (lat 3.423375 / lng 6.43273) is in the Gulf of Guinea,
// ~350 km offshore. Both halves are inside the envelope, so no validator can
// tell it from a legitimate coordinate. This test PINS that the builder emits
// exactly what it is handed: the guarantee lives in the producer
// (`parseLocationGeoPoint`, which maps pg `point` x->lng / y->lat), not here.
//
// It exists so that nobody "fixes" a future mis-pin by adding a silent swap
// heuristic — that would corrupt every genuinely southern/western venue.
Deno.test("#2468 A-3: a lat/lng SWAP is emitted verbatim — no silent re-ordering", () => {
  const swapped = { lat: LNG, lng: LAT };
  assertEquals(
    normalizeMapsGeo(swapped),
    swapped,
    "a swapped pair is inside the envelope; the builder cannot detect it",
  );
  const ios = buildMapsDeepLink({ geo: swapped, label: VENUE, platform: "ios" });
  assert(ios !== null);
  assertStringIncludes(
    ios.url,
    `ll=${LNG},${LAT}`,
    "the builder must NOT silently re-order the pair it was given",
  );
  // And the correct order is still the correct order.
  const good = buildMapsDeepLink({ geo: DIDI, label: VENUE, platform: "ios" });
  assert(good !== null);
  assertStringIncludes(good.url, `ll=${LAT},${LNG}`);
});

// ---------------------------------------------------------------------------
// A-4 — PRIVACY, as an exhaustive matrix
// ---------------------------------------------------------------------------
// The implementor's T-4 proves ONE hidden-address case. This walks all 16
// combinations of (addressHidden x venueName x address x locationGeo) and
// asserts the gate is TOTAL: every hidden row is null, and no digit of the
// stored pin can appear anywhere reachable from that row.
Deno.test("#2468 A-4 PRIVACY: every hidden-address combination yields null and leaks no pin", () => {
  const bools = [true, false];
  let hiddenRows = 0;

  for (const addressHidden of bools) {
    for (const hasVenue of bools) {
      for (const hasAddress of bools) {
        for (const hasGeo of bools) {
          const params = {
            venueName: hasVenue ? VENUE : null,
            address: hasAddress ? ADDRESS : null,
            addressHidden,
            locationGeo: hasGeo ? DIDI : null,
          };
          const row = JSON.stringify(params);
          const target = selectVenueMapsTarget(params);

          if (addressHidden) {
            hiddenRows += 1;
            assertEquals(target, null, `hidden row must be null: ${row}`);
            assertEquals(
              canOpenMapsTarget(target),
              false,
              `hidden row must disable the control: ${row}`,
            );
            continue;
          }

          // Not hidden: the control is enabled only when there IS a venue name
          // (the card itself hangs on it) — and then the pin rides along.
          if (!hasVenue) {
            assertEquals(target, null, `no venue name -> no card: ${row}`);
            continue;
          }
          assert(target !== null, `visible row must produce a target: ${row}`);
          assertEquals(
            target.geo,
            hasGeo ? DIDI : null,
            `visible row must carry exactly the pin it was given: ${row}`,
          );
        }
      }
    }
  }

  // VACUITY GUARD — half the matrix must actually have been the hidden arm.
  assertEquals(hiddenRows, 8, "the hidden arm of the matrix did not run");
});

// The RSVP page's gate is the INVERSE flag (`addressHidden: !addressRevealed`).
// A viewer who has not revealed the street must never reach the pin, and the
// `addressRevealed` variant must not be wired backwards.
Deno.test("#2468 A-4b PRIVACY: the RSVP addressRevealed variant gates the same way", () => {
  for (const addressRevealed of [false, true]) {
    const target = selectVenueMapsTarget({
      venueName: VENUE,
      address: ADDRESS,
      addressHidden: !addressRevealed,
      locationGeo: DIDI,
    });
    if (!addressRevealed) {
      assertEquals(target, null, "an un-revealed RSVP address must not pin");
    } else {
      assert(target !== null);
      assertEquals(target.geo, DIDI);
    }
  }
});

// ---------------------------------------------------------------------------
// A-5 — PRIVACY, structurally: the gate is the only lock
// ---------------------------------------------------------------------------
// `buildMapsDeepLink` has NO privacy gate of its own — feed it a hidden event's
// coordinate directly and it will happily emit the exact pin. That is by
// design (the venue page has no hidden-address concept), but it means the
// three EVENT renderers must all route through `selectVenueMapsTarget`.
// This test proves the bypass is real AND that no renderer takes it.
Deno.test("#2468 A-5 PRIVACY: buildMapsDeepLink has no gate, so no event renderer may bypass selectVenueMapsTarget", async () => {
  // 1. The bypass genuinely leaks — this is WHY the structural check matters.
  const bypass = buildMapsDeepLink({ geo: DIDI, label: VENUE, platform: "ios" });
  assert(bypass !== null);
  assertStringIncludes(
    bypass.url,
    `ll=${LAT},${LNG}`,
    "sanity: calling the builder directly DOES emit the exact pin",
  );

  // 2. No event renderer does that.
  const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
  const EVENT_RENDERERS = [
    "packages/offering-rendering/EventOfferingBody.tsx",
    "packages/offering-rendering/RsvpOfferingBody.tsx",
    "packages/offering-rendering/PublicEventPage.tsx",
  ];

  for (const relative of EVENT_RENDERERS) {
    const source = await Deno.readTextFile(REPO_ROOT + relative);
    // VACUITY GUARD — a bad path must fail, not silently pass.
    assert(source.length > 2000, `${relative} was not read`);

    assertStringIncludes(
      source,
      "selectVenueMapsTarget({",
      `${relative} must build its target through the privacy gate`,
    );
    assert(
      !/\bbuildMapsDeepLink\s*\(/.test(source),
      `${relative} calls buildMapsDeepLink directly — it would bypass the gate`,
    );
    assert(
      !/\bbuildMapsUrl\s*\(/.test(source),
      `${relative} calls buildMapsUrl directly — it would bypass the gate`,
    );
  }

  // 3. The gate short-circuits BEFORE the coordinate is read. Source order is
  //    the invariant: an early `return null` that moved below the locationGeo
  //    read would still pass every behavioural test above for the CURRENT
  //    param order, but would leak the moment the guard was refactored.
  const gateSource = await Deno.readTextFile(
    REPO_ROOT + "packages/offering-rendering/mapsDeepLink.ts",
  );
  const guardAt = gateSource.indexOf("if (params.addressHidden) return null;");
  const geoReadAt = gateSource.indexOf("normalizeMapsGeo(params.locationGeo)");
  assert(guardAt > 0, "the addressHidden guard is gone");
  assert(geoReadAt > 0, "the locationGeo read is gone");
  assert(
    guardAt < geoReadAt,
    "the addressHidden guard must come BEFORE locationGeo is ever read",
  );
});

// ---------------------------------------------------------------------------
// A-6 — cityGeo can never become the pin
// ---------------------------------------------------------------------------
// A city centroid is honest as a zoomed-out thumbnail centre and DISHONEST as
// a labelled pin (Constitution #9 — fabricated precision). The param type has
// no `cityGeo` field; this proves a caller force-feeding one is ignored at
// runtime, not merely rejected by tsc.
Deno.test("#2468 A-6: a force-fed cityGeo is ignored — it never becomes the pin", () => {
  const LAGOS_CENTROID = { lat: 6.5244, lng: 3.3792 };
  const target = selectVenueMapsTarget({
    venueName: VENUE,
    address: ADDRESS,
    addressHidden: false,
    locationGeo: null,
    // deliberately not on the type — this is the attack
    cityGeo: LAGOS_CENTROID,
  } as never);

  assert(target !== null, "the card still renders on the text path");
  assertEquals(target.geo, null, "cityGeo must NOT be adopted as the pin");

  for (const platform of PLATFORMS) {
    const link = buildMapsDeepLink({
      geo: target.geo,
      label: target.label,
      platform,
    });
    assert(link !== null);
    assertEquals(link.coordinateAnchored, false);
    for (const url of [link.url, link.fallbackUrl]) {
      assert(
        !url.includes("6.5244") && !url.includes("3.3792"),
        `the city centroid leaked into the link: ${url}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// A-7 — fallback honesty
// ---------------------------------------------------------------------------
Deno.test("#2468 A-7: no stored coordinate -> the text form opens, and NO pin is fabricated", () => {
  const target = selectVenueMapsTarget({
    venueName: "The Function",
    address: "12 Freetyped Road, Somewhere",
    addressHidden: false,
    locationGeo: null,
  });
  assert(target !== null, "a coordinate-less event must still be openable");
  assertEquals(target.geo, null);
  assertEquals(canOpenMapsTarget(target), true, "the control stays ENABLED");

  for (const platform of PLATFORMS) {
    const link = buildMapsDeepLink({
      geo: target.geo,
      label: target.label,
      platform,
    });
    assert(link !== null, `${platform} must open the text form`);
    assertEquals(link.coordinateAnchored, false);

    // The honest text form carries the LABEL, never an invented pair.
    assertStringIncludes(link.url, encodeURIComponent("The Function"));
    // No `ll=` anywhere, on any platform.
    assert(!link.url.includes("ll="), `fabricated ios pin: ${link.url}`);
    assert(
      !link.fallbackUrl.includes("ll="),
      `fabricated fallback pin: ${link.fallbackUrl}`,
    );
    // The android sentinel `geo:0,0?q=` is the honest "no coordinate" idiom —
    // it must NOT be reported as an anchor, and 0,0 must not reach the web
    // fallback as if it were a real query coordinate.
    assert(
      !/query=[-\d.]+,[-\d.]+$/.test(link.fallbackUrl),
      `the text fallback must not look like a coordinate query: ${link.fallbackUrl}`,
    );
  }

  // Android specifically keeps the pre-#2468 byte-form.
  const android = buildMapsDeepLink({
    geo: null,
    label: "The Function",
    platform: "android",
  });
  assert(android !== null);
  assertStringIncludes(android.url, "geo:0,0?q=");
  assertEquals(android.coordinateAnchored, false);
});

// ---------------------------------------------------------------------------
// A-8 — the #1605 web arm, generalized
// ---------------------------------------------------------------------------
// #1605: a `Platform.select({ ios, android })` returns `undefined` on web and
// the `if (url)` guard that followed silently no-opped — a dead tap nobody
// could see. The regression class is "an unrecognised platform yields nothing".
// So: NO platform string, known or unknown, may fail to produce an openable
// absolute URL, on EITHER branch.
Deno.test("#2468 A-8: no platform string can produce a dead tap (Constitution #1)", () => {
  const PLATFORM_STRINGS = [
    "ios",
    "android",
    "web",
    "windows",
    "macos",
    "native",
    "IOS", // case matters: anything not exactly "ios"/"android" is web
    "Android",
    "",
    "undefined",
  ];

  for (const platform of PLATFORM_STRINGS) {
    for (const geo of [DIDI, null]) {
      const link = buildMapsDeepLink({ geo, label: VENUE, platform });
      assert(
        link !== null,
        `platform "${platform}" (geo=${geo !== null}) produced NO link`,
      );
      assert(
        typeof link.url === "string" && link.url.length > 0,
        `platform "${platform}" produced an empty url`,
      );
      // The fallback is what makes the tap survivable everywhere: it must ALWAYS
      // be an absolute https URL a browser can open.
      assert(
        link.fallbackUrl.startsWith("https://"),
        `platform "${platform}" fallbackUrl is not absolute https: ${link.fallbackUrl}`,
      );
      // Anything that is not exactly ios/android is treated as web, and web's
      // primary URL IS the https fallback (no native scheme to fail on).
      if (platform !== "ios" && platform !== "android") {
        assertEquals(
          link.url,
          link.fallbackUrl,
          `platform "${platform}" must fall back to the universal https form`,
        );
        assert(
          link.url.startsWith("https://"),
          `platform "${platform}" web arm is not an openable URL: ${link.url}`,
        );
      }
    }
  }

  // The ONLY null is "we hold neither a coordinate nor a label" — and that is a
  // real answer the caller must translate into a DISABLED control.
  for (const platform of PLATFORM_STRINGS) {
    assertEquals(
      buildMapsDeepLink({ geo: null, label: null, platform }),
      null,
      `platform "${platform}" must return null when there is nothing to open`,
    );
    assertEquals(buildMapsDeepLink({ geo: null, label: "   ", platform }), null);
  }
});

// ---------------------------------------------------------------------------
// A-9 — label hostility must never corrupt the coordinate
// ---------------------------------------------------------------------------
Deno.test("#2468 A-9: a hostile label can never move the pin", () => {
  const HOSTILE = [
    "Bar & Grill",
    "What? Bar",
    "Studio #4",
    "100% Bar",
    "a=b&ll=51.5074,-0.1278", // an injection attempt at the ll param itself
    "Line\nBreak",
    "Café Über 北京 🎉",
    'The "Quote" Room',
    "The Shed (Brixton)",
    "6.43273,3.423375", // a label that looks like a coordinate
    "x".repeat(500),
  ];

  for (const label of HOSTILE) {
    const ios = buildMapsDeepLink({ geo: DIDI, label, platform: "ios" });
    assert(ios !== null);
    // The coordinate must sit intact between `ll=` and the FIRST `&q=`.
    assert(
      ios.url.startsWith(`maps://?ll=${LAT},${LNG}&q=`),
      `label ${JSON.stringify(label)} corrupted the ios pin: ${ios.url}`,
    );
    // And the encoded label must round-trip back to exactly what we passed.
    const encoded = ios.url.slice(`maps://?ll=${LAT},${LNG}&q=`.length);
    assertEquals(
      decodeURIComponent(encoded),
      label.trim(),
      `label ${JSON.stringify(label)} did not round-trip`,
    );

    const android = buildMapsDeepLink({ geo: DIDI, label, platform: "android" });
    assert(android !== null);
    // Everything before the FIRST `?` must be exactly the geo authority.
    assertEquals(
      android.url.slice(0, android.url.indexOf("?")),
      `geo:${LAT},${LNG}`,
      `label ${JSON.stringify(label)} corrupted the android geo authority`,
    );
    assertStringIncludes(android.url, `?q=${LAT},${LNG}(`);

    // The web arm is the pair ONLY — the label never reaches it, so it cannot
    // be re-geocoded no matter what the label contains. That is the whole fix.
    const web = buildMapsDeepLink({ geo: DIDI, label, platform: "web" });
    assert(web !== null);
    assertEquals(
      web.url,
      `https://www.google.com/maps/search/?api=1&query=${LAT},${LNG}`,
      `label ${JSON.stringify(label)} reached the web query`,
    );
  }
});

// `encodeURIComponent` leaves `!'()*-._~` unescaped, so a label containing a
// closing paren lands INSIDE android's `(<label>)` wrapper unescaped. The
// coordinate authority is untouched (A-9 proves that), so the pin is still
// right and this is a label-rendering nit, not a mis-pin. Pinned so the
// behaviour is visible if it is ever tightened.
Deno.test("#2468 A-9b: an unescaped paren in an android label is a known, contained gap", () => {
  const android = buildMapsDeepLink({
    geo: DIDI,
    label: "The Shed (Brixton)",
    platform: "android",
  });
  assert(android !== null);
  assertStringIncludes(android.url, "(The%20Shed%20(Brixton))");
  // The contract that actually matters: the pin is still the stored pin.
  assert(android.url.startsWith(`geo:${LAT},${LNG}?q=${LAT},${LNG}(`));
  assertEquals(android.coordinateAnchored, true);
});

// ---------------------------------------------------------------------------
// A-10 — #2469's un-doubling invariant under malformed theme shapes
// ---------------------------------------------------------------------------
// THE INVARIANT (#2469): the combined `location_text` is never returned in BOTH
// halves, and never on `address` beside a non-null `venueName`. The implementor
// proves it for the production row; this proves it for every shape a JSONB
// column can actually hold.
Deno.test("#2469 A-10: the un-doubling invariant holds for every malformed theme shape", () => {
  const THEMES: Array<[string, unknown]> = [
    ["null theme", null],
    ["undefined theme", undefined],
    ["string theme", "not-an-object"],
    ["number theme", 42],
    ["array theme", []],
    ["empty object", {}],
    ["business_event null", { business_event: null }],
    ["business_event string", { business_event: "nope" }],
    ["business_event array", { business_event: [] }],
    ["location null", { business_event: { location: null } }],
    ["location string", { business_event: { location: "nope" } }],
    ["location array", { business_event: { location: [] } }],
    ["location number", { business_event: { location: 7 } }],
    ["halves non-string", {
      business_event: { location: { venueName: 12, address: {} } },
    }],
    ["halves empty strings", {
      business_event: { location: { venueName: "", address: "" } },
    }],
    ["halves whitespace only", {
      business_event: { location: { venueName: "   ", address: "\t\n" } },
    }],
    ["venueName only", {
      business_event: { location: { venueName: VENUE } },
    }],
    ["address only", {
      business_event: { location: { address: ADDRESS } },
    }],
    ["legacy businessEvent.venueName fallback", {
      business_event: { venueName: VENUE, location: { address: ADDRESS } },
    }],
  ];

  let sawFallback = 0;

  for (const [what, theme] of THEMES) {
    for (const locationText of [COMBINED, null, undefined, "   "]) {
      const parts = extractPublicEventLocation(theme, locationText as never);
      const where = `${what} + locationText=${JSON.stringify(locationText)}`;

      // (1) Never the same non-null string in BOTH halves.
      if (parts.venueName !== null && parts.address !== null) {
        assert(
          parts.venueName !== parts.address,
          `both halves identical (${where}): ${parts.venueName}`,
        );
      }
      // (2) The COMBINED string may never sit on `address` while a venue name
      //     also renders — that is verbatim the #2469 defect.
      if (parts.address !== null && parts.venueName !== null) {
        assert(
          parts.address !== COMBINED,
          `combined string landed on address beside a venueName (${where})`,
        );
      }
      // (3) Never fabricated: every returned half is a non-empty trimmed string.
      for (const half of [parts.venueName, parts.address]) {
        if (half !== null) {
          assertEquals(typeof half, "string", `non-string half (${where})`);
          assertEquals(half, half.trim(), `untrimmed half (${where})`);
          assert(half.length > 0, `empty-string half (${where})`);
        }
      }
      // (4) When NOTHING is parseable the combined text goes to `venueName`
      //     ALONE — putting it on `address` would hide the whole card, which is
      //     the second half of #2469.
      if (parts.venueName === COMBINED) {
        sawFallback += 1;
        assertEquals(
          parts.address,
          null,
          `the fallback must occupy exactly one half (${where})`,
        );
      }
    }
  }

  // VACUITY GUARD — the fallback arm must actually have been exercised.
  assert(sawFallback > 0, "the combined-string fallback arm never ran");
});

// KNOWN GAP, pinned deliberately (tester finding, filed on #2469).
//
// The invariant above holds for every half the extractor SYNTHESISES. It does
// NOT hold when the stored parsed object already carries the same string in
// both slots: `extractPublicEventLocation` returns the parsed halves verbatim
// and never de-duplicates them, so `location = { venueName: X, address: X }`
// renders X twice — the exact user-visible symptom #2469 is named for.
//
// This is an upstream DATA shape rather than a mapper defect, and no live event
// carries it today, so it is not a release blocker. It is pinned here so the
// behaviour is visible: a one-line dedupe in the extractor would close it, and
// this assertion inverts the moment it does.
Deno.test("#2469 A-10b: identical STORED halves are passed through undeduplicated (known gap)", () => {
  const parts = extractPublicEventLocation(
    { business_event: { location: { venueName: COMBINED, address: COMBINED } } },
    COMBINED,
  );
  // Current behaviour: both halves come back identical.
  assertEquals(parts.venueName, COMBINED);
  assertEquals(parts.address, COMBINED);
  // Which means the maps label doubles — the #2469 symptom, from stored data.
  const target = selectVenueMapsTarget({
    venueName: parts.venueName,
    address: parts.address,
    addressHidden: false,
    locationGeo: DIDI,
  });
  assert(target !== null);
  assertEquals(target.label, `${COMBINED}, ${COMBINED}`);
  // CONTAINED: the pin is still the stored coordinate, so #2468's fix holds and
  // the tap still lands on the venue. The damage is cosmetic, not a mis-pin.
  assertEquals(target.geo, DIDI);
  const link = buildMapsDeepLink({
    geo: target.geo,
    label: target.label,
    platform: "ios",
  });
  assert(link !== null);
  assertEquals(link.coordinateAnchored, true);
  assert(link.url.startsWith(`maps://?ll=${LAT},${LNG}&q=`));
});

// ---------------------------------------------------------------------------
// A-11 — the seed -> canonical handoff cannot flip the address mid-flight
// ---------------------------------------------------------------------------
// A cold `/e/{brandSlug}/{eventSlug}` open renders from the SEED first
// (`coldSeedQuery.data`) and swaps to the CANONICAL read when it lands
// (ConsumerEventDetailScreen: `seedProp ?? canonicalSeed ?? coldSeedQuery.data`).
// Before #2469 the seed hard-coded `venueName: null`, so the "Where you'll be"
// card was ABSENT and then popped in. Now both sources must agree — the card
// must render cold, and the maps label must not change under the user.
Deno.test("#2469 A-11: the cold seed and the canonical read agree — no mid-flight flip", () => {
  const row = {
    id: "3014ea7e-f3e0-40d0-b112-a51f4e37e964",
    slug: "we-go-again-exhibition",
    // the mapper returns null for anything that is not an event/rsvp row
    event_type: "event",
    location_text: COMBINED,
    public_theme: {
      business_event: {
        location: { venueName: VENUE, address: ADDRESS },
        hideAddressUntilTicket: false,
      },
    },
    location_geo: `(${LNG},${LAT})`,
  };

  const seeded = mapPublicEventSeedRow(row as never);

  // (1) The card renders COLD — this is the regression #2469 names.
  assert(
    seeded.venueName !== null,
    "the seed must carry a venueName or the location card stays suppressed",
  );
  assertEquals(seeded.venueName, VENUE.trim());
  assertEquals(seeded.address, ADDRESS);
  // (2) …and it is NOT the doubled string.
  assert(
    seeded.address !== COMBINED,
    "the seed put the combined string back on `address`",
  );

  // (3) The seed carries the real pin, parsed out of the pg point.
  assertEquals(seeded.locationGeo, { lat: LAT, lng: LNG });

  // (4) The label the maps control sends is IDENTICAL from both sources, so the
  //     swap from seed to canonical cannot change where the tap lands.
  const fromSeed = selectVenueMapsTarget({
    venueName: seeded.venueName,
    address: seeded.address,
    addressHidden: seeded.hideAddressUntilTicket,
    locationGeo: seeded.locationGeo,
  });
  // The canonical read keeps the stored (untrimmed) venue name.
  const fromCanonical = selectVenueMapsTarget({
    venueName: VENUE,
    address: ADDRESS,
    addressHidden: false,
    locationGeo: { lat: LAT, lng: LNG },
  });
  assert(fromSeed !== null && fromCanonical !== null);
  assertEquals(
    fromSeed.label,
    fromCanonical.label,
    "the rendered maps label FLIPS when the canonical read lands",
  );
  assertEquals(fromSeed.geo, fromCanonical.geo);
  assertEquals(fromSeed.label, `${VENUE.trim()}, ${ADDRESS}`);

  // (5) And the tap lands on the stored pin, not the text — the #2468 contract.
  const link = buildMapsDeepLink({
    geo: fromSeed.geo,
    label: fromSeed.label,
    platform: "ios",
  });
  assert(link !== null);
  assertEquals(link.coordinateAnchored, true);
  assert(link.url.startsWith(`maps://?ll=${LAT},${LNG}&q=`));
});

// If the canonical read FAILS the screen keeps the seed. That path must not
// regress into the pre-#2469 state (no card, doubled address).
Deno.test("#2469 A-11b: a failed canonical read leaves the seed rendering correctly", () => {
  const row = {
    id: "id",
    slug: "slug",
    event_type: "event",
    location_text: COMBINED,
    // The theme is present but carries NO parsed location — the hostile case.
    public_theme: { business_event: { hideAddressUntilTicket: false } },
    location_geo: null,
  };
  const seeded = mapPublicEventSeedRow(row as never);

  assert(seeded.venueName !== null, "the card must still render");
  assertEquals(seeded.address, null, "no half may hold the combined string twice");

  const target = selectVenueMapsTarget({
    venueName: seeded.venueName,
    address: seeded.address,
    addressHidden: seeded.hideAddressUntilTicket,
    locationGeo: seeded.locationGeo,
  });
  assert(target !== null);
  assertEquals(target.geo, null, "no coordinate stored -> no fabricated pin");
  // The label is the combined string ONCE, never twice.
  assertEquals(target.label, COMBINED);
  assertEquals(
    target.label.split("Didi Museum").length - 1,
    1,
    "the venue name is in the maps label twice — that is #2469's doubling",
  );
});

// ---------------------------------------------------------------------------
// A-12 — the shared extractor is the fix for the read path that still doubles
// ---------------------------------------------------------------------------
// `mingla-business/src/services/publicEventsService.ts` resolves its halves as
//   venueName: asStringOrNull(location.venueName) ?? row.location_text
//   address:   asStringOrNull(location.address)   ?? row.location_text
// so when BOTH parsed halves are absent the COMBINED string lands in BOTH —
// exactly the shape #2469 removed from the two explorer mappers. That path was
// not migrated to the shared extractor.
//
// This asserts the extractor DOES resolve that same input correctly, so the
// remediation is a one-line swap and this suite already covers it.
Deno.test("#2469 A-12: the shared extractor resolves the un-migrated read path's input without doubling", () => {
  // The exact fallback condition: a combined location_text, no parsed halves.
  const parts = extractPublicEventLocation(
    { business_event: { location: {} } },
    COMBINED,
  );

  const wouldDouble = { venueName: COMBINED, address: COMBINED };
  assert(
    !(parts.venueName === wouldDouble.venueName &&
      parts.address === wouldDouble.address),
    "the extractor reproduced the doubling it exists to prevent",
  );
  assertEquals(parts.venueName, COMBINED);
  assertEquals(parts.address, null);

  // And the maps label built from it carries the venue name ONCE.
  const target = selectVenueMapsTarget({
    venueName: parts.venueName,
    address: parts.address,
    addressHidden: false,
    locationGeo: null,
  });
  assert(target !== null);
  assertEquals(target.label, COMBINED);
  assert(
    !target.label.includes(`${COMBINED}, ${COMBINED}`),
    "the doubled label reached the maps deep link",
  );
});
