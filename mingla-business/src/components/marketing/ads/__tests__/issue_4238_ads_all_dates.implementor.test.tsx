/**
 * #4238 — one ad promotes every date of a series (Host picker + builder).
 *
 *   J1  The picker shows the next date plus "+N more dates" in the page's own
 *       time zone (a Lagos 00:30 date is the Lagos day, not the viewer's).
 *   J2  A page that can't be promoted is greyed out, can't be pressed, and
 *       says why in plain words; every reason passes hostAdCopyIsPlain.
 *   J3  When nothing can be promoted, a one-line note says each one says why.
 *   J4  Builder rules: the end defaults to and is capped at the last day
 *       people can book; the plan never sends a later end.
 *
 * MINGLA-INVARIANT: I-4238-AD-PICKER-SAYS-WHY | issue #4238 | The Host page picker shows a page that can't be promoted greyed out with a plain reason and never lets it be chosen.
 */

import React from "react";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type RenderNode = {
  props: Record<string, unknown>;
  type: unknown;
  children: (RenderNode | string)[];
};
type Renderer = {
  root: {
    findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[];
  };
  unmount: () => void;
};

// The repository intentionally omits declarations for this test-only renderer.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (callback: () => void) => void;
  create: (element: React.ReactElement) => Renderer;
};

jest.mock("react-native", () => {
  const base = jest.requireActual("react-native") as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLib = require("react") as typeof React;
  // Render every row so the picker's rows are inspectable.
  const FlatList = ({
    data,
    renderItem,
  }: {
    data: readonly unknown[];
    renderItem: (info: { item: unknown; index: number }) => React.ReactElement;
  }) =>
    ReactLib.createElement(
      "FlatList",
      null,
      data.map((item, index) =>
        ReactLib.cloneElement(renderItem({ item, index }), { key: String(index) }),
      ),
    );
  return { ...base, FlatList, Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default } };
});
jest.mock("../../../../../../packages/phone-input/keyboardPrimitives", () => ({
  KeyboardProvider: ({ children }: { children: React.ReactNode }) => children,
  KeyboardToolbar: () => null,
}));
jest.mock(
  "react-native-safe-area-context",
  () => ({
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  }),
  { virtual: true },
);
jest.mock(
  "expo-haptics",
  () => ({ impactAsync: jest.fn(), ImpactFeedbackStyle: { Light: "light" } }),
  { virtual: true },
);

// eslint-disable-next-line import/first
import { HostAdPagePicker } from "../HostAdPagePicker";
// eslint-disable-next-line import/first
import {
  hostAdPageDate,
  hostAdPageSchedule,
  hostAdPageUnavailableReason,
} from "../hostAdPageLabels";
// eslint-disable-next-line import/first
import {
  hostAdScheduleEndIso,
  hostAdScheduleError,
  hostAdScheduleLimit,
} from "../hostAdBuilderRules";
// eslint-disable-next-line import/first
import { hostAdCopyIsPlain, hostAdErrorMessage } from "../hostAdCopy";
// eslint-disable-next-line import/first
import type { HostAdPage } from "../../../../services/hostAdPlanService";

const base = (patch: Partial<HostAdPage>): HostAdPage => ({
  page_type: "event",
  id: "p",
  brand_slug: "harmattan",
  entity_slug: "sunday-rooftop",
  title: "Sunday Rooftop Sessions",
  brand_name: "Harmattan Club",
  canonical_url: "https://host.usemingla.com/e/harmattan/sunday-rooftop",
  availability: "available",
  starts_at: "2026-11-08T18:00:00Z",
  city: "Lagos",
  cover_url: null,
  result_kind: "tickets",
  ok: true,
  ...patch,
});

const textOf = (node: RenderNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");

function render(element: React.ReactElement): Renderer {
  let renderer: Renderer | null = null;
  act(() => {
    renderer = create(element);
  });
  return renderer as unknown as Renderer;
}

const byTestId = (renderer: Renderer, id: string): RenderNode[] =>
  renderer.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === id,
  );

describe("#4238 J1 series date line in the page's time zone", () => {
  it("shows the next date and how many more", () => {
    const page = base({
      next_date: "2026-11-08T18:00:00Z",
      dates_remaining: 5,
      timezone: "Africa/Lagos",
    });
    expect(hostAdPageSchedule(page)).toBe("Sun 8 Nov · +4 more dates");
    expect(hostAdPageSchedule({ ...page, dates_remaining: 2 })).toBe(
      "Sun 8 Nov · +1 more date",
    );
    expect(hostAdPageSchedule({ ...page, dates_remaining: 1 })).toBe("Sun 8 Nov");
  });

  it("uses the event's day, not the viewer's", () => {
    // 23:30 UTC Sat 7 Nov is 00:30 Sun 8 Nov in Lagos.
    expect(hostAdPageDate("2026-11-07T23:30:00Z", "Africa/Lagos")).toBe("Sun 8 Nov");
    expect(hostAdPageDate("2026-11-07T23:30:00Z", "America/New_York")).toBe("Sat 7 Nov");
  });

  it("renders the line in the picker row", () => {
    const renderer = render(
      <HostAdPagePicker
        pages={[
          base({
            id: "series",
            next_date: "2026-11-07T23:30:00Z",
            starts_at: "2026-11-07T23:30:00Z",
            dates_remaining: 5,
            timezone: "Africa/Lagos",
          }),
        ]}
        selected={null}
        onSelect={jest.fn()}
      />,
    );
    expect(textOf(byTestId(renderer, "host-ad-page-series")[0])).toContain(
      "Sun 8 Nov · +4 more dates · Lagos",
    );
    renderer.unmount();
  });
});

const UNAVAILABLE: [Partial<HostAdPage>, string][] = [
  [{ availability: "draft" }, "Not published yet."],
  [{ availability: "private" }, "This page is private, so an ad can't link to it."],
  [{ availability: "unlisted", page_type: "trip" }, "Unlisted trips can't be promoted. Make it public to promote it."],
  [{ availability: "unlisted", page_type: "experience" }, "Unlisted experiences can't be promoted. Make it public to promote it."],
  [{ availability: "ended" }, "All its dates have passed."],
  [{ availability: "nothing_on_sale" }, "Nothing is on sale right now."],
  [{ availability: "nothing_on_sale", page_type: "rsvp" }, "No spots left."],
  [{ availability: "bookings_closed", page_type: "trip" }, "Bookings are closed."],
  [{ availability: "not_live", page_type: "site" }, "Your website isn't live yet."],
  [{ availability: "something_new" }, "Can't be promoted right now."],
];

describe("#4238 J2 unavailable pages are greyed out with a reason", () => {
  it.each(UNAVAILABLE)("%j → %s", (patch, reason) => {
    const page = base({ ...patch, ok: false });
    expect(hostAdPageUnavailableReason(page)).toBe(reason);
    expect(hostAdCopyIsPlain(reason)).toBe(true);
  });

  it("an ok page has no reason", () => {
    expect(hostAdPageUnavailableReason(base({ ok: true }))).toBeNull();
    expect(hostAdPageUnavailableReason(base({ ok: undefined }))).toBeNull();
  });

  it("can't be chosen, and says why", () => {
    const onSelect = jest.fn();
    const renderer = render(
      <HostAdPagePicker
        pages={[
          base({ id: "live" }),
          base({ id: "gone", title: "Old Night", availability: "ended", ok: false }),
        ]}
        selected={null}
        onSelect={onSelect}
      />,
    );
    const gone = byTestId(renderer, "host-ad-page-gone")[0];
    expect(gone.props.disabled).toBe(true);
    expect(gone.props.onPress).toBeUndefined();
    expect((gone.props.accessibilityState as { disabled: boolean }).disabled).toBe(true);
    expect(String(gone.props.accessibilityLabel)).toContain(
      "can't be promoted: All its dates have passed.",
    );
    expect(textOf(byTestId(renderer, "host-ad-page-reason-gone")[0])).toBe(
      "All its dates have passed.",
    );
    const live = byTestId(renderer, "host-ad-page-live")[0];
    act(() => {
      (live.props.onPress as () => void)();
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(byTestId(renderer, "host-ad-page-none-promotable")).toHaveLength(0);
    renderer.unmount();
  });

  it("an unavailable page is never shown as selected", () => {
    const gone = base({ id: "gone", availability: "ended", ok: false });
    const renderer = render(
      <HostAdPagePicker pages={[gone]} selected={gone} onSelect={jest.fn()} />,
    );
    const row = byTestId(renderer, "host-ad-page-gone")[0];
    expect((row.props.accessibilityState as { selected: boolean }).selected).toBe(false);
    renderer.unmount();
  });
});

describe("#4238 J3 nothing promotable", () => {
  it("shows one plain line above the list", () => {
    const renderer = render(
      <HostAdPagePicker
        pages={[base({ id: "a", availability: "draft", ok: false })]}
        selected={null}
        onSelect={jest.fn()}
      />,
    );
    const note = textOf(byTestId(renderer, "host-ad-page-none-promotable")[0]);
    expect(note).toBe("None of your pages can be promoted right now. Each one says why.");
    expect(hostAdCopyIsPlain(note)).toBe(true);
    expect(byTestId(renderer, "host-ad-page-empty")).toHaveLength(0);
    renderer.unmount();
  });
});

describe("#4238 J4 builder schedule rules", () => {
  const page = base({ last_bookable_at: "2026-12-06T22:00:00Z", timezone: "Africa/Lagos" });
  const limit = hostAdScheduleLimit(page, (iso) => hostAdPageDate(iso, page.timezone));

  it("knows the last bookable day", () => {
    expect(limit?.lastIso).toBe("2026-12-06T22:00:00.000Z");
    expect(limit?.label).toBe("Sun 6 Dec");
    expect(limit?.lastDay).toMatch(/^2026-12-0[67]$/);
    expect(hostAdScheduleLimit(base({}), () => null)).toBeNull();
  });

  it("refuses a later end or start in plain words", () => {
    const end = hostAdScheduleError("", "2026-12-20", limit);
    expect(end).toBe(
      "Your ad can run until Sun 6 Dec, the last day people can book. Pick an earlier end date.",
    );
    const start = hostAdScheduleError("2026-12-20", "", limit);
    expect(start).toBe("Your ad has to start by Sun 6 Dec, the last day people can book.");
    expect(hostAdCopyIsPlain(String(end)) && hostAdCopyIsPlain(String(start))).toBe(true);
    expect(hostAdScheduleError("", limit?.lastDay ?? "", limit)).toBeNull();
    expect(hostAdScheduleError("", "2099-01-01", null)).toBeNull();
  });

  it("never sends an end past the last bookable moment", () => {
    expect(hostAdScheduleEndIso(null, limit)).toBe("2026-12-06T22:00:00.000Z");
    expect(hostAdScheduleEndIso("2026-12-06T23:59:59.999Z", limit)).toBe(
      "2026-12-06T22:00:00.000Z",
    );
    expect(hostAdScheduleEndIso("2026-12-01T23:59:59.999Z", limit)).toBe(
      "2026-12-01T23:59:59.999Z",
    );
    expect(hostAdScheduleEndIso(null, null)).toBeNull();
  });

  it("server refusals read plainly", () => {
    for (const detail of [
      "schedule_end_required",
      "schedule_ends_after_last_date",
      "schedule_starts_after_last_date",
      "ad_plan_destination_invalid:destination_ended",
      "destination_nothing_on_sale",
      "destination_bookings_closed",
      "destination_unlisted_not_linkable",
    ]) {
      const text = hostAdErrorMessage({ code: "plan_preflight_failed", detail });
      expect(hostAdCopyIsPlain(text)).toBe(true);
      expect(text).not.toMatch(/try again in a minute/i);
    }
    expect(hostAdErrorMessage({ detail: "destination_ended" })).toBe(
      "All the dates for this page have passed, so it can't be promoted.",
    );
  });
});

describe("#4238 J6 (rework) a greyed-out row's reason is readable (>= 4.5:1)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { StyleSheet } = require("react-native") as typeof import("react-native");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ds = require("../../../../constants/designSystem") as typeof import("../../../../constants/designSystem");

  type Rgba = [number, number, number, number];
  const parse = (value: string): Rgba => {
    if (value.startsWith("#")) {
      const hex = value.slice(1);
      return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(1) as Rgba;
    }
    const nums = value.match(/[\d.]+/g)!.map(Number);
    return [nums[0], nums[1], nums[2], nums[3] ?? 1];
  };
  const over = (top: Rgba, bottom: Rgba, extraAlpha = 1): Rgba => {
    const a = top[3] * extraAlpha;
    return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1) as Rgba;
  };
  const luminance = ([r, g, b]: Rgba): number => {
    const ch = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  };
  const contrast = (a: Rgba, b: Rgba): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it("no dimming above the reason, and it measures at least 4.5:1 on the row", () => {
    const renderer = render(
      <HostAdPagePicker
        pages={[base({ id: "gone", title: "Old Night", availability: "ended", ok: false })]}
        selected={null}
        onSelect={jest.fn()}
      />,
    );
    const reason = byTestId(renderer, "host-ad-page-reason-gone")[0] as RenderNode & {
      parent: (RenderNode & { parent: unknown }) | null;
    };
    let opacity = 1;
    let node: { props?: Record<string, unknown>; parent?: unknown } | null = reason;
    while (node) {
      const flat = StyleSheet.flatten(node.props?.style as never) as { opacity?: number } | undefined;
      if (typeof flat?.opacity === "number") opacity *= flat.opacity;
      node = (node.parent as typeof node) ?? null;
    }
    expect(opacity).toBe(1);
    const color = (StyleSheet.flatten(reason.props.style as never) as { color: string }).color;
    const row = over(parse(ds.glass.tint.chrome.idle), parse(ds.canvas.discover));
    const ink = over(parse(color), row, opacity);
    expect(contrast(ink, row)).toBeGreaterThanOrEqual(4.5);
    renderer.unmount();
  });
});
