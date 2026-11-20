/**
 * #3040 / ORCH-1083 — one async owner for cover and trip-day video authoring.
 *
 * CoverPicker and TripDayMediaSheet both need the canonical Bunny/TUS client.
 * If they create separate async boundaries Metro hoists their shared transport
 * into `__common`, making every Host visitor download upload-only code at boot.
 * Both surfaces therefore import this exact runtime specifier. Keeping the
 * cohesive authoring surface under one boundary is intentional: splitting its
 * picker and transport into sibling lazy chunks makes Metro hoist the transport
 * back into startup.
 */

export { CoverPicker } from "../components/ui/CoverPicker";
export * from "./eventCoverVideoProcessingService";
export * from "./eventCoverVideoPreparedSource";
// #4238 B7: the Host ad media step's background uploads and multi-picker ride
// the same boundary, so the shared transport never hoists into `__common`.
export { HostAdVideoUploadSlot } from "../components/marketing/ads/HostAdVideoUploadSlot";
export { launchAdVideosPicker } from "../components/marketing/ads/hostAdVideoPicker";
export { revokeCoverPickedAssets } from "../components/ui/coverPickerDeviceMedia";
export { normalizePickerDurationMs } from "../components/ui/coverPickerVideoTrimUpload";
