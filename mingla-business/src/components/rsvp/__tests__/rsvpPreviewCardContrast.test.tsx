/**
 * RSVP Step 6 "Preview" card — venue line and "Not going" were invisible.
 *
 * Found filming the RSVP tutorial on the iOS simulator (brand "Lantern Room",
 * brand-default theme on a light surface): the card showed the date and title,
 * but "Lantern Room" and "Not going" rendered near-white on the near-white
 * themed panel. Both kept the dark app-chrome token `text.secondary`.
 *
 * Mounts the REAL RsvpStep7Preview (children with their own render lanes are
 * stubbed) on a light AND a dark brand theme, and measures the colour each text
 * actually renders with against the fill it sits on.
 *
 * Fails on revert: restore `color: textTokens.secondary` on miniVenue or
 * ctaNotGoingLabel and the light-theme case measures ~1.2:1.
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

import {
  createThemePalette,
  resolveOfferingSurface,
} from "../../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../../packages/offering-rendering/themeResolver";
import type { Brand } from "../../../store/currentBrandStore";
import { buildDraftEvent } from "../../../store/draftEventStore";
import { AA_TEXT_CONTRAST, textContrastOn } from "../../theme/themedPreviewCardColors";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../ui/EventCoverMedia", () => ({
  EventCoverMedia: () => React.createElement("CoverMedia"),
}));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: { children: React.ReactNode }) =>
    React.createElement("GlassCard", null, children),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => React.createElement("Icon") }));
jest.mock("../../theme/ThemeControlRow", () => ({
  ThemeControlRow: () => React.createElement("ThemeControlRow"),
}));
jest.mock("../../theme/ThemeSheet", () => ({
  ThemeSheet: () => React.createElement("ThemeSheet"),
}));
jest.mock("../../intel/PrePublishIntelligenceSurfaces", () => ({
  TurnoutGateSection: () => null,
}));

// eslint-disable-next-line import/first
import { RsvpStep7Preview } from "../RsvpStep7Preview";

type Node = {
  type: string;
  props: Record<string, unknown>;
  children: (Node | string)[] | null;
};
type Tree = { toJSON: () => unknown; unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (work: () => void) => void;
  create: (node: React.ReactElement) => Tree;
};

const flat = (style: unknown): Record<string, unknown> => {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flat));
  return style !== null && typeof style === "object"
    ? (style as Record<string, unknown>)
    : {};
};

const walk = (node: unknown, visit: (n: Node, ancestors: Node[]) => void, ancestors: Node[] = []): void => {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit, ancestors));
    return;
  }
  const n = node as Node;
  visit(n, ancestors);
  (n.children ?? []).forEach((child) => walk(child, visit, [...ancestors, n]));
};

/** The rendered colour of the <Text> reading `label`, and the nearest filled ancestor. */
const measure = (json: unknown, label: string): { color: string; fill: string } => {
  let found: { color: string; fill: string } | null = null;
  walk(json, (n, ancestors) => {
    if (n.type !== "Text" || found !== null) return;
    const own = (n.children ?? []).filter((c) => typeof c === "string").join("");
    if (own !== label) return;
    const fillHost = [...ancestors]
      .reverse()
      .find((a) => typeof flat(a.props.style).backgroundColor === "string");
    found = {
      color: String(flat(n.props.style).color),
      fill: String(flat(fillHost?.props.style).backgroundColor),
    };
  });
  if (found === null) throw new Error(`no <Text> reading "${label}"`);
  return found;
};

const draft = () => ({
  ...buildDraftEvent("brand-lantern", "draft-1", "2026-09-01T00:00:00.000Z"),
  name: "Neighbors Night on Wythe",
  venueName: "Lantern Room",
  format: "in_person" as const,
  isRsvp: true,
});

const brandWith = (color: string): Brand =>
  ({
    id: "brand-lantern",
    displayName: "Lantern Room",
    theme: { color, font: "dm_serif_display", animation: "none" },
  }) as unknown as Brand;

describe("RSVP Step 6 preview card text reads on the themed surface", () => {
  test.each([
    ["light", "#1e3a8a"],
    ["dark", "#eb7825"],
  ])("%s theme (%s): date, title, venue, Going and Not going all clear AA", (surface, color) => {
    expect(resolveOfferingSurface(resolveTheme({ color }, null))).toBe(surface);
    let tree: Tree | null = null;
    act(() => {
      tree = create(
        <RsvpStep7Preview
          {...({} as React.ComponentProps<typeof RsvpStep7Preview>)}
          draft={draft()}
          updateDraft={() => undefined}
          brand={brandWith(color)}
          onTapMiniCard={() => undefined}
        />,
      );
    });
    const json = (tree as unknown as Tree).toJSON();
    const page = createThemePalette(resolveTheme({ color }, null)).page;

    for (const label of ["Neighbors Night on Wythe", "Lantern Room", "Going", "Not going"]) {
      const { color: fg, fill } = measure(json, label);
      const ratio = textContrastOn(fg, fill);
      if (ratio < AA_TEXT_CONTRAST) {
        throw new Error(`"${label}" ${fg} on ${fill} = ${ratio.toFixed(2)}:1 (${surface})`);
      }
    }
    // The venue line sits directly on the themed page, not on some other fill.
    expect(measure(json, "Lantern Room").fill).toBe(page);
    act(() => (tree as unknown as Tree).unmount());
  });
});
