export type BrandPersonContactChannel = "email" | "phone";
export interface BrandPersonContact { id: string; channel: BrandPersonContactChannel; value: string; isPrimary: boolean }
export interface BrandPersonSuppression { channel: "email" | "sms"; scope: "marketing" | "all" }
export interface BrandPersonSummary {
  personId: string; displayName: string; avatarUrl: string | null; updatedAt: string;
  contacts: BrandPersonContact[]; suppressions: BrandPersonSuppression[];
}
export interface BookCursor { updatedAt: string; personId: string }
export interface BrandPeopleBookPage { rows: BrandPersonSummary[]; nextCursor: BookCursor | null; bookTotal: number; filteredTotal: number }
export interface AddBrandPersonInput {
  brandId: string; displayName: string; email: string | null; phoneE164: string | null;
  phoneCountryIso: string | null; clientRequestId: string;
}
export interface AddBrandPersonResult { outcome: "created" | "updated" | "unchanged" | "review"; person: BrandPersonSummary | null; conflictId: string | null }
export type PeopleErrorCode =
  | "people_forbidden" | "people_not_found" | "people_limit_invalid" | "people_search_invalid"
  | "people_cursor_invalid" | "people_name_invalid" | "people_email_invalid" | "people_phone_invalid"
  | "people_contact_required" | "people_idempotency_conflict" | "people_temporarily_unavailable" | "people_unknown";
