import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { GigTimeline } from "./crm/GigTimeline";
import { LocalsPanel } from "./locals/LocalsPanel";

async function rpc(name, input = {}) {
  const { data, error } = await supabase.rpc(name, input);
  if (error) throw error;
  return data;
}

export function GigQueuePage() {
  const [queue, setQueue] = useState({ disputes: [], creator_reviews: [] });
  const [selected, setSelected] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [refundBps, setRefundBps] = useState("5000");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => setQueue(await rpc("admin_gig_queue")), []);
  useEffect(() => { void load().catch((e) => setError(e.message)); }, [load]);
  const open = async (item) => { setSelected(item); setWorkspace(await rpc("gig_contract_workspace", { p_contract_id: item.contract_id })); };
  const decide = async (outcome) => {
    const { error: invokeError } = await supabase.functions.invoke("gig-dispute-resolve", { body: { dispute_id: selected.id, outcome, refund_bps: outcome === "partial_refund" ? Number(refundBps) : null, note: note || null } });
    if (invokeError) throw invokeError;
    setSelected(null); setWorkspace(null); await load();
  };
  return (
    <div className="space-y-6 p-6">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">Needs Mingla</p><h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Creator gigs</h1><p className="text-sm text-[var(--color-text-secondary)]">Only escalated disputes and identity reviews appear here. Silence never decides money.</p></div>
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      <section className="grid gap-3 md:grid-cols-2">
        {queue.disputes.map((item) => <button key={item.id} onClick={() => void open(item)} className="rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4 text-left"><p className="font-semibold text-[var(--color-text-primary)]">{item.gig_title}</p><p className="text-sm text-[var(--color-text-secondary)]">{item.creator_name} · {String(item.reason).replaceAll("_", " ")}</p></button>)}
        {!queue.disputes.length ? <p className="text-sm text-[var(--color-text-secondary)]">No escalated gig disputes.</p> : null}
      </section>
      {selected && workspace ? <section className="grid gap-6 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-5 lg:grid-cols-2"><div><h2 className="text-lg font-semibold">Shared evidence</h2><p className="my-3 text-sm">{selected.statement}</p><GigTimeline events={workspace.events} /></div><div className="space-y-3"><h2 className="text-lg font-semibold">Decision</h2><label className="block text-sm">Partial refund basis points<input className="mt-1 w-full rounded-lg border p-2" value={refundBps} onChange={(e) => setRefundBps(e.target.value)} inputMode="numeric" /></label><label className="block text-sm">Decision note<textarea className="mt-1 min-h-24 w-full rounded-lg border p-2" value={note} onChange={(e) => setNote(e.target.value)} /></label><div className="flex flex-wrap gap-2"><button className="rounded-lg bg-black px-4 py-2 text-white" onClick={() => void decide("release")}>Release fee</button><button className="rounded-lg border px-4 py-2" onClick={() => void decide("partial_refund")}>Partial refund</button><button className="rounded-lg border px-4 py-2" onClick={() => void decide("full_refund")}>Full refund</button></div></div></section> : null}
      <section><h2 className="text-lg font-semibold">Creator identity review</h2><p className="text-sm text-[var(--color-text-secondary)]">{queue.creator_reviews.length} creator{queue.creator_reviews.length === 1 ? "" : "s"} need a person.</p></section>
      <LocalsPanel />
    </div>
  );
}
