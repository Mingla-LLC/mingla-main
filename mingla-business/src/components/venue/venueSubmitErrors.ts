/**
 * #4490 click-test D11 — every add-venue submit error in plain words, with a
 * way forward. A raw server code (`invalid_cover_media_triplet`) never
 * reaches the host. `step` names the wizard step that fixes it, when one does.
 */
import { sanitizeAuthoringError } from "../../utils/sanitizeAuthoringError";

export interface VenueSubmitErrorCopy {
  message: string;
  /** Create-wizard step id that fixes it ("s4" = Cover), or null. */
  step: string | null;
  /** Button label for that step. */
  fixLabel: string | null;
}

const RETRY =
  "We couldn't submit your venue. Everything you entered is saved here, so submit again. If it keeps happening, message Mingla support.";

function rawText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error !== null && typeof error === "object") {
    const e = error as { message?: unknown; code?: unknown; details?: unknown };
    return [e.message, e.code, e.details].filter((x) => typeof x === "string").join(" ");
  }
  return typeof error === "string" ? error : "";
}

const RULES: readonly { test: RegExp; copy: VenueSubmitErrorCopy }[] = [
  {
    test: /cover_media|cover.*(triplet|poster|stable preview)|Choose a cover/i,
    copy: {
      message: "Your cover couldn't be saved. Pick your cover again, then submit.",
      step: "s4",
      fixLabel: "Go to Cover",
    },
  },
  {
    test: /hours_|missing_hour_index|brand_hours|windows_(invalid|overlap)/i,
    copy: {
      message: "Your opening hours need a fix. Check them, then submit.",
      step: "s2",
      fixLabel: "Go to Hours",
    },
  },
  {
    test: /contact_phone|phone_invalid|invalid_phone/i,
    copy: { message: "Check the phone number, then submit.", step: "s5", fixLabel: "Go to Contact" },
  },
  {
    test: /contact_email|email_invalid|invalid_email/i,
    copy: { message: "Check the email address, then submit.", step: "s5", fixLabel: "Go to Contact" },
  },
  {
    test: /price|discovery_range|range_invalid/i,
    copy: { message: "Check your price range, then submit.", step: "s7", fixLabel: "Go to Price" },
  },
  {
    test: /address|coordinates|lat_lng|location_invalid/i,
    copy: { message: "We couldn't place your address. Check it, then submit.", step: "s0", fixLabel: "Go to Address" },
  },
  {
    test: /invalid_venue_category|venue_category/i,
    copy: {
      message: "Pick what kind of place it is again: close this and start Add a venue once more.",
      step: null,
      fixLabel: null,
    },
  },
  {
    test: /not_authori[sz]ed|forbidden|permission denied|42501|insufficient_brand_role/i,
    copy: {
      message: "Only brand owners and admins can add a venue. Ask one of them to add it, or to raise your role.",
      step: null,
      fixLabel: null,
    },
  },
  {
    test: /already (claimed|listed)|place_claim_conflict|duplicate key|23505/i,
    copy: {
      message: "This place is already on Mingla under another brand. Message Mingla support and we'll sort it out.",
      step: null,
      fixLabel: null,
    },
  },
  {
    test: /failed to fetch|network request failed|networkerror|timeout|offline/i,
    copy: {
      message: "The connection dropped. Everything you entered is saved here, so submit again.",
      step: null,
      fixLabel: null,
    },
  },
];

/**
 * `scrubbed` is the caller's `sanitizeAuthoringError` result (ORCH-1218: the
 * wizard scrubs every pipeline error itself); used for codes no rule names.
 */
export function venueSubmitErrorCopy(error: unknown, scrubbed?: string): VenueSubmitErrorCopy {
  const raw = rawText(error);
  // The geocoding branch already speaks plain words.
  if (/Google location/.test(raw)) return { message: raw, step: "s0", fixLabel: "Go to Address" };
  for (const rule of RULES) {
    if (rule.test.test(raw)) return rule.copy;
  }
  const safe = scrubbed ?? sanitizeAuthoringError(error, RETRY);
  // A code-shaped string (no spaces, or snake_case) is never shown.
  if (safe.length === 0 || !/\s/.test(safe.trim()) || /[a-z]+_[a-z_]+/.test(safe)) {
    return { message: RETRY, step: null, fixLabel: null };
  }
  return { message: safe, step: null, fixLabel: null };
}
