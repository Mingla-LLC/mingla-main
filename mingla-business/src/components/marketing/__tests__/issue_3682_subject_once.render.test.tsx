import React, { useState } from "react";

// #3682 closeout — a local-stack screenshot of the review sheet (Email lead +
// "Also send by Push") read SUBJECT "Garden party this SaturdayGarden party
// this Saturday". This suite mounts the REAL subject input and the REAL review
// sheet, wired through the same `setSubject(value)` shape compose.tsx uses, and
// proves the composer carries the subject exactly once: the input replaces the
// value on every change (it never appends), and adding Push adds an
// "ALSO SENDING BY" row without touching the subject. The doubled subject in
// the screenshot was typed twice; the code does not duplicate it.
//
// Run: npx jest --config jest.issue1780.render.cjs --runInBand issue_3682_subject_once

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer");
const { act } = TestRenderer;

jest.mock("../../ui/Sheet", () => {
  const ReactModule = require("react");
  return { Sheet: (props: Record<string, unknown>) => ReactModule.createElement("sheet", props, props.children) };
});

jest.mock("../ComposerV2/richEditor", () => {
  const ReactLocal = jest.requireActual("react");
  const RN = jest.requireActual("react-native");
  return {
    __esModule: true,
    actions: {},
    RichEditor: ReactLocal.forwardRef(() => ReactLocal.createElement(RN.View, { testID: "mock-rich-editor" })),
  };
});

jest.mock("../ComposerV2/TemplatePreviewDrawer", () => ({
  __esModule: true,
  TemplatePreviewDrawer: (): null => null,
}));

jest.mock("expo-linear-gradient", () => {
  const ReactLocal = jest.requireActual("react");
  const RN = jest.requireActual("react-native");
  return {
    __esModule: true,
    LinearGradient: (props: Record<string, unknown>) => ReactLocal.createElement(RN.View, props),
  };
});

jest.mock("../../../hooks/useResponsiveLayout", () => ({
  WIDE_DESKTOP_MIN_WIDTH: 1024,
  useResponsiveLayout: () => ({ isWideDesktop: false, isWeb: false, width: 390, isShort: false }),
}));

import { ComposerReviewSheet } from "../ComposerReviewSheet";
import { ComposerV2Editor } from "../ComposerV2/ComposerV2Editor";

const SUBJECT = "Garden party this Saturday";
const noop = (): void => undefined;

const treeText = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(treeText).join(" ");
  if (value && typeof value === "object" && "children" in value) {
    return treeText((value as { children?: unknown }).children);
  }
  return "";
};

const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

let latestSubject = "";

/** compose.tsx's shape: `const [subject, setSubject] = useState("")`, and
 * `onSubjectChange = (value) => setSubject(value)`; the review sheet reads the
 * same state. */
function Harness(): React.ReactElement {
  const [subject, setSubject] = useState("");
  latestSubject = subject;
  return (
    <>
      <ComposerV2Editor
        initialBodyHtml=""
        subject={subject}
        onSubjectChange={(value: string) => setSubject(value)}
        onBodyChange={noop}
        editable
        brandEvents={[]}
        templates={[]}
        previewVariables={{} as never}
        brandName="Acme"
        currentDraftIsDirty={false}
        onErrorToast={noop}
      />
      <ComposerReviewSheet
        visible
        audienceName="Followers"
        recipientCount={12}
        subject={subject}
        scheduledLabel="Now"
        isSendNow
        submitting={false}
        onBack={noop}
        onClose={noop}
        onConfirm={noop}
        channelKind="email"
        sendingBy={[
          { key: "push", label: "Push", reachLabel: "9 reachable", costLabel: "Free" },
        ]}
      />
    </>
  );
}

const subjectInput = (renderer: any): any =>
  renderer.root.find(
    (node: any) => node.props.testID === "composer-v2-subject" && typeof node.props.onChangeText === "function",
  );

describe("#3682 closeout — the composer carries the subject once", () => {
  it("typing the subject key by key leaves it exactly once in state and on the review sheet", () => {
    let renderer: any;
    act(() => { renderer = TestRenderer.create(<Harness />); });
    for (const ch of SUBJECT) {
      const input = subjectInput(renderer);
      act(() => input.props.onChangeText(`${input.props.value}${ch}`));
    }
    expect(latestSubject).toBe(SUBJECT);
    expect(subjectInput(renderer).props.value).toBe(SUBJECT);
    const text = treeText(renderer.toJSON());
    expect(text).toContain("SENDING BY");
    expect(text).toContain("Push");
    // Once in the input's value prop is not in the text tree; the review sheet
    // is the only place the subject renders as text.
    expect(occurrences(text, SUBJECT)).toBe(1);
    expect(text).not.toContain(`${SUBJECT}${SUBJECT}`);
  });

  it("pasting the whole subject in one change replaces, never appends", () => {
    let renderer: any;
    act(() => { renderer = TestRenderer.create(<Harness />); });
    act(() => subjectInput(renderer).props.onChangeText(SUBJECT));
    act(() => subjectInput(renderer).props.onChangeText(SUBJECT));
    expect(latestSubject).toBe(SUBJECT);
    expect(occurrences(treeText(renderer.toJSON()), SUBJECT)).toBe(1);
  });
});
