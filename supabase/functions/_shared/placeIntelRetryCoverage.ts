export type RetryFailureClass =
  | "gemini_quota_or_billing"
  | "malformed_function_call"
  | "transient_infra_or_db"
  | "prep_prerequisites_missing"
  | "structural_or_data"
  | "permission_or_config"
  | "other";

export type RetryFilter = "retryable_only" | "all_failed";

export interface FailedTrialRow {
  id: string;
  place_pool_id: string;
  error_message?: string | null;
}

export interface CompletedCoverageRow {
  place_pool_id: string | null;
}

export interface RetryClassification {
  failureClass: RetryFailureClass;
  retryable: boolean;
}

export interface RetrySelectionResult<
  T extends FailedTrialRow = FailedTrialRow,
> {
  selectedRows: T[];
  retryableRows: T[];
  nonretryableRows: T[];
  failureClasses: Record<string, number>;
  retryableCount: number;
  nonretryableCount: number;
  failedCount: number;
}

export interface CoverageSummary {
  servable_count: number;
  scored_count: number;
  unscored_count: number;
  scored_percent: number;
}

const QUOTA_PATTERNS = [
  "prepayment credits",
  "resource_exhausted",
  "quota",
  "billing",
  "429",
];

const INFRA_PATTERNS = [
  "trial row update failed",
  "connection reset",
  "sendrequest",
  "fetch failed",
  "network",
  "timeout",
  "rest/v1",
  "supabase.co/rest",
];

const PERMISSION_CONFIG_PATTERNS = [
  "gemini_api_key not configured",
  "serper_api_key not configured",
  "admin access required",
  "missing authorization",
  "invalid token",
  "permission denied",
  "rls",
];

const STRUCTURAL_PATTERNS = [
  "place_pool fetch failed",
  "not found",
  "invalid",
  "schema",
  "validation",
];

function includesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

export function classifyPlaceIntelFailure(
  errorMessage?: string | null,
): RetryClassification {
  const raw = String(errorMessage ?? "").trim();
  const value = raw.toLowerCase();

  if (!value) {
    return { failureClass: "other", retryable: false };
  }

  if (includesAny(value, QUOTA_PATTERNS)) {
    return { failureClass: "gemini_quota_or_billing", retryable: true };
  }

  if (value.includes("malformed_function_call")) {
    return { failureClass: "malformed_function_call", retryable: true };
  }

  if (includesAny(value, INFRA_PATTERNS)) {
    return { failureClass: "transient_infra_or_db", retryable: true };
  }

  if (value.includes("prerequisites_missing")) {
    return { failureClass: "prep_prerequisites_missing", retryable: false };
  }

  if (includesAny(value, PERMISSION_CONFIG_PATTERNS)) {
    return { failureClass: "permission_or_config", retryable: false };
  }

  if (includesAny(value, STRUCTURAL_PATTERNS)) {
    return { failureClass: "structural_or_data", retryable: false };
  }

  return { failureClass: "other", retryable: false };
}

export function selectFailedRowsForRetry<T extends FailedTrialRow>(
  rows: T[],
  retryFilter: RetryFilter = "retryable_only",
): RetrySelectionResult<T> {
  const retryableRows: T[] = [];
  const nonretryableRows: T[] = [];
  const failureClasses: Record<string, number> = {};

  for (const row of rows) {
    const classification = classifyPlaceIntelFailure(row.error_message);
    failureClasses[classification.failureClass] =
      (failureClasses[classification.failureClass] ?? 0) + 1;
    if (classification.retryable) retryableRows.push(row);
    else nonretryableRows.push(row);
  }

  const selectedRows = retryFilter === "all_failed" ? rows : retryableRows;

  return {
    selectedRows,
    retryableRows,
    nonretryableRows,
    failureClasses,
    retryableCount: retryableRows.length,
    nonretryableCount: nonretryableRows.length,
    failedCount: rows.length,
  };
}

export function deriveCityCoverage(
  servableCount: number,
  completedRows: CompletedCoverageRow[],
): CoverageSummary {
  const completedPlaceIds = new Set<string>();
  for (const row of completedRows) {
    if (row.place_pool_id) completedPlaceIds.add(row.place_pool_id);
  }

  const scoredCount = completedPlaceIds.size;
  const safeServableCount = Math.max(0, Number(servableCount) || 0);
  const unscoredCount = Math.max(0, safeServableCount - scoredCount);
  const scoredPercent = safeServableCount === 0
    ? 0
    : Math.round((scoredCount / safeServableCount) * 1000) / 10;

  return {
    servable_count: safeServableCount,
    scored_count: scoredCount,
    unscored_count: unscoredCount,
    scored_percent: scoredPercent,
  };
}

export function buildRetryChildRows(args: {
  runId: string;
  cityId: string;
  rows: FailedTrialRow[];
  promptVersion: string;
  model: string;
}) {
  return args.rows.map((row) => ({
    run_id: args.runId,
    parent_run_id: args.runId,
    place_pool_id: row.place_pool_id,
    city_id: args.cityId,
    source_trial_run_id: row.id,
    signal_id: null,
    anchor_index: null,
    input_payload: {},
    status: "pending",
    prep_status: null,
    prompt_version: args.promptVersion,
    model: args.model,
    retry_count: 0,
  }));
}
