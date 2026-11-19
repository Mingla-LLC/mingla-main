/**
 * #4453 Website workspace — live step events for one of Ari's runs. Ari's
 * executor appends `site_step_started / _done / _failed` to the turn's
 * activity as each step lands; this follows them over Realtime (its own
 * channel, so it never collides with the chat's) and re-reads the turn's
 * status every few seconds in case a push was missed. Events are merged by
 * id, so a step is never counted twice.
 */
import { supabase } from "../services/supabase";
import type { StepEvent } from "./ariWorkspace";

const POLL_MS = 2_500;
const hasDetail = (event: StepEvent): boolean => event.detail !== null && typeof event.detail === "object";

/**
 * `readStatus` is Ari's own turn-status read, handed in by the caller: this
 * file is part of the Website chunk and must not pull Ari's services into it
 * (see workspace/ariRuntime.ts).
 */
export function followAriRun(
  clientTurnId: string,
  onEvents: (events: StepEvent[]) => void,
  readStatus: (clientTurnId: string) => Promise<{ events: readonly unknown[] }>,
): () => void {
  const seen = new Map<string, StepEvent & { sequence?: number }>();
  let active = true;
  const push = (rows: readonly unknown[]) => {
    let changed = false;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const event = row as StepEvent & { id?: unknown; sequence?: number };
      if (typeof event.id !== "string" || typeof event.event_type !== "string") continue;
      const known = seen.get(event.id);
      // The status re-read carries no `detail` (which step); the pushed row does.
      // Whichever arrives first, the row with the detail is the one kept.
      if (known && (hasDetail(known) || !hasDetail(event))) continue;
      seen.set(event.id, event);
      changed = true;
    }
    if (!changed || !active) return;
    onEvents([...seen.values()].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)));
  };
  const channel = supabase
    .channel(`site-run-${clientTurnId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_activity_events", filter: `client_turn_id=eq.${clientTurnId}` }, (payload) => push([payload.new]))
    .subscribe();
  const poll = () => {
    void readStatus(clientTurnId).then((status) => push(status.events)).catch(() => undefined);
  };
  const timer = setInterval(poll, POLL_MS);
  return () => {
    active = false;
    clearInterval(timer);
    void supabase.removeChannel(channel);
  };
}
