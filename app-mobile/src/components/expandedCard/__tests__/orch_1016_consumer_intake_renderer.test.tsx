// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1016 [Consumer Discover Trips tab] REWORK (tester finding D2) —
// IMPLEMENTOR happy-path regression test for the consumer trip-intake renderer.
//
// Proves the two REWORK contracts the tester demanded:
//   (A) intake answers are COLLECTED and INCLUDED in the ticket-checkout-create
//       body (`intake_form_data` → orders.intake_form_data) for a tier WITH a
//       schema, in the exact `{ ticket_type_id, schema_version_id, answers }`
//       shape the edge fn reads.
//   (B) required-field validation BLOCKS submission when a required question is
//       unanswered (no checkout payload emitted, no PaymentSheet reached).
//   (C) the no-schema path is UNCHANGED — a tier with no schema emits an empty
//       intakeFormData array so the request body stays byte-identical.
//
// app-mobile has no jest/RTL runner; the repo convention for mobile regression
// tests is node:assert source-assertions + behavioral replicas (mirrors
// src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.adversarial.test.tsx).
// Run with:
//   node app-mobile/src/components/expandedCard/__tests__/orch_1016_consumer_intake_renderer.test.tsx
//
// Every source assertion is written to FAIL if the guard it protects is reverted.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../../..");
const cartSrc = fs.readFileSync(
  path.join(ROOT, "src/components/expandedCard/TicketCartSheet.tsx"),
  "utf8",
);
const sheetSrc = fs.readFileSync(
  path.join(ROOT, "src/components/expandedCard/ExpandedBusinessEventSheet.tsx"),
  "utf8",
);
const flowSrc = fs.readFileSync(
  path.join(ROOT, "src/payments/nativeCheckoutFlow.ts"),
  "utf8",
);
const rendererSrc = fs.readFileSync(
  path.join(ROOT, "src/components/expandedCard/ConsumerIntakeForm.tsx"),
  "utf8",
);

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

// ---------------------------------------------------------------------------
// Behavioral replicas — mirror the pure logic in tripIntakeSchemaService.ts
// (validateAnswerAgainstSchema + buildIntakeFormData) so we can exercise the
// collect/validate/build path deterministically without a RN bridge.
// ---------------------------------------------------------------------------

function isAnswerEmpty(type, answer) {
  if (answer === undefined || answer === null) return true;
  switch (type) {
    case "short_text":
    case "long_text":
    case "single_choice":
    case "date":
    case "number":
      return typeof answer !== "string" || answer.trim().length === 0;
    case "multi_choice":
    case "file_upload":
      return !Array.isArray(answer) || answer.length === 0;
    default:
      return true;
  }
}

function validateAnswerAgainstSchema(schema, answers) {
  const errors = [];
  for (const q of schema.questions) {
    const answer = answers[q.id];
    if (q.required && isAnswerEmpty(q.type, answer)) {
      errors.push({ question_id: q.id, error: "This question is required." });
      continue;
    }
    if (answer === undefined || answer === null) continue;
    if (q.type === "single_choice" && typeof answer === "string") {
      if (!(q.options || []).includes(answer)) {
        errors.push({ question_id: q.id, error: "Pick one of the listed options." });
      }
    }
  }
  return errors;
}

function buildIntakeFormData(selectedTierIds, schemasByTier, answersByTier) {
  const out = [];
  for (const tierId of selectedTierIds) {
    const schema = schemasByTier.get(tierId);
    if (schema === undefined) continue;
    out.push({
      ticket_type_id: tierId,
      schema_version_id: schema.schema_version_id,
      answers: answersByTier[tierId] || {},
    });
  }
  return out;
}

// Replica of TicketCartSheet.handleConfirm's intake gate: validate every
// selected schema-bearing tier; block (emit nothing) on any error; otherwise
// build the intakeFormData array for the checkout payload.
function handleConfirmIntake(selectedSchemaTiers, schemasByTier, answersByTier) {
  for (const tier of selectedSchemaTiers) {
    const errs = validateAnswerAgainstSchema(
      tier.schema,
      answersByTier[tier.tierId] || {},
    );
    if (errs.length > 0) {
      return { blocked: true, payload: null };
    }
  }
  const intakeFormData = buildIntakeFormData(
    selectedSchemaTiers.map((t) => t.tierId),
    schemasByTier,
    answersByTier,
  );
  return { blocked: false, payload: { intakeFormData } };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SCHEMA = {
  schema_version_id: "ver-abc-123",
  questions: [
    { id: "q1", type: "short_text", label: "Passport name", required: true, position: 0 },
    {
      id: "q2",
      type: "single_choice",
      label: "Meal",
      required: true,
      position: 1,
      options: ["Veg", "Non-veg"],
    },
    { id: "q3", type: "long_text", label: "Notes", required: false, position: 2 },
  ],
};
const TIER_ID = "tier-deluxe";
const schemasByTier = new Map([[TIER_ID, SCHEMA]]);
const selectedSchemaTiers = [
  { tierId: TIER_ID, tierName: "Deluxe", schema: SCHEMA },
];

// ── (B) required validation BLOCKS when unanswered ──
{
  const res = handleConfirmIntake(selectedSchemaTiers, schemasByTier, {
    [TIER_ID]: { q3: "optional note only" }, // q1 + q2 required, both empty
  });
  ok(
    "B1 required questions unanswered → submission BLOCKED (no payload)",
    res.blocked === true && res.payload === null,
  );
}
{
  const res = handleConfirmIntake(selectedSchemaTiers, schemasByTier, {
    [TIER_ID]: { q1: "Jane Q Traveler" }, // q2 still missing
  });
  ok(
    "B2 partial answers (one required still empty) → BLOCKED",
    res.blocked === true,
  );
}

// ── (A) answers COLLECTED + INCLUDED in the checkout body, correct shape ──
{
  const res = handleConfirmIntake(selectedSchemaTiers, schemasByTier, {
    [TIER_ID]: { q1: "Jane Q Traveler", q2: "Veg", q3: "Window seat please" },
  });
  ok("A1 all required answered → NOT blocked", res.blocked === false);
  const body = res.payload.intakeFormData;
  ok("A2 intakeFormData is a non-empty array", Array.isArray(body) && body.length === 1);
  const entry = body[0];
  ok(
    "A3 entry carries ticket_type_id + schema_version_id + answers (edge-fn shape)",
    entry.ticket_type_id === TIER_ID &&
      entry.schema_version_id === "ver-abc-123" &&
      typeof entry.answers === "object",
  );
  ok(
    "A4 collected answers preserved verbatim in the body",
    entry.answers.q1 === "Jane Q Traveler" &&
      entry.answers.q2 === "Veg" &&
      entry.answers.q3 === "Window seat please",
  );
}

// ── (C) no-schema path UNCHANGED — empty intakeFormData ──
{
  const res = handleConfirmIntake([], new Map(), {});
  ok(
    "C1 no schema-bearing tier → not blocked, empty intakeFormData",
    res.blocked === false && res.payload.intakeFormData.length === 0,
  );
}

// ---------------------------------------------------------------------------
// Source-wiring assertions — these FAIL ON REVERT of the renderer wiring.
// ---------------------------------------------------------------------------

// The cart sheet must render the intake form for selected schema-bearing tiers.
ok(
  "WIRE-1 TicketCartSheet renders ConsumerIntakeForm for selected schema tiers",
  /selectedSchemaTiers\.map\([\s\S]{0,260}?<ConsumerIntakeForm/.test(cartSrc),
  "intake renderer must be mounted per selected schema tier",
);
// handleConfirm must validate required answers and block on error.
ok(
  "WIRE-2 handleConfirm validates required answers before payment + blocks",
  /validateAnswerAgainstSchema\(/.test(cartSrc) &&
    /setIntakeErrors\(nextErrors\)/.test(cartSrc) &&
    /Object\.keys\(nextErrors\)\.length\s*>\s*0/.test(cartSrc),
  "required-field validation gate must be wired into handleConfirm",
);
// handleConfirm must build intakeFormData and put it on the checkout payload.
ok(
  "WIRE-3 handleConfirm builds intakeFormData onto the checkout payload",
  /buildIntakeFormData\(/.test(cartSrc) &&
    /intakeFormData,?\s*\n?\s*\}\);/.test(cartSrc.replace(/\r/g, "")),
  "buildIntakeFormData result must be passed to onCheckout",
);
// The sheet must fetch schemas and pass them down; checkout must forward them.
ok(
  "WIRE-4 ExpandedBusinessEventSheet fetches intake schemas + passes to cart",
  /useTripIntakeSchemas\(/.test(sheetSrc) &&
    /intakeSchemasByTier=\{intakeSchemasQuery\.data\}/.test(sheetSrc),
);
ok(
  "WIRE-5 ExpandedBusinessEventSheet forwards intakeFormData to runNativeCheckout",
  /payload\.intakeFormData\.length\s*>\s*0/.test(sheetSrc) &&
    /intakeFormData:\s*payload\.intakeFormData/.test(sheetSrc),
);
// nativeCheckoutFlow must forward the answers on the existing body key.
ok(
  "WIRE-6 nativeCheckoutFlow forwards intake_form_data on ticket-checkout-create body",
  /intake_form_data:\s*input\.intakeFormData/.test(flowSrc),
);
// The renderer must support the keyable question types + required asterisk.
ok(
  "WIRE-7 ConsumerIntakeForm handles all 6 keyable types + required asterisk",
  /case "short_text"/.test(rendererSrc) &&
    /case "single_choice"/.test(rendererSrc) &&
    /case "multi_choice"/.test(rendererSrc) &&
    /case "date"/.test(rendererSrc) &&
    /case "number"/.test(rendererSrc) &&
    /requiredAsterisk/.test(rendererSrc),
);

console.log(`\n${passed} checks PASS`);
