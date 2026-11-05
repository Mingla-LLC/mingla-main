/**
 * #2830 — Website setup's server calls, imported only inside the Website chunk.
 *
 * Calls `agent-turn-control` directly. It must never import agentChatService:
 * sharing that module across the Ari and Website chunks makes Metro hoist it
 * into `__common` for every Host (#3493).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import {
  BrandSitesError,
  createBrandSiteOperationId,
  persistProvisionOperation,
  provisionBrandSite,
} from "../services/brandSitesService";
import { brandSiteKeys } from "./brandSiteKeys";
import { composeBrandSiteFromPlan } from "./planApi";
import {
  setupDraftState,
  type SetupDraftSite,
  type SetupDraftState,
  type SetupFlowView,
} from "./setupStatus";

type Raw = Record<string, unknown>;
const obj = (value: unknown): Raw => (value && typeof value === "object" && !Array.isArray(value) ? value as Raw : {});
const str = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

export function normalizeSetupFlow(value: unknown): SetupFlowView | null {
  if (!value || typeof value !== "object") return null;
  const raw = obj(value);
  const runId = str(raw.run_id);
  if (!runId) return null;
  const last = raw.last_takeover ? obj(raw.last_takeover) : null;
  return {
    runId,
    status: String(raw.status ?? ""),
    stepKey: str(raw.step_key),
    revision: typeof raw.revision === "number" ? raw.revision : 0,
    mine: raw.mine === true,
    stopped: raw.stopped === true,
    ownerName: str(raw.owner_name),
    ownerSince: str(raw.owner_since),
    lastActivityAt: str(raw.last_activity_at),
    conversationId: str(raw.conversation_id),
    canTakeOver: raw.can_take_over === true,
    lastTakeover: last
      ? { toName: str(last.to_name) ?? "A teammate", fromName: str(last.from_name) ?? "A teammate", kind: String(last.kind ?? ""), createdAt: String(last.created_at ?? "") }
      : null,
  };
}

export class SetupFlowError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SetupFlowError";
  }
}

async function turnControl(body: Raw): Promise<Raw> {
  const { data, error } = await supabase.functions.invoke<Raw>("agent-turn-control", { body });
  if (error !== null) {
    const context = (error as { context?: { json?: () => Promise<unknown>; clone?: () => { json: () => Promise<unknown> } } }).context;
    const parsed = context && typeof context.json === "function"
      ? await (typeof context.clone === "function" ? context.clone().json() : context.json()).catch(() => null)
      : null;
    throw new SetupFlowError(str(obj(parsed).code) ?? "UNAVAILABLE");
  }
  return obj(data);
}

/** Who else is on setup. Polls only while it can change what this screen shows. */
export function useSetupFlowState(brandId: string, enabled: boolean, poll: boolean) {
  const { isAuthReady } = useAuth();
  return useQuery({
    queryKey: brandSiteKeys.flowState(brandId),
    enabled: isAuthReady && enabled && brandId.length > 0,
    staleTime: 0,
    refetchInterval: poll ? 15_000 : false,
    queryFn: async () => normalizeSetupFlow((await turnControl({ action: "flow_setup_state", brand_id: brandId })).flow),
  });
}

export function useTakeOverSetup(brandId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { runId: string; expectedRevision: number; mode: "continue" | "take_over"; conversationId?: string | null }) =>
      normalizeSetupFlow((await turnControl({
        action: "flow_take_over",
        run_id: input.runId,
        expected_revision: input.expectedRevision,
        mode: input.mode,
        ...(input.conversationId ? { conversation_id: input.conversationId } : {}),
      })).flow),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: brandSiteKeys.flowState(brandId) }),
        queryClient.invalidateQueries({ queryKey: brandSiteKeys.plan(brandId) }),
      ]);
    },
  });
}

/** "Doesn't apply to my brand". The RPC checks rank, lock and revision. */
export function useMarkNotApplicable(brandId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { fieldKey: string; contextRevision: string }) => {
      const { error } = await supabase.rpc("brand_context_mark_not_applicable", {
        p_brand_id: brandId,
        p_field_key: input.fieldKey,
        p_expected_context_revision: input.contextRevision,
      });
      if (error) throw new BrandSitesError(/locked/.test(error.message) ? "PLAN_LOCKED" : "UNAVAILABLE", "That didn't save", true);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: brandSiteKeys.plan(brandId) }),
  });
}

const CHECK_EVERY_MS = 20_000;
const MAX_CHECKS = 3;
const POLL_MS = 2_000;

/** A 503 or a timeout may have worked: the answer never arrived. */
function outcomeUnknown(error: unknown): boolean {
  return !(error instanceof BrandSitesError) || error.retryable === true;
}

/**
 * #2830 states 7 to 9, from server truth. A provision that never reported back
 * is replayed under its SAME operation id, which is idempotent on the server
 * and never makes a second website; it is not polled forever. Compose refuses a
 * site still provisioning, so it waits for the site to be ready.
 */
export function useSetupDraft(args: {
  brandId: string;
  site: SetupDraftSite;
  refetchSite: () => void;
  approved: boolean;
  buildDone: boolean;
  canManage: boolean;
}): {
  state: SetupDraftState;
  start: () => void;
  retry: () => void;
} {
  const { brandId, site, refetchSite, approved, buildDone, canManage } = args;
  const queryClient = useQueryClient();
  const [ensurePending, setEnsurePending] = useState(false);
  const [composePending, setComposePending] = useState(false);
  const [composeFailed, setComposeFailed] = useState(false);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const operationRef = useRef<string | null>(null);
  const checksRef = useRef(0);
  const composedRef = useRef(false);

  const derived = setupDraftState({ site, buildDone, approved, composePending, composeFailed, ensurePending, now });
  // The call failed with no answer and the server shows nothing yet: check.
  const state: SetupDraftState = unknownOutcome && site === null ? { kind: "checking" } : derived;

  const refresh = useCallback(() => {
    refetchSite();
    void queryClient.invalidateQueries({ queryKey: brandSiteKeys.plan(brandId) });
  }, [brandId, queryClient, refetchSite]);

  const provision = useCallback(async (operationId: string) => {
    operationRef.current = operationId;
    setEnsurePending(true);
    try {
      await persistProvisionOperation(brandId, { operationId, startedAt: Date.now() });
      await provisionBrandSite(brandId, operationId);
      setUnknownOutcome(false);
    } catch (error) {
      setUnknownOutcome(outcomeUnknown(error));
    } finally {
      setEnsurePending(false);
      refresh();
    }
  }, [brandId, refresh]);

  const start = useCallback(() => {
    checksRef.current = 0;
    void provision(createBrandSiteOperationId());
  }, [provision]);

  const receiptId = site?.latest_provision_operation?.operation_id ?? null;

  const compose = useCallback(async () => {
    setComposeFailed(false);
    setComposePending(true);
    try {
      await composeBrandSiteFromPlan(brandId);
    } catch {
      setComposeFailed(true);
    } finally {
      setComposePending(false);
      refresh();
    }
  }, [brandId, refresh]);

  const retry = useCallback(() => {
    if (state.kind !== "failed") return;
    checksRef.current = 0;
    if (state.retry === "compose") void compose();
    else if (state.retry === "same_operation" && (receiptId ?? operationRef.current)) void provision((receiptId ?? operationRef.current)!);
    // Reuses the one site row on the server: never a second website.
    else void provision(createBrandSiteOperationId());
  }, [compose, provision, receiptId, state]);

  const polling = state.kind === "building" || state.kind === "checking";
  useEffect(() => {
    if (!polling) return undefined;
    const timer = setInterval(() => {
      setNow(Date.now());
      refetchSite();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [polling, refetchSite]);

  // Checking replays the same operation a few times, then moves on by itself.
  const checking = state.kind === "checking";
  useEffect(() => {
    if (!checking || !canManage) return undefined;
    const check = () => {
      const operationId = receiptId ?? operationRef.current;
      if (!operationId) return;
      if (checksRef.current >= MAX_CHECKS) {
        // No site came of it: nothing left to wait for, so it can start again.
        setUnknownOutcome(false);
        return;
      }
      checksRef.current += 1;
      void provision(operationId);
    };
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [canManage, checking, provision, receiptId]);

  // Once per visit; it resumes when someone with permission comes back.
  const ready = site !== null && site.status !== "provisioning" && site.status !== "error";
  useEffect(() => {
    if (!ready || !approved || buildDone || !canManage || composedRef.current) return;
    composedRef.current = true;
    void compose();
  }, [approved, buildDone, canManage, compose, ready]);

  return { state, start, retry };
}
