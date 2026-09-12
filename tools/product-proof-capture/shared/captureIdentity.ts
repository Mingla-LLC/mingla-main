export const CAPTURE_SENTINEL = "MINGLA_3176_PRODUCT_PROOF_CAPTURE_ONLY";
export const CAPTURE_BASELINE_COMMIT = "925aab769cd4970336c16d80391db15773012607";

export function assertCaptureRuntime(input: { enabled: boolean; baseline: string }): void {
  if (!input.enabled) throw new Error("capture_harness_flag_required");
  if (process.env.NODE_ENV === "production") throw new Error("capture_harness_forbidden_in_production");
  if (process.env.EAS_BUILD_PROFILE) throw new Error("capture_harness_forbidden_in_eas");
  if (input.baseline !== CAPTURE_BASELINE_COMMIT) {
    throw new Error("capture_harness_commit_mismatch");
  }
}
