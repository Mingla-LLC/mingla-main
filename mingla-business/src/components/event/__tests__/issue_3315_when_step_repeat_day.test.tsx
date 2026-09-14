/**
 * #3315 — RENDER proof that the REAL When step keeps a recurring event's repeat
 * day on its first date, and leaves a day the organiser chose alone.
 *
 * Seth's repro (tutorial shoot, 2026-09-13): switch to Recurring BEFORE picking
 * a date (rule seeded "every Monday"), then pick a Tuesday. The rule stayed on
 * Monday.
 *
 * Same harness as orch_1027_web_datetime_native_input.test.tsx: stock
 * jest.config.cjs, react-native -> the manual mock (Platform.OS "web"), so the
 * first-occurrence row is a real WebDateTimeInput whose change reaches
 * commitPickerValue("date") — the one path iOS, Android and web share. The
 * draft lives in a tiny stateful harness so each patch re-renders the step the
 * way the wizard's store does.
 *
 * Fails on revert: drop the followFirstDate call from the date commit and the
 * first test reads "MO"; drop the explicit-pick marking and the second reads
 * "TU".
 */

import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("@react-native-community/datetimepicker", () => ({
  __esModule: true,
  default: (): null => null,
}));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    ScrollView: ({ children }: { children?: React.ReactNode }) =>
      ReactActual.createElement(ReactActual.Fragment, null, children),
  };
});
jest.mock("../../ui/Sheet", () => ({ __esModule: true, Sheet: (): null => null }));
jest.mock("../../ui/Icon", () => ({ __esModule: true, Icon: (): null => null }));
jest.mock("../../ui/Button", () => ({ __esModule: true, Button: (): null => null }));
jest.mock("../../ui/Input", () => ({ __esModule: true, Input: (): null => null }));
jest.mock("../../ui/ConfirmDialog", () => ({
  __esModule: true,
  ConfirmDialog: (): null => null,
}));
// Capture the repeat sheet's handlers so a weekday chip tap can be driven.
const repeatSheet: { props: Record<string, unknown> | null } = { props: null };
jest.mock("../CreatorStep2WhenRepeatPickerSheet", () => ({
  __esModule: true,
  CreatorStep2WhenRepeatPickerSheet: (props: Record<string, unknown>): null => {
    repeatSheet.props = props;
    return null;
  },
}));
jest.mock("../MultiDateOverrideSheet", () => ({
  __esModule: true,
  MultiDateOverrideSheet: (): null => null,
}));

// eslint-disable-next-line import/first
import { CreatorStep2When } from "../CreatorStep2When";
// eslint-disable-next-line import/first
import { buildDraftEvent, type DraftEvent } from "../../../store/draftEventStore";

type HostNode = { type: unknown; props: Record<string, unknown> };
type Tree = {
  root: { findAll: (pred: (n: HostNode) => boolean) => HostNode[] };
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => Tree;
  act: (cb: () => Promise<void> | void) => Promise<void>;
};

const latest: { draft: DraftEvent | null } = { draft: null };

const Harness: React.FC<{ initial: DraftEvent }> = ({ initial }) => {
  const [draft, setDraft] = React.useState<DraftEvent>(initial);
  latest.draft = draft;
  return React.createElement(CreatorStep2When, {
    draft,
    updateDraft: (patch: Partial<DraftEvent>) =>
      setDraft((prev) => ({ ...prev, ...patch })),
    errors: [],
    showErrors: false,
    onShowToast: () => undefined,
    scrollToBottom: () => undefined,
  });
};

const mount = async (): Promise<Tree> => {
  let tree: Tree | undefined;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      React.createElement(Harness, {
        initial: {
          ...buildDraftEvent("brand_3315"),
          whenMode: "single",
          date: null,
          doorsOpen: null,
          endsAt: null,
          endsAtUtc: null,
          recurrenceRule: null,
          timezone: "America/New_York",
        },
      }),
    );
  });
  return tree as Tree;
};

const tapMode = async (tree: Tree, label: string): Promise<void> => {
  const pill = tree.root.findAll(
    (n) => n.type === "Pressable" && n.props.accessibilityLabel === label,
  )[0];
  expect(pill).toBeDefined();
  await TestRenderer.act(async () => {
    (pill.props.onPress as () => void)();
  });
};

const pickFirstDate = async (tree: Tree, iso: string): Promise<void> => {
  const input = tree.root
    .findAll((n) => n.type === "input")
    .find((n) => n.props["data-testid"] === "creator-when-date-web");
  expect(input).toBeDefined();
  await TestRenderer.act(async () => {
    (input?.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: iso },
    });
  });
};

describe("#3315 — the When step's repeat day follows the first date", () => {
  test("Recurring before a date, then a Tuesday: the rule repeats on Tuesday, not Monday", async () => {
    const tree = await mount();
    await tapMode(tree, "Recurring");
    expect(latest.draft?.recurrenceRule?.byDay).toBe("MO"); // the seed

    await pickFirstDate(tree, "2027-06-15"); // a Tuesday
    expect(latest.draft?.date).toBe("2027-06-15");
    expect(latest.draft?.recurrenceRule?.byDay).toBe("TU");

    // Changing the date again keeps following.
    await pickFirstDate(tree, "2027-06-17"); // a Thursday
    expect(latest.draft?.recurrenceRule?.byDay).toBe("TH");

    await TestRenderer.act(() => tree.unmount());
  });

  test("a weekday the organiser picks is kept when the date changes", async () => {
    const tree = await mount();
    await tapMode(tree, "Recurring");
    await pickFirstDate(tree, "2027-06-15");

    expect(repeatSheet.props).not.toBeNull();
    await TestRenderer.act(async () => {
      (repeatSheet.props?.onSelectByDay as (w: string) => void)("FR");
    });
    expect(latest.draft?.recurrenceRule?.byDay).toBe("FR");

    await pickFirstDate(tree, "2027-06-17");
    expect(latest.draft?.date).toBe("2027-06-17");
    expect(latest.draft?.recurrenceRule?.byDay).toBe("FR");

    await TestRenderer.act(() => tree.unmount());
  });

  test("picking the SAME weekday as the date still counts as a choice and is kept", async () => {
    // Without the explicit-pick record this rule looks exactly like one that is
    // following the date (TU on a Tuesday), and would silently move to Thursday.
    const tree = await mount();
    await tapMode(tree, "Recurring");
    await pickFirstDate(tree, "2027-06-15"); // Tuesday; rule follows to TU
    await TestRenderer.act(async () => {
      (repeatSheet.props?.onSelectByDay as (w: string) => void)("TU");
    });

    await pickFirstDate(tree, "2027-06-17"); // Thursday
    expect(latest.draft?.recurrenceRule?.byDay).toBe("TU");

    await TestRenderer.act(() => tree.unmount());
  });

  test("monthly by weekday seeds the week the first date falls in", async () => {
    const tree = await mount();
    await tapMode(tree, "Recurring");
    await pickFirstDate(tree, "2027-06-15"); // 3rd Tuesday
    await TestRenderer.act(async () => {
      (repeatSheet.props?.onSelectPreset as (p: string) => void)("monthly_dow");
    });
    expect(latest.draft?.recurrenceRule).toEqual(
      expect.objectContaining({ preset: "monthly_dow", byDay: "TU", bySetPos: 3 }),
    );

    await TestRenderer.act(() => tree.unmount());
  });
});
