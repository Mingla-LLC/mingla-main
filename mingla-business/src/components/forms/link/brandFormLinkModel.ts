/**
 * #4514 wave 3 — the guest link page's state machine (`/form/{formId}#t=…`),
 * pure so every state is unit-tested (BUILD CONTRACT v2 §5.7; C2; decision 12).
 *
 * States: loading · open (recognised: "Answering as {name} · Not you?") · saved ·
 * code (an existing answer, a closed form's last answers, or recognition ended
 * after 30 days, each needs a one-time code; a first answer never does) ·
 * closed (says closed; last answers read-only, only after the code) · invalid
 * link · paused (the emergency switch) · load failed (retry). A failed save keeps
 * the answers on screen with a retry. No useAuth anywhere on this page.
 *
 * #4541: replaced (an older personal link after a newer one was sent, R8.2) ·
 * a Blast form opened with no personal link (`?c={campaign}`, R4.4/R4.5):
 * unknown_open ("{brand} won't see who you are"), unknown_saved, unknown_limit
 * (the form's daily limit of Unknown replies). A personal Blast link that needs
 * a code it cannot get offers "Answer without confirming" (Unknown).
 */

import type { BrandAnswers, BrandFormDefinitionShape, BrandHeaderData } from "@mingla/form-rendering";

/** What `brand_form_my_response` returns (the fields this page reads). */
export interface LinkRead {
  state: "unanswered" | "answered" | "code_required";
  answered?: boolean;
  recognized?: boolean;
  identity?: string | null;
  form: {
    id: string;
    name: string;
    status: "live" | "closed" | string;
    versionId?: string | null;
    definition?: BrandFormDefinitionShape | null;
    doorFullAnswers?: boolean;
  };
  brand?: Record<string, unknown> | null;
  /** #4541 R4.4: a Blast link cannot get a one-time code (no contact is kept). */
  codeAvailable?: boolean;
  /** #4541 R4.4: the page may offer "Answer without confirming" (Unknown). */
  unknownAllowed?: boolean;
  /** #4541 R4.4: the Blast a personal Blast link came in. */
  campaignId?: string | null;
  response?: {
    id: string;
    versionId: string;
    isCurrentVersion: boolean;
    answers: BrandAnswers;
    editCount: number;
    updatedAt: string;
    definition?: BrandFormDefinitionShape | null;
  } | null;
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function parseDefinition(v: unknown): BrandFormDefinitionShape | null {
  if (!isRec(v) || !Array.isArray(v.questions)) return null;
  const questions: BrandFormDefinitionShape["questions"] = [];
  for (const q of v.questions) {
    if (!isRec(q) || typeof q.id !== "string" || typeof q.type !== "string" || typeof q.label !== "string") return null;
    questions.push({
      id: q.id,
      position: typeof q.position === "number" ? q.position : questions.length,
      type: q.type as BrandFormDefinitionShape["questions"][number]["type"],
      label: q.label,
      help: typeof q.help === "string" ? q.help : null,
      required: q.required === true,
      options: Array.isArray(q.options)
        ? q.options.filter(isRec).map((o) => ({ id: String(o.id), label: String(o.label) }))
        : undefined,
      show_if: isRec(q.show_if) && typeof q.show_if.question_id === "string" && typeof q.show_if.option_id === "string"
        ? { question_id: q.show_if.question_id, option_id: q.show_if.option_id }
        : null,
      show_at_door: q.show_at_door === true,
      door_label: typeof q.door_label === "string" ? q.door_label : null,
    });
  }
  return {
    title: typeof v.title === "string" ? v.title : undefined,
    intro: typeof v.intro === "string" ? v.intro : undefined,
    questions,
  };
}

function parseAnswers(v: unknown): BrandAnswers {
  const out: BrandAnswers = {};
  if (!isRec(v)) return out;
  for (const [k, a] of Object.entries(v)) {
    if (typeof a === "string") out[k] = a;
    else if (typeof a === "number") out[k] = String(a);
    else if (Array.isArray(a)) out[k] = a.filter((x): x is string => typeof x === "string");
  }
  return out;
}

/** Runtime check of a `brand_form_my_response` payload; null when it is not one. */
export function parseLinkRead(data: unknown): LinkRead | null {
  if (!isRec(data) || !isRec(data.form)) return null;
  const f = data.form;
  if (typeof f.id !== "string" || typeof f.name !== "string" || typeof f.status !== "string") return null;
  const state = data.state;
  if (state !== "unanswered" && state !== "answered" && state !== "code_required") return null;
  const r = data.response;
  const response = isRec(r) && typeof r.id === "string"
    ? {
      id: r.id,
      versionId: typeof r.versionId === "string" ? r.versionId : "",
      isCurrentVersion: r.isCurrentVersion === true,
      answers: parseAnswers(r.answers),
      editCount: typeof r.editCount === "number" ? r.editCount : 0,
      updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
      definition: parseDefinition(r.definition),
    }
    : null;
  return {
    state,
    answered: data.answered === true,
    recognized: data.recognized !== false,
    identity: typeof data.identity === "string" ? data.identity : null,
    form: {
      id: f.id,
      name: f.name,
      status: f.status,
      versionId: typeof f.versionId === "string" ? f.versionId : null,
      definition: parseDefinition(f.definition),
      doorFullAnswers: f.doorFullAnswers === true,
    },
    brand: isRec(data.brand) ? data.brand : null,
    codeAvailable: data.codeAvailable !== false,
    unknownAllowed: data.unknownAllowed === true,
    campaignId: typeof data.campaignId === "string" ? data.campaignId : null,
    response,
  };
}

export type CodeReason = "answered" | "recognition_ended" | "closed";

export interface CodeStep {
  /** "ask" = before a code was sent; "enter" = waiting for the six digits. */
  step: "ask" | "enter";
  challengeId: string | null;
  sentTo: string | null;
  otherChannel: boolean;
  channel: "email" | "phone" | null;
  error: CodeError | null;
  attemptsLeft: number | null;
  busy: boolean;
}

export type CodeError =
  | "bad_code"
  | "expired"
  | "locked"
  | "rate_limited"
  | "no_contact"
  | "send_failed"
  | "failed";

export type SaveError =
  | "failed"
  | "rate_limited"
  | "stale"
  | "changed"
  | "invalid";

export interface FormData {
  formId: string;
  formName: string;
  versionId: string | null;
  definition: BrandFormDefinitionShape;
  doorFullAnswers: boolean;
  identity: string | null;
}

export type LinkPhase =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "paused" }
  | { kind: "load_failed" }
  | { kind: "replaced" }
  | {
    kind: "code";
    reason: CodeReason;
    formName: string;
    identity: string | null;
    code: CodeStep;
    /** #4541 R4.4: no code for a Blast link: answer as Unknown in this Blast instead. */
    unknownCampaignId?: string | null;
  }
  | {
    kind: "unknown_open";
    form: FormData;
    campaignId: string;
    botTicket: string | null;
    answers: BrandAnswers;
    saving: boolean;
    saveError: UnknownSaveError | null;
    fieldErrors: Record<string, string>;
  }
  | { kind: "unknown_saved"; formName: string }
  | { kind: "unknown_limit" }
  | {
    kind: "open";
    form: FormData;
    answers: BrandAnswers;
    /** null = no answer yet (a first answer). */
    editCount: number | null;
    saving: boolean;
    saveError: SaveError | null;
    fieldErrors: Record<string, string>;
    notYouOpen: boolean;
  }
  | {
    kind: "closed";
    formName: string;
    /** The person's last answers, read-only, with the version they answered. */
    last: { definition: BrandFormDefinitionShape; answers: BrandAnswers } | null;
  }
  | { kind: "saved"; formName: string; firstName: string | null };

export const emptyCode = (): CodeStep => ({
  step: "ask",
  challengeId: null,
  sentTo: null,
  otherChannel: false,
  channel: null,
  error: null,
  attemptsLeft: null,
  busy: false,
});

/** Keep only answers to questions of this definition (an earlier version's extras drop). */
export function answersForDefinition(def: BrandFormDefinitionShape, answers: BrandAnswers | null | undefined): BrandAnswers {
  if (answers === null || answers === undefined) return {};
  const ids = new Set(def.questions.map((q) => q.id));
  const out: BrandAnswers = {};
  for (const [k, v] of Object.entries(answers)) if (ids.has(k)) out[k] = v;
  return out;
}

const firstNameOf = (identity: string | null | undefined): string | null => {
  const first = (identity ?? "").trim().split(/\s+/)[0] ?? "";
  return first.length > 0 ? first : null;
};

/** The page's state for one read of `brand_form_my_response`. */
export function phaseFromRead(read: LinkRead): LinkPhase {
  const closed = read.form.status === "closed";
  if (read.state === "code_required") {
    const answered = read.answered === true;
    if (closed && !answered) return { kind: "closed", formName: read.form.name, last: null };
    const reason: CodeReason = closed ? "closed" : answered ? "answered" : "recognition_ended";
    const unknownCampaignId =
      read.codeAvailable === false && read.unknownAllowed === true && !closed ? read.campaignId ?? null : null;
    return {
      kind: "code",
      reason,
      formName: read.form.name,
      identity: read.identity ?? null,
      code: emptyCode(),
      ...(unknownCampaignId !== null ? { unknownCampaignId } : {}),
    };
  }
  const resp = read.response ?? null;
  if (closed) {
    const def = resp?.definition ?? read.form.definition ?? null;
    return {
      kind: "closed",
      formName: read.form.name,
      last: resp !== null && def !== null ? { definition: def, answers: resp.answers } : null,
    };
  }
  const definition = read.form.definition;
  if (definition === undefined || definition === null) return { kind: "invalid" };
  return {
    kind: "open",
    form: {
      formId: read.form.id,
      formName: read.form.name,
      versionId: read.form.versionId ?? null,
      definition,
      doorFullAnswers: read.form.doorFullAnswers === true,
      identity: read.identity ?? null,
    },
    answers: answersForDefinition(definition, resp?.answers),
    editCount: resp === null ? null : resp.editCount,
    saving: false,
    saveError: null,
    fieldErrors: {},
    notYouOpen: false,
  };
}

/**
 * Answers typed on the page, kept across the one-time code step: when the
 * 30-minute grant runs out mid-edit, Save asks for a new code, and after the
 * re-read the typed answers come back (questions the live version no longer has
 * drop). Never persisted; memory only.
 */
export interface LinkDraft {
  formId: string;
  answers: BrandAnswers;
}

export function withDraft(phase: LinkPhase, draft: LinkDraft | null): LinkPhase {
  if (draft === null || phase.kind !== "open" || phase.form.formId !== draft.formId) return phase;
  return { ...phase, answers: { ...phase.answers, ...answersForDefinition(phase.form.definition, draft.answers) } };
}

type OpenPhase = Extract<LinkPhase, { kind: "open" }>;

/** Save asked for a new code (the grant ran out): the code step, and the typed answers to keep. */
export function codeStepKeepingAnswers(current: OpenPhase): { phase: LinkPhase; draft: LinkDraft } {
  return {
    phase: {
      kind: "code",
      reason: "answered",
      formName: current.form.formName,
      identity: current.form.identity,
      code: emptyCode(),
    },
    draft: { formId: current.form.formId, answers: current.answers },
  };
}

/** The page after a read: kept answers restored into the open form (then dropped), else kept for later. */
export function phaseAfterRead(read: LinkRead, draft: LinkDraft | null): { phase: LinkPhase; draft: LinkDraft | null } {
  const phase = withDraft(phaseFromRead(read), draft);
  return { phase, draft: phase.kind === "open" ? null : draft };
}

/** The page's state when the read failed (the exception message from PostgREST). */
export function phaseFromReadError(message: string | null): LinkPhase {
  const code = (message ?? "").trim().split(/[\s:]/)[0] ?? "";
  // #4541 R8.2: a newer personal link switched this one off.
  if (code === "link_revoked") return { kind: "replaced" };
  if (code === "forms_paused") return { kind: "paused" };
  if (["link_invalid", "link_wrong_form", "form_not_found", "not_signed_in"].includes(code)) {
    return { kind: "invalid" };
  }
  return { kind: "load_failed" };
}

// ---------------------------------------------------------------------------
// #4541 R4.4 / R4.5 — a Blast form with no personal link: Unknown replies
// ---------------------------------------------------------------------------

export type UnknownSaveError = "failed" | "rate_limited" | "bot_check" | "changed" | "invalid";

/** The `?c=` campaign of a Blast form link, or null (web only; never a token). */
export function campaignFromSearch(search: string): string | null {
  const m = /[?&]c=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:&|$)/i.exec(search);
  return m === null ? null : (m[1] ?? "").toLowerCase();
}

/** The page after the `blast_form` read: the Unknown form, or closed (no last answers), or invalid. */
export function phaseFromBlastRead(data: unknown, campaignId: string): LinkPhase {
  if (!isRec(data) || !isRec(data.form)) return { kind: "load_failed" };
  const f = data.form;
  if (typeof f.id !== "string" || typeof f.name !== "string") return { kind: "load_failed" };
  if (f.status === "closed") return { kind: "closed", formName: f.name, last: null };
  const definition = parseDefinition(f.definition);
  if (definition === null) return { kind: "invalid" };
  return {
    kind: "unknown_open",
    form: {
      formId: f.id,
      formName: f.name,
      versionId: typeof f.versionId === "string" ? f.versionId : null,
      definition,
      doorFullAnswers: false,
      identity: null,
    },
    campaignId,
    botTicket: typeof data.botTicket === "string" ? data.botTicket : null,
    answers: {},
    saving: false,
    saveError: null,
    fieldErrors: {},
  };
}

/** A refused `blast_form` read, as a page state. */
export function phaseFromBlastReadError(code: string | null): LinkPhase {
  switch (code) {
    case "form_closed":
      return { kind: "closed", formName: "", last: null };
    case "forms_paused":
      return { kind: "paused" };
    case "form_not_found":
    case "form_not_on_event":
    case "bad_request":
      return { kind: "invalid" };
    default:
      return { kind: "load_failed" };
  }
}

/** What an Unknown submit does to the page (§15). */
export type UnknownSubmitOutcome =
  | { next: "saved" }
  | { next: "limit" }
  | { next: "paused" }
  | { next: "closed" }
  | { next: "invalid" }
  | { next: "error"; error: UnknownSaveError; fieldErrors?: Record<string, string> };

export function unknownSubmitOutcome(
  error: string | null,
  questionErrors?: Array<{ questionId: string | null; code: string }>,
): UnknownSubmitOutcome {
  switch (error) {
    case null:
      return { next: "saved" };
    case "open_reply_limit":
      return { next: "limit" };
    case "forms_paused":
      return { next: "paused" };
    case "form_closed":
    case "form_not_live":
      return { next: "closed" };
    case "form_not_found":
    case "form_not_on_event":
      return { next: "invalid" };
    case "bot_check_failed":
      return { next: "error", error: "bot_check" };
    case "rate_limited":
      return { next: "error", error: "rate_limited" };
    case "form_changed":
      return { next: "error", error: "changed" };
    case "form_answers_invalid": {
      const fieldErrors: Record<string, string> = {};
      for (const e of questionErrors ?? []) {
        if (e.questionId !== null) fieldErrors[e.questionId] = FIELD_ERROR_COPY[e.code] ?? FIELD_ERROR_COPY.type;
      }
      return { next: "error", error: "invalid", fieldErrors };
    }
    default:
      return { next: "error", error: "failed" };
  }
}

/** What a failed submit does to the page. `reload` asks the screen to read again. */
export type SubmitOutcome =
  | { next: "saved" }
  | { next: "reload" }
  | { next: "code" }
  | { next: "paused" }
  | { next: "invalid" }
  | { next: "replaced" }
  | { next: "error"; error: SaveError; fieldErrors?: Record<string, string> };

export const FIELD_ERROR_COPY: Readonly<Record<string, string>> = {
  required: "Answer this question.",
  type: "Check this answer.",
  option: "Pick one of the choices.",
  too_long: "This answer is too long.",
  unknown_question: "This question changed. Reload the page.",
};

export function submitOutcome(
  error: string | null,
  questionErrors?: Array<{ questionId: string | null; code: string }>,
): SubmitOutcome {
  switch (error) {
    case null:
      return { next: "saved" };
    case "form_closed":
    case "form_not_live":
      return { next: "reload" };
    case "code_required":
      return { next: "code" };
    case "forms_paused":
      return { next: "paused" };
    case "link_revoked":
      return { next: "replaced" };
    case "link_invalid":
    case "link_wrong_form":
    case "form_not_found":
      return { next: "invalid" };
    case "form_changed":
      return { next: "error", error: "changed" };
    case "response_stale":
      return { next: "error", error: "stale" };
    case "rate_limited":
      return { next: "error", error: "rate_limited" };
    case "form_answers_invalid": {
      const fieldErrors: Record<string, string> = {};
      for (const e of questionErrors ?? []) {
        if (e.questionId !== null) fieldErrors[e.questionId] = FIELD_ERROR_COPY[e.code] ?? FIELD_ERROR_COPY.type;
      }
      return { next: "error", error: "invalid", fieldErrors };
    }
    default:
      return { next: "error", error: "failed" };
  }
}

export const savedPhase = (formName: string, identity: string | null): LinkPhase => ({
  kind: "saved",
  formName,
  firstName: firstNameOf(identity),
});

/** The code-send result, applied to the code step. */
export function codeAfterSend(
  code: CodeStep,
  result: { ok: true; challengeId: string; sentTo: string; otherChannel: boolean; channel: "email" | "phone" } | {
    ok: false;
    error: string;
  },
): CodeStep {
  if (result.ok) {
    return {
      ...code,
      step: "enter",
      challengeId: result.challengeId,
      sentTo: result.sentTo,
      otherChannel: result.otherChannel,
      channel: result.channel,
      error: null,
      attemptsLeft: null,
      busy: false,
    };
  }
  const known: CodeError[] = ["rate_limited", "no_contact", "send_failed"];
  return { ...code, busy: false, error: known.includes(result.error as CodeError) ? result.error as CodeError : "failed" };
}

/** The code-check result. `ok` means: read the form again with this challenge. */
export function codeAfterVerify(
  code: CodeStep,
  result: { ok: true } | { ok: false; error: string; attemptsLeft?: number },
): { ok: true } | { ok: false; code: CodeStep } {
  if (result.ok) return { ok: true };
  const error: CodeError = result.error === "bad_code"
    ? "bad_code"
    : result.error === "expired"
    ? "expired"
    : result.error === "locked"
    ? "locked"
    : result.error === "rate_limited"
    ? "rate_limited"
    : "failed";
  return {
    ok: false,
    code: {
      ...code,
      busy: false,
      error,
      attemptsLeft: typeof result.attemptsLeft === "number" ? result.attemptsLeft : null,
      // A spent challenge cannot be retried: ask for a new code.
      step: error === "expired" || error === "locked" ? "ask" : code.step,
    },
  };
}

/** The personal token, read from the URL fragment only (`#t=…`). Never a query string. */
/** The bits of `window` the token read needs (a fake in tests). */
export interface LinkLocationHost {
  location: { pathname: string; search: string; hash: string };
  history: { state: unknown; replaceState: (state: unknown, unused: string, url: string) => void };
}

let heldToken: { path: string; token: string } | null = null;

/**
 * Read the personal token from the URL fragment once, keep it in memory, and
 * remove the fragment from the address bar (history.replaceState) so it cannot
 * reach error reports, breadcrumbs or a copied URL. A later read on the same
 * path (a re-mount) gets the held token.
 */
export function takeLinkToken(host: LinkLocationHost): string | null {
  const path = host.location.pathname;
  const fromHash = tokenFromHash(host.location.hash);
  if (fromHash !== null) {
    heldToken = { path, token: fromHash };
    host.history.replaceState(host.history.state, "", `${path}${host.location.search}`);
    return fromHash;
  }
  return heldToken !== null && heldToken.path === path ? heldToken.token : null;
}

export function tokenFromHash(hash: string | null | undefined): string | null {
  const raw = (hash ?? "").replace(/^#/, "");
  for (const part of raw.split("&")) {
    const [k, v] = part.split("=");
    if (k === "t" && typeof v === "string" && /^[0-9a-f]{64}$/.test(v)) return v;
  }
  return null;
}
