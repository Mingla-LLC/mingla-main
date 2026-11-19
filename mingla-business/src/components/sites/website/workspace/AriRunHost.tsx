import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadAriRuntime, type AriRuntime } from "./ariRuntime";
import { useAriRun, type AriRun, type AriTeamDraft } from "./useAriRun";
import type { TeamRequestDraft } from "../../../../sites/ariWorkspace";

/*
 * #4453 — Ari in the workspace without Ari on the boot path. The workspace's
 * Ari controller (useAriRun) needs Ari's chat hooks, which live in the
 * AriChatScreen chunk (see ariRuntime.ts). This mounts the controller in a
 * small component that loads with that chunk and hands its state up, so the
 * workspace itself draws at once and never remounts when Ari arrives.
 *
 * Until Ari has loaded (a moment after the workspace opens), asking says so;
 * "Ask the Mingla team" still opens its request, because that needs no Ari.
 * If Ari cannot be loaded at all, asking says that instead, and nothing else
 * in the workspace is affected.
 */
type RunInput = Parameters<typeof useAriRun>[0];

export const ARI_LOADING_LINE = "Ari is getting ready. Try again in a moment.";
export const ARI_UNAVAILABLE_LINE = "Ari couldn’t be loaded. Check your connection, then reload this page.";

const ACTIONS = ["ask", "answer", "retry", "settle", "openTeamDraft", "closeTeamDraft", "dropTeamDraft", "confirmTeamDraft", "clear"] as const;
type Actions = Pick<AriRun, (typeof ACTIONS)[number]>;
type Shared = Pick<AriRun, "turns" | "working" | "teamDraft">;

function Host({ runtime, input, onRun }: { runtime: AriRuntime; input: RunInput; onRun: (run: AriRun) => void }): null {
  const run = useAriRun(input, runtime);
  const latest = useRef(run);
  latest.current = run;
  // The same functions for the life of the host: each calls the newest run.
  const actions = useMemo(() => Object.fromEntries(ACTIONS.map((name) => [
    name,
    (...args: unknown[]) => (latest.current[name] as (...inner: unknown[]) => unknown)(...args),
  ])) as unknown as Actions, []);
  const { turns, working, teamDraft } = run;
  useEffect(() => {
    onRun({ ...actions, turns, working, teamDraft });
  }, [actions, onRun, teamDraft, turns, working]);
  return null;
}

type HostProps = { input: RunInput; onRun: (run: AriRun) => void; onUnavailable: () => void };

const LazyHost = React.lazy(async (): Promise<{ default: React.ComponentType<HostProps> }> => {
  try {
    const runtime = await loadAriRuntime();
    const Loaded = (props: HostProps) => <Host runtime={runtime} input={props.input} onRun={props.onRun} />;
    Loaded.displayName = "AriRunHost";
    return { default: Loaded };
  } catch {
    // The chunk did not arrive (offline, a blocked request): the workspace keeps working without Ari.
    const Unavailable = ({ onUnavailable }: HostProps) => {
      useEffect(() => onUnavailable(), [onUnavailable]);
      return null;
    };
    Unavailable.displayName = "AriRunUnavailable";
    return { default: Unavailable };
  }
});

/**
 * The workspace's Ari run, and the element that must be rendered (anywhere,
 * once) for it to come alive.
 */
export function useLazyAriRun(input: RunInput): { run: AriRun; host: React.ReactElement } {
  const [loaded, setLoaded] = useState<AriRun | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  // A request to the team the owner opened before Ari arrived.
  const [early, setEarly] = useState<AriTeamDraft | null>(null);

  const onUnavailable = useCallback(() => setUnavailable(true), []);
  useEffect(() => {
    if (!loaded || !early) return;
    loaded.openTeamDraft(early.draft, early.turnId);
    setEarly(null);
  }, [early, loaded]);

  const waiting = useMemo<AriRun>(() => {
    const line = unavailable ? ARI_UNAVAILABLE_LINE : ARI_LOADING_LINE;
    return {
      turns: [],
      working: false,
      teamDraft: early,
      ask: () => line,
      answer: () => line,
      retry: () => undefined,
      settle: () => undefined,
      openTeamDraft: (draft: TeamRequestDraft, turnId: string | null = null) => setEarly({ turnId, draft, pendingActionId: null, toolArgs: null }),
      closeTeamDraft: () => setEarly(null),
      dropTeamDraft: () => setEarly(null),
      confirmTeamDraft: async () => ({ ok: false, message: line }),
      clear: () => undefined,
    };
  }, [early, unavailable]);

  const host = (
    <Suspense fallback={null}>
      <LazyHost input={input} onRun={setLoaded} onUnavailable={onUnavailable} />
    </Suspense>
  );
  return { run: loaded ?? waiting, host };
}
