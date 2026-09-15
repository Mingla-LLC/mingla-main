/**
 * #3373 — the experience creator's Theme preview shows the experience being
 * made, not the "Rooftop Sessions" sample (follow-up to #3349 / PR #3357, which
 * fixed the event and RSVP creators).
 *
 * The REAL ExperienceCoverStep is mounted with the REAL ThemeSheet under the
 * default node/ts-jest project (react-native -> __manual_mocks__), using the
 * same leaf mocks as the #3357 suite. Only native leaves, the cover picker, the
 * brand query and the collapsed theme row are mocked; the step, the preview
 * builder, the sheet and its fallbacks are real.
 *
 * Fails on revert:
 *   - ExperienceCoverStep.tsx without `preview` -> the sheet shows the sample,
 *     so every "shows the experience" test goes red;
 *   - themePreviewContent.ts without the experience kind -> the
 *     "Untitled experience" / "Reserve" tests go red.
 */

import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// ---- ThemeSheet leaves (same as issue_3348_3349_theme_sheet_shows_the_draft) --
jest.mock("../../ui/Sheet", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactActual = require("react");
  return {
    Sheet: ({ visible, children }: { visible: boolean; children?: unknown }) =>
      visible ? ReactActual.createElement("MockSheet", null, children) : null,
  };
});
jest.mock("../../ui/Button", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
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

// ---- ExperienceCoverStep's own heavy neighbours -----------------------------
// useBrand runs once per render of the step, so its call count is a render
// counter for the React.memo'd step.
const mockUseBrand = jest.fn(() => ({
  isLoading: false,
  isError: false,
  data: { theme: null },
}));
jest.mock("../../../hooks/useBrands", () => ({
  useBrand: () => mockUseBrand(),
}));
jest.mock("../../ui/CoverPickerSheet", () => ({
  CoverPickerSheet: (): null => null,
}));
jest.mock("../../ui/EventCoverMedia", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactActual = require("react");
  return {
    EventCoverMedia: (props: Record<string, unknown>) =>
      ReactActual.createElement("StepCoverMediaProbe", props),
  };
});
jest.mock("../../theme/ThemeControlRow", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactActual = require("react");
  return {
    ThemeControlRow: (props: Record<string, unknown>) =>
      ReactActual.createElement("ThemeControlRowProbe", props),
  };
});

// eslint-disable-next-line import/first
import { EventCoverMedia } from "@mingla/offering-rendering";
// eslint-disable-next-line import/first
import type { ExperienceWhenState } from "../../../hooks/useExperienceDraftAdapter";
// eslint-disable-next-line import/first
import type { CoverPatch } from "../../ui/CoverPicker";
// eslint-disable-next-line import/first
import {
  buildDraftThemePreview,
  type ThemePreviewDraft,
} from "../../theme/themePreviewContent";
// eslint-disable-next-line import/first
import {
  ExperienceCoverStep,
  type ExperienceCoverStepProps,
} from "../ExperienceCoverStep";

type HostNode = {
  type: unknown;
  props: Record<string, unknown>;
  children: (HostNode | string)[];
};
type Tree = {
  root: {
    findAll: (predicate: (node: HostNode) => boolean) => HostNode[];
  };
  update: (element: React.ReactElement) => void;
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const textOf = (node: HostNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");

/** The Theme sheet's preview band — the card that used to read Rooftop Sessions. */
const previewBand = (tree: Tree): HostNode => {
  const bands = tree.root.findAll(
    (n) =>
      n.type === "View" &&
      n.props.accessibilityLabel === "Preview: your page with this theme",
  );
  expect(bands).toHaveLength(1);
  return bands[0];
};

const bandTexts = (tree: Tree): string[] => {
  const band = previewBand(tree);
  const out: string[] = [];
  const walk = (node: HostNode | string): void => {
    if (typeof node === "string") return;
    if (node.type === "Text") {
      const t = textOf(node);
      if (t.length > 0) out.push(t);
      return;
    }
    node.children.forEach(walk);
  };
  walk(band);
  return out;
};

// The offering-rendering manual mock backs every component with one shared
// Stub; the sheet's cover tile is the Stub node carrying a `hue` prop.
const coverTiles = (tree: Tree): HostNode[] =>
  tree.root.findAll((n) => n.type === EventCoverMedia && "hue" in n.props);

const NO_COVER: CoverPatch = {
  coverMediaUrl: null,
  coverMediaPosterUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaSourceUrl: null,
  coverMediaCredit: null,
  coverMediaCreditUrl: null,
  coverMediaAlt: null,
};

// Spelled out (not read off the props type) so that, with the fix reverted,
// this suite still compiles and fails on what the organiser SEES.
type When = Pick<ExperienceWhenState, "whenMode" | "date" | "doorsOpen" | "multiDates">;
type StepProps = ExperienceCoverStepProps & { title: string; when: When };

const SINGLE: When = {
  whenMode: "single",
  date: "2026-11-14",
  doorsOpen: "18:30",
  multiDates: null,
};

const noop = (): void => undefined;
// Stable callbacks, as the wizard passes them (the step is React.memo'd).
const STABLE = {
  onCoverChange: noop,
  onShowToast: noop,
  onThemeChange: noop,
};

const stepProps = (overrides: Partial<StepProps> = {}): StepProps => ({
  brandId: "brand-3373",
  experienceId: "exp-3373",
  preparingDraft: false,
  cover: NO_COVER,
  title: "Lagos Food Walk",
  when: SINGLE,
  themeOverrides: null,
  ...STABLE,
  ...overrides,
});

/** Mount the real step and open its Theme sheet the way the organiser does. */
const mountAndOpenTheme = async (props: StepProps): Promise<Tree> => {
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(<ExperienceCoverStep {...props} />);
  });
  const row = (tree as Tree).root.findAll(
    (n) => n.type === "ThemeControlRowProbe",
  );
  expect(row).toHaveLength(1);
  await TestRenderer.act(() => {
    (row[0].props.onPress as () => void)();
  });
  return tree as Tree;
};

describe("#3373 — the experience Cover step's Theme sheet shows the experience", () => {
  test("its title, first date and time, and the Reserve button — never Rooftop Sessions", async () => {
    const tree = await mountAndOpenTheme(stepProps());
    const shown = bandTexts(tree);
    expect(shown).toEqual(["Sat 14 Nov · 6:30 PM", "Lagos Food Walk", "Reserve"]);
    expect(shown).not.toContain("Rooftop Sessions");
    expect(shown.join(" ")).not.toContain("12 JUL");
    expect(shown).not.toContain("Get tickets");
    await TestRenderer.act(() => tree.unmount());
  });

  test("an image cover appears as the preview's cover tile", async () => {
    const tree = await mountAndOpenTheme(
      stepProps({
        cover: {
          ...NO_COVER,
          coverMediaUrl: "https://cdn.example.com/food-walk.jpg",
          coverMediaType: "image",
        },
      }),
    );
    const tiles = coverTiles(tree);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].props).toEqual(
      expect.objectContaining({
        hue: 0,
        mediaUrl: "https://cdn.example.com/food-walk.jpg",
        mediaType: "image",
        autoplay: false,
        playbackActive: false,
      }),
    );
    await TestRenderer.act(() => tree.unmount());
  });

  test("a video cover appears as its poster still, never a second video player", async () => {
    const tree = await mountAndOpenTheme(
      stepProps({
        cover: {
          ...NO_COVER,
          coverMediaUrl: "https://vz.b-cdn.net/walk/play_720p.mp4",
          coverMediaPosterUrl: "https://vz.b-cdn.net/walk/poster.jpg",
          coverMediaType: "video",
        },
      }),
    );
    const tiles = coverTiles(tree);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].props.mediaUrl).toBe("https://vz.b-cdn.net/walk/poster.jpg");
    expect(tiles[0].props.mediaType).toBe("image");
    expect(tiles[0].props.autoplay).toBe(false);
    await TestRenderer.act(() => tree.unmount());
  });

  test("fallbacks: no title reads Untitled experience, no date reads Date TBD, no cover shows the cover colour", async () => {
    const tree = await mountAndOpenTheme(
      stepProps({
        title: "   ",
        when: { whenMode: "single", date: null, doorsOpen: null, multiDates: null },
      }),
    );
    expect(bandTexts(tree)).toEqual(["Date TBD", "Untitled experience", "Reserve"]);
    const tiles = coverTiles(tree);
    expect(tiles).toHaveLength(1);
    // The same hue the step's own inline cover preview paints with no media.
    const inline = tree.root.findAll((n) => n.type === "StepCoverMediaProbe");
    expect(inline).toHaveLength(1);
    expect(tiles[0].props).toEqual(
      expect.objectContaining({ hue: inline[0].props.hue, mediaUrl: null, mediaType: null }),
    );
    expect(tiles[0].props.hue).toBe(0);
    await TestRenderer.act(() => tree.unmount());
  });

  test("a multi-date experience shows its EARLIEST start, whatever the list order", async () => {
    const overrides = {
      title: null,
      description: null,
      venueName: null,
      address: null,
      onlineUrl: null,
    };
    const tree = await mountAndOpenTheme(
      stepProps({
        when: {
          whenMode: "multi_date",
          date: null,
          doorsOpen: null,
          multiDates: [
            { id: "b", date: "2026-12-05", startTime: "19:00", endTime: "22:00", overrides },
            { id: "a", date: "2026-11-28", startTime: "18:00", endTime: "21:00", overrides },
          ],
        },
      }),
    );
    expect(bandTexts(tree)[0]).toBe("Sat 28 Nov · 6 PM");
    await TestRenderer.act(() => tree.unmount());
  });

  test("a date without a time reads the date alone", async () => {
    const tree = await mountAndOpenTheme(
      stepProps({ when: { ...SINGLE, doorsOpen: null } }),
    );
    expect(bandTexts(tree)[0]).toBe("Sat 14 Nov");
    await TestRenderer.act(() => tree.unmount());
  });
});

describe("#3373 — the step stays memoised (META-ORCH-1059 cover freeze)", () => {
  test("re-rendering the wizard with the same title, When state and cover does not re-render the step", async () => {
    const props = stepProps();
    const tree = await mountAndOpenTheme(props);
    const rendersAfterOpen = mockUseBrand.mock.calls.length;
    // The counter really counts step renders: mount + opening the sheet.
    expect(rendersAfterOpen).toBeGreaterThanOrEqual(2);

    // The wizard re-renders (e.g. a toast); every prop keeps its reference.
    await TestRenderer.act(() => {
      tree.update(<ExperienceCoverStep {...props} />);
    });
    await TestRenderer.act(() => {
      tree.update(<ExperienceCoverStep {...props} />);
    });
    expect(mockUseBrand.mock.calls.length).toBe(rendersAfterOpen);

    // A real change still reaches the preview.
    await TestRenderer.act(() => {
      tree.update(<ExperienceCoverStep {...{ ...props, title: "Lagos Night Market" }} />);
    });
    expect(mockUseBrand.mock.calls.length).toBe(rendersAfterOpen + 1);
    expect(bandTexts(tree)).toContain("Lagos Night Market");
    await TestRenderer.act(() => tree.unmount());
  });
});

describe("#3373 — buildDraftThemePreview for experiences, without changing events or RSVPs", () => {
  const base: ThemePreviewDraft = {
    name: "",
    whenMode: "single",
    date: null,
    doorsOpen: null,
    multiDates: null,
    coverHue: 210,
    coverMediaUrl: null,
    coverMediaType: null,
  };

  test("an experience falls back to Untitled experience and books with Reserve", () => {
    const preview = buildDraftThemePreview({ ...base, kind: "experience" });
    expect(preview.title).toBe("Untitled experience");
    expect(preview.ctaLabel).toBe("Reserve");
    expect(preview.dateLine).toBe("Date TBD");
    expect(preview.cover).toEqual({ hue: 210, imageUrl: null });
  });

  test("events and RSVPs read exactly as they did in #3357", () => {
    expect(buildDraftThemePreview(base)).toEqual({
      dateLine: "Date TBD",
      title: "Untitled event",
      ctaLabel: "Get tickets",
      cover: { hue: 210, imageUrl: null },
    });
    expect(buildDraftThemePreview({ ...base, isRsvp: true })).toEqual({
      dateLine: "Date TBD",
      title: "Untitled RSVP",
      ctaLabel: "Going",
      cover: { hue: 210, imageUrl: null },
    });
  });
});
