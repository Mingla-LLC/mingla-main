import { reportNonFatal } from "../diagnostics/reportNonFatal";
import type { BookCursor, BrandPeopleBookPage } from "../types/people";
import type { ManualGroupSummary } from "../types/marketing";
import { listManualGroups } from "./marketing/manualGroupService";
import { listBrandPeople } from "./peopleService";
import { supabase } from "./supabase";

export type WizardOfferingType = "event" | "rsvp" | "experience" | "trip";
export type WizardInvitePlanState = "draft" | "locked";

export interface WizardInvitePlan {
  eventId: string;
  eventType: WizardOfferingType;
  selectionRevision: number;
  selectedCount: number;
  brandPersonIds: string[];
  selectionHash: string;
  state: WizardInvitePlanState;
  publishedSelectionRevision: number | null;
  updatedAt: string | null;
  replayed?: boolean;
}

export interface WizardInviteQuote {
  selectionRevision: number;
  selectedCount: number;
  reachableCount: number;
  suppressedCount: number;
  canReceiveCount: number;
  skippedCount: number;
  perChannelReachable: { email: number; sms: number; push: number };
  estimatedCostMinor: number;
  currency: string;
  quoteHash: string;
  selectionHash: string;
}

export interface WizardInviteSelection {
  includeEveryone: boolean;
  manualGroupIds: string[];
  personIds: string[];
  excludedPersonIds: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export class WizardInvitePlanError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly currentRevision: number | null = null,
  ) {
    super(code);
    this.name = "WizardInvitePlanError";
  }
}

function malformed(): never {
  const error = new WizardInvitePlanError("wizard_invite_invalid_response", true);
  reportNonFatal("wizard-invite-invalid-response", error, { feature: "wizard-invites" });
  throw error;
}

function parsePlan(value: unknown): WizardInvitePlan {
  if (!record(value) || typeof value.eventId !== "string" || !UUID.test(value.eventId) ||
      !["event", "rsvp", "experience", "trip"].includes(String(value.eventType)) ||
      !Number.isSafeInteger(value.selectionRevision) || (value.selectionRevision as number) < 0 ||
      !Number.isSafeInteger(value.selectedCount) || (value.selectedCount as number) < 0 ||
      (value.selectedCount as number) > 500 || !Array.isArray(value.brandPersonIds) ||
      !value.brandPersonIds.every((id) => typeof id === "string" && UUID.test(id)) ||
      value.brandPersonIds.length !== value.selectedCount || typeof value.selectionHash !== "string" ||
      !HASH.test(value.selectionHash) || (value.state !== "draft" && value.state !== "locked") ||
      !(value.publishedSelectionRevision === null || Number.isSafeInteger(value.publishedSelectionRevision)) ||
      !(value.updatedAt === null || typeof value.updatedAt === "string")) malformed();
  return value as unknown as WizardInvitePlan;
}

function parseQuote(value: unknown): WizardInviteQuote {
  if (!record(value) || !record(value.perChannelReachable) ||
      ![value.selectionRevision, value.selectedCount, value.reachableCount, value.suppressedCount,
        value.canReceiveCount, value.skippedCount,
        value.estimatedCostMinor, value.perChannelReachable.email,
        value.perChannelReachable.sms, value.perChannelReachable.push]
        .every((number) => Number.isSafeInteger(number) && (number as number) >= 0) ||
      typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency) ||
      typeof value.quoteHash !== "string" || !HASH.test(value.quoteHash) ||
      typeof value.selectionHash !== "string" || !HASH.test(value.selectionHash) ||
      (value.selectedCount as number) > 500 ||
      (value.canReceiveCount as number) > (value.selectedCount as number) ||
      (value.skippedCount as number) !==
        (value.selectedCount as number) - (value.canReceiveCount as number)) {
    malformed();
  }
  return value as unknown as WizardInviteQuote;
}

type ServiceErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  status?: number;
  context?: {
    status?: number;
    clone?: () => { json?: () => Promise<unknown> };
  };
};

function serviceError(error: ServiceErrorLike): WizardInvitePlanError {
  const messageCode = `${error.message ?? ""} ${error.details ?? ""}`
    .match(/wizard_invite_[a-z0-9_]+/)?.[0];
  const authRequired = error.code === "PGRST301" || error.status === 401 ||
    error.context?.status === 401 ||
    /(?:jwt[^a-z0-9]*(?:expired|invalid)|unauthorized)/i.test(error.message ?? "");
  const code = messageCode ?? (authRequired
    ? "wizard_invite_auth_required"
    : "wizard_invite_temporarily_unavailable");
  const currentRevisionMatch = error.details?.match(/"currentRevision"\s*:\s*(\d+)/);
  return new WizardInvitePlanError(code,
    !["wizard_invite_forbidden", "wizard_invite_not_found_or_forbidden",
      "wizard_invite_selection_invalid", "wizard_invite_selection_too_large",
      "wizard_invite_plan_locked", "wizard_invite_feature_disabled",
      "wizard_invite_offering_not_draft", "wizard_invite_auth_required"].includes(code),
    currentRevisionMatch ? Number(currentRevisionMatch[1]) : null);
}

async function edgeServiceError(error: unknown): Promise<WizardInvitePlanError> {
  const candidate = record(error) ? error as ServiceErrorLike : {};
  const cloned = candidate.context?.clone?.();
  if (cloned?.json) {
    try {
      const body = await cloned.json();
      if (record(body)) {
        const bodyMessage = [body.error, body.message]
          .find((value): value is string => typeof value === "string");
        if (bodyMessage) {
          return serviceError({ ...candidate, message: bodyMessage });
        }
      }
    } catch {
      // The transport status below remains authoritative when a body is not JSON.
    }
  }
  return serviceError(candidate);
}

async function rpc<T>(name: string, args: Record<string, unknown>, parse: (value: unknown) => T): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw serviceError(error);
  return parse(data);
}

export const createWizardInviteRequestId = (): string => {
  const cryptoValue = globalThis.crypto;
  if (typeof cryptoValue?.randomUUID === "function") return cryptoValue.randomUUID();
  if (typeof cryptoValue?.getRandomValues !== "function") {
    throw new WizardInvitePlanError("wizard_invite_secure_random_unavailable", false);
  }
  const bytes = cryptoValue.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
};

export const getWizardInvitePlan = (eventId: string): Promise<WizardInvitePlan> =>
  rpc("biz_get_offering_invite_plan_v1", { p_event_id: eventId }, parsePlan);

export const replaceWizardInvitePlan = (input: {
  eventId: string;
  selection: WizardInviteSelection;
  expectedRevision: number;
  clientRequestId: string;
}): Promise<WizardInvitePlan> => rpc("biz_replace_offering_invite_plan_v1", {
  p_event_id: input.eventId,
  p_selection: input.selection,
  p_expected_revision: input.expectedRevision,
  p_client_request_id: input.clientRequestId,
}, parsePlan);

export const clearWizardInvitePlan = (input: {
  eventId: string;
  expectedRevision: number;
  clientRequestId: string;
}): Promise<WizardInvitePlan> => rpc("biz_clear_offering_invite_plan_v1", {
  p_event_id: input.eventId,
  p_expected_revision: input.expectedRevision,
  p_client_request_id: input.clientRequestId,
}, parsePlan);

export async function quoteWizardInvitePlan(
  eventId: string,
  selectionRevision: number,
): Promise<WizardInviteQuote> {
  const { data, error } = await supabase.functions.invoke(
    "offering-invite-dispatch",
    { body: { mode: "wizard_preview", eventId, selectionRevision } },
  );
  if (error) throw await edgeServiceError(error);
  return parseQuote(data);
}

export const listWizardInviteBookPeople = (
  brandId: string,
  search: string | null,
  cursor: BookCursor | null,
): Promise<BrandPeopleBookPage> => listBrandPeople({ brandId, search, cursor, limit: 50 });

export const listWizardInviteManualGroups = (brandId: string): Promise<ManualGroupSummary[]> =>
  listManualGroups(brandId);

export function formatWizardInviteMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
}
