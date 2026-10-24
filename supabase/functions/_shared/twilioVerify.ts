const TWILIO_VERIFY_BASE = "https://verify.twilio.com/v2/Services";
const E164_PATTERN = /^\+[1-9]\d{1,14}$/;
const CODE_PATTERN = /^\d{6}$/;

type TwilioPayload = {
  code?: number;
  status?: string;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type TwilioVerificationStartResult =
  | { ok: true; status: string }
  | { ok: false; error: "invalid" | "rate_limited" | "unavailable" };

export type TwilioVerificationCheckResult =
  | { ok: true; approved: boolean; status: string }
  | { ok: false; error: "invalid" | "expired" | "unavailable" };

type TwilioVerifyDependencies = {
  fetchImpl?: FetchLike;
};

function credentials(): {
  accountSid: string;
  authToken: string;
  serviceSid: string;
} | null {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")?.trim() ?? "";
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")?.trim() ?? "";
  const serviceSid = Deno.env.get("TWILIO_VERIFY_SERVICE_SID")?.trim() ?? "";
  if (!accountSid || !authToken || !serviceSid) return null;
  return { accountSid, authToken, serviceSid };
}

async function postVerify(
  path: "Verifications" | "VerificationCheck",
  body: URLSearchParams,
  deps: TwilioVerifyDependencies,
): Promise<{ response: Response; payload: TwilioPayload } | null> {
  const config = credentials();
  if (!config) return null;

  try {
    const response = await (deps.fetchImpl ?? fetch)(
      `${TWILIO_VERIFY_BASE}/${encodeURIComponent(config.serviceSid)}/${path}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Basic ${
            btoa(`${config.accountSid}:${config.authToken}`)
          }`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );
    const payload = await response.json().catch(() => ({})) as TwilioPayload;
    return { response, payload };
  } catch {
    return null;
  }
}

/**
 * Starts an SMS-only Twilio Verify challenge.
 *
 * This shared claim flow deliberately has no store-review bypass and never
 * writes an account identity. The caller owns rate limits and persistence.
 */
export async function startVerification(
  phone: string,
  deps: TwilioVerifyDependencies = {},
): Promise<TwilioVerificationStartResult> {
  if (!E164_PATTERN.test(phone)) return { ok: false, error: "invalid" };

  const result = await postVerify(
    "Verifications",
    new URLSearchParams({ To: phone, Channel: "sms" }),
    deps,
  );
  if (!result) return { ok: false, error: "unavailable" };
  if (!result.response.ok) {
    if (result.response.status === 429 || result.payload.code === 60203) {
      return { ok: false, error: "rate_limited" };
    }
    return { ok: false, error: "unavailable" };
  }

  return { ok: true, status: result.payload.status ?? "pending" };
}

/** Checks a six-digit code without mutating Mingla account identity state. */
export async function checkVerification(
  phone: string,
  code: string,
  deps: TwilioVerifyDependencies = {},
): Promise<TwilioVerificationCheckResult> {
  if (!E164_PATTERN.test(phone) || !CODE_PATTERN.test(code)) {
    return { ok: false, error: "invalid" };
  }

  const result = await postVerify(
    "VerificationCheck",
    new URLSearchParams({ To: phone, Code: code }),
    deps,
  );
  if (!result) return { ok: false, error: "unavailable" };
  if (!result.response.ok) {
    if (result.response.status === 404 || result.payload.code === 60200) {
      return { ok: false, error: "expired" };
    }
    return { ok: false, error: "unavailable" };
  }

  const status = result.payload.status ?? "pending";
  return { ok: true, approved: status === "approved", status };
}
