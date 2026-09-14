/**
 * #3348 + #3349 — the Theme sheet tells the truth about the organiser's own
 * event (found filming the Scene 04 tutorial, 2026-09-14).
 *
 * #3348: the Font tab's top row is the INHERIT choice. It read
 *   "Brand default — <resolved font>", and the resolved font already includes
 *   the organiser's override, so picking Space Grotesk turned the row into
 *   "Brand default — Space Grotesk".
 * #3349: the preview band hard-coded "Rooftop Sessions" / "SAT 12 JUL · 8:00 PM"
 *   instead of the draft being created.
 *
 * The REAL ThemeSheet is mounted with react-test-renderer under the default
 * node/ts-jest project (react-native -> __manual_mocks__). Only native leaves
 * are mocked; the label, the preview content and the palette maths are real.
 *
 * Fails on revert:
 *   - ThemeSheet labelling the row from `resolved.font` again -> the
 *     "names the brand's font, not the pick" test goes red;
 *   - ThemeSheet ignoring `preview` (hard-coded sample) -> the draft tests go red;
 *   - a mount no longer passing the draft -> the mount source gate goes red.
 */

import { readFileSync } from "fs";
import path from "path";
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("../../ui/Sheet", () => {
  const ReactActual = require("react");
  return {
    Sheet: ({ visible, children }: { visible: boolean; children?: unknown }) =>
      visible ? ReactActual.createElement("MockSheet", null, children) : null,
  };
});
jest.mock("../../ui/Button", () => {
  const ReactActual = require("react");
  return {
    Button: (props: Record<string, unknown>) =>
      ReactActual.createElement("MockButton", props),
  };
});
jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));
jest.mock("../../ui/WebSafeGestureDetector", () => ({
  WebSafeGestureDetector: ({ children }: { children?: unknown }) => children ?? null,
}));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const ReactActual = require("react");
  return {
    ScrollView: ({ children }: { children?: unknown }) =>
      ReactActual.createElement("MockScroll", null, children),
  };
});
jest.mock("react-native-gesture-handler", () => {
  const make = (): Record<string, unknown> => {
    const g: Record<string, unknown> = new Proxy(
      {},
      { get: () => () => g },
    );
    return g;
  };
  return { Gesture: { Pan: make } };
});
jest.mock("expo-linear-gradient", () => ({
  LinearGradient: (): null => null,
}));
jest.mock("../../../theme/useThemeFont", () => ({
  useThemeFont: () => undefined,
}));
jest.mock("../../../store/themeRecentsStore", () => ({
  useThemeRecentsStore: (
    select: (s: { recents: string[]; addRecent: () => void }) => unknown,
  ) => select({ recents: [], addRecent: () => undefined }),
}));

// eslint-disable-next-line import/first
import { EventCoverMedia, type ThemeInput } from "@mingla/offering-rendering";
// eslint-disable-next-line import/first
import { ThemeSheet, type ThemeSheetProps } from "../ThemeSheet";
// eslint-disable-next-line import/first
import { themeDefaultFontLabel } from "../themeColorModel";
// eslint-disable-next-line import/first
import {
  SAMPLE_THEME_PREVIEW,
  buildDraftThemePreview,
  type ThemePreviewDraft,
} from "../themePreviewContent";

type HostNode = {
  type: unknown;
  props: Record<string, unknown>;
  children: Array<HostNode | string>;
};
type Tree = {
  root: {
    findAll: (predicate: (node: HostNode) => boolean) => HostNode[];
  };
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const textOf = (node: HostNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");

const texts = (tree: Tree): string[] =>
  tree.root
    .findAll((n) => n.type === "Text")
    .map((n) => textOf(n))
    .filter((t) => t.length > 0);

const mount = async (props: Partial<ThemeSheetProps>): Promise<Tree> => {
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <ThemeSheet
        visible
        onClose={() => undefined}
        value={null}
        onChange={() => undefined}
        scope="offering"
        {...props}
      />,
    );
  });
  return tree as Tree;
};

const openFontTab = async (tree: Tree): Promise<void> => {
  const tab = tree.root.findAll(
    (n) => n.type === "Pressable" && n.props.accessibilityLabel === "Font",
  )[0];
  expect(tab).toBeDefined();
  await TestRenderer.act(() => {
    (tab.props.onPress as () => void)();
  });
};

const defaultRow = (tree: Tree): HostNode => {
  const rows = tree.root.findAll(
    (n) =>
      n.type === "Pressable" &&
      typeof n.props.accessibilityLabel === "string" &&
      (n.props.accessibilityLabel as string).endsWith("default font"),
  );
  expect(rows).toHaveLength(1);
  return rows[0];
};

// The offering-rendering manual mock backs EVERY component with one shared
// Stub, so EventCoverMedia === ThemeEntranceAnimation by identity. A cover tile
// is the Stub node that carries a `hue` prop.
const coverTiles = (tree: Tree): HostNode[] =>
  tree.root.findAll((n) => n.type === EventCoverMedia && "hue" in n.props);

const BRAND: ThemeInput = { color: "#2563eb", font: "inter", animation: null };

const draft = (overrides: Partial<ThemePreviewDraft> = {}): ThemePreviewDraft => ({
  name: "Slow Burn vol. 5",
  whenMode: "single",
  date: "2026-10-17",
  doorsOpen: "21:00",
  multiDates: null,
  coverHue: 210,
  coverMediaUrl: null,
  coverMediaType: null,
  coverMediaPosterUrl: null,
  isRsvp: false,
  ...overrides,
});

describe("#3348 — the Brand default font row names the brand's font, never the pick", () => {
  test("picking Space Grotesk leaves the row on the brand's Inter and ticks the pick", async () => {
    const tree = await mount({
      brandTheme: BRAND,
      value: { color: "#eb7825", font: "space_grotesk", animation: null },
    });
    await openFontTab(tree);

    const row = defaultRow(tree);
    expect(textOf(row)).toBe("Brand default — Inter");
    expect(textOf(row)).not.toContain("Space Grotesk");
    // The inherit row is NOT selected; the picked row is.
    expect(row.props.accessibilityState).toEqual({ selected: false });
    const picked = tree.root.findAll(
      (n) =>
        n.type === "Pressable" &&
        n.props.accessibilityLabel === "Space Grotesk, technical sans",
    )[0];
    expect(picked.props.accessibilityState).toEqual({ selected: true });

    await TestRenderer.act(() => tree.unmount());
  });

  test("the row reads the same before and after a pick", async () => {
    const before = await mount({ brandTheme: BRAND, value: null });
    await openFontTab(before);
    const beforeLabel = textOf(defaultRow(before));
    await TestRenderer.act(() => before.unmount());

    for (const font of ["poppins", "playfair_display", "bebas_neue"] as const) {
      const after = await mount({
        brandTheme: BRAND,
        value: { color: null, font, animation: null },
      });
      await openFontTab(after);
      expect(textOf(defaultRow(after))).toBe(beforeLabel);
      await TestRenderer.act(() => after.unmount());
    }
    expect(beforeLabel).toBe("Brand default — Inter");
  });

  test("an unthemed brand inherits Mingla's default, and the brand sheet says Mingla default", () => {
    expect(themeDefaultFontLabel("offering", null)).toBe("Brand default — Inter");
    expect(themeDefaultFontLabel("venue", { color: null, font: "lora", animation: null })).toBe(
      "Brand default — Lora",
    );
    // A brand has no parent: its own saved font is NOT its default.
    expect(
      themeDefaultFontLabel("brand", { color: null, font: "anton", animation: null }),
    ).toBe("Mingla default — Inter");
  });
});

describe("#3349 — the preview band shows the draft being created", () => {
  test("an offering sheet shows the draft's name, first start and cover — not Rooftop Sessions", async () => {
    const tree = await mount({
      brandTheme: BRAND,
      preview: buildDraftThemePreview(
        draft({
          coverMediaUrl: "https://cdn.example.com/cover.jpg",
          coverMediaType: "image",
        }),
      ),
    });
    const shown = texts(tree);
    expect(shown).toContain("Slow Burn vol. 5");
    expect(shown).toContain("Sat 17 Oct · 9 PM");
    expect(shown).toContain("Get tickets");
    expect(shown).not.toContain("Rooftop Sessions");
    expect(shown.join(" ")).not.toContain("12 JUL");

    const covers = coverTiles(tree);
    expect(covers).toHaveLength(1);
    expect(covers[0].props).toEqual(
      expect.objectContaining({
        hue: 210,
        mediaUrl: "https://cdn.example.com/cover.jpg",
        mediaType: "image",
        autoplay: false,
        playbackActive: false,
      }),
    );

    await TestRenderer.act(() => tree.unmount());
  });

  test("the brand and venue sheets, with no draft, keep the sample and no cover tile", async () => {
    const tree = await mount({ scope: "brand" });
    const shown = texts(tree);
    expect(shown).toContain(SAMPLE_THEME_PREVIEW.title);
    expect(coverTiles(tree)).toHaveLength(0);
    await TestRenderer.act(() => tree.unmount());
  });
});

describe("#3349 — buildDraftThemePreview fallbacks", () => {
  test("an empty name falls back to Untitled event / Untitled RSVP", () => {
    expect(buildDraftThemePreview(draft({ name: "   " })).title).toBe("Untitled event");
    const rsvp = buildDraftThemePreview(draft({ name: "", isRsvp: true }));
    expect(rsvp.title).toBe("Untitled RSVP");
    expect(rsvp.ctaLabel).toBe("Going");
  });

  test("no date reads Date TBD; a date without a time reads the date alone", () => {
    expect(buildDraftThemePreview(draft({ date: null, doorsOpen: null })).dateLine).toBe(
      "Date TBD",
    );
    expect(buildDraftThemePreview(draft({ doorsOpen: null })).dateLine).toBe("Sat 17 Oct");
  });

  test("a multi-date event shows its EARLIEST start, whatever the list order", () => {
    const preview = buildDraftThemePreview(
      draft({
        whenMode: "multi_date",
        date: null,
        multiDates: [
          { id: "b", date: "2026-11-02", startTime: "19:30", endTime: "23:00", overrides: { title: null, description: null, venueName: null, address: null, onlineUrl: null } },
          { id: "a", date: "2026-10-30", startTime: "20:00", endTime: "23:00", overrides: { title: null, description: null, venueName: null, address: null, onlineUrl: null } },
        ],
      }),
    );
    expect(preview.dateLine).toBe("Fri 30 Oct · 8 PM");
    expect(
      buildDraftThemePreview(draft({ whenMode: "multi_date", multiDates: [] })).dateLine,
    ).toBe("Date TBD");
  });

  test("a video cover shows its poster still, never the video itself", () => {
    const withPoster = buildDraftThemePreview(
      draft({
        coverMediaType: "video",
        coverMediaUrl: "https://vz.b-cdn.net/abc/play_720p.mp4",
        coverMediaPosterUrl: "https://vz.b-cdn.net/abc/poster.jpg",
      }),
    );
    expect(withPoster.cover).toEqual({
      hue: 210,
      imageUrl: "https://vz.b-cdn.net/abc/poster.jpg",
    });
    const derived = buildDraftThemePreview(
      draft({
        coverMediaType: "video",
        coverMediaUrl: "https://vz.b-cdn.net/abc/play_720p.mp4",
        coverMediaPosterUrl: null,
      }),
    );
    expect(derived.cover?.imageUrl).toBe("https://vz.b-cdn.net/abc/thumbnail.jpg");
  });

  test("no media falls back to the draft's cover colour", () => {
    expect(buildDraftThemePreview(draft()).cover).toEqual({ hue: 210, imageUrl: null });
  });
});

describe("#3349 — every event and RSVP theme sheet passes its draft", () => {
  const src = (rel: string): string =>
    readFileSync(path.join(process.cwd(), rel), "utf8");

  test.each([
    ["event + RSVP cover step", "src/components/event/CreatorStep4Cover.tsx", "draft"],
    ["event review step", "src/components/event/CreatorStep7Preview.tsx", "draft"],
    ["RSVP review step", "src/components/rsvp/RsvpStep7Preview.tsx", "draft"],
    ["published event/RSVP edit", "src/components/event/EditPublishedScreen.tsx", "editState"],
  ])("%s", (_label, file, state) => {
    const sheet = src(file).match(/<ThemeSheet[\s\S]*?\/>/)?.[0] ?? "";
    expect(sheet).toContain(`preview={buildDraftThemePreview(${state})}`);
  });
});
