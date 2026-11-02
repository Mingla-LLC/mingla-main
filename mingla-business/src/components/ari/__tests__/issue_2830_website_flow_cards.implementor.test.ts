/**
 * #2830 P4 — Website setup on the Ari flow engine, Host side (implementor
 * happy path + adversarial).
 *
 * 1. A Website field card is answered with its real form control (phone chip
 *    + number, choices, text) and travels as a BOUND flow answer with the
 *    control's values — never a scripted "Use my answer for …" message in the
 *    owner's name. The owner's bubble shows only their value.
 * 2. Only the run's current form card can be answered; an answered or
 *    replaced form card is locked like every other flow card. (MessageList
 *    wiring is rendered in issue_3355_flow_cards.implementor.test.tsx.)
 * 3. The confirmation card says plainly when Ari saves Mingla's default
 *    design (labelled changeable) and what publishing does.
 */
import type {
  AriFlowArtefact,
  AriFlowState,
} from "../../../services/agentChatService";
import { buildFlowFormAnswer, flowCardStatus } from "../ariFlowCards";
import { websiteSetupProposalCopy } from "../websiteSetupProposalCopy";

const RUN = "11111111-1111-4111-8111-111111111111";
const Q1 = "22222222-2222-4222-8222-222222222222";
const Q2 = "33333333-3333-4333-8333-333333333333";

function formCard(questionId = Q1): AriFlowArtefact {
  return {
    schema_version: 1,
    artefact_id: `q:${RUN}:${questionId}`,
    run_id: RUN,
    step_key: "brand",
    question_id: questionId,
    kind: "question",
    title: "Contact phone",
    text: "What public contact phone number should the Website show?",
    options: [],
    answer_mode: "form",
  };
}

function state(currentQuestion: string): AriFlowState {
  return {
    run_id: RUN,
    flow_key: "website_setup",
    status: "awaiting_owner",
    current_artefact_id: `q:${RUN}:${currentQuestion}`,
    current_step_key: "brand",
    lease_owner_name: null,
    owner_name: "Ada Owner",
    view_only: false,
  };
}

describe("#2830 P4 — form-shaped Website cards", () => {
  it("sends the phone chip and number as bound values; the bubble shows the number", () => {
    const built = buildFlowFormAnswer({
      artefact: formCard(),
      choiceLabels: [],
      fieldValue: "07700 900123",
      fieldCountryIso: "GB",
    });
    expect(built).not.toBeNull();
    expect(built!.answer).toEqual({
      run_id: RUN,
      step_key: "brand",
      question_id: Q1,
      choice_id: "answer",
      display_text: built!.label,
      values: { choices: [], country: "GB", response: "07700 900123" },
    });
    expect(built!.label).toMatch(/^\+44 /);
    expect(built!.label).not.toMatch(/Use my answer for/);
  });

  it("sends chosen option labels for a choice card", () => {
    const built = buildFlowFormAnswer({
      artefact: { ...formCard(), title: "What you offer" },
      choiceLabels: ["Events", "Trips"],
      fieldValue: "",
    });
    expect(built!.answer.values).toEqual({
      choices: ["Events", "Trips"],
      country: null,
      response: "",
    });
    expect(built!.label).toBe("Events, Trips");
  });

  it("refuses an empty answer, a non-form card and a forged country", () => {
    expect(
      buildFlowFormAnswer({
        artefact: formCard(),
        choiceLabels: [],
        fieldValue: "   ",
      }),
    ).toBeNull();
    expect(
      buildFlowFormAnswer({
        artefact: { ...formCard(), answer_mode: undefined },
        choiceLabels: [],
        fieldValue: "x",
      }),
    ).toBeNull();
    const forged = buildFlowFormAnswer({
      artefact: formCard(),
      choiceLabels: [],
      fieldValue: "12345678",
      fieldCountryIso: "gb; drop",
    });
    expect(forged!.answer.values?.country).toBeNull();
  });

  it("only the current form card is live; answered and replaced ones lock", () => {
    const card = formCard(Q1);
    expect(
      flowCardStatus({
        artefact: card,
        flowState: state(Q1),
        answered: new Set(),
        fallbackCurrentId: null,
      }),
    ).toBe("live");
    expect(
      flowCardStatus({
        artefact: card,
        flowState: state(Q2),
        answered: new Set(),
        fallbackCurrentId: null,
      }),
    ).toBe("replaced");
    expect(
      flowCardStatus({
        artefact: card,
        flowState: state(Q1),
        answered: new Set([Q1]),
        fallbackCurrentId: null,
      }),
    ).toBe("answered");
    // A plain info card with no options stays information only.
    expect(
      flowCardStatus({
        artefact: { ...card, answer_mode: undefined },
        flowState: state(Q1),
        answered: new Set(),
        fallbackCurrentId: null,
      }),
    ).toBe("info");
  });
});

describe("#2830 P4 — confirmation card copy", () => {
  it("says plainly that skipping the look uses Mingla's default design, changeable", () => {
    const copy = websiteSetupProposalCopy("save_site_plan_design", {
      design_key: "atelier",
      source_type: "mingla",
      expected_plan_revision: 8,
    });
    expect(copy!.title).toBe("Use Mingla's default design");
    expect(copy!.fields).toEqual([
      { label: "Design", value: "Atelier (Mingla's default)" },
      {
        label: "Change it later",
        value: "You can pick a different design anytime from your Website.",
      },
    ]);
    expect(JSON.stringify(copy)).not.toMatch(/revision|mingla"/);
  });

  it("an owner's own design choice reads as before", () => {
    expect(
      websiteSetupProposalCopy("save_site_plan_design", {
        design_key: "voyage",
        source_type: "owner",
      }),
    ).toEqual({
      verb: "Save to your Website plan",
      title: "Save your design",
      fields: [{ label: "Design", value: "Voyage" }],
    });
  });

  it("publishing says what goes live and never shows digests", () => {
    const copy = websiteSetupProposalCopy("publish_site", {
      site_id: RUN,
      expected_revision: "12",
      source_digest: "a".repeat(64),
      arguments_digest: "b".repeat(64),
    });
    expect(copy!.title).toBe("Publish your Website");
    expect(JSON.stringify(copy)).not.toMatch(/aaaa|bbbb|revision|digest/);
  });
});
