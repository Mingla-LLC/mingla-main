import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  isRsvpBrandFormRefusal,
  parseRsvpBrandForm,
  rsvpBrandFormRefusal,
} from "../brandFormRsvp.ts";

const FORM = "11111111-1111-4111-8111-111111111111";
const VERSION = "22222222-2222-4222-8222-222222222222";

Deno.test("#4541 RSVP form marker is explicit and old clients stay incapable", () => {
  assertEquals(parseRsvpBrandForm({}), { capable: false, form: null });
  assertEquals(parseRsvpBrandForm({ brandFormStep: 1 }), {
    capable: true,
    form: null,
  });
  const refused = parseRsvpBrandForm({ brandFormStep: 2 });
  assert(isRsvpBrandFormRefusal(refused));
  assertEquals(refused.status, 400);
});

Deno.test("#4541 RSVP form payload is closed-shape and keeps answers", () => {
  const parsed = parseRsvpBrandForm({
    brandFormStep: 1,
    brandForm: {
      formId: FORM.toUpperCase(),
      versionId: VERSION,
      answers: { q: "yes" },
    },
  });
  assert(!isRsvpBrandFormRefusal(parsed));
  assertEquals(parsed, {
    capable: true,
    form: { formId: FORM, versionId: VERSION, answers: { q: "yes" } },
  });
  for (const brandForm of [
    { formId: FORM, versionId: VERSION, answers: {}, extra: true },
    { formId: FORM, versionId: VERSION, answers: [] },
  ]) {
    const bad = parseRsvpBrandForm({ brandFormStep: 1, brandForm });
    assert(isRsvpBrandFormRefusal(bad));
    assertEquals(bad.status, 400);
  }
});

Deno.test("#4541 unstorable answers are dropped so the database decides", () => {
  for (
    const answers of [
      { q: "bad\u0000text" },
      { q: ["ok", "bad\u0000text"] },
      { "bad\u0000key": "yes" },
    ]
  ) {
    const parsed = parseRsvpBrandForm({
      brandFormStep: 1,
      brandForm: { formId: FORM, versionId: VERSION, answers },
    });
    assert(!isRsvpBrandFormRefusal(parsed));
    assertEquals(parsed, { capable: true, form: null });
  }
  // A required form then refuses with the required-answers error.
  assertEquals(
    rsvpBrandFormRefusal({
      message: "form_answers_required",
      details: JSON.stringify({ formId: FORM, versionId: VERSION }),
    }),
    {
      status: 422,
      body: { error: "form_answers_required", formId: FORM, versionId: VERSION },
    },
  );
});

Deno.test("#4541 RSVP form SQL refusals retain actionable status", () => {
  assertEquals(
    rsvpBrandFormRefusal({
      message: "form_changed",
      details: JSON.stringify({ formId: FORM, versionId: VERSION }),
    }),
    {
      status: 409,
      body: { error: "form_changed", formId: FORM, versionId: VERSION },
    },
  );
  assertEquals(
    rsvpBrandFormRefusal({
      message: "form_answers_invalid",
      details: JSON.stringify([{ questionId: "q", code: "required" }]),
    }),
    {
      status: 422,
      body: {
        error: "form_answers_invalid",
        errors: [{ questionId: "q", code: "required" }],
      },
    },
  );
});

Deno.test("#4541 signed-out guest gate remains before atomic RSVP form RPC", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  const refusal = source.indexOf("signedOutGuestRefusal({");
  const attemptGate = source.indexOf("signedOutGuestGate({");
  const submit = source.indexOf('admin.rpc("submit_event_rsvp_with_form"');
  assert(refusal >= 0 && attemptGate > refusal && submit > attemptGate);
  assert(
    source.slice(submit, submit + 1_500).includes(
      '.setHeader("x-mingla-rsvp-client", inviterClient)',
    ),
  );
  assert(!source.includes('admin.rpc("submit_event_rsvp_with_delivery"'));
});
