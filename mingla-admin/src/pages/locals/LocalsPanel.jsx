import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

async function rpc(name, input = {}) {
  const { data, error } = await supabase.rpc(name, input);
  if (error) throw error;
  return data;
}

function ProgramCard({ program, onSave }) {
  const [seats, setSeats] = useState(String(program.seats));
  const [monthlyUsd, setMonthlyUsd] = useState(String(program.monthly_usd_minor / 100));
  const detailsChanged = Number(seats) !== Number(program.seats) || Math.round(Number(monthlyUsd) * 100) !== Number(program.monthly_usd_minor);
  return (
    <article className="rounded-xl border border-[var(--gray-200)] p-4">
      <p className="font-semibold">{program.city}</p>
      <p className="text-sm text-[var(--color-text-secondary)]">{program.active} of {program.seats} seats filled · ${(program.monthly_usd_minor / 100).toFixed(0)}/month</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-xs">Seats<input min="0" max="10" type="number" className="mt-1 w-full rounded-lg border p-2 text-sm" value={seats} onChange={(event) => setSeats(event.target.value)} /></label>
        <label className="text-xs">Monthly USD<input min="1" step="1" type="number" className="mt-1 w-full rounded-lg border p-2 text-sm" value={monthlyUsd} onChange={(event) => setMonthlyUsd(event.target.value)} /></label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled={!detailsChanged || Number(seats) < program.active} className="rounded-lg bg-black px-3 py-2 text-sm text-white disabled:opacity-40" onClick={() => void onSave({ ...program, seats: Number(seats), monthly_usd_minor: Math.round(Number(monthlyUsd) * 100) }, program.is_open)}>Save details</button>
        <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => void onSave({ ...program, seats: Number(seats), monthly_usd_minor: Math.round(Number(monthlyUsd) * 100) }, !program.is_open)}>{program.is_open ? "Pause applications" : "Open applications"}</button>
      </div>
      {Number(seats) < program.active ? <p className="mt-2 text-xs text-red-600">Seats cannot be lower than the {program.active} active Locals.</p> : null}
    </article>
  );
}

export function LocalsPanel() {
  const [queue, setQueue] = useState({ cities: [], programs: [], applications: [], reviews: [], payouts: [] });
  const [agreementVersion, setAgreementVersion] = useState("");
  const [reasons, setReasons] = useState("Needs more first-hand detail");
  const [programDraft, setProgramDraft] = useState({ city_id: "", seats: "3", monthly_usd: "150", is_open: true });
  const [error, setError] = useState("");
  const load = useCallback(async () => setQueue(await rpc("admin_local_queue")), []);
  useEffect(() => { void load().catch((cause) => setError(cause.message)); }, [load]);

  const decideApplication = async (id, status) => {
    setError("");
    try {
      await rpc("local_application_decide", {
        p_application_id: id,
        p_status: status,
        p_agreement_version: status === "accepted" ? agreementVersion.trim() : null,
      });
      await load();
    } catch (cause) { setError(cause.message); }
  };
  const decideReview = async (id, decision) => {
    setError("");
    try {
      await rpc("local_review_decide", {
        p_local_month_id: id,
        p_decision: decision,
        p_reasons: decision === "changes_requested" ? reasons.split("\n").map((item) => item.trim()).filter(Boolean) : [],
      });
      await load();
    } catch (cause) { setError(cause.message); }
  };
  const preparePayout = async (id) => {
    setError("");
    const { error: invokeError } = await supabase.functions.invoke("local-payout", { body: { local_month_id: id } });
    if (invokeError) { setError(invokeError.message); return; }
    await load();
  };
  const saveProgram = async (program, nextOpen = program.is_open) => {
    setError("");
    try {
      await rpc("local_city_program_save", {
        p_city_id: program.city_id,
        p_seats: Number(program.seats),
        p_is_open: Boolean(nextOpen),
        p_monthly_usd_minor: Number(program.monthly_usd_minor),
      });
      await load();
    } catch (cause) { setError(cause.message); }
  };

  return (
    <section className="space-y-5 border-t border-[var(--gray-200)] pt-6" aria-labelledby="locals-heading">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">Mingla Locals</p>
        <h2 id="locals-heading" className="text-xl font-bold text-[var(--color-text-primary)]">Applications, monthly reviews and payouts</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">Mingla—not the place—selects the Local, reviews the work and funds the $150 monthly payout.</p>
      </div>
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}

      <form className="grid gap-3 rounded-xl border border-[var(--gray-200)] p-4 md:grid-cols-5" onSubmit={(event) => {
        event.preventDefault();
        void saveProgram({
          city_id: programDraft.city_id,
          seats: programDraft.seats,
          monthly_usd_minor: Math.round(Number(programDraft.monthly_usd) * 100),
          is_open: programDraft.is_open,
        }).then(() => setProgramDraft((current) => ({ ...current, city_id: "" })));
      }}>
        <label className="text-sm md:col-span-2">City
          <select required className="mt-1 w-full rounded-lg border p-2" value={programDraft.city_id} onChange={(event) => setProgramDraft((current) => ({ ...current, city_id: event.target.value }))}>
            <option value="">Choose a city</option>
            {queue.cities.filter((city) => !queue.programs.some((program) => program.city_id === city.id)).map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Seats
          <input required min="0" max="10" type="number" className="mt-1 w-full rounded-lg border p-2" value={programDraft.seats} onChange={(event) => setProgramDraft((current) => ({ ...current, seats: event.target.value }))} />
        </label>
        <label className="text-sm">Monthly USD
          <input required min="1" step="1" type="number" className="mt-1 w-full rounded-lg border p-2" value={programDraft.monthly_usd} onChange={(event) => setProgramDraft((current) => ({ ...current, monthly_usd: event.target.value }))} />
        </label>
        <button disabled={!programDraft.city_id} className="self-end rounded-lg bg-black px-3 py-2 text-sm text-white disabled:opacity-40" type="submit">Create city program</button>
        <label className="flex items-center gap-2 text-sm md:col-span-5"><input type="checkbox" checked={programDraft.is_open} onChange={(event) => setProgramDraft((current) => ({ ...current, is_open: event.target.checked }))} />Open applications immediately</label>
      </form>

      <div className="grid gap-3 md:grid-cols-3">
        {queue.programs.map((program) => (
          <ProgramCard key={`${program.city_id}:${program.seats}:${program.monthly_usd_minor}`} program={program} onSave={saveProgram} />
        ))}
      </div>

      <div className="rounded-xl border border-[var(--gray-200)] p-4">
        <h3 className="font-semibold">Applications ({queue.applications.length})</h3>
        <label className="mt-3 block text-sm">Approved agreement version
          <input className="mt-1 w-full rounded-lg border p-2" value={agreementVersion} onChange={(event) => setAgreementVersion(event.target.value)} placeholder="Required before accepting anyone" />
        </label>
        <div className="mt-3 space-y-3">
          {queue.applications.map((application) => (
            <article key={application.id} className="rounded-lg bg-black/[0.035] p-3">
              <p className="font-medium">{application.city}</p>
              <p className="text-sm">{application.why}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => void decideApplication(application.id, "shortlisted")}>Shortlist</button>
                <button disabled={!agreementVersion.trim()} className="rounded-lg bg-black px-3 py-1.5 text-sm text-white disabled:opacity-40" onClick={() => void decideApplication(application.id, "accepted")}>Seat Local</button>
                <button className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => void decideApplication(application.id, "waitlisted")}>Waitlist</button>
                <button className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => void decideApplication(application.id, "rejected")}>Reject</button>
              </div>
            </article>
          ))}
          {!queue.applications.length ? <p className="text-sm text-[var(--color-text-secondary)]">No Local applications need review.</p> : null}
        </div>
      </div>

      <div className="rounded-xl border border-[var(--gray-200)] p-4">
        <h3 className="font-semibold">Monthly reviews ({queue.reviews.length})</h3>
        <label className="mt-3 block text-sm">Changes requested, one reason per line
          <textarea className="mt-1 min-h-20 w-full rounded-lg border p-2" value={reasons} onChange={(event) => setReasons(event.target.value)} />
        </label>
        <div className="mt-3 space-y-3">
          {queue.reviews.map((item) => (
            <article key={item.local_month_id} className="rounded-lg bg-black/[0.035] p-3">
              <p className="font-medium">{item.local_name} at {item.place_name}</p>
              <p className="text-sm">{item.review.rating}/5 · {item.review.title}</p>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{item.review.body}</p>
              <p className="mt-1 text-xs uppercase tracking-wide">Social check: {item.review.social_check_status}</p>
              <div className="mt-2 flex gap-2">
                <button className="rounded-lg bg-black px-3 py-1.5 text-sm text-white" onClick={() => void decideReview(item.local_month_id, "approve")}>Approve and publish</button>
                <button className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => void decideReview(item.local_month_id, "changes_requested")}>Request changes</button>
              </div>
            </article>
          ))}
          {!queue.reviews.length ? <p className="text-sm text-[var(--color-text-secondary)]">No Local reviews need a decision.</p> : null}
        </div>
      </div>

      <div className="rounded-xl border border-[var(--gray-200)] p-4">
        <h3 className="font-semibold">Payout status</h3>
        <div className="mt-3 space-y-2">
          {queue.payouts.map((item) => (
            <div key={item.local_month_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-black/[0.035] p-3 text-sm">
              <span>{item.local_name} · {item.month} · {item.share_status ?? "Awaiting FX quote"}{item.amount_minor ? ` · ${item.currency} ${(item.amount_minor / 100).toFixed(2)}` : ""}</span>
              {!item.share_status ? <button className="rounded-lg border px-3 py-1.5" onClick={() => void preparePayout(item.local_month_id)}>Freeze quote and queue payout</button> : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
