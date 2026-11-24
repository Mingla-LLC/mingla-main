/**
 * #4514 wave 2 — the attach sheet's three choices, the tile's state mapping
 * and the role gates (contract correction C5).
 *
 * FAILS-ON-REVERT: each guard below is pinned by at least one case; deleting
 * the guard (a rank check, the trip refusal, the RSVP wording, the optional
 * "never to answer" rule) turns that case red.
 */

import {
  canAttachGuestQuestions,
  canExportGuestAnswers,
  canReadGuestQuestions,
  canSaveAttach,
  defaultMode,
  formRowState,
  modeRows,
  rowSummary,
  tileAccessibilityLabel,
  tileLine,
  tileState,
  tileTarget,
  type TileData,
} from "../guestQuestionsModel";
import { BRAND_ROLE_RANK } from "../brandRole";

const data = (over: Partial<NonNullable<TileData>> = {}): TileData => ({
  formName: "Open mic sign-up",
  formStatus: "live",
  mode: "required_step",
  published: true,
  answered: 7,
  notAnswered: 5,
  ...over,
});

describe("attach sheet: When guests answer", () => {
  it("has exactly three radio rows with the exact words and lines", () => {
    const rows = modeRows("event");
    expect(rows.map((r) => [r.label, r.line])).toEqual([
      ["On the page, optional", "Guests can answer if they want."],
      // #4541 R1.2 (changed on purpose): honest "required" and "after" lines.
      ["On the page, required", "Guests answer before they finish. Anyone booking from an older app version is asked afterwards."],
      ["After they purchase", "Guests are taken to the form right after they buy."],
    ]);
    expect(rows).toHaveLength(3);
  });

  it("says After they RSVP on RSVP pages only", () => {
    expect(modeRows("rsvp")[2]?.label).toBe("After they RSVP");
    for (const kind of ["event", "experience", "trip"] as const) {
      expect(modeRows(kind)[2]?.label).toBe("After they purchase");
    }
  });

  it("defaults to On the page, required (a trip can only ask after purchase)", () => {
    expect(defaultMode("event")).toBe("required_step");
    expect(defaultMode("rsvp")).toBe("required_step");
    expect(defaultMode("experience")).toBe("required_step");
    expect(defaultMode("trip")).toBe("after_purchase");
  });

  it("never mentions journeys or steps", () => {
    for (const kind of ["event", "rsvp", "trip"] as const) {
      for (const row of modeRows(kind)) {
        // the retired host-visible names, and no journey or step talk
        expect(row.label).not.toMatch(/before they finish|part of signing up|after they claim|required before paying/i);
        expect(`${row.label} ${row.line}`).not.toMatch(/journey|step|checkout/i);
      }
    }
  });

  it("turns off the two choices a trip is refused, with a reason", () => {
    const trip = modeRows("trip");
    expect(trip.map((r) => r.disabled)).toEqual([true, true, false]);
    expect(trip[0]?.disabledReason).toBe("Trips keep their own questions step for now.");
    expect(modeRows("event").every((r) => !r.disabled)).toBe(true);
  });

  it("keeps Save off until the sheet is valid and something changed", () => {
    expect(canSaveAttach("event", { formId: null, mode: "required_step" }, null, false)).toBe(false);
    expect(canSaveAttach("event", { formId: "f1", mode: "required_step" }, null, false)).toBe(true);
    expect(canSaveAttach("event", { formId: "f1", mode: "required_step" }, { formId: "f1", mode: "required_step" }, false)).toBe(false);
    expect(canSaveAttach("event", { formId: "f1", mode: "optional_on_page" }, { formId: "f1", mode: "required_step" }, false)).toBe(true);
    expect(canSaveAttach("event", { formId: "f1", mode: "required_step" }, null, true)).toBe(false);
    expect(canSaveAttach("trip", { formId: "f1", mode: "required_step" }, null, false)).toBe(false);
    expect(canSaveAttach("trip", { formId: "f1", mode: "after_purchase" }, null, false)).toBe(true);
  });

  it("offers live forms, and shows draft and closed forms off (except the one already on the page)", () => {
    expect(formRowState({ id: "a", status: "live" }, null)).toEqual({ selectable: true, hint: null });
    expect(formRowState({ id: "a", status: "draft" }, null)).toEqual({ selectable: false, hint: "draft" });
    expect(formRowState({ id: "a", status: "closed" }, null)).toEqual({ selectable: false, hint: "closed" });
    expect(formRowState({ id: "a", status: "draft" }, "a")).toEqual({ selectable: true, hint: null });
    expect(formRowState({ id: "a", status: "archived" }, null).selectable).toBe(false);
  });
});

describe("Guest questions tile: states, lines and taps", () => {
  it("maps every state to its line", () => {
    const line = (input: Parameters<typeof tileState>[0]): string => tileLine(tileState(input));
    expect(line({ isError: false, data: undefined })).toBe("Loading…");
    expect(line({ isError: true, data: undefined })).toBe("Unable to load");
    expect(line({ isError: false, data: null })).toBe("Not set up");
    expect(line({ isError: false, data: data({ published: false, formStatus: "draft" }) })).toBe("Not published");
    expect(line({ isError: false, data: data({ formStatus: "closed" }) })).toBe("Closed");
    expect(line({ isError: false, data: data() })).toBe("5 to answer");
    expect(line({ isError: false, data: data({ notAnswered: 0 }) })).toBe("7 answered");
  });

  it("never asks anyone to answer on an optional form", () => {
    const state = tileState({ isError: false, data: data({ mode: "optional_on_page", notAnswered: 9 }) });
    expect(state).toEqual({ kind: "live", answered: 7 });
  });

  it("opens the right place on a tap", () => {
    const state = (d: TileData | undefined, isError = false) => tileState({ isError, data: d });
    expect(tileTarget(state(null))).toEqual({ to: "sheet" });
    expect(tileTarget(state(data({ published: false, formStatus: "draft" })))).toEqual({ to: "builder" });
    expect(tileTarget(state(data()))).toEqual({ to: "responses", tab: "not_answered" });
    expect(tileTarget(state(data({ notAnswered: 0 })))).toEqual({ to: "responses", tab: "summary" });
    expect(tileTarget(state(data({ formStatus: "closed" })))).toEqual({ to: "responses", tab: "summary" });
    expect(tileTarget(state(undefined))).toEqual({ to: "retry" });
    expect(tileTarget(state(undefined, true))).toEqual({ to: "retry" });
  });

  it("carries the full count in the accessibility label", () => {
    const d = data();
    const label = tileAccessibilityLabel(tileState({ isError: false, data: d }), d, "On the page, required");
    expect(label).toBe("Guest questions. Open mic sign-up, on the page, required. 7 of 12 answered.");
    expect(tileAccessibilityLabel(tileState({ isError: false, data: null }), null, null)).toBe(
      "Guest questions. No form on this page yet.",
    );
  });
});

describe("edit-screen row summary", () => {
  it("reads what the page asks now", () => {
    expect(rowSummary({ isError: false, data: undefined }, "event")).toBe("Loading…");
    expect(rowSummary({ isError: true, data: undefined }, "event")).toBe("Unable to load");
    expect(rowSummary({ isError: false, data: null }, "event")).toBe("Not set up");
    expect(rowSummary({ isError: false, data: { formName: "Q", formStatus: "live", published: true, mode: "after_purchase" } }, "rsvp")).toBe(
      "Q · After they RSVP",
    );
    expect(rowSummary({ isError: false, data: { formName: "Q", formStatus: "draft", published: false, mode: "required_step" } }, "event")).toBe(
      "Q · Draft, publish it to start asking",
    );
  });
});

describe("role gates (correction C5)", () => {
  it("lets marketing manager and up read; scanners never", () => {
    expect(canReadGuestQuestions(BRAND_ROLE_RANK.scanner)).toBe(false);
    expect(canReadGuestQuestions(BRAND_ROLE_RANK.venue_staff)).toBe(false);
    expect(canReadGuestQuestions(0)).toBe(false);
    expect(canReadGuestQuestions(BRAND_ROLE_RANK.marketing_manager)).toBe(true);
    expect(canReadGuestQuestions(BRAND_ROLE_RANK.finance_manager)).toBe(true);
  });

  it("keeps attach and export at event manager and up", () => {
    for (const gate of [canAttachGuestQuestions, canExportGuestAnswers]) {
      expect(gate(BRAND_ROLE_RANK.marketing_manager)).toBe(false);
      expect(gate(BRAND_ROLE_RANK.finance_manager)).toBe(false);
      expect(gate(BRAND_ROLE_RANK.event_manager)).toBe(true);
      expect(gate(BRAND_ROLE_RANK.brand_owner)).toBe(true);
    }
  });
});
