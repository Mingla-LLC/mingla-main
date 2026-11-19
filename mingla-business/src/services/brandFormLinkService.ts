/**
 * #4514 wave 3 — the guest link page's calls (`/form/{formId}#t=…`). Anonymous:
 * the personal token from the URL fragment is the only key, posted in a request
 * BODY (never a query string, never logged). Imported only by the lazily loaded
 * link screen, so nothing here reaches the eager Host web bundle.
 *
 * - read:   `brand_form_my_response(form, token, challenge?)` (granted to anon)
 * - save:   `brand-form-submit` (the answers)
 * - codes:  `brand-form-submit` {op:"code_begin"|"code_verify"} (C2, decision 12)
 *
 * Services throw `BrandFormLinkError` for a failure the page cannot read; a
 * refusal the page handles (a code the server named) comes back as a value.
 */

import type { BrandAnswers } from "@mingla/form-rendering";

import { type LinkRead, parseLinkRead } from "../components/forms/link/brandFormLinkModel";

const getSupabase = async () => (await import("./supabase")).supabase;

export class BrandFormLinkError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "BrandFormLinkError";
    this.code = code;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Read the form for this link. Throws with the server's code ("link_invalid", …). */
export async function readLinkForm(input: {
  formId: string;
  token: string;
  challengeId: string | null;
}): Promise<LinkRead> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("brand_form_my_response", {
    p_form_id: input.formId,
    p_event_id: null,
    p_token: input.token,
    p_challenge_id: input.challengeId,
  });
  if (error !== null) throw new BrandFormLinkError(String(error.message ?? "read_failed"));
  const read = parseLinkRead(data);
  if (read === null) throw new BrandFormLinkError("read_shape");
  return read;
}

/** The JSON body of a non-2xx edge response (supabase-js wraps it in error.context). */
async function errorBody(error: unknown): Promise<Record<string, unknown> | null> {
  const context = isRecord(error) ? (error as { context?: unknown }).context : undefined;
  if (context instanceof Response) {
    try {
      const body: unknown = await context.json();
      return isRecord(body) ? body : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function callSubmit(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.functions.invoke("brand-form-submit", { body });
  if (error !== null) {
    const parsed = await errorBody(error);
    if (parsed !== null) return parsed;
    // No readable body: the network or the platform failed (retryable).
    return { ok: false, error: "network" };
  }
  return isRecord(data) ? data : { ok: false, error: "server_error" };
}

export interface SaveAnswersInput {
  formId: string;
  versionId: string | null;
  answers: BrandAnswers;
  expectedEditCount: number | null;
  token: string;
  challengeId: string | null;
}

export type SaveAnswersResult =
  | { ok: true; editCount: number }
  | { ok: false; error: string; errors?: Array<{ questionId: string | null; code: string }> };

export async function saveLinkAnswers(input: SaveAnswersInput): Promise<SaveAnswersResult> {
  const out = await callSubmit({
    formId: input.formId,
    versionId: input.versionId,
    answers: input.answers,
    source: "link",
    expectedEditCount: input.expectedEditCount,
    token: input.token,
    challengeId: input.challengeId,
  });
  if (out.ok === true) {
    return { ok: true, editCount: typeof out.editCount === "number" ? out.editCount : 0 };
  }
  return {
    ok: false,
    error: typeof out.error === "string" ? out.error : "server_error",
    errors: Array.isArray(out.errors) ? out.errors as Array<{ questionId: string | null; code: string }> : undefined,
  };
}

export type SendCodeResult =
  | { ok: true; challengeId: string; sentTo: string; otherChannel: boolean; channel: "email" | "phone" }
  | { ok: false; error: string };

export async function sendLinkCode(input: {
  formId: string;
  token: string;
  channel: "email" | "phone" | null;
}): Promise<SendCodeResult> {
  const out = await callSubmit({
    op: "code_begin",
    formId: input.formId,
    token: input.token,
    ...(input.channel !== null ? { channel: input.channel } : {}),
  });
  if (
    out.ok === true && typeof out.challengeId === "string" && typeof out.sentTo === "string" &&
    (out.channel === "email" || out.channel === "phone")
  ) {
    return {
      ok: true,
      challengeId: out.challengeId,
      sentTo: out.sentTo,
      otherChannel: out.otherChannel === true,
      channel: out.channel,
    };
  }
  return { ok: false, error: typeof out.error === "string" ? out.error : "failed" };
}

export async function checkLinkCode(input: {
  formId: string;
  token: string;
  challengeId: string;
  code: string;
}): Promise<{ ok: true } | { ok: false; error: string; attemptsLeft?: number }> {
  const out = await callSubmit({
    op: "code_verify",
    formId: input.formId,
    token: input.token,
    challengeId: input.challengeId,
    code: input.code,
  });
  if (out.ok === true) return { ok: true };
  return {
    ok: false,
    error: typeof out.error === "string" ? out.error : "failed",
    attemptsLeft: typeof out.attemptsLeft === "number" ? out.attemptsLeft : undefined,
  };
}
