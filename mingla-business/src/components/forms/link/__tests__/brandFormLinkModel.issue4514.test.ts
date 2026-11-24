/**
 * #4514 wave 3 — the guest link page's state machine (`/form/{formId}#t=…`).
 * Every state the design draws is reached from a server read or a refusal code.
 *
 * FAILS-ON-REVERT: letting a code_required read open the form (an existing answer
 * shown without the code), or reading the token from a query string, turns a case red.
 */

import {
  answersForDefinition,
  codeAfterSend,
  codeAfterVerify,
  emptyCode,
  type LinkRead,
  parseLinkRead,
  phaseFromRead,
  phaseFromReadError,
  savedPhase,
  codeStepKeepingAnswers,
  phaseAfterRead,
  submitOutcome,
  takeLinkToken,
  tokenFromHash,
  withDraft,
} from "../brandFormLinkModel";
import { LINK_COPY } from "../brandFormLinkCopy";

const TOKEN = "a".repeat(64);
const def = {
  questions: [
    { id: "q1", position: 0, type: "single_choice" as const, label: "Perform?", required: true,
      options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] },
    { id: "q2", position: 1, type: "short_text" as const, label: "What?", required: true,
      show_if: { question_id: "q1", option_id: "yes" } },
  ],
};

const read = (over: Partial<LinkRead> = {}): LinkRead => ({
  state: "unanswered",
  answered: false,
  recognized: true,
  identity: "Amara N.",
  form: { id: "f1", name: "Open mic", status: "live", versionId: "v2", definition: def, doorFullAnswers: true },
  brand: { displayName: "Ndoto" },
  response: null,
  ...over,
});

describe("token", () => {
  it("is read from the fragment only", () => {
    expect(tokenFromHash(`#t=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash(`#x=1&t=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash(`?t=${TOKEN}`)).toBeNull();
    expect(tokenFromHash("#t=short")).toBeNull();
    expect(tokenFromHash(null)).toBeNull();
  });
});

describe("states from a read", () => {
  it("a first answer opens the form with no code, recognised by name", () => {
    const p = phaseFromRead(read());
    expect(p.kind).toBe("open");
    if (p.kind !== "open") return;
    expect(p.form.identity).toBe("Amara N.");
    expect(p.editCount).toBeNull();
    expect(p.form.doorFullAnswers).toBe(true);
    expect(LINK_COPY.answeringAs("Amara N.")).toBe("Answering as Amara N.");
  });

  it("an existing answer needs the one-time code and reveals nothing until then", () => {
    const p = phaseFromRead(read({ state: "code_required", answered: true }));
    expect(p).toEqual(expect.objectContaining({ kind: "code", reason: "answered" }));
    expect(JSON.stringify(p)).not.toContain("Juggle");
  });

  it("after the code, the answer opens prefilled with its edit count", () => {
    const p = phaseFromRead(read({
      state: "answered",
      response: { id: "r1", versionId: "v2", isCurrentVersion: true, answers: { q1: "yes", q2: "Juggle", gone: "x" },
        editCount: 2, updatedAt: "2026-11-18T10:00:00Z", definition: def },
    }));
    expect(p.kind).toBe("open");
    if (p.kind !== "open") return;
    expect(p.answers).toEqual({ q1: "yes", q2: "Juggle" });
    expect(p.editCount).toBe(2);
  });

  it("recognition ended after 30 days: the code, then carry on", () => {
    expect(phaseFromRead(read({ state: "code_required", answered: false, recognized: false })))
      .toEqual(expect.objectContaining({ kind: "code", reason: "recognition_ended" }));
  });

  it("a closed form: closed with no answers, the code for last answers, then read-only", () => {
    expect(phaseFromRead(read({ state: "unanswered", form: { ...read().form, status: "closed" } })))
      .toEqual({ kind: "closed", formName: "Open mic", last: null });
    expect(phaseFromRead(read({ state: "code_required", answered: true, form: { ...read().form, status: "closed" } })))
      .toEqual(expect.objectContaining({ kind: "code", reason: "closed" }));
    const last = phaseFromRead(read({
      state: "answered",
      form: { ...read().form, status: "closed" },
      response: { id: "r1", versionId: "v1", isCurrentVersion: false, answers: { q1: "no" }, editCount: 0,
        updatedAt: "", definition: def },
    }));
    expect(last).toEqual({ kind: "closed", formName: "Open mic", last: { definition: def, answers: { q1: "no" } } });
  });

  it("a bad or wrong-form link is the invalid state; a revoked one was replaced (#4541 R8.2); anything else can retry", () => {
    expect(phaseFromReadError("link_invalid")).toEqual({ kind: "invalid" });
    expect(phaseFromReadError("link_revoked")).toEqual({ kind: "replaced" });
    expect(phaseFromReadError("form_not_found")).toEqual({ kind: "invalid" });
    expect(phaseFromReadError("Failed to fetch")).toEqual({ kind: "load_failed" });
    expect(phaseFromReadError(null)).toEqual({ kind: "load_failed" });
  });
});

describe("saving", () => {
  it("maps every refusal to what the page does", () => {
    expect(submitOutcome(null)).toEqual({ next: "saved" });
    expect(submitOutcome("form_closed")).toEqual({ next: "reload" });
    expect(submitOutcome("code_required")).toEqual({ next: "code" });
    expect(submitOutcome("forms_paused")).toEqual({ next: "paused" });
    expect(submitOutcome("link_revoked")).toEqual({ next: "replaced" });
    expect(submitOutcome("response_stale")).toEqual({ next: "error", error: "stale" });
    expect(submitOutcome("form_changed")).toEqual({ next: "error", error: "changed" });
    expect(submitOutcome("network")).toEqual({ next: "error", error: "failed" });
    expect(submitOutcome("server_error")).toEqual({ next: "error", error: "failed" });
    expect(submitOutcome("form_answers_invalid", [{ questionId: "q2", code: "too_long" }, { questionId: null, code: "type" }]))
      .toEqual({ next: "error", error: "invalid", fieldErrors: { q2: "This answer is too long." } });
  });

  it("thanks the guest by first name", () => {
    expect(savedPhase("Open mic", "Amara N.")).toEqual({ kind: "saved", formName: "Open mic", firstName: "Amara" });
    expect(LINK_COPY.savedTitle("Amara")).toBe("Thanks, Amara. Your answers are saved.");
    expect(LINK_COPY.openInApp).toBe("Open in the Explorer app");
  });

  it("drops answers to questions the current version no longer has", () => {
    expect(answersForDefinition(def, { q1: "yes", old: "x" })).toEqual({ q1: "yes" });
  });
});

describe("the one-time code", () => {
  it("send moves to entering the code; a refusal stays on ask with the reason", () => {
    const sent = codeAfterSend(emptyCode(), { ok: true, challengeId: "c1", sentTo: "a•••@x.test", otherChannel: true, channel: "email" });
    expect(sent).toEqual(expect.objectContaining({ step: "enter", challengeId: "c1", sentTo: "a•••@x.test", otherChannel: true }));
    expect(codeAfterSend(emptyCode(), { ok: false, error: "rate_limited" })).toEqual(expect.objectContaining({ step: "ask", error: "rate_limited" }));
    expect(codeAfterSend(emptyCode(), { ok: false, error: "weird" }).error).toBe("failed");
  });

  it("a wrong code counts down; expired or locked asks for a new code", () => {
    const entering = codeAfterSend(emptyCode(), { ok: true, challengeId: "c1", sentTo: "x", otherChannel: false, channel: "phone" });
    expect(codeAfterVerify(entering, { ok: true })).toEqual({ ok: true });
    const bad = codeAfterVerify(entering, { ok: false, error: "bad_code", attemptsLeft: 3 });
    expect(bad).toEqual({ ok: false, code: expect.objectContaining({ step: "enter", error: "bad_code", attemptsLeft: 3 }) });
    expect(LINK_COPY.codeBad(1)).toBe("That code didn't match. 1 try left.");
    const locked = codeAfterVerify(entering, { ok: false, error: "locked" });
    expect(locked).toEqual({ ok: false, code: expect.objectContaining({ step: "ask", error: "locked" }) });
    const expired = codeAfterVerify(entering, { ok: false, error: "expired" });
    expect(expired).toEqual({ ok: false, code: expect.objectContaining({ step: "ask", error: "expired" }) });
  });
});

describe("parsing a read", () => {
  it("accepts the server payload and refuses anything else", () => {
    const parsed = parseLinkRead({
      state: "code_required", answered: true, recognized: true, identity: "Amara N.",
      form: { id: "f1", name: "Open mic", status: "live" }, brand: { displayName: "Ndoto" },
    });
    expect(parsed?.state).toBe("code_required");
    expect(parsed?.response).toBeNull();
    expect(parseLinkRead({ state: "hacked", form: { id: "f1", name: "x", status: "live" } })).toBeNull();
    expect(parseLinkRead(null)).toBeNull();
    const withNumber = parseLinkRead({
      state: "answered", form: { id: "f1", name: "x", status: "live", definition: def },
      response: { id: "r1", answers: { q3: 4, q1: "yes", q4: ["a", 2] }, editCount: 1 },
    });
    expect(withNumber?.response?.answers).toEqual({ q3: "4", q1: "yes", q4: ["a"] });
  });
});

// Fix wave (review finding 4): the token leaves the address bar once read, so it
// cannot reach error reports or breadcrumbs; it stays in memory for the page.
// FAILS-ON-REVERT: not calling replaceState leaves "#t=" in the URL.
describe("the fragment is removed after the token is read", () => {
  const host = (pathname: string, hash: string) => {
    const calls: string[] = [];
    const h = {
      location: { pathname, search: "?utm=x", hash },
      history: {
        state: { k: 1 },
        replaceState: (_s: unknown, _u: string, url: string) => {
          calls.push(url);
          h.location.hash = "";
        },
      },
    };
    return { h, calls };
  };

  it("reads the token, then replaces the URL without the fragment", () => {
    const { h, calls } = host("/form/f1", `#t=${TOKEN}`);
    expect(takeLinkToken(h)).toBe(TOKEN);
    expect(calls).toEqual(["/form/f1?utm=x"]);
    expect(h.location.hash).toBe("");
    // A re-mount on the same page still has the token (memory only).
    expect(takeLinkToken(h)).toBe(TOKEN);
    expect(calls).toHaveLength(1);
  });

  it("another page never gets the held token", () => {
    const { h } = host("/form/other", "");
    expect(takeLinkToken(h)).toBeNull();
  });
});

// Fix wave (review finding 3): the typed answers survive the code step when the
// 30-minute grant runs out mid-edit.
// FAILS-ON-REVERT: re-reading after the code without the draft drops "Juggle".
describe("typed answers survive a new one-time code", () => {
  const saved = read({ state: "answered", answered: true,
    response: { id: "r1", versionId: "v2", isCurrentVersion: true, editCount: 1, updatedAt: "2026-11-19T10:00:00Z",
      answers: { q1: "yes", q2: "Sing" } } });

  it("after verify, the re-read form shows what the guest typed, not the saved answer", () => {
    const p = withDraft(phaseFromRead(saved), { formId: "f1", answers: { q1: "yes", q2: "Juggle", gone: "x" } });
    expect(p.kind).toBe("open");
    if (p.kind !== "open") return;
    expect(p.answers).toEqual({ q1: "yes", q2: "Juggle" });
    expect(p.editCount).toBe(1);
  });

  it("no draft, another form, or a non-open state is left alone", () => {
    expect(withDraft(phaseFromRead(saved), null)).toEqual(phaseFromRead(saved));
    expect(withDraft(phaseFromRead(saved), { formId: "f9", answers: { q2: "X" } })).toEqual(phaseFromRead(saved));
    const code = phaseFromRead(read({ state: "code_required", answered: true }));
    expect(withDraft(code, { formId: "f1", answers: { q2: "X" } })).toEqual(code);
  });
});

describe("the code step keeps the typed answers (the screen's flow)", () => {
  it("Save -> code -> verify -> re-read: the typed answers are back and the draft is used up", () => {
    const open = phaseFromRead(read({ state: "answered", answered: true,
      response: { id: "r1", versionId: "v2", isCurrentVersion: true, editCount: 1, updatedAt: "2026-11-19T10:00:00Z",
        answers: { q1: "yes", q2: "Sing" } } }));
    if (open.kind !== "open") throw new Error("expected open");
    const typed = { ...open, answers: { q1: "yes", q2: "Juggle" } };
    const step = codeStepKeepingAnswers(typed);
    expect(step.phase.kind).toBe("code");
    if (step.phase.kind === "code") expect(step.phase.reason).toBe("answered");
    // A failed verify reads code_required again: the draft is still kept.
    const still = phaseAfterRead(read({ state: "code_required", answered: true }), step.draft);
    expect(still.phase.kind).toBe("code");
    expect(still.draft).toEqual(step.draft);
    // The verified re-read returns the saved answer; the typed one wins and the draft is dropped.
    const after = phaseAfterRead(read({ state: "answered", answered: true,
      response: { id: "r1", versionId: "v2", isCurrentVersion: true, editCount: 1, updatedAt: "2026-11-19T10:00:00Z",
        answers: { q1: "yes", q2: "Sing" } } }), still.draft);
    expect(after.draft).toBeNull();
    expect(after.phase.kind === "open" ? after.phase.answers : null).toEqual({ q1: "yes", q2: "Juggle" });
  });
});
