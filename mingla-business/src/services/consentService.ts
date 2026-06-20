/**
 * META-ORCH-1161 Sub-A.2 (consent-capture slice) — buyer-checkout consent writer.
 *
 * Calls the shared `record-consent` edge function (verify_jwt=false, anon-tolerant)
 * to append the bundled-mandatory consent audit rows (DEC-186). One call writes a
 * transactional AND a marketing `consent_records` row per provided channel/contact;
 * the EXACT §1b disclosure string is recorded VERBATIM server-side, and ip_hash is
 * computed from the request IP by the edge fn (never sent from the client).
 *
 * Non-blocking by contract at the call site: the buyer's purchase MUST NOT be
 * blocked by a consent-audit write failure (the affirmative checkbox act already
 * happened); the caller logs the error but proceeds. The legal record is the
 * primary artifact, but losing it must not deadlock checkout — surfaced via the
 * returned result so the caller can log/monitor.
 */

import { supabase } from "./supabase";

export interface RecordConsentInput {
  source: "checkout" | "onboarding";
  /** EXACT §1b disclosure string the buyer saw (CONSENT_DISCLOSURE_TEXT). */
  disclosureText: string;
  /** Pins the disclosure wording version (DISCLOSURE_VERSION). */
  disclosureVersion: string;
  /** E.164 phone — produces the 'sms' consent rows. */
  phone?: string | null;
  /** Email — produces the 'email' consent rows. */
  email?: string | null;
  /** ISO-2 buyer country derived from the phone country at checkout. */
  countryCode?: string | null;
  /** The authenticated user id, when present (anon checkout = null). */
  userId?: string | null;
}

export interface RecordConsentResult {
  ok: boolean;
  inserted: number;
  deduped: number;
}

/**
 * Records the bundled consent grant. Returns the write result; on failure it
 * returns ok=false rather than throwing, so the caller can proceed with the
 * purchase (the checkbox act already constitutes consent) while logging the gap.
 */
export const recordConsent = async (
  input: RecordConsentInput,
): Promise<RecordConsentResult> => {
  const { data, error } = await supabase.functions.invoke("record-consent", {
    body: {
      source: input.source,
      disclosureText: input.disclosureText,
      disclosureVersion: input.disclosureVersion,
      phone: input.phone ?? null,
      email: input.email ?? null,
      countryCode: input.countryCode ?? null,
      userId: input.userId ?? null,
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
