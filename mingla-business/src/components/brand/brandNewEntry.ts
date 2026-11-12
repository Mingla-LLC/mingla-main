/**
 * #4389 keeps #881 / ORCH-1081 — which brand flow /brand/new shows.
 *
 * Self brands use the 4-step setup (BrandCreationFlow). A host with partner
 * mode on still says who the brand is for first ("Myself" / "A client", Step 0
 * of PartnerClientBrandCreationFlow). "Myself" hands over to the setup; "A
 * client" stays in the partner client flow (invite step).
 *
 * Invariant I-881-PARTNER-INTENT | issue #881, #4389 | a partner host on /brand/new sees Step 0 while untouched; late partner status reveals it only while nothing is typed and it was not already answered; once shown it is never hidden by a later status read; "Myself" is final for this visit; unknown or failed partner status opens the self setup.
 */

export type BrandNewEntry = "self" | "partner-intent" | "client";

export interface BrandNewEntryInput {
  /** `?partner_mode=` from the route. */
  partnerModeParam: string | null;
  /** true / false once read; null while loading or after a failed read. */
  partnerEnabled: boolean | null;
  /** The host has typed something into the setup's brand name field. */
  selfTyped: boolean;
  /** The host picked "Myself" on Step 0 during this visit. */
  selfChosen: boolean;
  /** Step 0 was already on screen during this visit. */
  intentShown: boolean;
}

export function decideBrandNewEntry(input: BrandNewEntryInput): BrandNewEntry {
  // The partner deep links (/partner/brands, earnings) are explicit client
  // intent; the partner flow re-applies client mode itself when the status
  // arrives late (ORCH-1332 F-2).
  if (input.partnerModeParam === "client") return "client";
  if (input.selfChosen) return "self";
  // Never demote: once Step 0 is up, a later status read does not hide it.
  if (input.intentShown) return "partner-intent";
  // Typed identity is never thrown away by a late status read.
  if (input.partnerEnabled === true && !input.selfTyped) return "partner-intent";
  return "self";
}
