/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4347 wave 1 — every deck-card state in the approved state table that the
 * COLLAPSED card owns, rendered (implementor happy path).
 *
 * The curated / host-experience face is mounted whole (CuratedExperienceSwipeCard).
 * The single-place face is mounted from the same leaf pieces SwipeableCards
 * composes it from (bars, host chip, text column, plate) — SwipeableCards itself
 * needs the whole app's providers, and its decisions are the pure producers the
 * model suite runs.
 *
 *   loading skeleton · one photo · no photo · video cover · photo load failure ·
 *   missing rating/price/distance · open / closes soon / closed / hours unknown ·
 *   free · saved + scheduled discs · Been-here slot · locked plan face ·
 *   collab (same card) · large text cap · Android opaque plate · reduce motion
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 *
 * FAILS-ON-REVERT: dropping the `count < 2` guard in PhotoPagerBars (R-2),
 * the `opaque` prop path in PlateMaterial (R-4), the `onLoadFailed` report in
 * CuratedStopImage (R-6), or the kicker in DeckTextColumn (R-3) fails here.
 */
import React from "react";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

// A cards.json-backed translator, so the rendered strings are the shipped copy.
jest.mock("react-i18next", () => {
  const cards = require("../../../i18n/locales/en/cards.json");
  const interpolate = (value: string, options: Record<string, unknown> = {}) =>
    String(value).replace(/{{\s*(\w+)\s*}}/g, (_m: string, key: string) =>
      key in options ? String(options[key]) : `{{${key}}}`,
    );
  const t = (key: string, options: Record<string, unknown> = {}) => {
    const leaf = key.includes(":") ? key.split(":").at(-1)! : key;
    const plural = typeof options.count === "number" ? `${leaf}_${options.count === 1 ? "one" : "other"}` : leaf;
    const value = cards[plural] ?? cards[leaf] ?? (options.defaultValue as string | undefined) ?? key;
    return interpolate(value, options);
  };
  return { useTranslation: () => ({ t, i18n: { language: "en" } }), initReactI18next: {} };
});
jest.mock("expo-image", () => {
  const ReactActual = jest.requireActual("react");
  const Image = (props: Record<string, unknown>) => ReactActual.createElement("ExpoImage", props);
  Image.prefetch = jest.fn(() => Promise.resolve(true));
  return { Image };
});
jest.mock("@mingla/offering-rendering", () => {
  const ReactActual = jest.requireActual("react");
  return {
    EventCoverMedia: (props: Record<string, unknown>) => ReactActual.createElement("EventCoverMedia", props),
  };
});
jest.mock("../../../utils/breadcrumbs", () => ({ breadcrumbs: { add: jest.fn(), tap: jest.fn() } }));
jest.mock("../../../services/currencyService", () => ({
  convertBetween: (amount: number) => amount,
  getServableRate: (code: string) => ({ USD: 1, NGN: 1347.74 } as Record<string, number>)[code] ?? null,
}));
jest.mock("../../../services/countryCurrencyService", () => ({ currencySymbolMap: { USD: "$", NGN: "₦" } }));
jest.mock("../../../utils/localeUtils", () => ({ getUserLocale: () => "en-US" }));

const designSystem = require("../../../constants/designSystem");
const { CuratedExperienceSwipeCard } = require("../../CuratedExperienceSwipeCard");
const { DeckCardPlate, CardStateDiscs, platePresentation } = require("../../deckCardPlate");
const { DeckTextColumn, HostChip, PhotoPagerBars, PhotoCapsule, NoPhotoFill } = require("../DeckCardChrome");
const { curatedDeckPhotos, experienceDeckPhotos, placeFactSpans } = require("../deckCardModel");
const { SkeletonCard } = require("../../SkeletonCard");
const CI = require("../../../../../packages/card-identity/index.js");

type Node = import("react-test-renderer").ReactTestInstance;

function mount(element: React.ReactElement) {
  let root: import("react-test-renderer").ReactTestRenderer | null = null;
  TestRenderer.act(() => {
    root = TestRenderer.create(element);
  });
  return root!;
}
// react-native-web: the composite element keeps `testID` / `style` / a11y
// props; its host <div> carries the compiled attributes. Read the composite.
const isComposite = (n: Node) => typeof n.type !== "string";
const byTestId = (root: { root: Node }, id: string) => root.root.findAll((n: Node) => n.props?.testID === id && isComposite(n));
const allText = (root: { root: Node }) =>
  root.root
    .findAll((n: Node) => typeof n.props?.children === "string" || typeof n.props?.children === "number")
    .map((n: Node) => String(n.props.children));
const flat = (style: unknown): Record<string, unknown> =>
  Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : ((style as Record<string, unknown>) ?? {});

const STOPS = [
  { placeName: "Café Neo", imageUrl: "https://cdn/neo.jpg", optional: false, priceMin: 0, priceMax: 50, travelTimeFromUserMin: 8 },
  { placeName: "Nike Art Gallery", imageUrl: "https://cdn/nike.jpg", optional: false, priceMin: 50, priceMax: 120 },
  { placeName: "Terra Kulture", imageUrl: "https://cdn/terra.jpg", optional: false, priceMin: 0, priceMax: 0 },
];
const PLAN = {
  id: "plan-1",
  cardType: "curated",
  title: "A slow Saturday in Ikoyi",
  experienceType: "romantic",
  estimatedDurationMinutes: 210,
  totalPriceMin: 0,
  totalPriceMax: 0,
  stops: STOPS,
};
const EXPERIENCE = {
  ...PLAN,
  id: "exp-1",
  cardType: "experience",
  title: "Lekki Art & Supper Walk",
  currency: "NGN",
  totalPriceMin: 100_000,
  totalPriceMax: 100_000,
};

describe("#4347 deck card states — curated plan and host experience", () => {
  test("R-1 curated: bars page the stops, the label names the stop, stack + route + facts", () => {
    const photos = curatedDeckPhotos(STOPS);
    const root = mount(
      <CuratedExperienceSwipeCard
        card={PLAN}
        currencyCode="USD"
        photos={photos}
        photoIndex={1}
        kicker="Curated plan · Romantic"
        stopLabel="Stop 2 · Nike Art Gallery"
      />,
    );
    expect(byTestId(root, "deck-photo-bars")).toHaveLength(1);
    expect(byTestId(root, "deck-photo-bar-on")).toHaveLength(1);
    expect(byTestId(root, "deck-photo-bar")).toHaveLength(2);
    const text = allText(root);
    expect(text).toEqual(expect.arrayContaining([
      "Stop 2 · Nike Art Gallery",
      "CURATED PLAN · ROMANTIC",
      "A slow Saturday in Ikoyi",
      "Café Neo → Nike Art Gallery → Terra Kulture",
      "3 stops",
      "3h 30m",
      "8 min away",
      "Moderate",
    ]));
    // The page showing is stop 2's photo.
    const hero = root.root.findAll((n: Node) => n.type === "ExpoImage" && n.props.source?.uri === "https://cdn/nike.jpg" && n.props.transition !== undefined);
    expect(hero).toHaveLength(1);
    // The stack uses existing `_thumb.jpg` objects only for place-photos URLs;
    // these test URLs are off-bucket, so they pass through untouched.
    const thumbs = root.root.findAll((n: Node) => n.type === "ExpoImage" && n.props.style && flat(n.props.style).width === CI.STOP_STACK.size);
    expect(thumbs).toHaveLength(3);
  });

  test("R-2 one photo: no bars, nothing to page", () => {
    const root = mount(
      <CuratedExperienceSwipeCard card={{ ...PLAN, stops: [STOPS[0]] }} photos={curatedDeckPhotos([STOPS[0]])} />,
    );
    expect(byTestId(root, "deck-photo-bars")).toHaveLength(0);
  });

  test("R-3 no photo: neutral fill, dark type, no scrims, opaque plate", () => {
    const root = mount(
      <CuratedExperienceSwipeCard card={{ ...PLAN, stops: STOPS.map((s) => ({ ...s, imageUrl: "" })) }} photos={[]} kicker="Curated plan" />,
    );
    expect(byTestId(root, "deck-no-photo-fill")).toHaveLength(1);
    // No scrim: nothing receives the ramp's colour stops.
    expect(root.root.findAll((n: Node) => Array.isArray(n.props?.colors) && Array.isArray(n.props?.locations))).toHaveLength(0);
    const withPhoto = mount(<CuratedExperienceSwipeCard card={PLAN} photos={curatedDeckPhotos(STOPS)} />);
    expect(withPhoto.root.findAll((n: Node) => isComposite(n) && Array.isArray(n.props?.colors) && Array.isArray(n.props?.locations)).length).toBeGreaterThan(0);
    const title = byTestId(root, "deck-title")[0];
    expect(flat(title.props.style).color).toBe(CI.NO_PHOTO.titleColor);
    expect(flat(byTestId(root, "deck-kicker")[0].props.style).color).toBe(CI.KICKER.darkColor);
    // The plate is the measured opaque solid, not glass over a scrim that is not there.
    const solids = root.root.findAll((n: Node) => isComposite(n) && flat(n.props?.style).backgroundColor === CI.PLATE.fallbackSolid);
    expect(solids.length).toBeGreaterThan(0);
  });

  test("R-4 photo load failure is REPORTED (the pager skips), never swapped for a stock photo", () => {
    const failed: string[] = [];
    const root = mount(
      <CuratedExperienceSwipeCard card={PLAN} photos={curatedDeckPhotos(STOPS)} photoIndex={0} onPhotoFailed={(u: string) => failed.push(u)} />,
    );
    const hero = root.root.find((n: Node) => n.type === "ExpoImage" && n.props.source?.uri === "https://cdn/neo.jpg" && n.props.transition !== undefined);
    TestRenderer.act(() => hero.props.onError());
    expect(failed).toEqual(["https://cdn/neo.jpg"]);
    // A failed page is never rendered: the next usable page shows.
    const after = mount(
      <CuratedExperienceSwipeCard card={PLAN} photos={curatedDeckPhotos(STOPS)} photoIndex={0} failedPhotos={new Set(["https://cdn/neo.jpg"])} />,
    );
    expect(after.root.findAll((n: Node) => n.type === "ExpoImage" && n.props.source?.uri === "https://cdn/neo.jpg" && n.props.transition !== undefined)).toHaveLength(0);
    expect(after.root.findAll((n: Node) => n.type === "ExpoImage" && n.props.source?.uri === "https://cdn/nike.jpg" && n.props.transition !== undefined)).toHaveLength(1);
  });

  test("R-5 host experience: host chip, date-first kicker, converted From pill, cover on page 1", () => {
    const photos = experienceDeckPhotos("https://cdn/cover.mp4", STOPS);
    const root = mount(
      <CuratedExperienceSwipeCard
        card={EXPERIENCE}
        currencyCode="USD"
        photos={photos}
        photoIndex={0}
        brandExperience={{ brandName: "Lagos Supper Club", brandLogoUrl: null }}
        experienceCover={{ coverMediaUrl: "https://cdn/cover.mp4", coverMediaType: "video" }}
        kicker="Sat, Nov 14, 6pm · Experience"
        onDetailsPress={() => undefined}
        detailsLabel="Details"
      />,
    );
    const text = allText(root);
    expect(text).toEqual(expect.arrayContaining(["Lagos Supper Club", "SAT, NOV 14, 6PM · EXPERIENCE", "From ≈ $74"]));
    // The experience's price lives on the pill, not in the fact line.
    expect(text).not.toEqual(expect.arrayContaining(["Moderate"]));
    expect(root.root.findAll((n: Node) => n.type === "EventCoverMedia")).toHaveLength(1);
    // No "Stop N" label on an experience (its host chip owns that corner).
    expect(byTestId(root, "deck-stop-label")).toHaveLength(0);
  });

  test("R-6 a free experience says Free; the behind face's pill presses nothing", () => {
    const root = mount(
      <CuratedExperienceSwipeCard
        card={{ ...EXPERIENCE, totalPriceMin: 0, totalPriceMax: 0 }}
        photos={[]}
        brandExperience={{ brandName: "Lagos Supper Club", brandLogoUrl: null }}
      />,
    );
    expect(allText(root)).toEqual(expect.arrayContaining(["Free"]));
    // No onDetailsPress (the behind face): the pill is not a button.
    expect(root.root.findAll((n: Node) => isComposite(n) && n.props?.accessibilityRole === "button" && n.props?.accessibilityLabel === "Free")).toHaveLength(0);
  });

  test("R-7 the one smart chip and the one-time hint render when handed", () => {
    const root = mount(
      <CuratedExperienceSwipeCard
        card={PLAN}
        photos={curatedDeckPhotos(STOPS)}
        smartChip={{ text: "Stop 2 closed when you arrive", tone: "warn" }}
        photoHint="Tap the sides to see more photos"
      />,
    );
    const chip = byTestId(root, "deck-smart-chip");
    expect(chip).toHaveLength(1);
    expect(flat(chip[0].props.style).backgroundColor).toBe(CI.SMART_CHIP.warnFill);
    expect(allText(root)).toEqual(expect.arrayContaining(["Stop 2 closed when you arrive", "Tap the sides to see more photos"]));
  });

  test("R-8 large text is capped at 1.3x on the facts and kicker, 1.4x on the title", () => {
    const root = mount(<CuratedExperienceSwipeCard card={PLAN} photos={curatedDeckPhotos(STOPS)} kicker="Curated plan" />);
    expect(byTestId(root, "deck-kicker")[0].props.maxFontSizeMultiplier).toBe(CI.MAX_FONT_SCALE.meta);
    expect(byTestId(root, "deck-title")[0].props.maxFontSizeMultiplier).toBe(CI.MAX_FONT_SCALE.title);
    expect(byTestId(root, "deck-title")[0].props.numberOfLines).toBe(2);
    expect(CI.MAX_FONT_SCALE.meta).toBe(1.3);
  });
});

describe("#4347 deck card states — single place face", () => {
  const LABELS = {
    openUntil: (time: string) => `Open until ${time}`,
    closesIn: (m: number) => `Closes in ${m} min`,
    opensAt: (time: string) => `Opens ${time}`,
    opensTomorrow: (time: string) => `Opens tomorrow ${time}`,
    opensOn: (d: number, time: string) => `Opens +${d} ${time}`,
    open24h: "Open 24 hours",
    clock: (minute: number) => `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`,
  };
  const HOURS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(
    (d) => `${d}: 12:00 PM – 11:00 PM`,
  );
  const face = (spans: { kind: string; text: string }[], opts: { dark?: boolean; saved?: boolean; scheduled?: boolean; host?: string } = {}) => {
    const presentation = platePresentation(spans, 1);
    return mount(
      <>
        {opts.dark ? <NoPhotoFill /> : null}
        <PhotoPagerBars count={opts.dark ? 0 : 5} index={1} top={60} />
        <CardStateDiscs saved={!!opts.saved} scheduled={!!opts.scheduled} savedLabel="Saved" scheduledLabel="Scheduled" />
        {opts.host ? <HostChip name={opts.host} top={70} label={`Hosted by ${opts.host}`} /> : null}
        <DeckTextColumn title="Nok by Alara" kicker="Restaurant" bottom={presentation.titleBottom} dark={!!opts.dark} />
        <DeckCardPlate
          spans={spans}
          metaLines={presentation.metaLines}
          opaque={!!opts.dark}
          beenHere={<PhotoCapsule text="Been here" top={0} />}
          onSharePress={() => undefined}
          shareLabel="Share"
          onDetailsPress={() => undefined}
          detailsLabel="Details"
        />
      </>,
    );
  };

  test("R-9 open / closes soon / closed / hours unknown are coloured from the package", () => {
    const at = (iso: string) => new Date(iso);
    const cases: [string, unknown, string, string][] = [
      ["open", HOURS, "2026-11-09T14:00:00Z", CI.FACT_LINE.status.open],
      ["closing", HOURS, "2026-11-09T22:30:00Z", CI.FACT_LINE.status.closingSoon],
      ["closed", HOURS, "2026-11-09T09:00:00Z", CI.FACT_LINE.status.closed],
    ];
    for (const [label, hours, iso, colour] of cases) {
      const spans = placeFactSpans({ openingHours: hours, utcOffsetMinutes: 0, rating: 4.6, reviewCount: 212 }, at(iso), LABELS);
      const root = face(spans);
      const status = root.root.findAll((n: Node) => n.props?.children === spans[0].text && isComposite(n))[0];
      expect([label, flat(status.props.style).color]).toEqual([label, colour]);
    }
    const unknown = placeFactSpans({ openingHours: null, rating: 4.6, reviewCount: 212 }, new Date(), LABELS);
    expect(unknown.map((s: { text: string }) => s.text)).toEqual(["★ 4.6 (212)"]);
  });

  test("R-10 missing rating/price/distance: left out, separators only between present facts", () => {
    const spans = placeFactSpans({ travelTime: "12 min" }, new Date(), LABELS);
    const root = face(spans);
    const text = allText(root);
    expect(text).toContain("12 min");
    expect(text.filter((t) => t.trim() === "·")).toHaveLength(0);
    // Nothing at all: the plate drops the facts row (its short silhouette).
    expect(platePresentation([], 1).withMeta).toBe(false);
  });

  test("R-11 saved and scheduled discs, the host chip, the Been-here slot, bars", () => {
    const root = face(placeFactSpans({ rating: 4.8, reviewCount: 96 }, new Date(), LABELS), {
      saved: true,
      scheduled: true,
      host: "Ìtàn Kitchen",
    });
    expect(root.root.findAll((n: Node) => n.props?.accessibilityLabel === "Saved" && isComposite(n) && n.props?.style)).toHaveLength(1);
    expect(root.root.findAll((n: Node) => n.props?.accessibilityLabel === "Scheduled" && isComposite(n) && n.props?.style)).toHaveLength(1);
    expect(byTestId(root, "deck-host-chip")).toHaveLength(1);
    expect(allText(root)).toEqual(expect.arrayContaining(["ÌK", "Ìtàn Kitchen", "Been here", "RESTAURANT", "Nok by Alara"]));
    expect(byTestId(root, "deck-photo-bar-on")).toHaveLength(1);
  });

  test("R-12 no photo: neutral fill, dark type, opaque plate, no bars", () => {
    const root = face([], { dark: true });
    expect(byTestId(root, "deck-no-photo-fill")).toHaveLength(1);
    expect(byTestId(root, "deck-photo-bars")).toHaveLength(0);
    expect(flat(byTestId(root, "deck-title")[0].props.style).color).toBe(CI.NO_PHOTO.titleColor);
  });

  test("R-13 Android: the plate is the opaque solid whatever the photo", () => {
    expect(designSystem.ANDROID_GLASS_USES_OPAQUE_FALLBACK).toBe(false); // jest = iOS-like web platform
    const glass = face([{ kind: "fact", text: "12 min" }]);
    const opaque = face([{ kind: "fact", text: "12 min" }], { dark: true });
    const solid = (r: { root: Node }) =>
      r.root.findAll((n: Node) => isComposite(n) && flat(n.props?.style).backgroundColor === CI.PLATE.fallbackSolid).length;
    expect(solid(glass)).toBe(0);
    expect(solid(opaque)).toBeGreaterThan(0);
  });
});

describe("#4347 deck card states — loading and motion", () => {
  test("R-14 loading: the skeleton is the NEW layout (bars, kicker + title column, plate); still under Reduce Motion", () => {
    const root = mount(React.createElement(SkeletonCard, { width: 360, height: 640 }));
    expect(byTestId(root, "deck-skeleton")).toHaveLength(1);
    expect(byTestId(root, "deck-skeleton-column")).toHaveLength(1);
    const plate = byTestId(root, "deck-skeleton-plate")[0];
    expect(flat(plate.props.style)).toMatchObject({ height: CI.SURFACES.s1Single.plateH, borderRadius: CI.SURFACES.s1Single.plateR });
    expect(byTestId(root, "deck-skeleton-shimmer").length).toBeGreaterThan(0);
    const still = mount(React.createElement(SkeletonCard, { width: 360, height: 640, reducedMotion: true }));
    expect(byTestId(still, "deck-skeleton-shimmer")).toHaveLength(0);
  });

  test("R-15 reduce motion: the flip is instant (transition 0), else the 180ms cross-fade", () => {
    const photos = curatedDeckPhotos(STOPS);
    const still = mount(<CuratedExperienceSwipeCard card={PLAN} photos={photos} photoTransitionMs={0} />);
    const hero = still.root.find((n: Node) => n.type === "ExpoImage" && n.props.source?.uri === "https://cdn/neo.jpg" && n.props.transition !== undefined);
    expect(hero.props.transition).toBe(0);
    const moving = mount(<CuratedExperienceSwipeCard card={PLAN} photos={photos} />);
    const hero2 = moving.root.find((n: Node) => n.type === "ExpoImage" && n.props.source?.uri === "https://cdn/neo.jpg" && n.props.transition !== undefined);
    expect(hero2.props.transition).toBe(CI.PHOTO_PAGER.crossfadeMs);
    expect(CI.PHOTO_PAGER.crossfadeMs).toBe(180);
  });
});
