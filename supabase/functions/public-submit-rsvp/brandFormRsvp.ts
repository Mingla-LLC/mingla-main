// #4541 — the RSVP-specific brand-form envelope. The RSVP edge owns only
// shape/error mapping; the database wrapper owns attachment, version,
// requirement and atomic-write decisions.

import {
  BRAND_FORM_RSVP_STEP,
  type BrandFormAnswers,
  unstorableAnswerErrors,
} from "../_shared/brandFormsContract.ts";

export interface RsvpBrandForm {
  capable: boolean;
  form: { formId: string; versionId: string; answers: BrandFormAnswers } | null;
}

export type RsvpBrandFormRefusal = {
  status: number;
  body: Record<string, unknown>;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORM_KEYS = new Set(["formId", "versionId", "answers"]);

export function parseRsvpBrandForm(
  body: Record<string, unknown>,
): RsvpBrandForm | RsvpBrandFormRefusal {
  const capable = body.brandFormStep === BRAND_FORM_RSVP_STEP;
  if (body.brandFormStep !== undefined && !capable) {
    return {
      status: 400,
      body: { error: "rsvp_payload_invalid", detail: "brand_form_step_invalid" },
    };
  }
  const raw = body.brandForm;
  if (raw === undefined || raw === null) return { capable, form: null };
  if (!capable || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      status: 400,
      body: { error: "rsvp_payload_invalid", detail: "brand_form_invalid" },
    };
  }
  const r = raw as Record<string, unknown>;
  if (
    Object.keys(r).some((key) => !FORM_KEYS.has(key)) ||
    typeof r.formId !== "string" || !UUID_RE.test(r.formId) ||
    typeof r.versionId !== "string" || !UUID_RE.test(r.versionId) ||
    !r.answers || typeof r.answers !== "object" || Array.isArray(r.answers)
  ) {
    return {
      status: 400,
      body: { error: "rsvp_payload_invalid", detail: "brand_form_invalid" },
    };
  }
  const answers = r.answers as BrandFormAnswers;
  // Unstorable text is dropped here, never refused: the database decides
  // whether the form is required (refuse with form_answers_required) or
  // optional (the RSVP saves and the guest stays "to answer").
  if (unstorableAnswerErrors(answers).length > 0) {
    return { capable, form: null };
  }
  return {
    capable,
    form: {
      formId: r.formId.toLowerCase(),
      versionId: r.versionId.toLowerCase(),
      answers,
    },
  };
}

export function isRsvpBrandFormRefusal(
  value: RsvpBrandForm | RsvpBrandFormRefusal,
): value is RsvpBrandFormRefusal {
  return (value as RsvpBrandFormRefusal).status !== undefined;
}

function detailValue(details: string | null | undefined): unknown {
  if (!details) return null;
  try {
    return JSON.parse(details);
  } catch {
    return null;
  }
}

export function rsvpBrandFormRefusal(error: {
  message?: string | null;
  details?: string | null;
}): RsvpBrandFormRefusal | null {
  const code = (error.message ?? "").trim().split(/[\s:]/)[0] ?? "";
  const details = detailValue(error.details);
  if (code === "form_changed") {
    const detail = details && typeof details === "object" && !Array.isArray(details)
      ? details as Record<string, unknown>
      : {};
    return {
      status: 409,
      body: {
        error: code,
        formId: detail.formId ?? null,
        versionId: detail.versionId ?? null,
      },
    };
  }
  if (code === "form_answers_required") {
    const detail = details && typeof details === "object" && !Array.isArray(details)
      ? details as Record<string, unknown>
      : {};
    return {
      status: 422,
      body: {
        error: code,
        formId: detail.formId ?? null,
        versionId: detail.versionId ?? null,
      },
    };
  }
  if (code === "form_answers_invalid") {
    return {
      status: 422,
      body: {
        error: code,
        errors: Array.isArray(details)
          ? details
          : [{ questionId: null, code: "type" }],
      },
    };
  }
  return null;
}

/** #4541 R1.3: the after-RSVP hand-off the success view opens, or null. */
export interface RsvpBrandFormHandoff {
  formId: string;
  token: string;
}

export interface HandoffRpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string | null } | null }>;
}

const TOKEN_RE = /^[0-9a-f]{64}$/;

/**
 * #4541 R1.3: after a committed, current RSVP (approved Going or Maybe) on a
 * page whose form is asked "after they RSVP", a personal link for this RSVP,
 * minted by brand_form_rsvp_handoff_link in its own call (no RSVP lock). Pending
 * approval and waitlisted RSVPs get none: their card picks it up once approved.
 * A failure never fails the RSVP: it is logged and the hand-off is null.
 */
export async function rsvpBrandFormHandoff(
  admin: HandoffRpcClient,
  args: {
    rsvpId: string | null | undefined;
    eventId: string;
    status: string | null | undefined;
    approvalStatus: string | null | undefined;
  },
  log: (line: string) => void = (line) => console.error(line),
): Promise<RsvpBrandFormHandoff | null> {
  if (
    typeof args.rsvpId !== "string" ||
    (args.status !== "going" && args.status !== "maybe") ||
    args.approvalStatus !== "approved"
  ) return null;
  try {
    const { data, error } = await admin.rpc("brand_form_rsvp_handoff_link", {
      p_rsvp_id: args.rsvpId,
      p_event_id: args.eventId,
    });
    if (error) {
      log("[public-submit-rsvp] handoff_skipped");
      return null;
    }
    const d = data && typeof data === "object" && !Array.isArray(data)
      ? data as Record<string, unknown>
      : {};
    if (
      d.outcome === "link" && typeof d.formId === "string" &&
      UUID_RE.test(d.formId) && typeof d.token === "string" &&
      TOKEN_RE.test(d.token)
    ) {
      return { formId: d.formId, token: d.token };
    }
    return null;
  } catch {
    log("[public-submit-rsvp] handoff_skipped");
    return null;
  }
}
