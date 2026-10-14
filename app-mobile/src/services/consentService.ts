/**
 * META-ORCH-1161 Sub-A.2 (consent-capture slice) — onboarding consent writer.
 *
 * Calls the shared `record-consent` edge function to append scoped consent
 * audit rows. Legacy onboarding callers omit `scopes` and preserve the bundled
 * behavior; #3859 checkout passes transactional explicitly.
 *
 * Non-blocking by contract at the call site: a failed consent-audit write MUST NOT
 * block the user finishing onboarding (the affirmative checkbox act already
 * happened). The caller proceeds and logs the gap.
 */

import { supabase } from "./supabase";

export type ConsentScope = "transactional" | "marketing";

export interface RecordConsentInput {
  source: "onboarding" | "checkout";
  /** Exact disclosure string the user saw. */
  disclosureText: string;
  /** Pins the disclosure wording version (DISCLOSURE_VERSION). */
  disclosureVersion: string;
  /** Omitted preserves the existing bundled onboarding/legacy grant. */
  scopes?: readonly ConsentScope[];
  /** E.164 phone — produces the 'sms' consent rows. */
  phone?: string | null;
  /** Email — produces the 'email' consent rows. */
  email?: string | null;
  /** ISO-2 country at grant (the phone country at onboarding). */
  countryCode?: string | null;
  /** The just-created user id. */
  userId?: string | null;
  /**
   * #3682 / #3524 — offering id so record-consent can resolve brand_id/event_id
   * for the Follow grant (same field the Host buyer rails already send).
   */
  eventId?: string | null;
}

export interface RecordConsentResult {
  ok: boolean;
  inserted: number;
  deduped: number;
}

export const recordConsent = async (
  input: RecordConsentInput,
): Promise<RecordConsentResult> => {
  const { data, error } = await supabase.functions.invoke("record-consent", {
    body: {
      source: input.source,
      disclosureText: input.disclosureText,
      disclosureVersion: input.disclosureVersion,
      scopes: input.scopes,
      phone: input.phone ?? null,
      email: input.email ?? null,
      countryCode: input.countryCode ?? null,
      userId: input.userId ?? null,
      eventId: input.eventId ?? null,
    },
  });
  if (error) {
    return { ok: false, inserted: 0, deduped: 0 };
  }
  const payload = (data ?? {}) as { inserted?: number; deduped?: number };
  return {
    ok: true,
    inserted: payload.inserted ?? 0,
    deduped: payload.deduped ?? 0,
  };
};
