// #4111 — production wiring for the public enquiry / subscribe handlers.
// The handlers take these as dependencies so their tests never touch the
// network or a database. Moderation and SMS are wired only by the functions
// that use them (public-brand-enquiry, public-brand-subscribe), so the other
// functions do not inherit those providers' environment reads.

// @ts-ignore -- Deno ESM import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailAdapter } from "./adapters/emailAdapter.ts";
import {
  makeGuestToken,
  type OriginDeps,
  serviceOriginDeps,
  sleepFloor,
} from "./brandEnquiry.ts";

/** Same shape as contentModeration.ts ModerationResult (kept local so
 *  functions without moderation do not import the provider module). */
export interface ModerationResult {
  flagged: boolean;
  categories: string[];
  checked: boolean;
  failure?: string;
}

export interface RpcResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

export interface BrandRef {
  id: string;
  name: string;
  slug: string | null;
}

export interface EmailMessage {
  to: string;
  title: string;
  body: string;
  cta: { label: string; url: string };
  idempotencyKey?: string;
}

export interface PublicEnquiryDeps {
  now(): number;
  sleepFloor(startedMs: number): Promise<void>;
  originDeps: OriginDeps;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  resolveBrand(ref: { brandId?: string | null; brandSlug?: string | null }): Promise<BrandRef | null>;
  moderate(text: string): Promise<ModerationResult>;
  sendEmail(message: EmailMessage): Promise<{ ok: boolean; error?: string | null }>;
  sendSms(input: {
    to: string;
    brandName: string;
    message: string;
    confirmUrl?: string;
    idempotencyKey?: string;
  }): Promise<{ ok: boolean; error?: string | null }>;
  makeToken(): string;
  log(level: "warn" | "error", event: string, detail?: Record<string, unknown>): void;
}

export type CoreEnquiryDeps = Omit<PublicEnquiryDeps, "moderate" | "sendSms">;

/** Not wired in this function; reaching it is a programming error. */
export const NOT_WIRED = {
  moderate(): Promise<ModerationResult> {
    return Promise.reject(new Error("moderation_not_wired"));
  },
  sendSms(): Promise<{ ok: boolean; error?: string | null }> {
    return Promise.reject(new Error("sms_not_wired"));
  },
};

export function productionCoreDeps(): CoreEnquiryDeps {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("supabase_service_env_missing");
  const service = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    now: () => Date.now(),
    sleepFloor: (started) => sleepFloor(started),
    originDeps: serviceOriginDeps(service),
    async rpc(name, args) {
      const { data, error } = await service.rpc(name, args);
      return { data, error: error ? { message: error.message, code: error.code } : null };
    },
    async resolveBrand(ref) {
      let query = service.from("brands").select("id, name, slug").is("deleted_at", null);
      if (ref.brandId) query = query.eq("id", ref.brandId);
      else if (ref.brandSlug) query = query.eq("slug", ref.brandSlug);
      else return null;
      const { data, error } = await query.maybeSingle();
      if (error || !data?.id) return null;
      return {
        id: String(data.id),
        name: String(data.name ?? "").trim() || "this brand",
        slug: typeof data.slug === "string" ? data.slug : null,
      };
    },
    async sendEmail(message) {
      const result = await emailAdapter.send({
        to: message.to,
        title: message.title,
        body: message.body,
        cta: message.cta,
        idempotencyKey: message.idempotencyKey,
      });
      return { ok: result.ok, error: result.error ?? null };
    },
    makeToken: makeGuestToken,
    log(level, event, detail) {
      const line = detail ? `${event} ${JSON.stringify(detail)}` : event;
      if (level === "error") console.error(line);
      else console.warn(line);
    },
  };
}
