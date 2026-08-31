import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailAdapter } from "../_shared/adapters/emailAdapter.ts";
import { smsAdapter } from "../_shared/adapters/smsAdapter.ts";
import {
  createSixDigitCode,
  erasureSecretDiagnostic,
  ErasureTemporarilyUnavailable,
  hmacChallenge,
  resolveErasureChallengeKey,
} from "./erasureContract.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CASE_REFERENCE = /^[A-Z0-9][A-Z0-9._/-]{2,79}$/;
const CODE = /^[0-9]{6}$/;
const MAX_BODY_BYTES = 8 * 1024;
const ALLOWED_ORIGINS = new Set([
  "https://host.usemingla.com",
  "https://business.usemingla.com",
  "http://localhost:8081",
  "http://localhost:19006",
]);

export type ErasureErrorCode =
  | "erasure_forbidden"
  | "erasure_request_invalid"
  | "erasure_person_not_found"
  | "erasure_linked_user_refused"
  | "erasure_identity_ambiguous"
  | "erasure_contact_invalid"
  | "erasure_challenge_expired"
  | "erasure_challenge_invalid"
  | "erasure_challenge_locked"
  | "erasure_challenge_state_unknown"
  | "erasure_delivery_unavailable"
  | "erasure_idempotency_conflict"
  | "erasure_cleanup_pending"
  | "erasure_temporarily_unavailable";

type RpcResult = { data: unknown; error?: { message?: string } | null };
type SafeDeliveryResult = { status: string; error?: string };
type ClaimOutcome = "not_attempted" | "confirmed" | "denied" | "unknown";

export interface ErasureHandlerDependencies {
  authenticate(authHeader: string): Promise<{ userId: string } | null>;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  resolveKey(): Uint8Array;
  randomUuid(): string;
  randomCode(): string;
  hash(key: Uint8Array, challengeId: string, code: string): Promise<string>;
  sendEmail(input: {
    to: string;
    title: string;
    body: string;
    idempotencyKey: string;
    beforeProviderIo: () => Promise<void>;
  }): Promise<SafeDeliveryResult>;
  sendSms(input: {
    to: string;
    brandName: string;
    message: string;
    beforeProviderIo: () => Promise<void>;
  }): Promise<SafeDeliveryResult>;
  cleanup(paths: string[]): Promise<boolean>;
  diagnostic(value: Readonly<Record<string, string>>): void;
}

function headers(req: Request): HeadersInit {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin":
      origin !== null && ALLOWED_ORIGINS.has(origin)
        ? origin
        : "https://host.usemingla.com",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function response(
  req: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), { status, headers: headers(req) });
}

function errorResponse(
  req: Request,
  code: ErasureErrorCode,
  status: number,
  extra: Record<string, unknown> = {},
): Response {
  return response(req, { error: code, ...extra }, status);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return JSON.stringify(actual) === JSON.stringify(wanted);
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" &&
        !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function safeRpcCode(message: string | undefined): ErasureErrorCode {
  const value = message ?? "";
  if (value.includes("people_support_forbidden")) return "erasure_forbidden";
  if (value.includes("people_idempotency_conflict")) {
    return "erasure_idempotency_conflict";
  }
  if (value.includes("people_erasure_delivery_unknown")) {
    return "erasure_challenge_state_unknown";
  }
  if (value.includes("people_erasure_contact_invalid")) {
    return "erasure_contact_invalid";
  }
  if (value.includes("people_erasure_challenge_not_found")) {
    return "erasure_challenge_invalid";
  }
  if (value.includes("people_erasure_operation_not_found")) {
    return "erasure_person_not_found";
  }
  if (value.includes("people_erasure_refused")) {
    return "erasure_identity_ambiguous";
  }
  if (value.includes("people_erasure_input_invalid")) {
    return "erasure_request_invalid";
  }
  return "erasure_temporarily_unavailable";
}

function errorStatus(code: ErasureErrorCode): number {
  if (code === "erasure_forbidden") return 403;
  if (
    code === "erasure_request_invalid" ||
    code === "erasure_contact_invalid" ||
    code === "erasure_challenge_invalid" ||
    code === "erasure_challenge_expired" ||
    code === "erasure_challenge_locked" ||
    code === "erasure_identity_ambiguous" ||
    code === "erasure_linked_user_refused"
  ) return 400;
  if (code === "erasure_idempotency_conflict") return 409;
  return 503;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return null;
  }
  return [...value] as string[];
}

function defaultDependencies(): ErasureHandlerDependencies {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const service = createClient(url, serviceKey);
  return {
    async authenticate(authHeader) {
      if (!url || !anon || !serviceKey) return null;
      const userClient = createClient(url, anon, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userError } = await userClient.auth
        .getUser();
      if (userError || !user) return null;
      const { data: isStaff, error: staffError } = await userClient.rpc(
        "is_support_staff",
        { p_user_id: user.id },
      );
      if (staffError || isStaff !== true) return null;
      const { error: actorError } = await userClient.rpc(
        "issue_1772_assert_support_actor",
        { p_actor_id: user.id },
      );
      if (actorError) return null;
      return { userId: user.id };
    },
    async rpc(name, args) {
      const { data, error } = await service.rpc(name, args);
      return { data, error };
    },
    resolveKey: () => resolveErasureChallengeKey(),
    randomUuid: () => crypto.randomUUID(),
    randomCode: () => createSixDigitCode(),
    hash: hmacChallenge,
    sendEmail: async (input) => {
      const result = await emailAdapter.send(input);
      return { status: result.status, error: result.error };
    },
    sendSms: async (input) => {
      const result = await smsAdapter.send({
        to: input.to,
        brandName: input.brandName,
        message: input.message,
        messageType: "transactional",
        beforeProviderIo: input.beforeProviderIo,
      });
      return { status: result.status, error: result.error };
    },
    async cleanup(paths) {
      if (paths.length === 0) return true;
      const { error } = await service.storage.from("brand-people-exports")
        .remove(
          paths,
        );
      return !error;
    },
    diagnostic: (value) => console.warn(value),
  };
}

async function finalizeCleanup(
  deps: ErasureHandlerDependencies,
  operationId: string,
  actorId: string,
  paths: string[],
): Promise<boolean> {
  const success = await deps.cleanup(paths).catch(() => false);
  const finalized = await deps.rpc(
    "issue_1772_complete_brand_person_erasure_cleanup",
    {
      p_operation_id: operationId,
      p_actor_id: actorId,
      p_success: success,
      p_safe_code: success ? null : "storage_cleanup_failed",
    },
  );
  return success && !finalized.error;
}

export function createErasureHandler(
  deps: ErasureHandlerDependencies = defaultDependencies(),
): (req: Request) => Promise<Response> {
  return async (req) => {
    const origin = req.headers.get("origin");
    if (origin !== null && !ALLOWED_ORIGINS.has(origin)) {
      return errorResponse(req, "erasure_forbidden", 403);
    }
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: headers(req) });
    }
    if (req.method !== "POST") {
      return errorResponse(req, "erasure_request_invalid", 405);
    }
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse(req, "erasure_forbidden", 403);
    }
    const body = await readBody(req);
    if (!body || typeof body.action !== "string") {
      return errorResponse(req, "erasure_request_invalid", 400);
    }
    const actor = await deps.authenticate(authHeader).catch(() => null);
    if (!actor) return errorResponse(req, "erasure_forbidden", 403);

    if (body.action === "create_challenge") {
      if (
        !exactKeys(body, [
          "action",
          "caseReference",
          "brandId",
          "personId",
          "contactMethodId",
          "clientRequestId",
        ]) ||
        typeof body.caseReference !== "string" ||
        !CASE_REFERENCE.test(body.caseReference) ||
        typeof body.brandId !== "string" || !UUID.test(body.brandId) ||
        typeof body.personId !== "string" || !UUID.test(body.personId) ||
        typeof body.contactMethodId !== "string" ||
        !UUID.test(body.contactMethodId) ||
        typeof body.clientRequestId !== "string" ||
        !UUID.test(body.clientRequestId)
      ) return errorResponse(req, "erasure_request_invalid", 400);

      let key: Uint8Array;
      try {
        key = deps.resolveKey();
      } catch (error) {
        const typed = error instanceof ErasureTemporarilyUnavailable
          ? error
          : new ErasureTemporarilyUnavailable("bundle_invalid_json");
        deps.diagnostic(erasureSecretDiagnostic(typed, "create_challenge"));
        return errorResponse(req, "erasure_temporarily_unavailable", 503);
      }
      const challengeId = deps.randomUuid();
      const code = deps.randomCode();
      const codeHash = await deps.hash(key, challengeId, code);
      const created = await deps.rpc(
        "issue_1772_create_brand_person_erasure_challenge",
        {
          p_challenge_id: challengeId,
          p_client_request_id: body.clientRequestId,
          p_case_reference: body.caseReference,
          p_brand_id: body.brandId,
          p_person_id: body.personId,
          p_contact_method_id: body.contactMethodId,
          p_code_hash: codeHash,
          p_actor_id: actor.userId,
        },
      );
      if (created.error) {
        const safe = safeRpcCode(created.error.message);
        return errorResponse(req, safe, errorStatus(safe));
      }
      const payload = created.data as Record<string, unknown> | null;
      if (payload?.state === "refused") {
        return errorResponse(req, "erasure_identity_ambiguous", 400);
      }
      if (
        !payload || typeof payload.challengeId !== "string" ||
        typeof payload.deliveryState !== "string"
      ) {
        return errorResponse(req, "erasure_temporarily_unavailable", 503);
      }
      if (payload.shouldDispatch === false) {
        if (payload.deliveryState === "sent") {
          return response(req, {
            challengeId: payload.challengeId,
            deliveryState: "sent",
            replayed: true,
          });
        }
        const safe = payload.deliveryState === "failed"
          ? "erasure_delivery_unavailable"
          : "erasure_challenge_state_unknown";
        return errorResponse(req, safe, 503, {
          challengeId: payload.challengeId,
        });
      }
      if (
        payload.shouldDispatch !== true ||
        typeof payload.destination !== "string" ||
        (payload.channel !== "email" && payload.channel !== "phone")
      ) return errorResponse(req, "erasure_temporarily_unavailable", 503);

      const idempotencyKey = `brand-person-erasure:${payload.challengeId}:v1`;
      const title = "Confirm your Mingla privacy request";
      const message =
        `Your Mingla verification code is ${code}. It expires in 15 minutes. If you did not request this, ignore this message.`;
      const claimState: { outcome: ClaimOutcome; deniedState: string | null } =
        {
          outcome: "not_attempted",
          deniedState: null,
        };
      const beforeProviderIo = async (): Promise<void> => {
        let claim: RpcResult;
        try {
          claim = await deps.rpc(
            "issue_1772_claim_erasure_challenge_delivery",
            { p_challenge_id: payload.challengeId, p_actor_id: actor.userId },
          );
        } catch {
          claimState.outcome = "unknown";
          throw new Error("erasure_delivery_claim_unknown");
        }
        const claimData = claim.data as Record<string, unknown> | null;
        if (
          claim.error || !claimData || typeof claimData.claimed !== "boolean" ||
          typeof claimData.deliveryState !== "string"
        ) {
          claimState.outcome = "unknown";
          throw new Error("erasure_delivery_claim_unknown");
        }
        if (
          claimData.claimed === true &&
          claimData.deliveryState === "dispatching"
        ) {
          claimState.outcome = "confirmed";
          return;
        }
        claimState.outcome = "denied";
        claimState.deniedState = claimData.deliveryState;
        throw new Error("erasure_delivery_claim_denied");
      };
      const delivery: SafeDeliveryResult = payload.channel === "email"
        ? await deps.sendEmail({
          to: payload.destination,
          title,
          body:
            `Your Mingla verification code is ${code}.\n\nIt expires in 15 minutes. If you did not request this, ignore this message.`,
          idempotencyKey,
          beforeProviderIo,
        }).catch(() => ({ status: "failed", error: "pre_dispatch_failed" }))
        : await deps.sendSms({
          to: payload.destination,
          brandName: "Mingla",
          message,
          beforeProviderIo,
        }).catch(() => ({ status: "failed", error: "pre_dispatch_failed" }));
      if (claimState.outcome === "denied") {
        if (claimState.deniedState === "sent") {
          return response(req, {
            challengeId: payload.challengeId,
            deliveryState: "sent",
            replayed: true,
          });
        }
        return errorResponse(
          req,
          claimState.deniedState === "failed"
            ? "erasure_delivery_unavailable"
            : "erasure_challenge_state_unknown",
          503,
          { challengeId: payload.challengeId },
        );
      }
      if (claimState.outcome === "unknown") {
        return errorResponse(req, "erasure_challenge_state_unknown", 503, {
          challengeId: payload.challengeId,
        });
      }
      if (claimState.outcome === "not_attempted") {
        const preDispatchSafe = [
            "no_contact",
            "invalid_recipient",
            "country_unresolved",
            "provider_kill_switch_off",
            "ng_operator_embargo",
            "provider_config_missing",
            "provider_protocol_error",
          ].includes(delivery.error ?? "")
          ? delivery.error!
          : "pre_dispatch_failed";
        const finished = await deps.rpc(
          "issue_1772_finish_erasure_challenge_delivery",
          {
            p_challenge_id: payload.challengeId,
            p_actor_id: actor.userId,
            p_state: "failed",
            p_safe_code: preDispatchSafe,
          },
        );
        if (finished.error) {
          return errorResponse(req, "erasure_challenge_state_unknown", 503, {
            challengeId: payload.challengeId,
          });
        }
        return errorResponse(req, "erasure_delivery_unavailable", 503, {
          challengeId: payload.challengeId,
        });
      }
      if (delivery.status === "sent") {
        const finished = await deps.rpc(
          "issue_1772_finish_erasure_challenge_delivery",
          {
            p_challenge_id: payload.challengeId,
            p_actor_id: actor.userId,
            p_state: "sent",
            p_safe_code: null,
          },
        );
        if (finished.error) {
          return errorResponse(req, "erasure_challenge_state_unknown", 503, {
            challengeId: payload.challengeId,
          });
        }
        return response(req, {
          challengeId: payload.challengeId,
          deliveryState: "sent",
          replayed: false,
        });
      }
      const definiteFailure = [
        "provider_config_missing",
        "recipient_opted_out",
        "provider_rejected",
        "provider_rate_limited",
      ].includes(delivery.error ?? "");
      if (definiteFailure) {
        const finished = await deps.rpc(
          "issue_1772_finish_erasure_challenge_delivery",
          {
            p_challenge_id: payload.challengeId,
            p_actor_id: actor.userId,
            p_state: "failed",
            p_safe_code: delivery.error,
          },
        );
        if (finished.error) {
          return errorResponse(req, "erasure_challenge_state_unknown", 503, {
            challengeId: payload.challengeId,
          });
        }
        return errorResponse(req, "erasure_delivery_unavailable", 503, {
          challengeId: payload.challengeId,
        });
      }
      // Claimed but ambiguous: provider_unavailable, provider_protocol_error,
      // timeout, throw, or malformed response remains dispatching. Never finish.
      return errorResponse(req, "erasure_challenge_state_unknown", 503, {
        challengeId: payload.challengeId,
      });
    }

    if (body.action === "execute") {
      if (
        !exactKeys(body, [
          "action",
          "challengeId",
          "code",
          "clientRequestId",
        ]) ||
        typeof body.challengeId !== "string" || !UUID.test(body.challengeId) ||
        typeof body.code !== "string" || !CODE.test(body.code) ||
        typeof body.clientRequestId !== "string" ||
        !UUID.test(body.clientRequestId)
      ) return errorResponse(req, "erasure_request_invalid", 400);
      let key: Uint8Array;
      try {
        key = deps.resolveKey();
      } catch (error) {
        const typed = error instanceof ErasureTemporarilyUnavailable
          ? error
          : new ErasureTemporarilyUnavailable("bundle_invalid_json");
        deps.diagnostic(erasureSecretDiagnostic(typed, "execute"));
        return errorResponse(req, "erasure_temporarily_unavailable", 503);
      }
      const verificationHash = await deps.hash(
        key,
        body.challengeId,
        body.code,
      );
      const executed = await deps.rpc(
        "issue_1772_execute_brand_person_erasure",
        {
          p_challenge_id: body.challengeId,
          p_verification_hash: verificationHash,
          p_client_request_id: body.clientRequestId,
          p_actor_id: actor.userId,
        },
      );
      if (executed.error) {
        const safe = safeRpcCode(executed.error.message);
        return errorResponse(req, safe, errorStatus(safe));
      }
      const payload = executed.data as Record<string, unknown> | null;
      if (!payload || typeof payload.state !== "string") {
        return errorResponse(req, "erasure_temporarily_unavailable", 503);
      }
      if (payload.state === "verification_rejected") {
        const safe = payload.safeCode === "challenge_locked"
          ? "erasure_challenge_locked"
          : payload.safeCode === "challenge_unavailable"
          ? "erasure_challenge_expired"
          : "erasure_challenge_invalid";
        return errorResponse(req, safe, 400);
      }
      if (payload.state === "delivery_unknown") {
        return errorResponse(req, "erasure_challenge_state_unknown", 503);
      }
      if (payload.state === "refused") {
        return errorResponse(req, "erasure_identity_ambiguous", 400);
      }
      if (typeof payload.operationId !== "string") {
        return errorResponse(req, "erasure_temporarily_unavailable", 503);
      }
      if (payload.state === "completed") {
        return response(req, {
          operationId: payload.operationId,
          state: "completed",
        });
      }
      const paths = stringArray(payload.cleanupPaths);
      if (paths === null) {
        return errorResponse(req, "erasure_temporarily_unavailable", 503);
      }
      if (
        !(await finalizeCleanup(deps, payload.operationId, actor.userId, paths))
      ) {
        return errorResponse(req, "erasure_cleanup_pending", 503, {
          operationId: payload.operationId,
          retryable: true,
        });
      }
      return response(req, {
        operationId: payload.operationId,
        state: "completed",
      });
    }

    if (body.action === "status") {
      if (
        !exactKeys(body, ["action", "operationId"]) ||
        typeof body.operationId !== "string" || !UUID.test(body.operationId)
      ) return errorResponse(req, "erasure_request_invalid", 400);
      const status = await deps.rpc(
        "issue_1772_get_brand_person_erasure_operation",
        { p_operation_id: body.operationId, p_actor_id: actor.userId },
      );
      if (status.error) {
        const safe = safeRpcCode(status.error.message);
        return errorResponse(req, safe, errorStatus(safe));
      }
      const payload = status.data as Record<string, unknown> | null;
      if (!payload || typeof payload.state !== "string") {
        return errorResponse(req, "erasure_temporarily_unavailable", 503);
      }
      if (payload.state === "completed") {
        return response(req, {
          operationId: body.operationId,
          state: "completed",
        });
      }
      const paths = stringArray(payload.cleanupPaths);
      if (paths === null) {
        return errorResponse(req, "erasure_temporarily_unavailable", 503);
      }
      if (
        !(await finalizeCleanup(deps, body.operationId, actor.userId, paths))
      ) {
        return errorResponse(req, "erasure_cleanup_pending", 503, {
          operationId: body.operationId,
          retryable: true,
        });
      }
      return response(req, {
        operationId: body.operationId,
        state: "completed",
      });
    }

    return errorResponse(req, "erasure_request_invalid", 400);
  };
}

if (import.meta.main) serve(createErasureHandler());
