/**
 * META-ORCH-1161 Sub-A.2 (consent-capture slice) — onboarding consent writer.
 *
 * Calls the shared `record-consent` edge function to append the bundled-mandatory
 * consent audit rows at signup (DEC-186, source='onboarding'). One call writes a
 * transactional AND a marketing `consent_records` row per provided channel/contact;
 * the EXACT §1b disclosure string (CONSENT_DISCLOSURE_TEXT) is recorded VERBATIM.
 *
 * Non-blocking by contract at the call site: a failed consent-audit write MUST NOT
 * block the user finishing onboarding (the affirmative checkbox act already
 * happened). The caller proceeds and logs the gap.
 */

import { supabase } from "./supabase";

export interface RecordConsentInput {
  source: "onboarding" | "checkout";
  /** EXACT §1b disclosure string the user saw (CONSENT_DISCLOSURE_TEXT). */
  disclosureText: string;
  /** Pins the disclosure wording version (DISCLOSURE_VERSION). */
  disclosureVersion: string;
  /** E.164 phone — produces the 'sms' consent rows. */
  phone?: string | null;
  /** Email — produces the 'email' consent rows. */
  email?: string | null;
  /** ISO-2 country at grant (the phone country at onboarding). */
  countryCode?: string | null;
  /** The just-created user id. */
  userId?: string | null;
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
