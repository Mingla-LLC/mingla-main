/**
 * #4541 R2.1–R2.3 — the form route's params, the routes that open it, and the
 * screen state each server answer maps to. Pure (no React Native), so the
 * route, the cards, the hand-off and the tests share one definition.
 *
 *   /form/{formId}?event=&as=&sid=&campaign=&from=&t=
 *
 * Every way in names the form, the event and who the answer is for. A personal
 * link's token (`t`, from the link's `#t=`, rewritten to the query by
 * app/+native-intent.tsx R-5b) stays on this phone and is never logged.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;

export type FormSubjectKind = "rsvp" | "rsvp_guest" | "order";
export type FormOpenedFrom = "link" | "pass" | "ticket" | "purchase" | "rsvp" | "push" | "blast";

export const FORM_OPENED_FROM: readonly FormOpenedFrom[] = [
  "link", "pass", "ticket", "purchase", "rsvp", "push", "blast",
];

export interface FormRouteParams {
  formId: string;
  eventId: string | null;
  as: FormSubjectKind | null;
  sid: string | null;
  campaignId: string | null;
  from: FormOpenedFrom;
  token: string | null;
}

type Raw = string | string[] | undefined | null;
const first = (v: Raw): string | null => {
  const value = Array.isArray(v) ? v[0] : v;
  return typeof value === "string" && value.length > 0 ? value : null;
};
const uuid = (v: Raw): string | null => {
  const value = first(v);
  return value !== null && UUID.test(value) ? value.toLowerCase() : null;
};

/** The route's params, or null when the form id is not a uuid. */
export function parseFormRouteParams(raw: {
  formId?: Raw; event?: Raw; as?: Raw; sid?: Raw; campaign?: Raw; from?: Raw; t?: Raw;
}): FormRouteParams | null {
  const formId = uuid(raw.formId);
  if (formId === null) return null;
  const asRaw = first(raw.as);
  const as = asRaw === "rsvp" || asRaw === "rsvp_guest" || asRaw === "order" ? asRaw : null;
  const sid = as === null ? null : uuid(raw.sid);
  const fromRaw = first(raw.from);
  const from = FORM_OPENED_FROM.find((f) => f === fromRaw) ?? "link";
  const tokenRaw = first(raw.t);
  return {
    formId,
    eventId: uuid(raw.event),
    as: sid === null ? null : as,
    sid,
    campaignId: uuid(raw.campaign),
    from,
    token: tokenRaw !== null && TOKEN.test(tokenRaw) ? tokenRaw : null,
  };
}

/** The in-app route to a form, for a held item or a Blast. Never carries a token. */
export function formRoutePath(input: {
  formId: string;
  eventId?: string | null;
  as?: FormSubjectKind | null;
  sid?: string | null;
  campaignId?: string | null;
  from: FormOpenedFrom;
}): string {
  const q = new URLSearchParams();
  if (input.eventId) q.set("event", input.eventId);
  if (input.as && input.sid) {
    q.set("as", input.as);
    q.set("sid", input.sid);
  }
  if (input.campaignId) q.set("campaign", input.campaignId);
  q.set("from", input.from);
  return `/form/${encodeURIComponent(input.formId)}?${q.toString()}`;
}

/** The read's cache scope (R2.4): a link never puts its token in a key. */
export function formScreenScope(p: FormRouteParams): string {
  if (p.token !== null) return "link";
  return `${p.eventId ?? p.campaignId ?? "none"}:${p.as ?? "user"}:${p.sid ?? "self"}`;
}

/** Who the answer belongs to and how the server is asked (R2.2). */
export type FormIdentityPath =
  | "link"
  | "held"
  | "event"
  | "blast_user"
  | "blast_unknown"
  | "sign_in";

export function formIdentityPath(p: FormRouteParams, signedIn: boolean): FormIdentityPath {
  if (p.token !== null) return "link";
  if (p.campaignId !== null && p.eventId === null) return signedIn ? "blast_user" : "blast_unknown";
  if (!signedIn) return "sign_in";
  if (p.as !== null && p.sid !== null) return "held";
  return "event";
}

/** Screen states (R2.3); each renders with testID `form-screen-<state>`. */
export type FormScreenState =
  | "load"
  | "fill"
  | "err"
  | "send"
  | "saved"
  | "view"
  | "edit"
  | "changed"
  | "stale"
  | "signin"
  | "closed"
  | "ended"
  | "notfound"
  | "replaced"
  | "notholder"
  | "paused"
  | "loadfail"
  | "unknown";

/** A refused READ, as a whole-screen state (§15). */
export function readErrorState(code: string): FormScreenState {
  switch (code) {
    case "forms_paused":
      return "paused";
    case "link_revoked":
      return "replaced";
    case "code_required":
    case "sign_in_required":
      return "signin";
    case "not_holder":
    case "not_current":
      return "notholder";
    case "form_closed":
      return "closed";
    case "form_not_found":
    case "form_not_live":
    case "link_invalid":
    case "link_wrong_form":
    case "form_not_on_event":
    case "subject_unavailable":
    case "bad_request":
      return "notfound";
    default:
      return "loadfail";
  }
}

/** A refused SUBMIT: a whole-screen state, or an inline line on the fill state. */
export type SubmitOutcome =
  | { kind: "screen"; state: FormScreenState }
  | { kind: "inline"; line: "offline" | "rate" | "openLimit" | "botCheck" | "tooLarge" };

export function submitErrorOutcome(code: string): SubmitOutcome {
  switch (code) {
    case "form_answers_invalid":
      return { kind: "screen", state: "err" };
    case "form_changed":
      return { kind: "screen", state: "changed" };
    case "response_stale":
      return { kind: "screen", state: "stale" };
    case "rate_limited":
      return { kind: "inline", line: "rate" };
    case "open_reply_limit":
      return { kind: "inline", line: "openLimit" };
    case "bot_check_failed":
      return { kind: "inline", line: "botCheck" };
    case "too_large":
      return { kind: "inline", line: "tooLarge" };
    case "network":
    case "server_error":
      return { kind: "inline", line: "offline" };
    default: {
      const state = readErrorState(code);
      return state === "loadfail" ? { kind: "inline", line: "offline" } : { kind: "screen", state };
    }
  }
}

/** True when an event is over or called off (status from `brand_forms_my_pending`). */
export const eventIsOver = (status: string | null | undefined): boolean =>
  status === "ended" || status === "cancelled";

/** "Ada O." → "Ada" and "O" (the who-line placeholders). */
export function splitIdentity(identity: string | null): { first: string; initial: string } | null {
  if (identity === null) return null;
  const parts = identity.trim().split(/\s+/);
  const firstName = parts[0] ?? "";
  if (firstName.length === 0) return null;
  const initial = (parts[1] ?? "").replace(/\.$/, "").slice(0, 1);
  return { first: firstName, initial };
}

type FormAnswers = Record<string, string | string[] | null>;
interface FormDefinitionLike {
  questions: { id: string; type: string; options?: { id: string }[] }[];
}

/** Keep typed answers whose question still exists in the new version (R2.3 S-CHANGED). Pure. */
export function remapAnswersById(answers: FormAnswers, def: FormDefinitionLike | null): FormAnswers {
  if (def === null) return {};
  const out: FormAnswers = {};
  for (const q of def.questions) {
    const value = answers[q.id];
    if (value === undefined) continue;
    if (q.type === "single_choice" || q.type === "multi_choice") {
      const known = new Set((q.options ?? []).map((o) => o.id));
      if (typeof value === "string" && known.has(value)) out[q.id] = value;
      else if (Array.isArray(value)) {
        const kept = value.filter((id) => known.has(id));
        if (kept.length > 0) out[q.id] = kept;
      }
    } else if (typeof value === "string") {
      out[q.id] = value;
    }
  }
  return out;
}

