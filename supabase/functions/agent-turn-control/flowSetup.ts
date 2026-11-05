/**
 * Issue #2830 — who is on Website setup, and taking it over. Sibling of
 * flowResume: not a turn, no attempt row, no rate limit. The Business setup
 * screen is the only caller.
 *
 * A teammate's view never carries `answers`, `step_states`, `current_artefact`
 * or a chat id: one person must not read another's answers through this.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  createFlowStore,
  type FlowBrandRun,
  FlowConflict,
  FlowEngineUnavailable,
  type FlowStore,
  readFlowEngineEnabled,
} from "../_shared/ariFlows/store.ts";
import type { FlowRun } from "../_shared/ariFlows/types.ts";
import { WEBSITE_SETUP_FLOW_KEY } from "../_shared/ariFlows/websiteSetup.ts";

export const FLOW_TAKE_OVER_CONFLICTS: ReadonlySet<string> = new Set([
  "flow_run_active",
  "flow_run_busy",
  "flow_run_terminal",
  "flow_revision_conflict",
  "flow_brand_paused",
]);

type Result = { status: number; body: Record<string, unknown> };

export function flowSetupView(
  run: FlowRun,
  extra: Pick<FlowBrandRun, "can_take_over" | "last_takeover">,
): Record<string, unknown> {
  return {
    run_id: run.id,
    status: run.status,
    step_key: run.current_step_key,
    revision: run.revision,
    mine: run.started_by_me,
    stopped: run.stopped,
    owner_name: run.started_by_name,
    owner_since: run.owner_since,
    last_activity_at: run.last_activity_at,
    conversation_id: run.started_by_me ? run.conversation_id : null,
    can_take_over: extra.can_take_over,
    last_takeover: extra.last_takeover,
  };
}

export async function flowSetupState(args: {
  service: SupabaseClient;
  userId: string;
  brandId: string;
  enabled?: boolean;
  store?: FlowStore;
}): Promise<Result> {
  if (!(args.enabled ?? await readFlowEngineEnabled(args.service))) {
    return { status: 200, body: { flow: null } };
  }
  const store = args.store ?? createFlowStore(args.service, args.userId);
  try {
    const found = await store.brandRun?.(args.brandId, WEBSITE_SETUP_FLOW_KEY);
    return {
      status: 200,
      body: { flow: found ? flowSetupView(found.run, found) : null },
    };
  } catch (error) {
    if (error instanceof FlowEngineUnavailable) {
      return { status: 200, body: { flow: null } };
    }
    if (error instanceof FlowConflict && error.code === "forbidden") {
      return { status: 403, body: { code: "FORBIDDEN" } };
    }
    return { status: 503, body: { code: "SETUP_STATE_UNAVAILABLE" } };
  }
}

export async function flowTakeOver(args: {
  service: SupabaseClient;
  userId: string;
  runId: string;
  expectedRevision: number;
  mode: "continue" | "take_over";
  conversationId: string | null;
  store?: FlowStore;
}): Promise<Result> {
  const store = args.store ?? createFlowStore(args.service, args.userId);
  try {
    if (!store.takeOver) {
      return { status: 503, body: { code: "TAKEOVER_UNAVAILABLE" } };
    }
    const taken = await store.takeOver({
      runId: args.runId,
      conversationId: args.conversationId,
      expectedRevision: args.expectedRevision,
      mode: args.mode,
    });
    const found = await store.brandRun?.(
      taken.run.brand_id,
      WEBSITE_SETUP_FLOW_KEY,
    ).catch(() => null) ?? null;
    return {
      status: 200,
      body: {
        changed: taken.changed,
        flow: flowSetupView(taken.run, {
          can_take_over: found?.can_take_over ?? true,
          last_takeover: found?.last_takeover ?? null,
        }),
      },
    };
  } catch (error) {
    if (error instanceof FlowEngineUnavailable) {
      return { status: 503, body: { code: "TAKEOVER_UNAVAILABLE" } };
    }
    if (error instanceof FlowConflict) {
      if (error.code === "forbidden") {
        return { status: 403, body: { code: "FORBIDDEN" } };
      }
      if (FLOW_TAKE_OVER_CONFLICTS.has(error.code)) {
        return { status: 409, body: { code: error.code } };
      }
    }
    return { status: 503, body: { code: "TAKEOVER_UNAVAILABLE" } };
  }
}
