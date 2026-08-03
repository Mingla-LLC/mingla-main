import type {
  CreateStayOfferingInput,
  StayBulkJobResult,
  StayCurrencyReconciliationInput,
  StayFeeInput,
  StayInventoryAction,
  StayInventorySnapshot,
  StayMediaInput,
  StayPriceInput,
  StaySettingsInput,
} from "../types/stayInventory";
import { supabase } from "./supabase";

interface SuccessEnvelope<T> {
  kind: "success";
  data: T;
  requestId: string;
}

async function stayInventoryError(error: {
  message?: string;
  context?: unknown;
}): Promise<Error> {
  const context = error.context;
  if (
    context !== null &&
    context !== undefined &&
    typeof (context as Response).json === "function"
  ) {
    try {
      const body = (await (context as Response).json()) as {
        code?: string;
        message?: string;
      };
      if (typeof body.code === "string") {
        return new Error(body.code);
      }
    } catch {
      // Preserve the provider-safe fallback below.
    }
  }
  return new Error(error.message ?? "stay_inventory_request_failed");
}

export async function manageStayInventory<T>(input: {
  action: StayInventoryAction;
  venueId: string;
  payload?: Record<string, unknown>;
  expectedVersion?: number | null;
}): Promise<T> {
  const { data, error } = await supabase.functions.invoke<SuccessEnvelope<T>>(
    "manage-stay-inventory",
    {
      body: {
        action: input.action,
        venueId: input.venueId,
        payload: input.payload ?? {},
        expectedVersion: input.expectedVersion ?? null,
      },
    },
  );
  if (error) throw await stayInventoryError(error);
  if (!data || data.kind !== "success") {
    throw new Error("The Stay inventory service returned no result.");
  }
  return data.data;
}

export function getStayInventory(
  venueId: string,
): Promise<StayInventorySnapshot> {
  return manageStayInventory<StayInventorySnapshot>({
    action: "get",
    venueId,
  });
}

export function saveStaySettings(input: {
  venueId: string;
  settings: StaySettingsInput;
  expectedVersion?: number | null;
}): Promise<{ inventory: StayInventorySnapshot }> {
  return manageStayInventory({
    action: "save_settings",
    venueId: input.venueId,
    payload: input.settings as unknown as Record<string, unknown>,
    expectedVersion: input.expectedVersion,
  });
}

export function publishStay(input: {
  venueId: string;
  expectedVersion: number;
}): Promise<{ inventory: StayInventorySnapshot }> {
  return manageStayInventory({
    action: "publish_stay",
    venueId: input.venueId,
    expectedVersion: input.expectedVersion,
  });
}

export function createStayOffering(input: {
  venueId: string;
  offering: CreateStayOfferingInput;
}): Promise<{ inventory: StayInventorySnapshot; offeringId: string }> {
  return manageStayInventory({
    action: "create_offering",
    venueId: input.venueId,
    payload: input.offering as unknown as Record<string, unknown>,
  });
}

export function updateStayOffering(input: {
  venueId: string;
  offeringId: string;
  expectedVersion: number;
  patch: Partial<CreateStayOfferingInput>;
}): Promise<{ inventory: StayInventorySnapshot; offeringId: string }> {
  return manageStayInventory({
    action: "update_offering",
    venueId: input.venueId,
    expectedVersion: input.expectedVersion,
    payload: {
      offeringId: input.offeringId,
      ...input.patch,
    } as Record<string, unknown>,
  });
}

export function replaceStayUnits(input: {
  venueId: string;
  offeringId: string;
  expectedVersion: number;
  units: { name: string; externalReference?: string }[];
}): Promise<{ inventory: StayInventorySnapshot }> {
  return manageStayInventory({
    action: "replace_units",
    venueId: input.venueId,
    expectedVersion: input.expectedVersion,
    payload: { offeringId: input.offeringId, units: input.units },
  });
}

export function changeStayOfferingStatus(input: {
  venueId: string;
  offeringId: string;
  expectedVersion: number;
  status: "draft" | "live" | "paused" | "archived";
}): Promise<{ inventory: StayInventorySnapshot }> {
  return manageStayInventory({
    action: "change_status",
    venueId: input.venueId,
    expectedVersion: input.expectedVersion,
    payload: { offeringId: input.offeringId, status: input.status },
  });
}

export function setStayOfferingPolicy(input: {
  venueId: string;
  offeringId: string;
  expectedVersion: number;
  policy: NonNullable<CreateStayOfferingInput["policy"]>;
}): Promise<{ inventory: StayInventorySnapshot }> {
  return manageStayInventory({
    action: "set_policy",
    venueId: input.venueId,
    expectedVersion: input.expectedVersion,
    payload: { offeringId: input.offeringId, ...input.policy },
  });
}

export function setStayOfferingPrice(input: {
  venueId: string;
  offeringId: string;
  expectedVersion: number;
  price: StayPriceInput;
}): Promise<{ inventory: StayInventorySnapshot }> {
  return manageStayInventory({
    action: "set_price",
    venueId: input.venueId,
    expectedVersion: input.expectedVersion,
    payload: { offeringId: input.offeringId, ...input.price },
  });
}

export function replaceStayOfferingFees(input: {
  venueId: string;
  offeringId: string;
  expectedVersion: number;
  fees: StayFeeInput[];
}): Promise<{ inventory: StayInventorySnapshot }> {
  return manageStayInventory({
    action: "replace_fees",
    venueId: input.venueId,
    expectedVersion: input.expectedVersion,
    payload: { offeringId: input.offeringId, fees: input.fees },
  });
}

export function attachStayOfferingMedia(input: {
  venueId: string;
  offeringId: string;
  expectedVersion: number;
  media: StayMediaInput;
}): Promise<{ inventory: StayInventorySnapshot }> {
  return manageStayInventory({
    action: "attach_media",
    venueId: input.venueId,
    expectedVersion: input.expectedVersion,
    payload: { offeringId: input.offeringId, ...input.media },
  });
}

export function reorderStayOfferingMedia(input: {
  venueId: string;
  offeringId: string;
  expectedVersion: number;
  mediaIds: string[];
}): Promise<{ inventory: StayInventorySnapshot }> {
  return manageStayInventory({
    action: "reorder_media",
    venueId: input.venueId,
    expectedVersion: input.expectedVersion,
    payload: {
      offeringId: input.offeringId,
      mediaIds: input.mediaIds,
    },
  });
}

export function removeStayOfferingMedia(input: {
  venueId: string;
  mediaId: string;
  expectedVersion: number;
}): Promise<{ inventory: StayInventorySnapshot }> {
  return manageStayInventory({
    action: "remove_media",
    venueId: input.venueId,
    expectedVersion: input.expectedVersion,
    payload: { mediaId: input.mediaId },
  });
}

export function upsertStayRoomNights(input: {
  venueId: string;
  offeringId: string;
  nights: Record<string, unknown>[];
}): Promise<{ inventory: StayInventorySnapshot }> {
  return manageStayInventory({
    action: "upsert_room_nights",
    venueId: input.venueId,
    payload: { offeringId: input.offeringId, nights: input.nights },
  });
}

export function upsertStayPlaceSchedule(input: {
  venueId: string;
  offeringId: string;
  expectedVersion?: number | null;
  schedule: Record<string, unknown>;
}): Promise<{ inventory: StayInventorySnapshot }> {
  return manageStayInventory({
    action: "upsert_place_schedule",
    venueId: input.venueId,
    expectedVersion: input.expectedVersion,
    payload: { offeringId: input.offeringId, ...input.schedule },
  });
}

export function materializeStayPlaceWindows(input: {
  venueId: string;
  scheduleRuleId: string;
  fromDate: string;
  toDate: string;
}): Promise<{ inventory: StayInventorySnapshot }> {
  return manageStayInventory({
    action: "materialize_place_windows",
    venueId: input.venueId,
    payload: {
      scheduleRuleId: input.scheduleRuleId,
      fromDate: input.fromDate,
      toDate: input.toDate,
    },
  });
}

export function upsertStayPlaceWindows(input: {
  venueId: string;
  windows: Record<string, unknown>[];
}): Promise<{ inventory: StayInventorySnapshot }> {
  return manageStayInventory({
    action: "upsert_place_windows",
    venueId: input.venueId,
    payload: { windows: input.windows },
  });
}

export function bulkCreateStayOfferings(input: {
  venueId: string;
  idempotencyKey: string;
  items: CreateStayOfferingInput[];
}): Promise<StayBulkJobResult> {
  return manageStayInventory({
    action: "bulk_create",
    venueId: input.venueId,
    payload: {
      idempotencyKey: input.idempotencyKey,
      items: input.items,
    },
  });
}

export function resolveStayCurrencyReconciliation(input: {
  venueId: string;
  reconciliation: StayCurrencyReconciliationInput;
}): Promise<Record<string, unknown>> {
  return manageStayInventory({
    action: "resolve_currency_reconciliation",
    venueId: input.venueId,
    payload: input.reconciliation as unknown as Record<string, unknown>,
  });
}
