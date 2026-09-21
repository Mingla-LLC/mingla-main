/**
 * #3429 REWORK-4 N-2 [ari-chat-polish] — implementor happy-path suite.
 *
 * THE DEFECT (RETEST-2 N-2, P3). R-6 taught the renderer to turn an answer's
 * "- item" lines into real bullet rows, and the RETEST proved the VISIBLE rows
 * render a "•" glyph node on both Android and web. The accessibility label was
 * still built from the RAW text, so every assistant bubble announced
 * "Ari said: Here is what I found for your week. dash Friday rooftop launch.
 * dash Saturday supper club…". Sighted users got the R-6 fix; TalkBack and
 * VoiceOver users did not.
 *
 * THE FIX. `toAccessibleText` builds the spoken string from the SAME
 * `toSegments` output the renderer consumes, so the list markers are gone and
 * the announcement cannot drift from what is on screen. It is applied on all
 * three label sites: the assistant bubble, the user bubble (which renders
 * bullets through the same path), and `SemanticRevealText`'s settled label —
 * the last of which is the COMMON case, because a freshly answered turn reveals
 * before it settles.
 *
 * WHY THIS SUITE RENDERS. The defect was invisible to every source-level check
 * in the repo precisely because the renderer was already correct; only the
 * label was wrong. So this suite mounts the real `ChatBubble` with the exact
 * content shape the RETEST captured and reads the real `accessibilityLabel`
 * back off the rendered element, exactly as the Android accessibility tree dump
 * did.
 *
 * fails-on-revert (proven by TRUE LINE DELETION, never a comment-out): restore
 * any of the three labels to the raw `${text}` form and T-2/T-3/T-4 go red with
 * the literal "- " back in the announcement.
 *
 * Adversarial coverage (nested/ordered lists, mixed markers, live-region
 * announcement order) is tester-owned.
 */

import React from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("../AriOrb", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return {
    AriOrb: (props: Record<string, unknown>): React.ReactElement =>
      ReactModule.createElement("AriOrb", props),
  };
});

// SemanticRevealText value-imports reanimated, which the node/ts-jest config
// cannot load. T-4 asserts against its SOURCE instead, so an inert stand-in
// here costs nothing — the reveal path's label is checked where it is written.
jest.mock("../SemanticRevealText", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return {
    SemanticRevealText: (props: Record<string, unknown>): React.ReactElement =>
      ReactModule.createElement("SemanticRevealText", props),
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ChatBubble, toAccessibleText, toSegments } = require("../ChatBubble") as {
  ChatBubble: React.FC<Record<string, unknown>>;
  toAccessibleText: (raw: string) => string;
  toSegments: (raw: string) => { kind: "paragraph" | "bullet"; text: string }[];
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (fn: () => void) => void;
  create: (el: React.ReactElement) => { toJSON: () => JsonNode; unmount: () => void };
};

interface JsonNode {
  type: string;
  props: Record<string, unknown>;
  children: JsonNode[] | null;
}

/** The exact answer shape the RETEST-2 Android accessibility dump captured. */
const ANSWER =
  "Here is what I found for your week.\n- Friday rooftop launch\n- Saturday supper club\n- Sunday brunch pop-up";

function renderedLabel(props: Record<string, unknown>): string {
  let tree: { toJSON: () => JsonNode; unmount: () => void } | null = null;
  act(() => {
    tree = create(<ChatBubble {...props} />) as unknown as typeof tree;
  });
  const root = tree as unknown as { toJSON: () => JsonNode; unmount: () => void };
  const label = root.toJSON().props.accessibilityLabel as string;
  act(() => root.unmount());
  return label;
}

describe("#3429 REWORK-4 N-2 — the spoken bubble carries no list markers", () => {
  it("T-1 the spoken form is built from the renderer's own segments", () => {
    const segments = toSegments(ANSWER);
    // Every bullet the renderer will draw appears in the announcement, by its
    // own text — so the two cannot describe different content.
    for (const segment of segments) {
      expect(toAccessibleText(ANSWER)).toContain(segment.text);
    }
    expect(segments.filter((s) => s.kind === "bullet")).toHaveLength(3);
  });

  it("T-2 the assistant bubble announces bullets without reading 'dash'", () => {
    const label = renderedLabel({ role: "assistant", text: ANSWER });
    expect(label).toContain("Ari said: Here is what I found for your week.");
    expect(label).toContain("Friday rooftop launch");
    // The defect, stated exactly: a screen reader must not meet a list marker.
    expect(label).not.toContain("- ");
    expect(label).not.toMatch(/^\s*[-•]\s/m);
  });

  it("T-3 the user bubble gets the same treatment (it renders bullets too)", () => {
    const label = renderedLabel({ role: "user", text: ANSWER });
    expect(label).toContain("You said: Here is what I found for your week.");
    expect(label).not.toContain("- ");
  });

  it("T-4 a revealing answer — the COMMON case — is clean too", () => {
    // With `reveal`, ChatBubble hands the label duty to SemanticRevealText, so
    // fixing only ChatBubble would have left the defect on every fresh answer.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { toAccessibleText: shared } = require("../ChatBubble") as {
      toAccessibleText: (raw: string) => string;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const revealSource: string = require("fs").readFileSync(
      require("path").join(__dirname, "..", "SemanticRevealText.tsx"),
      "utf8",
    );
    // The settled label is produced by the shared helper, not by raw text.
    expect(revealSource).toContain("accessibilityLabel={`Ari said: ${toAccessibleText(text)}`}");
    expect(revealSource).not.toContain("accessibilityLabel={`Ari said: ${text}`}");
    expect(shared(ANSWER)).not.toContain("- ");
  });

  it("T-5 plain prose is untouched, so nothing else changed meaning", () => {
    const prose = "Your Friday event sold 42 tickets.";
    expect(toAccessibleText(prose)).toBe(prose);
    expect(renderedLabel({ role: "assistant", text: prose })).toBe(`Ari said: ${prose}`);
  });

  it("T-6 an explicit accessibilityLabel prop still wins", () => {
    const label = renderedLabel({
      role: "assistant",
      text: ANSWER,
      accessibilityLabel: "Ari is thinking",
    });
    expect(label).toBe("Ari is thinking");
  });
});
