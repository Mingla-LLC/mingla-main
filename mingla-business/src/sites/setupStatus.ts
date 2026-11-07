/**
 * #2830 — the one display status of a Website setup step, who else is on setup,
 * and how the draft build is going. Pure, so the list, the header, the Website
 * navigation and the tests can never disagree.
 *
 * MINGLA-INVARIANT: I-WEBSITE-SETUP-TICK-MEANS-NOTHING-OPEN | issue #2830 | setup_status part done implies empty open_fields, unless published; a tick here only ever comes from that.
 */
import { PLAN_PARTS, planBuildBlockers, type PlanPartKey } from "../../../packages/site-contracts/src/sitePlan.ts";
import { planBuildDone, type BrandContextField, type BrandContextFieldState, type RawSetupPart, type RawSetupStatus, type SitePlanState } from "./sitePlanState";

export type { RawSetupPart, RawSetupStatus };

export type SetupStatusField = { key: string; label: string; state: BrandContextFieldState };

export type SetupStepStatus =
  | { kind: "not_started" }
  | { kind: "open"; left: number; fields: SetupStatusField[] }
  | { kind: "needs_upload"; left: number; fields: SetupStatusField[] }
  | { kind: "done" }
  | { kind: "skipped" }
  | { kind: "failed"; reason: "draft" | "publish" };

export type SetupStep = {
  key: PlanPartKey;
  label: string;
  status: SetupStepStatus;
  /** Only rank 50 or above can do it. */
  ownerOnly: boolean;
};

const OWNER_ONLY: ReadonlySet<PlanPartKey> = new Set<PlanPartKey>(["approve", "build", "publish"]);

const partlyThere = (field: BrandContextField): boolean => field.state !== "missing";

export function setupSteps(input: {
  setupStatus: RawSetupStatus | null;
  /** Used while `setupStatus` is absent (between deploy and migration). */
  fallbackParts?: readonly { key: PlanPartKey; done: boolean; skipped: boolean }[];
  fields: readonly BrandContextField[];
  draftFailed: boolean;
  publishFailed: boolean;
}): { steps: SetupStep[]; doneCount: number; total: number; nextKey: PlanPartKey | null } {
  const raw = new Map<PlanPartKey, RawSetupPart>();
  for (const part of input.setupStatus?.parts ?? []) raw.set(part.key, part);
  const fallback = new Map(input.fallbackParts?.map((part) => [part.key, part]) ?? []);
  const fieldByKey = new Map(input.fields.map((field) => [field.key, field]));
  const steps: SetupStep[] = PLAN_PARTS.map((meta) => {
    const key = meta.key;
    const part: RawSetupPart = raw.get(key) ?? {
      key,
      done: fallback.get(key)?.done === true && fallback.get(key)?.skipped !== true,
      skipped: key === "first_offering" && fallback.get(key)?.skipped === true,
      fieldCount: 0,
      openFields: [],
    };
    const openRows = part.openFields.map((fieldKey) => fieldByKey.get(fieldKey)).filter((row): row is BrandContextField => row !== undefined);
    const named: SetupStatusField[] = openRows.map((row) => ({ key: row.key, label: row.label, state: row.state }));
    let status: SetupStepStatus;
    if (key === "build" && input.draftFailed) status = { kind: "failed", reason: "draft" };
    else if (key === "publish" && input.publishFailed) status = { kind: "failed", reason: "publish" };
    else if (part.done) status = { kind: "done" };
    else if (part.skipped) status = { kind: "skipped" };
    else if (part.openFields.length > 0 && openRows.length === part.openFields.length && openRows.every((row) => row.humanActionRequired)) {
      status = { kind: "needs_upload", left: part.openFields.length, fields: named };
    } else if (part.openFields.length > 0 && (part.openFields.length < part.fieldCount || openRows.some(partlyThere))) {
      status = { kind: "open", left: part.openFields.length, fields: named };
    } else status = { kind: "not_started" };
    return { key, label: meta.label, status, ownerOnly: OWNER_ONLY.has(key) };
  });
  const doneCount = steps.filter((step) => step.status.kind === "done" || step.status.kind === "skipped").length;
  return {
    steps,
    doneCount,
    total: steps.length,
    nextKey: steps.find((step) => step.status.kind !== "done" && step.status.kind !== "skipped")?.key ?? null,
  };
}

/** #2830 — Ari's build rule over this screen's plan read (one rule, `planBuildBlockers`). */
export function setupBuildBlockers(plan: SitePlanState): { key: string; label: string }[] {
  if (planBuildDone(plan)) return [];
  return planBuildBlockers({
    partDone: (key) => plan.parts.some((part) => part.key === key && part.done),
    contextComplete: plan.completeness?.contextComplete === true,
    fields: plan.completeness?.fields ?? [],
    labelOf: (field, key) => (typeof field.label === "string" && field.label ? field.label : key),
  });
}

/** Where "Go to what's missing" goes: the first open part before Build. */
export function firstMissingStep(plan: SitePlanState | null, blockers: readonly { key: string }[], nextKey: PlanPartKey | null): PlanPartKey | null {
  if (nextKey && nextKey !== "build") return nextKey;
  const first = blockers[0];
  if (!first) return null;
  if (first.key.startsWith("part:")) return first.key.slice(5) as PlanPartKey;
  const owner = plan?.setupStatus?.parts.find((part) => part.openFields.includes(first.key));
  return owner && owner.key !== "build" ? owner.key : "brand";
}

/**
 * #2830 — where "Next" goes from a step: the first part after it that is
 * still open (not done, not skipped), else simply the one after it.
 */
export function nextOpenStep(steps: readonly SetupStep[], key: PlanPartKey): PlanPartKey {
  const at = steps.findIndex((row) => row.key === key);
  const after = steps.slice(at + 1);
  return after.find((row) => row.status.kind !== "done" && row.status.kind !== "skipped")?.key ?? after[0]?.key ?? key;
}

/**
 * #2830 — the form follows Ari's part. Only a MOVE of Ari's run (a new
 * current_step_key) moves the form, so a person who goes to another part by
 * hand afterwards stays there until Ari moves again. Returns the part to
 * open, or null to stay.
 */
export function ariStepToFollow(lastSeen: string | null, current: string | null | undefined): PlanPartKey | null {
  if (!current || current === lastSeen) return null;
  return PLAN_PARTS.find((part) => part.key === current)?.key ?? null;
}

/** The words beside a step. The ring or tick is decided by `setupStepMark`. */
export function setupStepChip(status: SetupStepStatus): string | null {
  switch (status.kind) {
    case "open": return `${status.left} left`;
    case "needs_upload": return "Needs your upload";
    case "skipped": return "Skipped";
    case "failed": return "Didn't work";
    case "done": return "Done";
    case "not_started": return null;
  }
}

export function setupStepMark(status: SetupStepStatus): "tick" | "ring" | "ring_now" {
  if (status.kind === "done") return "tick";
  if (status.kind === "open" || status.kind === "needs_upload" || status.kind === "failed") return "ring_now";
  return "ring";
}

// ── Presence ───────────────────────────────────────────────────────────────

export type SetupFlowView = {
  runId: string;
  status: string;
  stepKey: string | null;
  revision: number;
  mine: boolean;
  stopped: boolean;
  ownerName: string | null;
  ownerSince: string | null;
  lastActivityAt: string | null;
  conversationId: string | null;
  canTakeOver: boolean;
  lastTakeover: { toName: string; fromName: string; kind: string; createdAt: string } | null;
};

export type SetupLockView = { active: boolean; heldByMe: boolean; holderName: string | null };

export type SetupPresence =
  | { kind: "paused" }
  | { kind: "free" }
  | { kind: "stopped"; name: string; since: string | null; stepKey: string | null; canContinue: boolean }
  | { kind: "active"; source: "ari" | "hand"; name: string; stepKey: string | null; canTakeOver: boolean }
  | { kind: "displaced"; name: string };

/** Who, when the server has no name for them. Starts a sentence; see `nameInSentence`. */
export const UNNAMED_TEAMMATE = "Your teammate";
const nameOf = (value: string | null | undefined): string => (value && value.trim() ? value.trim() : UNNAMED_TEAMMATE);
/** A name placed mid-sentence: "tell your teammate why", never "tell Your teammate why". */
export const nameInSentence = (name: string): string => (name === UNNAMED_TEAMMATE ? "your teammate" : name);

export function setupPresence(input: {
  paused: boolean;
  flow: SetupFlowView | null;
  lock: SetupLockView | null;
  canManage: boolean;
  /** This screen held the form lock a moment ago. */
  wasMine: boolean;
  /** This screen owned the run a moment ago. A lapsed lock says nothing about it. */
  wasMyRun?: boolean;
}): SetupPresence {
  const { flow, lock } = input;
  if (input.paused) return { kind: "paused" };
  const theirs = flow !== null && !flow.mine;
  if (theirs && input.wasMyRun) return { kind: "displaced", name: nameOf(flow.ownerName) };
  if (theirs && !flow.stopped) {
    return { kind: "active", source: "ari", name: nameOf(flow.ownerName), stepKey: flow.stepKey, canTakeOver: flow.canTakeOver && input.canManage };
  }
  if (lock?.active && !lock.heldByMe) {
    if (input.wasMine) return { kind: "displaced", name: nameOf(lock.holderName) };
    return { kind: "active", source: "hand", name: nameOf(lock.holderName), stepKey: flow?.stepKey ?? null, canTakeOver: input.canManage };
  }
  if (theirs && flow.stopped) {
    return { kind: "stopped", name: nameOf(flow.ownerName), since: flow.ownerSince, stepKey: flow.stepKey, canContinue: flow.canTakeOver && input.canManage };
  }
  return { kind: "free" };
}

// ── Draft ──────────────────────────────────────────────────────────────────

export const DRAFT_CHECK_AFTER_MS = 90_000;
export const DRAFT_GIVE_UP_MS = 5 * 60_000;

export type SetupDraftState =
  | { kind: "ready" }
  | { kind: "building" }
  | { kind: "not_ready" }
  | { kind: "can_start" }
  | { kind: "checking" }
  | { kind: "failed"; retry: "new_operation" | "same_operation" | "compose" };

export type SetupDraftSite = {
  status: string;
  provisioning_error_code?: string | null;
  latest_provision_operation?: {
    operation_id?: string | null;
    status?: string | null;
    error_code?: string | null;
    updated_at?: string | null;
  } | null;
} | null;

/** Server truth only. Age comes from the receipt the server wrote. */
export function setupDraftState(input: {
  site: SetupDraftSite;
  buildDone: boolean;
  approved: boolean;
  composePending: boolean;
  composeFailed: boolean;
  ensurePending: boolean;
  now: number;
}): SetupDraftState {
  const { site } = input;
  const inProgress = site !== null && site.status === "provisioning";
  const failedStatus = site !== null && site.status === "error";
  if (site !== null && !inProgress && !failedStatus && input.buildDone) return { kind: "ready" };
  // Paused by Mingla: nothing is being built, and nothing can be started.
  if (site?.status === "suspended") return { kind: "not_ready" };
  if (input.ensurePending || input.composePending) return { kind: "building" };
  if (site === null) return input.approved ? { kind: "can_start" } : { kind: "not_ready" };
  const receipt = site.latest_provision_operation ?? null;
  if (failedStatus || site.provisioning_error_code || receipt?.status === "failed" || (inProgress && !receipt)) {
    return { kind: "failed", retry: "new_operation" };
  }
  if (inProgress) {
    const updated = receipt?.updated_at ? Date.parse(receipt.updated_at) : Number.NaN;
    const age = Number.isNaN(updated) ? DRAFT_GIVE_UP_MS : input.now - updated;
    if (age >= DRAFT_GIVE_UP_MS) return { kind: "failed", retry: "same_operation" };
    if (receipt?.status === "ambiguous" || age >= DRAFT_CHECK_AFTER_MS) return { kind: "checking" };
    return { kind: "building" };
  }
  if (input.composeFailed) return { kind: "failed", retry: "compose" };
  return input.approved ? { kind: "building" } : { kind: "not_ready" };
}
