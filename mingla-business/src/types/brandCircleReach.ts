export type BrandCircleRing = "follower" | "extended";
export type BrandCircleRequestRing = BrandCircleRing | "all";
export type BrandCircleAvailabilityReason =
  | "rollout_disabled" | "controls_not_live" | "refresh_pending"
  | "refresh_failed" | "freshness_expired" | "authority_unavailable";
export interface BrandCircleCursor { snapshotVersion:number; ringOrder:2|3; sortName:string; memberId:string }
export interface BrandCircleMember { memberId:string; ring:BrandCircleRing; displayName:string; avatarUrl:string|null; reasonCode:"follows_brand"|"extended_circle"; reasonLabel:"Follows your brand."|"In your extended circle." }
export interface BrandCircleAvailability { state:"ready"|"unavailable"; reason:BrandCircleAvailabilityReason|null; refreshedAt:string|null; expiresAt:string|null }
export interface BrandCircleReachPage {
  schemaVersion:1; state:"ready"|"partial"|"unavailable"; snapshotVersion:number|null;
  counts:{followers:number|null;extended:number|null;total:number|null};
  availability:{followers:BrandCircleAvailability;extended:BrandCircleAvailability};
  rows:BrandCircleMember[]; nextCursor:BrandCircleCursor|null;
}
export type BrandCircleErrorCode = "circle_forbidden"|"circle_cursor_invalid"|"circle_cursor_stale"|"circle_limit_invalid"|"circle_ring_invalid"|"circle_temporarily_unavailable";
