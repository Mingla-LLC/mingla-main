/**
 * issue #1027 — Thread B (business web date/time) · IMPLEMENTOR happy-path
 * RENDER proof. Mounts the REAL CreatorStep2When on the WEB target and drives
 * Seth's two runtime-confirmed symptoms to green:
 *
 *   Seth (desktop Chrome): "The date picker comes up, I can select a date but
 *   clicking out does not close it, there's no way to close the date picker, and
 *   the times don't work — clicking the times does nothing."
 *
 * ROOT CAUSE: the When step drove date/time on web through a hidden 1×1
 * `opacity:0; pointer-events:none` <input> triggered by `showPicker()`/`.click()`
 * from a Pressable — the calendar opened detached + un-dismissable, and the time
 * rows never wired a real control (dead taps).
 *
 * FIX: each web row renders a REAL, visible, hit-testable native <input> via the
 * shared `WebDateTimeInput`. This suite proves, at render time:
 *   T1a — the Date row is a real `<input type="date">` (NOT pointer-events:none /
 *         opacity:0 — i.e. a normal in-flow input the browser dismisses on click-
 *         out), and its `change` commits `draft.date` + a recomputed `endsAtUtc`.
 *   T1b — the Doors + Ends rows are real `<input type="time">` whose `change`
 *         reaches `commitPickerValue` and commits `doorsOpen` / `endsAt`
 *         (the "clicking the times does nothing" symptom).
 *
 * FAILS-ON-REVERT (proven by true line deletion in the implementation report):
 *   restore the hidden-input + showPicker bridge → the Date/Doors/Ends rows are
 *   no longer visible `<input>`s wired to commit → T1a/T1b go RED.
 *
 * Bare react-test-renderer harness under the stock mingla-business/jest.config.cjs
 * (react-native → the manual mock whose Platform.OS is "web"); react-test-renderer
 * is installed --no-save by mingla-business-jest-suite.yml + issue-1027-web-
 * datetime-tests.yml. I-PROPOSED-1027-WEB-NATIVE-DATE-INPUT.
 */

import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// ── Boundary mocks: keep WebDateTimeInput + the date-math utils REAL; stub the
//    heavy children so only the When body's own rows render. Sheets render null,
//    so the AddDate/override/termination inner inputs never enter the tree — the
//    only <input>s left are the three MAIN rows (Date / Doors / Ends). ─────────
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
jest.mock("../../ui/Button", () => ({
  __esModule: true,
  Button: (): null => null,
}));
jest.mock("../../ui/Input", () => ({ __esModule: true, Input: (): null => null }));
jest.mock("../../ui/ConfirmDialog", () => ({
  __esModule: true,
  ConfirmDialog: (): null => null,
}));
jest.mock("../CreatorStep2WhenRepeatPickerSheet", () => ({
  __esModule: true,
  CreatorStep2WhenRepeatPickerSheet: (): null => null,
}));
jest.mock("../MultiDateOverrideSheet", () => ({
  __esModule: true,
  MultiDateOverrideSheet: (): null => null,
}));

import { CreatorStep2When } from "../CreatorStep2When";
import {
  buildDraftEvent,
  type DraftEvent,
} from "../../../store/draftEventStore";

type HostNode = { type: unknown; props: Record<string, unknown> };
type Tree = {
  root: { findAll: (pred: (n: HostNode) => boolean) => HostNode[] };
  unmount: () => void;
};

// react-test-renderer ships no bundled types; CJS-require it the way the #976
// suites do (proven under this stock config).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => Tree;
  act: (cb: () => Promise<void> | void) => Promise<void>;
};

type Patch = Partial<DraftEvent>;

const singleDraft = (): DraftEvent => ({
  ...buildDraftEvent("brand_1027"),
  whenMode: "single",
  date: null,
  doorsOpen: null,
  endsAt: null,
  endsAtUtc: null,
  timezone: "Europe/London",
});

describe("issue #1027 Thread B — When step renders visible native web date/time inputs that commit", () => {
  let tree: Tree | null = null;
  let updates: Patch[] = [];

  const mount = async (): Promise<void> => {
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        React.createElement(CreatorStep2When, {
          draft: singleDraft(),
          updateDraft: (patch: Patch) => {
            updates.push(patch);
          },
          errors: [],
          showErrors: false,
          onShowToast: () => undefined,
          scrollToBottom: () => undefined,
        }),
      );
    });
  };

  const inputsOfType = (t: string): HostNode[] =>
    (tree as Tree).root
      .findAll((n) => n.type === "input")
      .filter((n) => n.props.type === t);

  beforeEach(() => {
    updates = [];
  });

  afterEach(() => {
    if (tree !== null) {
      TestRenderer.act(() => {
        tree?.unmount();
      });
      tree = null;
    }
  });

  test("T1a — Date row is a real, visible <input type='date'> (dismissable) whose change commits draft.date + endsAtUtc", async () => {
    await mount();
    const dateInputs = inputsOfType("date");
    expect(dateInputs).toHaveLength(1);
    const dateInput = dateInputs[0];

    // Hit-testable + dismissable: an in-flow input, NOT the old hidden bridge.
    const style = dateInput.props.style as Record<string, unknown>;
    expect(style.pointerEvents).toBeUndefined();
    expect(style.opacity).not.toBe(0);
    expect(dateInput.props["data-testid"]).toBe("creator-when-date-web");

    // Selecting a date commits the value (Seth's "date does not stick / can't
    // close" symptom — a real input commits on change and closes on click-out).
    await TestRenderer.act(async () => {
      (dateInput.props.onChange as (e: { target: { value: string } }) => void)({
        target: { value: "2026-08-01" },
      });
    });
    const datePatch = updates.find((p) => p.date !== undefined);
    expect(datePatch?.date).toBe("2026-08-01");
    // ORCH-0877 smart-infer commit contract preserved — endsAtUtc recomputed.
    expect(datePatch).toHaveProperty("endsAtUtc");
  });

  test("T1b — Doors + Ends are real <input type='time'> whose change commits (the dead-time-rows symptom)", async () => {
    await mount();
    const timeInputs = inputsOfType("time");
    expect(timeInputs.length).toBeGreaterThanOrEqual(2);

    const doors = timeInputs.find(
      (n) => n.props["data-testid"] === "creator-when-doors-web",
    );
    const ends = timeInputs.find(
      (n) => n.props["data-testid"] === "creator-when-ends-web",
    );
    expect(doors).toBeDefined();
    expect(ends).toBeDefined();
    // Neither is a hidden/dead control.
    expect((doors?.props.style as Record<string, unknown>).pointerEvents).toBeUndefined();
    expect((ends?.props.style as Record<string, unknown>).pointerEvents).toBeUndefined();

    await TestRenderer.act(async () => {
      (doors?.props.onChange as (e: { target: { value: string } }) => void)({
        target: { value: "20:30" },
      });
    });
    expect(updates.find((p) => p.doorsOpen !== undefined)?.doorsOpen).toBe(
      "20:30",
    );

    await TestRenderer.act(async () => {
      (ends?.props.onChange as (e: { target: { value: string } }) => void)({
        target: { value: "23:45" },
      });
    });
    expect(updates.find((p) => p.endsAt !== undefined)?.endsAt).toBe("23:45");
  });
});
