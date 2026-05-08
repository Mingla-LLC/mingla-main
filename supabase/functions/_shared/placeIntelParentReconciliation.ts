export const TRIAL_TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
export const CHILD_RECONCILE_PAGE_SIZE = 1000;

export interface ParentRunCounterSnapshot {
  status: string;
  total_count: number | null;
  processed_count: number | null;
  succeeded_count: number | null;
  failed_count: number | null;
  cost_so_far_usd: number | null;
}

export interface TrialChildCounterRow {
  status: string | null;
  cost_usd: number | null;
}

export interface ParentReconciliationUpdate {
  processed_count: number;
  succeeded_count: number;
  failed_count: number;
  cost_so_far_usd: number;
  status: "complete" | "cancelled";
  completed_at: string;
}

export interface ChildTruthReconciliationResult {
  finalized: boolean;
  reason: string;
  totalChildren: number;
  terminalChildren: number;
  completedChildren: number;
  failedChildren: number;
  cancelledChildren: number;
  nonterminalChildren: number;
  updatePayload?: ParentReconciliationUpdate;
}

export function deriveParentReconciliation(
  parent: ParentRunCounterSnapshot,
  children: TrialChildCounterRow[],
  completedAt: string,
): ChildTruthReconciliationResult {
  let completedChildren = 0;
  let failedChildren = 0;
  let cancelledChildren = 0;
  let nonterminalChildren = 0;
  let costSoFarUsd = 0;

  for (const child of children) {
    const status = String(child.status ?? "");
    if (status === "completed") completedChildren++;
    else if (status === "failed") failedChildren++;
    else if (status === "cancelled") cancelledChildren++;
    else if (!TRIAL_TERMINAL_STATUSES.has(status)) nonterminalChildren++;
    costSoFarUsd += Number(child.cost_usd ?? 0);
  }

  const totalChildren = children.length;
  const terminalChildren = completedChildren + failedChildren + cancelledChildren;
  const resultBase = {
    totalChildren,
    terminalChildren,
    completedChildren,
    failedChildren,
    cancelledChildren,
    nonterminalChildren,
  };

  const parentTotal = Number(parent.total_count ?? 0);
  if (totalChildren === 0) {
    return { finalized: false, reason: "no_children", ...resultBase };
  }
  if (nonterminalChildren > 0 || terminalChildren < parentTotal) {
    return { finalized: false, reason: "children_not_terminal", ...resultBase };
  }

  const finalStatus: ParentReconciliationUpdate["status"] = ["cancelling", "cancelled"].includes(parent.status)
    ? "cancelled"
    : "complete";
  const updatePayload = {
    processed_count: terminalChildren,
    succeeded_count: completedChildren,
    failed_count: failedChildren,
    cost_so_far_usd: costSoFarUsd,
    status: finalStatus,
    completed_at: completedAt,
  };

  const alreadyAligned = parent.status === finalStatus
    && Number(parent.processed_count ?? 0) === updatePayload.processed_count
    && Number(parent.succeeded_count ?? 0) === updatePayload.succeeded_count
    && Number(parent.failed_count ?? 0) === updatePayload.failed_count
    && Math.abs(Number(parent.cost_so_far_usd ?? 0) - updatePayload.cost_so_far_usd) < 0.000001;

  return {
    finalized: true,
    reason: alreadyAligned ? "already_aligned" : "reconciled_from_children",
    ...resultBase,
    updatePayload,
  };
}
