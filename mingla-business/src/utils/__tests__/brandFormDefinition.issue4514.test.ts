/**
 * #4514 wave 2 — the builder's new rules: the door cap, "Show only if", option
 * ids that stay with their label, and the trip builder staying as it was.
 *
 * FAILS-ON-REVERT: removing the cap check, the earlier-question rule, the
 * move block or the features-off default turns a case red.
 */


import type { IntakeQuestion } from "../../services/intakeSchemaService";
import {
  addOptionTo,
  conditionSources,
  definitionToSchema,
  doorQuestionCount,
  doorToggleState,
  dropBlankOptions,
  moveOptionIn,
  moveQuestion,
  publishBlockers,
  removeOptionFrom,
  sanitizeShowIf,
  schemaToDefinition,
  BRAND_FORM_SCHEMA,
} from "../brandFormDefinition";
import { TRIP_INTAKE_FEATURES } from "../../components/trip/intakeBuilderFeatures";
import { BRAND_FORM_FEATURES } from "../../components/forms/brandFormBuilderKit";

const q = (id: string, over: Partial<IntakeQuestion> = {}): IntakeQuestion => ({
  id,
  type: "short_text",
  label: `Question ${id}`,
  required: false,
  position: 0,
  ...over,
});

const yesNo = (id: string): IntakeQuestion =>
  q(id, { type: "single_choice", options: ["Yes", "No"], option_ids: [`${id}-yes`, `${id}-no`] });

describe("Show at the door", () => {
  it("allows at most 3 door questions on a form", () => {
    const others = [q("a", { show_at_door: true }), q("b", { show_at_door: true }), q("c", { show_at_door: true })];
    expect(doorQuestionCount(others)).toBe(3);
    const fourth = doorToggleState(q("d"), 3, "Short text");
    expect(fourth.canTurnOn).toBe(false);
    expect(fourth.line).toBe("3 questions is the most the door can show. Turn one off first.");
    expect(doorToggleState(q("d"), 2, "Short text").canTurnOn).toBe(true);
  });

  it("lets a question that is already on stay on at the cap, and counts it", () => {
    const state = doorToggleState(q("a", { show_at_door: true }), 2, "Short text");
    expect(state.canTurnOn).toBe(true);
    expect(state.countLine).toBe("3 of 3 door questions");
    expect(state.line).toBe("Door staff see this answer when they scan.");
  });

  it("turns the switch off for long text and file questions with the exact line", () => {
    const long = doorToggleState(q("l", { type: "long_text" }), 0, "Long text");
    expect(long.canTurnOn).toBe(false);
    expect(long.line).toBe("Long text answers are too long to show at the door.");
    expect(doorToggleState(q("f", { type: "file_upload" }), 0, "File").canTurnOn).toBe(false);
    expect(doorToggleState(q("s"), 0, "Short text").line).toBe("Off: door staff never see this answer.");
  });
});

describe("Show only if", () => {
  it("offers only EARLIER single-choice questions, one level deep", () => {
    const list = [
      yesNo("a"),
      q("b", { type: "multi_choice", options: ["x", "y"], option_ids: ["bx", "by"] }),
      yesNo("c"),
      q("d", { show_if: { question_id: "a", option_id: "a-yes" } }),
    ];
    // for question index 3 ("d"): a and c qualify, the multi choice does not
    expect(conditionSources(list, 3).map((s) => s.id)).toEqual(["a", "c"]);
    // for the first question there is no earlier question
    expect(conditionSources(list, 0)).toEqual([]);
    // a question that itself depends on another is never a source
    const deep = [yesNo("a"), { ...yesNo("b"), show_if: { question_id: "a", option_id: "a-yes" } }, q("c")];
    expect(conditionSources(deep, 2).map((s) => s.id)).toEqual(["a"]);
    // a new question (null index) may use any single-choice question on the form
    expect(conditionSources([yesNo("a"), yesNo("b")], null).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("blocks moving a dependent question above its source, with a message", () => {
    const list = [yesNo("a"), q("b", { show_if: { question_id: "a", option_id: "a-yes" } })];
    const blocked = moveQuestion(list, 1, 0);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.message).toMatch(/Question 1 only shows after question 2/);
    // and the source cannot sink below its dependent either
    expect(moveQuestion(list, 0, 1).ok).toBe(false);
    const free = moveQuestion([yesNo("a"), q("b"), q("c")], 2, 0);
    expect(free.ok).toBe(true);
    if (free.ok) expect(free.questions.map((x) => [x.id, x.position])).toEqual([["c", 0], ["a", 1], ["b", 2]]);
  });

  it("clears a condition whose source or option is gone, and says which question", () => {
    const list = [yesNo("a"), q("b", { show_if: { question_id: "a", option_id: "a-yes" } })];
    expect(sanitizeShowIf(list).cleared).toEqual([]);
    const lostOption = [{ ...yesNo("a"), options: ["No"], option_ids: ["a-no"] }, list[1] as IntakeQuestion];
    expect(sanitizeShowIf(lostOption).cleared).toEqual([2]);
    const lostSource = [list[1] as IntakeQuestion];
    const result = sanitizeShowIf(lostSource);
    expect(result.cleared).toEqual([1]);
    expect(result.questions[0]?.show_if).toBeUndefined();
  });
});

describe("options keep their id", () => {
  it("keeps option_ids parallel through add, remove, move and blank-dropping", () => {
    const base = yesNo("a");
    const added = addOptionTo(base, 10);
    expect(added.options).toEqual(["Yes", "No", ""]);
    expect(added.option_ids?.length).toBe(3);
    expect(added.option_ids?.slice(0, 2)).toEqual(["a-yes", "a-no"]);
    const moved = moveOptionIn(base, 0, 1);
    expect(moved.options).toEqual(["No", "Yes"]);
    expect(moved.option_ids).toEqual(["a-no", "a-yes"]);
    const removed = removeOptionFrom(added, 2, 2);
    expect(removed.option_ids).toEqual(["a-yes", "a-no"]);
    expect(removeOptionFrom(base, 0, 2)).toBe(base);
    expect(dropBlankOptions(added).option_ids).toEqual(["a-yes", "a-no"]);
  });

  it("works unchanged for trip questions that have no ids", () => {
    const trip = q("t", { type: "single_choice", options: ["A", "B"] });
    expect(addOptionTo(trip, 10).option_ids).toBeUndefined();
    expect(moveOptionIn(trip, 0, 1).options).toEqual(["B", "A"]);
    expect(removeOptionFrom(addOptionTo(trip, 10), 2, 2).options).toEqual(["A", "B"]);
  });
});

describe("definition round trip", () => {
  it("keeps ids, help, conditions and door marks, and never puts door on long text", () => {
    const schema = {
      schema_version_id: "s",
      questions: [
        yesNo("a"),
        q("b", { helper: "A hint", show_if: { question_id: "a", option_id: "a-yes" }, show_at_door: true, door_label: "Performing" }),
        q("c", { type: "long_text", show_at_door: true }),
      ],
    };
    const def = schemaToDefinition(schema, { title: "Open mic" });
    expect(def.schema).toBe(BRAND_FORM_SCHEMA);
    expect(def.questions[0]?.options).toEqual([{ id: "a-yes", label: "Yes" }, { id: "a-no", label: "No" }]);
    expect(def.questions[1]).toMatchObject({ help: "A hint", show_at_door: true, door_label: "Performing", show_if: { question_id: "a", option_id: "a-yes" } });
    expect(def.questions[2]?.show_at_door).toBeUndefined();
    const back = definitionToSchema(def);
    expect(back.questions[1]?.helper).toBe("A hint");
    expect(back.questions[0]?.option_ids).toEqual(["a-yes", "a-no"]);
    // the same builder state always gives the same definition (stable dirty check)
    expect(JSON.stringify(schemaToDefinition(schema, { title: "Open mic" }))).toBe(JSON.stringify(def));
  });

  it("names what blocks a publish in plain words", () => {
    expect(publishBlockers([])).toEqual(["Add at least one question before publishing."]);
    expect(publishBlockers([q("a", { label: "  " })])).toEqual(["Question 1 needs a question."]);
    expect(publishBlockers([q("a", { type: "single_choice", options: ["Only one", ""] })])).toEqual([
      "Question 1 needs at least 2 options.",
    ]);
    expect(publishBlockers([q("a")])).toEqual([]);
  });
});

describe("the trip builder keeps today's behaviour", () => {
  it("has every brand form extra off by default", () => {
    expect(TRIP_INTAKE_FEATURES).toMatchObject({
      helpText: false,
      conditions: false,
      door: false,
      fileUploadLater: false,
      audience: "travelers",
      showUpfrontBanner: true,
      variant: "trip",
      optionMax: 100,
    });
    expect(BRAND_FORM_FEATURES).toMatchObject({
      helpText: true,
      conditions: true,
      door: true,
      fileUploadLater: true,
      audience: "guests",
      showUpfrontBanner: false,
      variant: "brand_form",
      optionMax: 80,
    });
    expect(BRAND_FORM_FEATURES.kit).toBeDefined();
    expect(TRIP_INTAKE_FEATURES.kit).toBeUndefined();
  });

  // The trip builder's eager bundle must never pull the brand form modules in
  // (`import type` is erased and costs nothing). Proved by loading each file in an
  // isolated registry and recording which brand form modules it asked for.
  it("loading the trip builder files never loads the brand form modules (eager bundle)", () => {
    const guarded = [
      "../brandFormDefinition",
      "../../components/forms/brandFormsCopy",
      "../../components/trip/IntakeBrandFormFields",
      "../../components/trip/IntakeQuestionBrandTags",
      "../../components/forms/brandFormBuilderKit",
    ];
    const loaded: string[] = [];
    jest.isolateModules(() => {
      for (const mod of guarded) {
        jest.doMock(mod, () => {
          loaded.push(mod);
          return jest.requireActual(mod);
        });
      }
      require("../../components/trip/intakeBuilderFeatures");
    });
    expect(loaded).toEqual([]);
  });
});
