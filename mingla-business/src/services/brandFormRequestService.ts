/**
 * #4514 wave 4 — "Ask guests to answer", "Remind" and the automatic reminder
 * switch. The edge (guest-roster-actions form operations) checks the role
 * (event manager and up, C5), throttles each guest per form for 24 hours and
 * mints each guest's own form link; a request never creates an invite
 * (decision 17). Loaded only by the lazy forms owner; no module-scope client.
 */

export type FormRequestChannel = "push" | "sms" | "email";
export type FormRequestKind = "ask" | "remind";
export type FormRequestAudience = "unanswered" | "everyone";

export interface FormRequestSubject {
  kind: "rsvp" | "order";
  id: string;
}

export interface FormRequestInput {
  formId: string;
  eventId: string;
  kind: FormRequestKind;
  audience: FormRequestAudience;
  channels: FormRequestChannel[];
  /** Named guests (the answers drawer); absent: everyone on the page in the audience. */
  subjects?: FormRequestSubject[];
}

export interface FormRequestPreview {
  selectedCount: number;
  reachableCount: number;
  throttledCount: number;
  smsOptedOutCount: number;
  unreachableCount: number;
  perChannelReachable: Record<FormRequestChannel, number>;
  smsCount: number;
  /** null: some texts go to a country without a price yet (never a guessed amount). */
  estimatedCostMinor: number | null;
  currency: string | null;
}

export interface FormRequestResult {
  sent: number;
  failed: number;
  throttled: number;
  answered: number;
  unreachable: number;
}

export type FormRequestErrorCode =
  | "forbidden"
  | "form_closed"
  | "form_not_live"
  | "form_not_on_event"
  | "audience_too_large"
  | "no_recipients"
  | "preview_stale_cost"
  | "network_error"
  | "invalid_response"
  | "unknown";

export class FormRequestError extends Error {
  public readonly code: FormRequestErrorCode;
  public constructor(code: FormRequestErrorCode, message: string) {
    super(message);
    this.name = "FormRequestError";
    this.code = code;
  }
}

const ERROR_COPY: Record<FormRequestErrorCode, string> = {
  forbidden: "Your role doesn't include this action. Ask an event manager or above.",
  form_closed: "This form is closed. Reopen it to ask guests.",
  form_not_live: "Publish the form before asking guests.",
  form_not_on_event: "This form is no longer on this page. Reload.",
  audience_too_large: "That's more than 500 guests. Ask from the guest list in smaller groups.",
  no_recipients: "Nobody here can be reached right now.",
  preview_stale_cost: "The cost changed. Check the new estimate and send again.",
  network_error: "Couldn't reach Mingla. Check your connection and try again.",
  invalid_response: "Something went wrong reading the reply. Try again.",
  unknown: "Couldn't send. Try again.",
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const getSupabase = async () => (await import("./supabase")).supabase;

function codeOf(value: unknown): FormRequestErrorCode {
  const code = isRecord(value) && typeof value.code === "string" ? value.code : "";
  return code in ERROR_COPY ? (code as FormRequestErrorCode) : "unknown";
}

async function invoke(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.functions.invoke("guest-roster-actions", { body });
  if (error !== null) {
    // A non-2xx reply carries the code in its body; read it, never guess.
    const context: unknown = (error as { context?: unknown }).context;
    let payload: unknown = null;
    if (context instanceof Response) {
      try {
        payload = await context.json();
      } catch {
        payload = null;
      }
    }
    const code = payload === null ? "network_error" : codeOf(payload);
    throw new FormRequestError(code, ERROR_COPY[code]);
  }
  if (!isRecord(data) || data.ok !== true) {
    const code = codeOf(data);
    throw new FormRequestError(code, ERROR_COPY[code]);
  }
  return data;
}

export function parseFormRequestPreview(data: Record<string, unknown>): FormRequestPreview {
  const per = isRecord(data.perChannelReachable) ? data.perChannelReachable : {};
  return {
    selectedCount: num(data.selectedCount),
    reachableCount: num(data.reachableCount),
    throttledCount: num(data.throttledCount),
    smsOptedOutCount: num(data.smsOptedOutCount),
    unreachableCount: num(data.unreachableCount),
    perChannelReachable: { push: num(per.push), sms: num(per.sms), email: num(per.email) },
    smsCount: num(data.smsCount),
    estimatedCostMinor: typeof data.estimatedCostMinor === "number" ? data.estimatedCostMinor : null,
    currency: typeof data.currency === "string" ? data.currency : null,
  };
}

const requestBody = (input: FormRequestInput): Record<string, unknown> => ({
  eventId: input.eventId,
  formId: input.formId,
  kind: input.kind,
  // Remind reaches only people who have not answered.
  audience: input.kind === "remind" ? "unanswered" : input.audience,
  channels: [...input.channels].sort(),
  ...(input.subjects !== undefined && input.subjects.length > 0 ? { subjects: input.subjects } : {}),
});

export async function previewFormRequest(input: FormRequestInput): Promise<FormRequestPreview> {
  return parseFormRequestPreview(await invoke({ operation: "form_preview", ...requestBody(input) }));
}

export async function sendFormRequest(
  input: FormRequestInput & { expectedCostMinor: number | null; currency: string | null },
): Promise<FormRequestResult> {
  const data = await invoke({
    operation: "form_send",
    ...requestBody(input),
    expectedCostMinor: input.expectedCostMinor,
    currency: input.currency,
  });
  const skipped = isRecord(data.skipped) ? data.skipped : {};
  return {
    sent: num(data.sent),
    failed: num(data.failed),
    throttled: num(skipped.throttled),
    answered: num(skipped.answered),
    unreachable: num(skipped.unreachable),
  };
}

export async function setFormAutoRemind(input: {
  attachmentId: string;
  on: boolean;
  channels: FormRequestChannel[];
}): Promise<{ autoRemind: boolean; remindAt: string | null }> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("biz_brand_form_set_auto_remind", {
    p_attachment_id: input.attachmentId,
    p_on: input.on,
    p_channels: [...input.channels].sort(),
  });
  if (error !== null) {
    const code: FormRequestErrorCode = error.code === "42501" ? "forbidden" : error.code === "PT409" ? "form_not_on_event" : "unknown";
    throw new FormRequestError(code, code === "unknown" ? "Couldn't change the reminder. Try again." : ERROR_COPY[code]);
  }
  if (!isRecord(data)) throw new FormRequestError("invalid_response", ERROR_COPY.invalid_response);
  return {
    autoRemind: data.autoRemind === true,
    remindAt: typeof data.remindAt === "string" ? data.remindAt : null,
  };
}
