/**
 * Step 4 Cover card while a video cover is still processing (filmed on the iOS
 * sim, 2026-09-15).
 *
 * The host closes the cover sheet during "Processing video…". The sheet — and
 * its progress UI — unmounts, the video keeps processing, and the wizard keeps
 * Publish disabled. The card used to show the empty striped placeholder, an
 * "Add cover" button, and nothing about the 3 photos already added.
 *
 * Mounts the REAL CreatorStep4Cover (react-test-renderer over the stock jest
 * config's passthrough react-native mock; the sheet, media and theme children
 * are stubbed):
 *   P-1  processing → "Processing video…" on the card, button says "Change cover".
 *   P-2  not processing → no overlay, "Add cover".
 *   P-3  the body matches the sheet's promise per apply mode (draft auto-applies;
 *        a published edit waits for the host).
 *   G-1  added gallery photos are counted under the card.
 *   W-1  all three Cover-step mounts hand the wizard's flag back to the step.
 *
 * FAILS-ON-REVERT: drop the overlay / label change (P-1), the gallery count
 * (G-1), or any `coverVideoProcessing,` baseProps line (W-1).
 */

import { readFileSync } from "fs";
import path from "path";
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

import type { DraftEvent } from "../../../store/draftEventStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("../../../hooks/useBrands", () => ({
  useBrand: () => ({ isLoading: false, isError: false, data: null }),
}));
jest.mock("../../ui/Button", () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { Pressable, Text } = require("react-native");
  const R = require("react");
  /* eslint-enable @typescript-eslint/no-require-imports */
  return {
    Button: (props: { label: string; testID?: string; onPress?: () => void }) =>
      R.createElement(
        Pressable,
        { testID: props.testID, onPress: props.onPress },
        R.createElement(Text, null, props.label),
      ),
  };
});
jest.mock("../../ui/CoverPickerSheet", () => ({ CoverPickerSheet: (): null => null }));
jest.mock("../../ui/EventCoverMedia", () => ({ EventCoverMedia: (): null => null }));
jest.mock("../../theme/ThemeControlRow", () => ({ ThemeControlRow: (): null => null }));
jest.mock("../../theme/ThemeSheet", () => ({ ThemeSheet: (): null => null }));
jest.mock("../../theme/themePreviewContent", () => ({
  buildDraftThemePreview: (): null => null,
}));

import {
  CreatorStep4Cover,
  coverStepGalleryCountLabel,
  coverStepProcessingBody,
} from "../CreatorStep4Cover";

type JsonNode = {
  type: string;
  props: Record<string, unknown>;
  children: Array<JsonNode | string> | null;
};
type HostNode = { type: unknown; props: Record<string, unknown> };
type Tree = {
  root: { findAll: (predicate: (node: HostNode) => boolean) => HostNode[] };
  toJSON: () => JsonNode | JsonNode[] | null;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const makeDraft = (overrides: Partial<DraftEvent> = {}): DraftEvent =>
  ({
    // A server uuid, so the step does not try to prepare a server row.
    id: "0b6f2f3e-7a51-4e7b-9a1c-2d3e4f5a6b7c",
    brandId: "brand-1",
    coverHue: 25,
    coverMediaUrl: null,
    coverMediaType: null,
    coverMediaAlt: null,
    coverMediaProvider: null,
    coverMediaCredit: null,
    themeOverrides: null,
    ...overrides,
  }) as unknown as DraftEvent;

async function mount(props: {
  draft: DraftEvent;
  coverVideoProcessing?: boolean;
  coverMediaApplyMode?: "draft_auto" | "published_manual";
}): Promise<Tree> {
  let tree: Tree | undefined;
  await act(() => {
    tree = TestRenderer.create(
      <CreatorStep4Cover
        {...({
          errors: [],
          showErrors: false,
          updateDraft: () => {},
          onShowToast: () => {},
          onCoverVideoProcessingChange: () => {},
          ...props,
        } as unknown as React.ComponentProps<typeof CreatorStep4Cover>)}
      />,
    );
  });
  return tree as Tree;
}

const hostByTestId = (tree: Tree, testID: string): HostNode[] =>
  tree.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === testID,
  );

const allText = (tree: Tree): string => {
  const out: string[] = [];
  const walk = (node: JsonNode | string | null): void => {
    if (node === null) return;
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  const json = tree.toJSON();
  for (const node of Array.isArray(json) ? json : [json]) walk(node);
  return out.join("\n");
};

describe("P — the card shows a video that is still processing", () => {
  test("P-1 processing with no cover yet: overlay + 'Change cover'", async () => {
    const tree = await mount({
      draft: makeDraft(),
      coverVideoProcessing: true,
      coverMediaApplyMode: "draft_auto",
    });

    expect(hostByTestId(tree, "cover-step-video-processing")).toHaveLength(1);
    const text = allText(tree);
    expect(text).toContain("Processing video…");
    expect(text).toContain(coverStepProcessingBody("draft_auto"));
    expect(text).toContain("Change cover");
    expect(text).not.toContain("Add cover");
  });

  test("P-2 not processing: no overlay, 'Add cover'", async () => {
    const tree = await mount({ draft: makeDraft(), coverVideoProcessing: false });

    expect(hostByTestId(tree, "cover-step-video-processing")).toHaveLength(0);
    expect(allText(tree)).toContain("Add cover");
    expect(allText(tree)).not.toContain("Processing video…");
  });

  test("P-3 the body keeps the sheet's promise for each apply mode", async () => {
    expect(coverStepProcessingBody("draft_auto")).toBe(
      "You can keep going. It becomes your cover when it's ready.",
    );
    expect(coverStepProcessingBody("published_manual")).toBe(
      "Open the cover again when it's ready to use it.",
    );

    const tree = await mount({
      draft: makeDraft({ coverMediaUrl: "https://cdn.example/cover.jpg", coverMediaType: "image" } as Partial<DraftEvent>),
      coverVideoProcessing: true,
      coverMediaApplyMode: "published_manual",
    });
    expect(allText(tree)).toContain(
      "Open the cover again when it's ready to use it.",
    );
  });
});

describe("G-1 added gallery photos are counted under the card", () => {
  test.each([
    [3, "Plus 3 more photos"],
    [1, "Plus 1 more photo"],
  ])("%i photos → %s", async (count, label) => {
    const coverGallery = Array.from({ length: count }, (_, i) => ({
      url: `https://cdn.example/photo-${i}.jpg`,
      type: "image",
    }));
    const tree = await mount({
      draft: makeDraft({ coverGallery } as unknown as Partial<DraftEvent>),
      coverVideoProcessing: true,
    });

    expect(hostByTestId(tree, "cover-step-gallery-count")).toHaveLength(1);
    expect(allText(tree)).toContain(label);
  });

  test("no photos (or an unknown gallery) → no count line", async () => {
    expect(coverStepGalleryCountLabel(0)).toBeNull();
    const tree = await mount({ draft: makeDraft() });
    expect(hostByTestId(tree, "cover-step-gallery-count")).toHaveLength(0);
  });
});

describe("W-1 every Cover-step mount passes the processing flag back", () => {
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  // The two creator wizards route the flag through the cover-tracking handler
  // from #3407 (it still sets coverVideoProcessing); the published-event
  // editor passes the state setter directly.
  test.each([
    ["src/components/rsvp/RsvpCreatorWizard.tsx", "handleCoverProcessingChange"],
    ["src/components/event/EventCreatorWizard.tsx", "handleCoverProcessingChange"],
    ["src/components/event/EditPublishedScreen.tsx", "setCoverVideoProcessing"],
  ])("%s", (file, handler) => {
    const src = stripComments(
      readFileSync(path.join(process.cwd(), file), "utf8"),
    );
    expect(src).toMatch(
      new RegExp(`onCoverVideoProcessingChange: ${handler},\\s*coverVideoProcessing,`),
    );
  });
});
