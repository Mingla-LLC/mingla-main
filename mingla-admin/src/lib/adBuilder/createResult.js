/**
 * ISSUE-979 Bug 2 [Campaign Builder correctness] — classify an
 * admin-ad-create-campaign response into the HONEST UI outcome.
 *
 * The bug this fixes (false "Created" toast): the wizard used to treat any
 * response that was not truthy-`validated` as a create success. But
 * TikTok / Snapchat / Reddit have NO validate-only mode, so a `validate_only`
 * call to them legitimately returns `{ validated: false, skipped_layers: [...] }`
 * — NOTHING was created or validated. The old code fired
 * "Created on <platform>. Nothing is spending yet." for that response, which is
 * a lie.
 *
 * The rule established here — success is only ever one of two proven states:
 *   1. `validated === true`  → the platform ran a real dry-run (Meta/Google).
 *   2. a `campaign` object is present → a real object was created.
 * Everything else is the honest "no dry-run / nothing happened" state, which
 * must NEVER show the "Created" toast.
 */

/** @typedef {"validated"|"created"|"novalidate"} CreateOutcome */

/**
 * @param {object|null|undefined} data — the create-campaign success body.
 * @returns {{ outcome: CreateOutcome, showCreatedToast: boolean,
 *            campaign: object|null, validatedLayers: any[], skippedLayers: any[],
 *            detail: string|null }}
 */
export function classifyCreateResult(data) {
  // 1. A real platform-side dry-run (Meta/Google validate_only).
  if (data?.validated === true) {
    return {
      outcome: "validated",
      showCreatedToast: false,
      campaign: null,
      validatedLayers: Array.isArray(data.validated_layers) ? data.validated_layers : [],
      skippedLayers: Array.isArray(data.skipped_layers) ? data.skipped_layers : [],
      detail: typeof data.detail === "string" ? data.detail : null,
    };
  }
  // 2. A real created object (a real create, any platform).
  if (data?.campaign) {
    return {
      outcome: "created",
      showCreatedToast: true,
      campaign: data.campaign,
      validatedLayers: [],
      skippedLayers: [],
      detail: typeof data?.detail === "string" ? data.detail : null,
    };
  }
  // 3. Honest "nothing happened": TikTok/Snap/Reddit have no validate-only mode
  //    (validated:false, layers skipped), or the create returned no object.
  //    NEVER a "Created" toast — nothing was created or validated.
  return {
    outcome: "novalidate",
    showCreatedToast: false,
    campaign: null,
    validatedLayers: Array.isArray(data?.validated_layers) ? data.validated_layers : [],
    skippedLayers: Array.isArray(data?.skipped_layers) ? data.skipped_layers : [],
    detail: typeof data?.detail === "string" ? data.detail : null,
  };
}
