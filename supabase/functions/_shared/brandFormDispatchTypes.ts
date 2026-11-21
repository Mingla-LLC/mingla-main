// The slice of notify-dispatch's request and response that the form-request
// reminder path uses. It lives here, with no imports, so notify-reminders and
// brandFormRequests.ts can name the shapes without reaching notifyV2.ts (and
// with it the delivery adapters and their secrets). The audit walks even
// `import type` edges. A test checks these stay assignable to notifyV2's types.

export interface FormDispatchInput {
  user_id?: string | null;
  contact?: string | null;
  category_key: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  country_code?: string | null;
  deep_link?: string | null;
  requested_channel?: "inapp" | "push" | "email" | "sms" | null;
  email_cta?: { label: string; url: string; note: string };
}

export interface FormDispatchResult {
  success: boolean;
  duplicate?: boolean;
  notificationId?: string | null;
  deliveries?: Array<
    {
      channel: string;
      status: string;
      providerMessageId: string | null;
      segments?: number;
    }
  >;
  reason?: string;
}
