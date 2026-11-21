// #4514 wave 3: the link page's one-time code (C2, decision 12), as two actions on
// brand-form-submit. A code is asked only on the web, only to see or change an
// existing answer, or after automatic recognition ends (30 days). It goes to the
// contact on file of the link's person; the client never names an address.
//
//   {op:"code_begin",  formId, token, channel?}            → {ok, challengeId, channel, sentTo, otherChannel}
//   {op:"code_verify", formId, token, challengeId, code}   → {ok, challengeId}
//
// Rails reused, nothing new: public.contact_challenges (#4063) through
// brand_form_code_begin / brand_form_code_challenge / brand_form_code_settle (the
// settle is #4063's, behind a purpose and link check), the #4063 email code
// template and the existing SMS verify service. Limits: 3 codes per link per 10
// min, 10 per address, 20 per contact per day and the #4063 per-phone limit (SQL);
// 5 sends and 10 checks per address per 10 min (edge, the existing per-scope
// limiter); 5 tries per code (the #4063 settle). Email code digests use a salt
// derived from the platform service key (#3201 derivation), so no new secret.
//
// The token arrives in the POST body only (the page reads it from the URL
// fragment). Logs carry the outcome only: never a token, a code or a contact.

import {
  contactCodeHash,
  generateContactCode,
} from "../_shared/contactCode.ts";
import {
  deriveScopedSecret,
  type ScopedSecretRootEnv,
} from "../_shared/derivedSecret.ts";

export const CODE_SALT_LABEL = "brand-form-code-digest";
export const CODE_SEND_PER_IP_10MIN = 5;
export const CODE_CHECK_PER_IP_10MIN = 10;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[0-9a-f]{64}$/;
const OTP_RE = /^\d{6}$/;

export type CodeChannel = "email" | "phone";

export type CodeErrorCode =
  | "bad_request"
  | "link_invalid"
  | "no_contact"
  | "rate_limited"
  | "send_failed"
  | "bad_code"
  | "expired"
  | "locked"
  | "code_invalid"
  | "forms_paused"
  | "unavailable";

export const CODE_ERROR_STATUS: Readonly<Record<CodeErrorCode, number>> = {
  bad_request: 400,
  link_invalid: 403,
  no_contact: 409,
  rate_limited: 429,
  send_failed: 502,
  bad_code: 400,
  expired: 410,
  locked: 429,
  code_invalid: 400,
  forms_paused: 503,
  unavailable: 503,
};

export type CodeRequest =
  | {
    op: "code_begin";
    formId: string;
    token: string;
    channel: CodeChannel | null;
  }
  | {
    op: "code_verify";
    formId: string;
    token: string;
    challengeId: string;
    code: string;
  };

type RpcResult = { data: unknown; error: { message?: string } | null };

export interface CodeDeps {
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  /** The existing per-scope limiter; true when the call is allowed. */
  allow(
    scope: string,
    limit: number,
  ): Promise<"allow" | "limited" | "unavailable">;
  sendEmail(
    target: string,
    code: string,
    challengeId: string,
  ): Promise<boolean>;
  startPhone(
    phone: string,
  ): Promise<
    { ok: true } | {
      ok: false;
      error: "rate_limited" | "unavailable" | "invalid";
    }
  >;
  checkPhone(
    phone: string,
    code: string,
  ): Promise<
    | { ok: true; approved: boolean }
    | { ok: false; error: "expired" | "unavailable" | "invalid" }
  >;
  /** The email-code digest salt; defaults to the service-key-derived one. */
  codeSalt?: () => Promise<string>;
  log?: (line: string) => void;
}

export function isCodeOp(raw: unknown): boolean {
  return !!raw && typeof raw === "object" && !Array.isArray(raw) &&
    ((raw as Record<string, unknown>).op === "code_begin" ||
      (raw as Record<string, unknown>).op === "code_verify");
}

export function parseCodeRequest(raw: unknown): CodeRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const keys = Object.keys(r);
  if (typeof r.formId !== "string" || !UUID_RE.test(r.formId)) return null;
  if (typeof r.token !== "string" || !TOKEN_RE.test(r.token)) return null;
  if (r.op === "code_begin") {
    if (keys.some((k) => !["op", "formId", "token", "channel"].includes(k))) {
      return null;
    }
    if (
      r.channel !== undefined && r.channel !== null && r.channel !== "email" &&
      r.channel !== "phone"
    ) return null;
    return {
      op: "code_begin",
      formId: r.formId.toLowerCase(),
      token: r.token,
      channel: (r.channel as CodeChannel | undefined) ?? null,
    };
  }
  if (r.op === "code_verify") {
    if (
      keys.some((k) =>
        !["op", "formId", "token", "challengeId", "code"].includes(k)
      )
    ) return null;
    if (typeof r.challengeId !== "string" || !UUID_RE.test(r.challengeId)) {
      return null;
    }
    if (typeof r.code !== "string") return null;
    return {
      op: "code_verify",
      formId: r.formId.toLowerCase(),
      token: r.token,
      challengeId: r.challengeId.toLowerCase(),
      code: r.code.trim(),
    };
  }
  return null;
}

/** "s•••@example.com"; never the whole address. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}

/** "•••• 0104"; never the whole number. */
export function maskPhone(phone: string): string {
  return `•••• ${phone.slice(-4)}`;
}

export function defaultCodeSalt(env?: ScopedSecretRootEnv): Promise<string> {
  return deriveScopedSecret(CODE_SALT_LABEL, env);
}

async function digestFor(
  deps: CodeDeps,
  challengeId: string,
  code: string,
): Promise<string> {
  const salt = await (deps.codeSalt ?? (() => defaultCodeSalt()))();
  if (!salt) throw new Error("code_salt_unavailable");
  return await contactCodeHash(
    new TextEncoder().encode(salt),
    challengeId,
    code,
  );
}

function asObject(data: unknown): Record<string, unknown> {
  const value = Array.isArray(data) ? data[0] : data;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export type CodeResult =
  | { status: 200; body: Record<string, unknown> }
  | {
    status: number;
    body: { ok: false; error: CodeErrorCode; attemptsLeft?: number };
  };

function refuse(
  error: CodeErrorCode,
  extra: { attemptsLeft?: number } = {},
): CodeResult {
  return {
    status: CODE_ERROR_STATUS[error],
    body: { ok: false, error, ...extra },
  };
}

/**
 * The two code actions. `ipHash` is the caller's salted address hash (the same
 * one the submit path counts with).
 */
export async function handleCodeRequest(
  req: CodeRequest,
  ipHash: string,
  deps: CodeDeps,
): Promise<CodeResult> {
  const log = deps.log ?? ((l: string) => console.log(l));
  if (req.op === "code_begin") {
    const gate = await deps.allow(
      `bf_code_send:${ipHash}`,
      CODE_SEND_PER_IP_10MIN,
    );
    if (gate !== "allow") {
      return refuse(gate === "limited" ? "rate_limited" : "unavailable");
    }
    const resolved = await deps.rpc("brand_form_link_resolve", {
      p_token: req.token,
    });
    if (resolved.error) return refuse("unavailable");
    const link = asObject(resolved.data);
    if (link.outcome !== "ok" || link.formId !== req.formId) {
      log(`[brand-form-submit] code_begin refused=link_invalid`);
      return refuse("link_invalid");
    }
    const channels = Array.isArray(link.channels)
      ? (link.channels as unknown[]).filter((c): c is CodeChannel =>
        c === "email" || c === "phone"
      )
      : [];
    const channel = req.channel ?? channels[0] ?? null;
    if (channel === null || !channels.includes(channel)) {
      return refuse("no_contact");
    }
    const challengeId = crypto.randomUUID();
    const code = channel === "email" ? generateContactCode() : "";
    const codeHash = channel === "email"
      ? await digestFor(deps, challengeId, code)
      : null;
    const begun = await deps.rpc("brand_form_code_begin", {
      p_challenge_id: challengeId,
      p_token: req.token,
      p_channel: channel,
      p_code_hash: codeHash,
      p_ip_hash: ipHash,
    });
    if (begun.error) return refuse("unavailable");
    const started = asObject(begun.data);
    if (started.outcome === "rate_limited") return refuse("rate_limited");
    if (started.outcome === "no_email" || started.outcome === "no_phone") {
      return refuse("no_contact");
    }
    if (started.outcome !== "started" || typeof started.target !== "string") {
      return refuse("link_invalid");
    }
    const target = started.target;
    if (channel === "email") {
      if (!(await deps.sendEmail(target, code, challengeId))) {
        log(`[brand-form-submit] code_begin send_failed channel=email`);
        return refuse("send_failed");
      }
    } else {
      const sent = await deps.startPhone(target);
      if (!sent.ok) {
        log(`[brand-form-submit] code_begin send_failed channel=phone`);
        return refuse(
          sent.error === "rate_limited" ? "rate_limited" : "send_failed",
        );
      }
    }
    log(`[brand-form-submit] code_begin started channel=${channel}`);
    return {
      status: 200,
      body: {
        ok: true,
        challengeId,
        channel,
        sentTo: channel === "email" ? maskEmail(target) : maskPhone(target),
        otherChannel: channels.some((c) => c !== channel),
      },
    };
  }

  // code_verify
  if (!OTP_RE.test(req.code)) return refuse("bad_request");
  const gate = await deps.allow(
    `bf_code_check:${ipHash}`,
    CODE_CHECK_PER_IP_10MIN,
  );
  if (gate !== "allow") {
    return refuse(gate === "limited" ? "rate_limited" : "unavailable");
  }
  // Purpose and link isolation: only a brand form challenge of THIS link resolves.
  const looked = await deps.rpc("brand_form_code_challenge", {
    p_challenge_id: req.challengeId,
    p_token: req.token,
  });
  if (looked.error) return refuse("unavailable");
  const challenge = asObject(looked.data);
  if (
    challenge.outcome !== "ok" || challenge.formId !== req.formId ||
    (challenge.channel !== "email" && challenge.channel !== "phone") ||
    typeof challenge.target !== "string"
  ) {
    log(`[brand-form-submit] code_verify refused=code_invalid`);
    return refuse("code_invalid");
  }
  let approved = false;
  let codeHash: string | null = null;
  if (challenge.channel === "phone") {
    const checked = await deps.checkPhone(challenge.target, req.code);
    if (!checked.ok) {
      return refuse(checked.error === "expired" ? "expired" : "unavailable");
    }
    approved = checked.approved;
  } else {
    codeHash = await digestFor(deps, req.challengeId, req.code);
  }
  const settled = await deps.rpc("brand_form_code_settle", {
    p_challenge_id: req.challengeId,
    p_token: req.token,
    p_code_hash: codeHash,
    p_provider_approved: approved,
  });
  if (settled.error) return refuse("unavailable");
  const outcome = asObject(settled.data);
  log(`[brand-form-submit] code_verify outcome=${String(outcome.outcome)}`);
  if (outcome.outcome === "ok") {
    return { status: 200, body: { ok: true, challengeId: req.challengeId } };
  }
  if (outcome.outcome === "bad_code") {
    const left = Number(outcome.attemptsLeft);
    return refuse(
      "bad_code",
      Number.isFinite(left) ? { attemptsLeft: left } : {},
    );
  }
  if (outcome.outcome === "expired") return refuse("expired");
  if (outcome.outcome === "locked") return refuse("locked");
  return refuse("code_invalid");
}
