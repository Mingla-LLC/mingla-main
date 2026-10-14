export type ExplorerCheckoutContactField = "name" | "email" | "phone";

export interface ExplorerCheckoutContactSnapshot {
  name: string;
  email: string;
  phone: string;
}

export interface ExplorerCheckoutContactValidation {
  normalized: ExplorerCheckoutContactSnapshot;
  valid: Record<ExplorerCheckoutContactField, boolean>;
  invalidFields: ExplorerCheckoutContactField[];
  isValid: boolean;
}

export interface ExplorerCheckoutContactResolution
  extends ExplorerCheckoutContactValidation {
  provenance: {
    name: "current_profile" | "missing";
    email: "current_auth" | "missing";
    phone: "current_profile_normalized" | "missing";
  };
}

export const EXPLORER_CHECKOUT_CONTACT_FIELDS: readonly ExplorerCheckoutContactField[];

export function explorerCheckoutContactFieldsForEditor(
  validation: Pick<ExplorerCheckoutContactValidation, "invalidFields">,
  editAll: boolean,
): ExplorerCheckoutContactField[];

export function resolveExplorerCheckoutContact(input: {
  authUserId?: unknown;
  authEmail?: unknown;
  profileId?: unknown;
  profileDisplayName?: unknown;
  profilePhone?: unknown;
  profileCountry?: unknown;
}): ExplorerCheckoutContactResolution;

export function validateExplorerCheckoutContact(input: {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
}): ExplorerCheckoutContactValidation;
