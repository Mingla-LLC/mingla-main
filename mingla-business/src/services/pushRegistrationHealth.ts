/**
 * #4549 S1 — the Host app checks and repairs its own push setup.
 *
 * Runs at launch (warm restore), at sign-in and when the app returns to the
 * front. It waits for the push SDK (bounded), reads what the device can see
 * (permission, subscription id, token, opted-in, linked account), runs the
 * smallest repair that fits, re-reads, and reports the result to Mingla's
 * server (`report_host_push_device`). The server answers `reregister` when the
 * push provider refuses this device; the app then resubscribes once per launch.
 *
 * What the device cannot see (whether Apple or Google accept its token) only
 * the provider knows; host-push-reconcile asks it and queues the `reregister`.
 *
 * Bounded by construction: at most one run in flight, foreground runs at most
 * every 5 minutes, 4 SDK waits per run, one local and one server-asked
 * resubscribe per launch. A device that cannot be repaired is reported and
 * left alone until the next launch. Every failure goes to Sentry through
 * reportNonFatal with no ids in the message.
 *
 * Every SDK call stays in oneSignalService.ts; this module is the only caller
 * of its registration exports. Web uses pushRegistrationHealth.web.ts (no-op).
 */

import { Platform } from "react-native";

import { reportNonFatal } from "../diagnostics/reportNonFatal";
import {
  isPushAvailableInBuild,
  onOneSignalLogout,
  readPushRegistrationState,
  repairPushRegistration,
  whenOneSignalReady,
  type PushRegistrationState,
  type PushRepairStep,
} from "./oneSignalService";
import { supabase } from "./supabase";

export type PushHealthReason = "launch" | "sign_in" | "foreground";

const SDK_READY_TIMEOUT_MS = 15_000;
/** Pause before each SDK wait: 4 waits per run, then stop until the next run. */
const SDK_READY_RETRY_DELAYS_MS: readonly number[] = [
  2_000, 5_000, 15_000, 60_000,
];
const REPAIR_SETTLE_MS = 3_000;
const FOREGROUND_MIN_INTERVAL_MS = 5 * 60 * 1000;

const SCOPE = "push.registration";

interface Deps {
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const defaultDeps: Deps = {
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};
let deps: Deps = defaultDeps;

interface ReportArgs {
  p_subscription_id: string;
  p_platform: "ios" | "android";
  p_app_build: string | null;
  p_permission: PushRegistrationState["permission"];
  p_opted_in: boolean;
  p_token_present: boolean;
  p_linked: boolean;
  p_reason: PushHealthReason;
}

let inFlight: Promise<void> | null = null;
let queued: { userId: string; reason: PushHealthReason } | null = null;
let lastFinishedAt = Number.NEGATIVE_INFINITY;
let localResubscribeUsed = false;
let serverResubscribeUsed = false;
let unsentReport: { userId: string; args: ReportArgs } | null = null;

// #4549 P1-1: every run is tied to the account and the generation it started
// for. Sign-out (logoutOneSignal) bumps the generation synchronously, wakes
// every pending wait, drops the queued run and the unsent report, so nothing
// the old run does afterwards can link, opt in or report.
let generation = 0;
const CANCELLED = Symbol("cancelled");
let wakeWaiters: Array<() => void> = [];

function cancelPendingRuns(): void {
  generation += 1;
  queued = null;
  unsentReport = null;
  // #4549 P3-3 (retest): the once-per-launch resubscribe budgets belong to the
  // account that was signed in; a sign-out (even one landing between taking
  // the budget and the repair) gives the next account its own.
  localResubscribeUsed = false;
  serverResubscribeUsed = false;
  const waiters = wakeWaiters;
  wakeWaiters = [];
  for (const wake of waiters) wake();
}

let logoutHookAttached = false;
function attachLogoutHook(): void {
  if (logoutHookAttached) return;
  // Guarded because some suites mock oneSignalService without this export.
  if (typeof onOneSignalLogout !== "function") return;
  onOneSignalLogout(cancelPendingRuns);
  logoutHookAttached = true;
}

class RunCancelled extends Error {
  constructor() {
    super("run_cancelled");
  }
}

interface RunContext {
  userId: string;
  gen: number;
}

const alive = (ctx: RunContext): boolean => ctx.gen === generation;

/** A wait that ends at once (and throws RunCancelled) when the run is cancelled. */
async function cancellable<T>(ctx: RunContext, work: Promise<T>): Promise<T> {
  if (!alive(ctx)) throw new RunCancelled();
  let wake: (() => void) | null = null;
  const cancelled = new Promise<typeof CANCELLED>((resolve) => {
    wake = () => resolve(CANCELLED);
    wakeWaiters.push(wake);
  });
  try {
    const result = await Promise.race([work, cancelled]);
    if (result === CANCELLED || !alive(ctx)) throw new RunCancelled();
    return result as T;
  } finally {
    wakeWaiters = wakeWaiters.filter((w) => w !== wake);
  }
}

/**
 * Re-reads the signed-in account right before an action that links, opts in
 * or reports. Throws RunCancelled when the run is stale or the session belongs
 * to anyone else (or no one).
 */
async function assertStillCurrent(ctx: RunContext): Promise<void> {
  if (!alive(ctx)) throw new RunCancelled();
  const { data } = await cancellable(ctx, supabase.auth.getSession());
  const current = data.session?.user?.id ?? null;
  if (!alive(ctx) || current !== ctx.userId) throw new RunCancelled();
}

/**
 * #4549 P2-A: a build without push (native module not linked, or no app id)
 * has nothing to check or repair, so every entry point returns at once and
 * quietly: no waits, no reports. Guarded because some suites mock
 * oneSignalService without this export; there it counts as available, which
 * is the behaviour those suites were written against.
 */
function pushAvailable(): boolean {
  return typeof isPushAvailableInBuild === "function"
    ? isPushAvailableInBuild()
    : true;
}

function nativePlatform(): "ios" | "android" | null {
  return Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : null;
}

function installedBuild(): string | null {
  try {
    // Loaded on use: keeps expo-constants off this module's import path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const identity = require("./appVersionIdentity") as {
      getInstalledNativeBuildVersion: () => string | null;
    };
    return identity.getInstalledNativeBuildVersion();
  } catch (error) {
    reportNonFatal(SCOPE, error, { step: "app_build" });
    return null;
  }
}

async function waitForSdk(ctx: RunContext): Promise<boolean> {
  for (const delay of SDK_READY_RETRY_DELAYS_MS) {
    await cancellable(ctx, deps.sleep(delay));
    if (await cancellable(ctx, whenOneSignalReady(SDK_READY_TIMEOUT_MS))) {
      return true;
    }
  }
  return false;
}

async function repairAndReread(
  ctx: RunContext,
  step: PushRepairStep,
  repairs: PushRepairStep[],
): Promise<PushRegistrationState> {
  await assertStillCurrent(ctx);
  repairs.push(step);
  const ok = await cancellable(
    ctx,
    repairPushRegistration(ctx.userId, step, () => alive(ctx)),
  );
  if (!alive(ctx)) throw new RunCancelled();
  if (!ok) reportNonFatal(SCOPE, new Error("repair_step_failed"), { step });
  await cancellable(ctx, deps.sleep(REPAIR_SETTLE_MS));
  return cancellable(ctx, readPushRegistrationState());
}

/** Returns the server's action, or null when the report could not be sent. */
async function sendReport(
  ctx: RunContext,
  args: ReportArgs,
): Promise<"none" | "reregister" | null> {
  // The report is filed under the session's account (auth.uid()), so it is
  // sent only while that account is still this run's account.
  await assertStillCurrent(ctx);
  const userId = ctx.userId;
  try {
    const { data, error } = await supabase.rpc("report_host_push_device", args);
    if (!alive(ctx)) throw new RunCancelled();
    if (error) throw new Error(error.message);
    unsentReport = null;
    const action = (data as { action?: unknown } | null)?.action;
    return action === "reregister" ? "reregister" : "none";
  } catch (error) {
    if (error instanceof RunCancelled) throw error;
    // Network or server failure: keep the latest result and send it next run.
    unsentReport = { userId, args };
    reportNonFatal(SCOPE, error, { step: "report", reason: args.p_reason });
    return null;
  }
}

function buildReport(
  state: PushRegistrationState,
  userId: string,
  reason: PushHealthReason,
): ReportArgs | null {
  const platform = nativePlatform();
  if (platform === null || state.subscriptionId === null) return null;
  return {
    p_subscription_id: state.subscriptionId,
    p_platform: platform,
    p_app_build: installedBuild(),
    p_permission: state.permission,
    p_opted_in: state.optedIn,
    p_token_present: state.tokenPresent,
    p_linked: state.externalId === userId,
    p_reason: reason,
  };
}

async function runOnce(ctx: RunContext, reason: PushHealthReason): Promise<void> {
  const userId = ctx.userId;
  if (!(await waitForSdk(ctx))) {
    // The cold-start re-link used to return silently here. Now it is reported
    // and retried at the next launch or foreground.
    reportNonFatal(SCOPE, new Error("sdk_not_ready"), { reason });
    if (unsentReport && unsentReport.userId === userId) {
      await sendReport(ctx, unsentReport.args);
    }
    return;
  }

  const repairs: PushRepairStep[] = [];
  let state = await cancellable(ctx, readPushRegistrationState());

  // Linked to another account (account switch) or no subscription yet.
  if (state.externalId !== userId || !state.subscriptionIdPresent) {
    state = await repairAndReread(ctx, "relink", repairs);
  }

  // Permission granted but not receiving: relink, then resubscribe once.
  if (state.permission === "granted" && (!state.optedIn || !state.tokenPresent)) {
    if (!repairs.includes("relink")) {
      state = await repairAndReread(ctx, "relink", repairs);
    }
    if (!state.optedIn && !localResubscribeUsed) {
      localResubscribeUsed = true;
      state = await repairAndReread(ctx, "resubscribe", repairs);
    }
  }
  // Denied: the person's choice. No repair, no prompt (App Store 4.5.4).
  // Never asked: usePushPermissionMoment asks at the value moment.

  const report = buildReport(state, userId, reason);
  if (report === null) {
    reportNonFatal(SCOPE, new Error("no_subscription_id"), {
      reason,
      repairs: repairs.join(","),
      permission: state.permission,
    });
    if (unsentReport && unsentReport.userId === userId) {
      await sendReport(ctx, unsentReport.args);
    }
    return;
  }
  if (repairs.length > 0 && state.externalId !== userId) {
    reportNonFatal(SCOPE, new Error("still_unlinked_after_repair"), { reason });
  }

  const action = await sendReport(ctx, report);
  if (action === "reregister" && !serverResubscribeUsed) {
    serverResubscribeUsed = true;
    state = await repairAndReread(ctx, "resubscribe", repairs);
    const after = buildReport(state, userId, reason);
    if (after !== null) await sendReport(ctx, after);
  }
}

/**
 * Check and repair this device's push setup for `userId`. Never throws and
 * never blocks the UI: callers fire and forget.
 */
export function ensurePushRegistration(
  userId: string,
  reason: PushHealthReason,
): Promise<void> {
  if (nativePlatform() === null || userId.length === 0 || !pushAvailable()) {
    return Promise.resolve();
  }
  attachLogoutHook();
  if (
    reason === "foreground" &&
    deps.now() - lastFinishedAt < FOREGROUND_MIN_INTERVAL_MS
  ) {
    return Promise.resolve();
  }
  if (inFlight !== null) {
    // One run at a time. A sign-in or launch that arrives mid-run runs next;
    // a foreground run is dropped (the running one covers it).
    if (reason !== "foreground") queued = { userId, reason };
    return inFlight;
  }
  const run = (async (): Promise<void> => {
    try {
      await runOnce({ userId, gen: generation }, reason);
    } catch (error) {
      // A cancelled run (sign-out or another account) stops quietly: that is
      // the intended outcome, not a failure.
      if (!(error instanceof RunCancelled)) {
        reportNonFatal(SCOPE, error, { step: "run", reason });
      }
    } finally {
      lastFinishedAt = deps.now();
      inFlight = null;
      const next = queued;
      queued = null;
      if (next !== null) void ensurePushRegistration(next.userId, next.reason);
    }
  })();
  inFlight = run;
  return run;
}

/**
 * The foreground entry point: the signed-in account comes from the stored
 * session, so a signed-out app never relinks a previous account.
 */
export async function ensurePushRegistrationOnForeground(): Promise<void> {
  if (nativePlatform() === null || !pushAvailable()) return;
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id;
    if (typeof userId !== "string" || userId.length === 0) return;
    await ensurePushRegistration(userId, "foreground");
  } catch (error) {
    reportNonFatal(SCOPE, error, { step: "foreground_session" });
  }
}

/** Tests only: reset per-launch state and inject time. */
export function __resetPushRegistrationHealthForTests(next?: Partial<Deps>): void {
  deps = { ...defaultDeps, ...next };
  inFlight = null;
  queued = null;
  lastFinishedAt = Number.NEGATIVE_INFINITY;
  localResubscribeUsed = false;
  serverResubscribeUsed = false;
  unsentReport = null;
  generation += 1;
  wakeWaiters = [];
}
