import type {
  CreateStayOfferingInput,
  StayBulkJobResult,
  StayCurrencyReconciliationInput,
  StayInventoryAction,
  StayInventorySnapshot,
  StaySettingsInput,
} from "../types/stayInventory";
import { supabase } from "./supabase";

interface SuccessEnvelope<T> {
  kind: "success";
  data: T;
  requestId: string;
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
  if (error) throw error;
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
