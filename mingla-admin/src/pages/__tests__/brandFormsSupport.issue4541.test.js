// #4541 R7.1 (SC-43) — the Admin forms support view: counts, statuses, failures
// and switches only; never answer content or guest contacts; mounted on a
// brand's detail in the Brands console; the daily Unknown-reply limit is 0..5000.
//
// FAILS-ON-REVERT: letting an answer or contact key through the model, dropping
// a switch row, the 0..5000 check, the refusal wording, or the console mount
// turns a case red.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  brandFormsSupportView,
  parseOpenReplyLimit,
  sendLine,
  supportErrorMessage,
} from "../../lib/brandFormsSupport.js";

const reply = {
  forms: [{
    id: "f1", name: "Guest details", status: "live", liveVersion: 2, doorFullAnswers: true,
    doorFullAnswersInvited: false, openReplyLimitPerDay: 500, blastKnown: 4, blastUnknown: 7, hidden: 1,
    // Never sent by the server; the model must drop it if it ever were.
    answers: { q1: "Vegan" }, email: "guest@example.com",
  }],
  pages: [{ eventId: "e1", eventTitle: "Detty", formId: "f1", mode: "required_step", autoRemind: true, answered: 3, toAnswer: 2, notAsked: 1 }],
  requestSends30d: [{ status: "sent", reason: null, count: 12 }, { status: "skipped", reason: "no_texts_left", count: 3 }],
  stuckCheckoutAnswers: { count: 1, oldest: "2026-11-20T10:00:00Z" },
  doorReads7d: 5,
  switches: { BRAND_FORMS_KILL_SWITCH: false, BRAND_FORMS_PUSH: false, BRAND_FORMS_PUSH_EMAIL_ALONGSIDE: true },
  formReadyAppShare14d: 42,
};

test("#4541 R7.1 the view reads counts, statuses, failures and switches", () => {
  const v = brandFormsSupportView(reply);
  assert.deepEqual(v.forms[0], {
    id: "f1", name: "Guest details", status: "Live", liveVersion: "v2", doorFullAnswers: "On",
    doorFullAnswersInvited: "Off", openReplyLimitPerDay: 500, blastKnown: 4, blastUnknown: 7, hidden: 1,
  });
  assert.deepEqual(v.pages[0], {
    eventId: "e1", eventTitle: "Detty", formId: "f1", mode: "Before they finish", autoRemind: "On",
    answered: 3, toAnswer: 2, notAsked: 1,
  });
  assert.deepEqual(v.sends.map(sendLine), ["sent · 12", "skipped (no_texts_left) · 3"]);
  assert.deepEqual(v.stuckCheckout, { count: 1, oldest: "2026-11-20T10:00:00Z" });
  assert.equal(v.doorReads7d, 5);
  assert.deepEqual(v.switches.map((s) => `${s.label}: ${s.value}`), [
    "Forms off switch: Off", "Form requests by push: Off", "Email alongside push: On",
  ]);
  assert.equal(v.formReadyShare, "Form-ready app share (14 days): 42%");
});

test("#4541 R7.1 no answer content and no guest contacts ever reach the view", () => {
  const json = JSON.stringify(brandFormsSupportView(reply));
  assert.ok(!json.includes("Vegan"));
  assert.ok(!json.includes("@"));
});

test("#4541 R7.1 an unreadable reply throws (the page shows Retry), never a blank 'no forms'", () => {
  assert.throws(() => brandFormsSupportView(null));
  assert.throws(() => brandFormsSupportView({ forms: "x" }));
  assert.equal(brandFormsSupportView({ forms: [] }).forms.length, 0);
  assert.equal(brandFormsSupportView({ forms: [], formReadyAppShare14d: null }).formReadyShare,
    "Form-ready app share (14 days): no app users seen");
});

test("#4541 R7.1 the daily Unknown-reply limit is a whole number 0..5000", () => {
  assert.equal(parseOpenReplyLimit("0"), 0);
  assert.equal(parseOpenReplyLimit(" 500 "), 500);
  assert.equal(parseOpenReplyLimit("5000"), 5000);
  assert.equal(parseOpenReplyLimit("5001"), null);
  assert.equal(parseOpenReplyLimit("-1"), null);
  assert.equal(parseOpenReplyLimit("2.5"), null);
  assert.equal(parseOpenReplyLimit(""), null);
});

test("#4541 R7.1 a refusal reads in plain words", () => {
  assert.equal(supportErrorMessage({ code: "42501", message: "forbidden" }), "This view is for Mingla admins and support only.");
  assert.equal(supportErrorMessage({ message: "limit_invalid" }), "The limit must be a whole number from 0 to 5000.");
  assert.equal(supportErrorMessage(new Error("Failed to fetch")), "Couldn't load forms support. Check your connection and try again.");
});

test("#4541 R7.1 the brand detail mounts the view and the page calls only the admin RPCs", () => {
  const consolePage = readFileSync(new URL("../BrandsConsolePage.jsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../BrandFormsSupportPage.jsx", import.meta.url), "utf8");
  assert.ok(consolePage.includes("<BrandFormsSupportPage brandId={selectedBrandId} />"));
  assert.ok(page.includes('supabase.rpc("admin_brand_forms_support"'));
  assert.ok(page.includes('supabase.rpc("admin_brand_form_set_open_reply_limit"'));
  assert.ok(!page.includes(".from("));
});
