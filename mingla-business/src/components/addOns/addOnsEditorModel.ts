/**
 * issue #3281 S3 — the Add-ons editor's pure model.
 *
 * One model for every offering (event, trip, experience, RSVP): it reads the
 * `biz_offering_add_ons` payload, keeps the form in strings while the host
 * types, turns it back into the whole-list save payload, and maps every server
 * refusal to the host copy of the spec (section 7). Money is integer minor
 * units from the payload to the save (I-ADDON-MINOR-UNITS); the only decimal
 * is the text the host types, parsed here with the currency's own digits.
 */

import { minorFromMajor } from "../../utils/currency";

export type AddOnOfferingKind = "event" | "trip" | "experience" | "rsvp";

export type AddOnTarget =
  | { kind: "ticket_type"; ticketTypeId: string }
  | { kind: "rsvp" };

export interface AddOnTargetOption {
  key: string;
  target: AddOnTarget;
  name: string;
  isFree: boolean;
  priceCents: number;
  /** Null: every date of the offering. */
  validOccurrenceKeys: string[] | null;
}

export interface AddOnDateOption {
  key: string;
  startsAt: string;
  timezone: string;
}

export interface OfferingAddOn {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  isUnlimited: boolean;
  quantityTotal: number | null;
  maxPerTicket: number;
  validOccurrenceKeys: string[] | null;
  photoPath: string | null;
  photoThumbPath: string | null;
  showOnPublicPage: boolean;
  sortOrder: number;
  soldCount: number;
  soldOccurrenceKeys: string[];
  targets: AddOnTarget[];
}

export interface OfferingAddOnsPayload {
  eventId: string;
  eventType: string;
  revision: number;
  multiLinkEnabled: boolean;
  freeParentEnabled: boolean;
  currency: string | null;
  dates: AddOnDateOption[];
  targets: AddOnTargetOption[];
  addOns: OfferingAddOn[];
}

/** The save item the RPC takes (`biz_offering_add_ons_save`). */
export interface AddOnSaveItem {
  id?: string;
  name: string;
  description: string | null;
  priceCents: number;
  isUnlimited: boolean;
  quantityTotal: number | null;
  maxPerTicket: number;
  validOccurrenceKeys: string[] | null;
  targets: AddOnTarget[];
  photoPath: string | null;
  photoThumbPath: string | null;
  showOnPublicPage: boolean;
  sortOrder: number;
}

/** The form while the host edits one add-on. */
export interface AddOnForm {
  id: string | null;
  name: string;
  description: string;
  priceText: string;
  limitText: string;
  stockText: string;
  targetKeys: string[];
  /** Null: every date its tickets admit. */
  dateKeys: string[] | null;
  photoPath: string | null;
  photoThumbPath: string | null;
  showOnPublicPage: boolean;
  soldCount: number;
  soldOccurrenceKeys: string[];
  originalPriceCents: number | null;
}

export const MAX_ADD_ONS_PER_OFFERING = 40;
export const MAX_ADD_ONS_PER_TICKET = 20;
export const MAX_ADD_ON_LIMIT = 20;

/**
 * Digits after the point for a currency (0 for JPY and friends, else 2).
 * `minorFromMajor` owns the currency table; this only asks it.
 */
export const minorDigits = (currency: string | null | undefined): number =>
  minorFromMajor(1, currency ?? "") === 1 ? 0 : 2;

/**
 * Parses the typed price into integer minor units. Empty is 0 (a free
 * add-on). Anything else that is not a plain non-negative amount with at most
 * the currency's digits returns null, so no float ever reaches the server.
 */
export const parsePriceToMinor = (
  text: string,
  currency: string | null | undefined,
): number | null => {
  const trimmed = text.trim().replace(/,/g, "");
  if (trimmed === "") return 0;
  const digits = minorDigits(currency);
  const pattern = digits === 0 ? /^\d{1,9}$/ : /^\d{1,9}(\.\d{0,2})?$/;
  if (!pattern.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  const minor =
    Number(whole) * 10 ** digits + Number((fraction + "00").slice(0, digits) || "0");
  return Number.isSafeInteger(minor) ? minor : null;
};

/** Minor units back to the text a host edits ("25" or "25.50"). */
export const minorToPriceText = (
  minor: number,
  currency: string | null | undefined,
): string => {
  if (minor === 0) return "";
  const digits = minorDigits(currency);
  if (digits === 0) return String(minor);
  const whole = Math.floor(minor / 100);
  const fraction = minor % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0")}`;
};

export const targetKey = (target: AddOnTarget): string =>
  target.kind === "rsvp" ? "rsvp" : `tt:${target.ticketTypeId}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const int = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;
const strList = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : null;

const parseTarget = (value: unknown): AddOnTarget | null => {
  if (!isRecord(value)) return null;
  if (value.kind === "rsvp") return { kind: "rsvp" };
  const id = str(value.ticketTypeId);
  return value.kind === "ticket_type" && id !== null ? { kind: "ticket_type", ticketTypeId: id } : null;
};

/** Reads the RPC payload. Throws when it is not the shape the server sends. */
export const parseOfferingAddOns = (raw: unknown): OfferingAddOnsPayload => {
  if (!isRecord(raw)) throw new Error("add_ons_payload_invalid");
  const revision = int(raw.revision);
  const eventId = str(raw.eventId);
  if (revision === null || eventId === null) throw new Error("add_ons_payload_invalid");
  const targets: AddOnTargetOption[] = [];
  for (const item of Array.isArray(raw.targets) ? raw.targets : []) {
    const target = parseTarget(item);
    if (target === null || !isRecord(item)) continue;
    targets.push({
      key: targetKey(target),
      target,
      name: target.kind === "rsvp" ? "The RSVP" : str(item.name) ?? "Ticket",
      isFree: target.kind === "rsvp" ? true : item.isFree === true,
      priceCents: int(item.priceCents) ?? 0,
      validOccurrenceKeys: strList(item.validOccurrenceKeys),
    });
  }
  const dates: AddOnDateOption[] = [];
  for (const item of Array.isArray(raw.dates) ? raw.dates : []) {
    if (!isRecord(item)) continue;
    const key = str(item.key);
    const startsAt = str(item.startsAt);
    if (key !== null && startsAt !== null) {
      dates.push({ key, startsAt, timezone: str(item.timezone) ?? "UTC" });
    }
  }
  const addOns: OfferingAddOn[] = [];
  for (const item of Array.isArray(raw.addOns) ? raw.addOns : []) {
    if (!isRecord(item)) continue;
    const id = str(item.id);
    const name = str(item.name);
    const priceCents = int(item.priceCents);
    if (id === null || name === null || priceCents === null) continue;
    addOns.push({
      id,
      name,
      description: str(item.description),
      priceCents,
      isUnlimited: item.isUnlimited === true,
      quantityTotal: int(item.quantityTotal),
      maxPerTicket: int(item.maxPerTicket) ?? 1,
      validOccurrenceKeys: strList(item.validOccurrenceKeys),
      photoPath: str(item.photoPath),
      photoThumbPath: str(item.photoThumbPath),
      showOnPublicPage: item.showOnPublicPage !== false,
      sortOrder: int(item.sortOrder) ?? addOns.length,
      soldCount: int(item.soldCount) ?? 0,
      soldOccurrenceKeys: strList(item.soldOccurrenceKeys) ?? [],
      targets: (Array.isArray(item.targets) ? item.targets : [])
        .map(parseTarget)
        .filter((target): target is AddOnTarget => target !== null),
    });
  }
  return {
    eventId,
    eventType: str(raw.eventType) ?? "event",
    revision,
    multiLinkEnabled: raw.multiLinkEnabled === true,
    freeParentEnabled: raw.freeParentEnabled === true,
    currency: str(raw.currency),
    dates,
    targets,
    addOns,
  };
};

/** What one ticket, package or option is called on this offering. */
export const targetNoun = (kind: AddOnOfferingKind): string =>
  kind === "trip" ? "package" : kind === "experience" ? "option" : kind === "rsvp" ? "RSVP" : "ticket";

export const emptyAddOnForm = (defaultTargetKeys: string[]): AddOnForm => ({
  id: null,
  name: "",
  description: "",
  priceText: "",
  limitText: "1",
  stockText: "",
  targetKeys: defaultTargetKeys,
  dateKeys: null,
  photoPath: null,
  photoThumbPath: null,
  showOnPublicPage: true,
  soldCount: 0,
  soldOccurrenceKeys: [],
  originalPriceCents: null,
});

export const formFromAddOn = (addOn: OfferingAddOn, currency: string | null): AddOnForm => ({
  id: addOn.id,
  name: addOn.name,
  description: addOn.description ?? "",
  priceText: minorToPriceText(addOn.priceCents, currency),
  limitText: String(addOn.maxPerTicket),
  stockText: addOn.isUnlimited || addOn.quantityTotal === null ? "" : String(addOn.quantityTotal),
  targetKeys: addOn.targets.map(targetKey),
  dateKeys: addOn.validOccurrenceKeys,
  photoPath: addOn.photoPath,
  photoThumbPath: addOn.photoThumbPath,
  showOnPublicPage: addOn.showOnPublicPage,
  soldCount: addOn.soldCount,
  soldOccurrenceKeys: addOn.soldOccurrenceKeys,
  originalPriceCents: addOn.priceCents,
});

/** The dates the chosen tickets admit (the union), in the offering's order. */
export const datesForTargets = (
  payload: Pick<OfferingAddOnsPayload, "dates" | "targets">,
  targetKeys: readonly string[],
): AddOnDateOption[] => {
  const chosen = payload.targets.filter((option) => targetKeys.includes(option.key));
  if (chosen.length === 0) return [];
  if (chosen.some((option) => option.validOccurrenceKeys === null)) return payload.dates;
  const allowed = new Set(chosen.flatMap((option) => option.validOccurrenceKeys ?? []));
  return payload.dates.filter((date) => allowed.has(date.key));
};

export interface AddOnFormContext {
  payload: OfferingAddOnsPayload;
  currency: string | null;
  kind: AddOnOfferingKind;
}

/** The first thing wrong with the form, as the sentence shown under Save. */
export const validateAddOnForm = (form: AddOnForm, context: AddOnFormContext): string | null => {
  const noun = targetNoun(context.kind);
  if (form.name.trim().length === 0) return "Give this add-on a name.";
  if (form.name.trim().length > 120) return "Keep the name under 120 characters.";
  if (form.description.trim().length > 280) return "Keep the description under 280 characters.";
  const price = parsePriceToMinor(form.priceText, context.currency);
  if (price === null) return "Enter a price like 25 or 25.50, or leave it empty for free.";
  const limit = Number(form.limitText);
  if (!/^\d+$/.test(form.limitText.trim()) || limit < 1 || limit > MAX_ADD_ON_LIMIT) {
    return `Set a limit from 1 to ${MAX_ADD_ON_LIMIT}.`;
  }
  if (form.stockText.trim() !== "" && (!/^\d+$/.test(form.stockText.trim()) || Number(form.stockText) < 1)) {
    return "Stock is a whole number, or empty for no limit.";
  }
  if (form.stockText.trim() !== "" && Number(form.stockText) < form.soldCount) {
    return `${form.soldCount} already sold, so stock can't go below that.`;
  }
  if (form.targetKeys.length === 0) {
    return context.kind === "rsvp"
      ? "Turn on 'Comes with the RSVP'."
      : `Pick at least one ${noun} for this add-on.`;
  }
  if (!context.payload.multiLinkEnabled && form.targetKeys.length > 1) {
    return `Each add-on can come with one ${noun} for now.`;
  }
  if (
    price > 0 &&
    !context.payload.freeParentEnabled &&
    context.payload.targets.some((option) => form.targetKeys.includes(option.key) && option.isFree)
  ) {
    return `Paid add-ons need a paid ${noun} for now. Set the price to 0 or pick a paid ${noun}.`;
  }
  if (form.soldCount > 0 && form.originalPriceCents !== null && price !== form.originalPriceCents) {
    return "Add-ons people already bought keep their price.";
  }
  if (form.dateKeys !== null) {
    if (form.dateKeys.length === 0) return "Pick at least one date, or choose every date.";
    const allowed = new Set(datesForTargets(context.payload, form.targetKeys).map((date) => date.key));
    if (form.dateKeys.some((key) => !allowed.has(key))) {
      return "This add-on has dates none of its tickets cover.";
    }
  }
  return null;
};

/** The form as one save item (call only when `validateAddOnForm` is null). */
export const saveItemFromForm = (
  form: AddOnForm,
  context: AddOnFormContext,
  sortOrder: number,
): AddOnSaveItem => {
  const stock = form.stockText.trim();
  const targets = context.payload.targets
    .filter((option) => form.targetKeys.includes(option.key))
    .map((option) => option.target);
  return {
    ...(form.id !== null ? { id: form.id } : {}),
    name: form.name.trim(),
    description: form.description.trim().length > 0 ? form.description.trim() : null,
    priceCents: parsePriceToMinor(form.priceText, context.currency) ?? 0,
    isUnlimited: stock === "",
    quantityTotal: stock === "" ? null : Number(stock),
    maxPerTicket: Number(form.limitText),
    validOccurrenceKeys: form.dateKeys,
    targets,
    photoPath: form.photoPath,
    photoThumbPath: form.photoThumbPath,
    showOnPublicPage: form.showOnPublicPage,
    sortOrder,
  };
};

/** The saved list as save items, unchanged. */
export const saveItemFromAddOn = (addOn: OfferingAddOn, sortOrder: number): AddOnSaveItem => ({
  id: addOn.id,
  name: addOn.name,
  description: addOn.description,
  priceCents: addOn.priceCents,
  isUnlimited: addOn.isUnlimited,
  quantityTotal: addOn.isUnlimited ? null : addOn.quantityTotal,
  maxPerTicket: addOn.maxPerTicket,
  validOccurrenceKeys: addOn.validOccurrenceKeys,
  targets: addOn.targets,
  photoPath: addOn.photoPath,
  photoThumbPath: addOn.photoThumbPath,
  showOnPublicPage: addOn.showOnPublicPage,
  sortOrder,
});

/**
 * The whole list to save after one add-on was edited, added (`form.id`
 * null) or removed (`remove`). Everything else is sent as the server has it.
 */
export const buildSaveList = (
  payload: OfferingAddOnsPayload,
  context: AddOnFormContext,
  edit: { form: AddOnForm } | { removeId: string },
): AddOnSaveItem[] => {
  const kept = payload.addOns.filter((addOn) =>
    "removeId" in edit ? addOn.id !== edit.removeId : true,
  );
  const items = kept.map((addOn, index) =>
    "form" in edit && edit.form.id === addOn.id
      ? saveItemFromForm(edit.form, context, index)
      : saveItemFromAddOn(addOn, index),
  );
  if ("form" in edit && edit.form.id === null) {
    items.push(saveItemFromForm(edit.form, context, items.length));
  }
  return items;
};

/** "{price} · {limit} per {noun} · {stock}" for a list row. */
export const addOnSummaryLine = (
  addOn: OfferingAddOn,
  formatMinor: (minor: number) => string,
  kind: AddOnOfferingKind,
): string => {
  const price = addOn.priceCents > 0 ? formatMinor(addOn.priceCents) : "Free";
  const per = kind === "rsvp" ? "guest" : targetNoun(kind);
  if (!addOn.isUnlimited && addOn.quantityTotal !== null && addOn.soldCount >= addOn.quantityTotal) {
    return `${price} · Sold out · ${addOn.soldCount}/${addOn.quantityTotal}`;
  }
  const stock =
    addOn.isUnlimited || addOn.quantityTotal === null
      ? "No stock limit"
      : `${addOn.quantityTotal} in stock`;
  const sold = addOn.soldCount > 0 ? ` · ${addOn.soldCount} sold` : "";
  return `${price} · ${addOn.maxPerTicket} per ${per} · ${stock}${sold}`;
};

/** Which tickets a row comes with, as the chip on the right. */
export const addOnTargetsLabel = (
  addOn: OfferingAddOn,
  payload: OfferingAddOnsPayload,
  kind: AddOnOfferingKind,
): string => {
  const names = payload.targets
    .filter((option) => addOn.targets.some((target) => targetKey(target) === option.key))
    .map((option) => option.name);
  if (kind === "rsvp") return names.length > 0 ? "With the RSVP" : "Not linked";
  if (names.length === 0) return "Not linked";
  if (names.length === payload.targets.length && names.length > 1) {
    return `All ${targetNoun(kind)}s`;
  }
  return names.join(", ");
};

export type AddOnSaveErrorKind = "conflict" | "offline" | "forbidden" | "refused" | "unknown";

/** Host copy for every refusal the save or the photo upload can return. */
export const ADD_ON_ERROR_COPY: Readonly<Record<string, string>> = {
  add_on_target_required: "Pick at least one ticket for this add-on.",
  add_on_link_wrong_offering: "That ticket belongs to another listing. Refresh and try again.",
  add_on_dates_outside_tickets: "This add-on has dates none of its tickets cover.",
  add_on_multi_link_off: "Each add-on can come with one ticket for now.",
  add_ons_changed_elsewhere:
    "Someone else changed these add-ons. We've loaded the latest; check and save again.",
  add_ons_too_many: "An offering can have up to 40 add-ons.",
  add_ons_too_many_for_ticket: "A ticket can come with up to 20 add-ons.",
  add_on_photo_invalid: "Choose a JPEG, PNG, WebP or HEIC photo under 5 MB.",
  sold_extra_mutation_blocked:
    "Add-ons people already bought keep their price, and stock can't go below what sold.",
  extra_day_scope_drops_sold_day: "A date someone bought this add-on for has to stay.",
  paid_extra_on_free_ticket: "Paid add-ons need a paid ticket for now.",
  ticket_extra_name_invalid: "Give this add-on a name under 120 characters.",
  ticket_extra_description_too_long: "Keep the description under 280 characters.",
  ticket_extra_capacity_required: "Set the stock, or leave it empty for no limit.",
  ticket_extra_capacity_invalid: "Set the stock, or leave it empty for no limit.",
  ticket_extra_max_invalid: "Set a limit from 1 to 20.",
  ticket_extra_day_scope_empty: "Pick at least one date, or choose every date.",
  add_ons_forbidden: "Only event managers can change add-ons on this listing.",
  add_ons_invalid: "We couldn't read these add-ons. Check them and try again.",
};

export const ADD_ON_UNKNOWN_ERROR = "Add-ons didn't save. Check your connection and try again.";

export const addOnErrorCopy = (code: string | null | undefined): string =>
  (code !== null && code !== undefined ? ADD_ON_ERROR_COPY[code] : undefined) ?? ADD_ON_UNKNOWN_ERROR;
