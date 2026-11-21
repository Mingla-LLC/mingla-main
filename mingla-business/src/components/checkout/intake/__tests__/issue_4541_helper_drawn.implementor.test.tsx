/**
 * #4541 T-35 (R6.3, R2.7, R2.12 shared part) — the shared question frame in
 * @mingla/form-rendering draws `helper`: help text under the label, then the
 * "Shown to door staff" line with the eye as its own element (hidden from
 * screen readers). The required mark takes an injected colour, and every word
 * the package draws can be injected (`primitives.copy`).
 *
 * Lives in the mingla-business default suite (not packages/form-rendering/
 * __tests__) because nothing under packages/** is swept by that suite, and a
 * package-local jest config would need its own CI registration.
 *
 * FAILS-ON-REVERT: deleting the `<IntakeQuestionHelper …/>` line in
 * IntakeQuestionShell turns "help text and the door line both draw" RED;
 * restoring `color: color.accent` on the asterisk turns the requiredMark case RED.
 */

import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

// `@types/react-test-renderer` is not installed here: a local shape, as
// issue_2160_roster_and_wizard does.
type ReactTestInstance = {
  type: unknown;
  props: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  find: (p: (n: ReactTestInstance) => boolean) => ReactTestInstance;
  findAll: (p: (n: ReactTestInstance) => boolean) => ReactTestInstance[];
};
type ReactTestRenderer = { root: ReactTestInstance };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  create: (el: React.ReactElement) => ReactTestRenderer;
  act: (cb: () => void) => void;
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("@react-native-community/datetimepicker", () => ({ __esModule: true, default: () => null }));

import {
  BrandFormRenderer,
  DEFAULT_FORM_RENDERING_COPY,
  IntakeFormRenderer,
  rendererSchema,
  SHOWN_TO_DOOR_STAFF,
  type FormIconProps,
  type FormRenderingPrimitives,
  type FormRenderingTokens,
  type BrandFormDefinitionShape,
} from "@mingla/form-rendering";

const IconStub: React.FC<FormIconProps> = (props) => React.createElement("Icon", props);
const WebDateStub: React.FC = () => null;

const tokens = (requiredMark?: string): FormRenderingTokens => ({
  color: {
    danger: "#d00",
    warning: "#fa0",
    accent: "#ff7a00",
    accentLine: "#ff7a00",
    line: "#333",
    text1: "#fff",
    text2: "#ccc",
    text3: "#999",
    text4: "#777",
    textStrong: "#fff",
    fill: { inset: "#111" },
    ...(requiredMark !== undefined ? { requiredMark } : {}),
  },
  radius: { sm: 8, md: 12 },
  space: { 1: 4, 2: 8, 4: 16, 6: 24 },
  type: { body: { fontSize: 16, lineHeight: 24 }, caption: { fontSize: 12, lineHeight: 16 }, small: { fontSize: 14 } },
});

const primitivesWith = (extra: Partial<FormRenderingPrimitives> = {}, requiredMark?: string): FormRenderingPrimitives => ({
  tokens: tokens(requiredMark),
  Icon: IconStub,
  WebDateTimeInput: WebDateStub as FormRenderingPrimitives["WebDateTimeInput"],
  ...extra,
});

const def: BrandFormDefinitionShape = {
  questions: [
    { id: "q1", position: 0, type: "short_text", label: "Dietary needs?", required: true,
      help: "Tell us about allergies.", show_at_door: true },
    { id: "q2", position: 1, type: "short_text", label: "Who invited you?", required: false },
  ],
};

const texts = (root: ReactTestInstance): string[] =>
  root.findAll((n) => (n.type as unknown) === "Text").map((n) =>
    React.Children.toArray(n.props.children as React.ReactNode).filter((c) => typeof c === "string").join(""),
  );

const mount = (el: React.ReactElement): ReactTestRenderer => {
  let r: ReactTestRenderer | null = null;
  act(() => {
    r = create(el);
  });
  if (r === null) throw new Error("not mounted");
  return r;
};

describe("#4541 R6.3 the question frame draws helper", () => {
  test("help text and the door line both draw, under the label and before the field", () => {
    const primitives = primitivesWith();
    const r = mount(
      <IntakeFormRenderer schema={rendererSchema(def, {})} answers={{}} onAnswersChange={() => undefined} primitives={primitives} />,
    );
    const all = texts(r.root);
    expect(all).toContain("Tell us about allergies.");
    expect(all).toContain(SHOWN_TO_DOOR_STAFF);
    // Exactly one door row (q2 is not a door question).
    const doorRows = r.root.findAll((n) => n.props.testID === "intake-question-helper-door" && (n.type as unknown) === "View");
    expect(doorRows).toHaveLength(1);
    expect(doorRows[0]?.props.accessibilityLabel).toBe("Shown to door staff");
    expect(doorRows[0]?.props.accessible).toBe(true);
    // The eye is its own element, hidden from screen readers.
    const eyeWrap = r.root.find((n) => n.props.testID === "intake-question-helper-door-eye" && (n.type as unknown) === "View");
    expect(eyeWrap.props.accessibilityElementsHidden).toBe(true);
    expect(eyeWrap.props.importantForAccessibility).toBe("no-hide-descendants");
    const eye = eyeWrap.find((n) => (n.type as unknown) === "Icon");
    expect(eye.props.name).toBe("eye");
    expect(eye.props.size).toBe(12);
    // Order: label, then helper, then the field.
    const order = r.root.findAll((n) =>
      ((n.type as unknown) === "View" && n.props.testID === "intake-question-helper") || (n.type as unknown) === "TextInput",
    ).map((n) => ((n.type as unknown) === "TextInput" ? "field" : "helper"));
    expect(order.slice(0, 2)).toEqual(["helper", "field"]);
    // The help line is plain muted caption (no eye).
    const helpLine = r.root.find((n) => (n.type as unknown) === "Text" && n.props.children === "Tell us about allergies.");
    expect(helpLine.props.style).toMatchObject({ color: "#999", fontSize: 12 });
  });

  test("a question with no helper draws no helper block", () => {
    const r = mount(
      <IntakeFormRenderer
        schema={rendererSchema({ questions: [def.questions[1]!] }, {})}
        answers={{}}
        onAnswersChange={() => undefined}
        primitives={primitivesWith()}
      />,
    );
    expect(r.root.findAll((n) => n.props.testID === "intake-question-helper")).toHaveLength(0);
  });
});

describe("#4541 R2.7 the required mark colour is injected", () => {
  const asteriskColor = (p: FormRenderingPrimitives): unknown => {
    const r = mount(
      <IntakeFormRenderer schema={rendererSchema(def, {})} answers={{}} onAnswersChange={() => undefined} primitives={p} />,
    );
    const star = r.root.find((n) => (n.type as unknown) === "Text" && n.props.children === " *");
    return (star.props.style as { color?: string }).color;
  };
  test("white when the app passes it; the accent when nothing is passed (Host and buyer web)", () => {
    expect(asteriskColor(primitivesWith({}, "#fff"))).toBe("#fff");
    expect(asteriskColor(primitivesWith())).toBe("#ff7a00");
  });
});

describe("#4541 R2.12 the package words can be injected", () => {
  test("defaults are today's English", () => {
    expect(DEFAULT_FORM_RENDERING_COPY.shownToDoorStaff).toBe("Shown to door staff");
    expect(DEFAULT_FORM_RENDERING_COPY.answersSeenLine).toBe("The host and their door staff can see your answers.");
    expect(DEFAULT_FORM_RENDERING_COPY.optional).toBe("(optional)");
    expect(DEFAULT_FORM_RENDERING_COPY.requiredToContinue).toBe("Answer the required questions to continue");
    expect(DEFAULT_FORM_RENDERING_COPY.fieldErrors).toEqual({
      required: "Answer this question.",
      type: "Check this answer.",
      option: "Pick one of the choices.",
      too_long: "This answer is too long.",
    });
  });

  test("injected words reach the door line (with its eye), the optional note and the top line", () => {
    const primitives = primitivesWith({
      copy: { shownToDoorStaff: "Visible à l'entrée", optional: "(facultatif)", answersSeenLine: "L'hôte voit vos réponses." },
    });
    const r = mount(
      <BrandFormRenderer definition={def} answers={{}} onAnswersChange={() => undefined} primitives={primitives} doorFullAnswers />,
    );
    const all = texts(r.root);
    expect(all).toContain("Visible à l'entrée");
    expect(all).not.toContain("Shown to door staff");
    expect(all).toContain("(facultatif)");
    expect(all).toContain("L'hôte voit vos réponses.");
    const door = r.root.find((n) => n.props.testID === "intake-question-helper-door" && (n.type as unknown) === "View");
    expect(door.props.accessibilityLabel).toBe("Visible à l'entrée");
  });
});
