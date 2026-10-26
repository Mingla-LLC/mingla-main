// Issue #3872 — Mingla Locals, run by Mingla. Mingla—not the place—selects the
// Local, reviews the work and funds the monthly payout.
//
//   - one card per city: seats used of total, open or paused, and the city's
//     own monthly rate and payout currency (decision 6), saved through
//     local_city_program_save(p_monthly_rate_minor, p_payout_currency)
//   - tabs: Applications · Picks · Reviews · Payouts, each with the existing
//     decide actions; the approved agreement version is required to seat a
//     Local.

import { useCallback, useEffect, useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Input, Textarea, Toggle } from "../../components/ui/Input";
import { AlertCard, SectionCard } from "../../components/ui/Card";
import { Tabs } from "../../components/ui/Tabs";
import { useToast } from "../../context/ToastContext";
import {
  decideLocalApplication,
  decideLocalReview,
  getLocalQueue,
  prepareLocalPayout,
  saveCityProgram,
  voidLocalMonth,
} from "../../services/creatorProgramsService";
import {
  APPLICATION_STATUS_WORDS,
  checkProgramDraft,
  LOCAL_MONTH_WORDS,
  PAYOUT_CURRENCIES,
  SOCIAL_CHECK_WORDS,
  minorToWhole,
  money,
  moneyStateWord,
  monthWord,
  programErrorMessage,
} from "../../lib/creatorPrograms";

const selectClass = "h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]";

/** The city's rate in minor units, whichever shape the server sends. */
function programRate(program) {
  const currency = program.payout_currency ?? "USD";
  const minor = program.monthly_rate_minor ?? program.monthly_usd_minor ?? null;
  return { currency, minor };
}

function CityCard({ program, onSave }) {
  const rate = programRate(program);
  const initial = { seats: String(program.seats), rate: minorToWhole(rate.minor, rate.currency), currency: rate.currency };
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const changed = draft.seats !== initial.seats || draft.rate !== initial.rate || draft.currency !== initial.currency;
  const set = (key, value) => { setDraft((d) => ({ ...d, [key]: value })); setErrors((e) => ({ ...e, [key]: undefined, form: undefined })); };

  const save = async (nextOpen) => {
    const checked = checkProgramDraft(draft, Number(program.active ?? 0));
    if (checked.errors) { setErrors(checked.errors); return; }
    setSaving(true);
    const problem = await onSave({ cityId: program.city_id, isOpen: nextOpen, ...checked.values });
    if (problem) setErrors({ form: problem });
    setSaving(false);
  };

  return (
    <article className="space-y-3 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-[var(--color-text-primary)]">{program.city}</p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {program.active ?? 0} of {program.seats} seats used · {money(rate.minor, rate.currency)} a month
          </p>
        </div>
        <Badge variant={program.is_open ? "success" : "default"} dot>{program.is_open ? "Open" : "Paused"}</Badge>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Input label="Seats" inputMode="numeric" value={draft.seats} onChange={(e) => set("seats", e.target.value)} error={errors.seats} />
        <Input label="Monthly rate" inputMode="numeric" value={draft.rate} onChange={(e) => set("rate", e.target.value)} error={errors.rate} />
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]" htmlFor={`cur-${program.city_id}`}>Paid in</label>
          <select id={`cur-${program.city_id}`} className={selectClass} value={draft.currency} onChange={(e) => set("currency", e.target.value)}>
            {PAYOUT_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {errors.currency ? <p className="mt-1 text-xs text-[#ef4444]">{errors.currency}</p> : null}
        </div>
      </div>
      {errors.form ? <p role="alert" className="text-xs text-[var(--color-error-700)]">{errors.form}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!changed} loading={saving} onClick={() => void save(program.is_open)}>Save details</Button>
        <Button size="sm" variant="secondary" disabled={saving} onClick={() => void save(!program.is_open)}>
          {program.is_open ? "Pause applications" : "Open applications"}
        </Button>
      </div>
    </article>
  );
}

function NewCityForm({ cities, onSave }) {
  const [draft, setDraft] = useState({ cityId: "", seats: "3", rate: "150", currency: "USD", isOpen: true });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (key, value) => { setDraft((d) => ({ ...d, [key]: value })); setErrors((e) => ({ ...e, [key]: undefined, form: undefined })); };

  const submit = async (event) => {
    event.preventDefault();
    if (!draft.cityId) { setErrors({ cityId: "Choose a city." }); return; }
    const checked = checkProgramDraft(draft, 0);
    if (checked.errors) { setErrors(checked.errors); return; }
    setSaving(true);
    const problem = await onSave({ cityId: draft.cityId, isOpen: draft.isOpen, ...checked.values });
    setSaving(false);
    if (problem) setErrors({ form: problem });
    else setDraft((d) => ({ ...d, cityId: "" }));
  };

  return (
    <form className="grid items-start gap-3 md:grid-cols-6" onSubmit={(e) => void submit(e)}>
      <div className="md:col-span-2">
        <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]" htmlFor="new-local-city">City</label>
        <select id="new-local-city" className={selectClass} value={draft.cityId} onChange={(e) => set("cityId", e.target.value)}>
          <option value="">Choose a city</option>
          {cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
        </select>
        {errors.cityId ? <p className="mt-1 text-xs text-[#ef4444]">{errors.cityId}</p> : null}
      </div>
      <Input label="Seats" inputMode="numeric" value={draft.seats} onChange={(e) => set("seats", e.target.value)} error={errors.seats} />
      <Input label="Monthly rate" inputMode="numeric" value={draft.rate} onChange={(e) => set("rate", e.target.value)} error={errors.rate} />
      <div>
        <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]" htmlFor="new-local-currency">Paid in</label>
        <select id="new-local-currency" className={selectClass} value={draft.currency} onChange={(e) => set("currency", e.target.value)}>
          {PAYOUT_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="md:pt-7">
        <Button type="submit" loading={saving} disabled={!draft.cityId}>Create city program</Button>
      </div>
      <div className="md:col-span-6">
        <Toggle label="Open applications immediately" checked={draft.isOpen} onChange={(value) => set("isOpen", typeof value === "boolean" ? value : !draft.isOpen)} />
        {errors.form ? <p role="alert" className="mt-1 text-xs text-[var(--color-error-700)]">{errors.form}</p> : null}
      </div>
    </form>
  );
}

function Row({ children }) {
  return <article className="space-y-2 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4">{children}</article>;
}

function handleList(handles) {
  if (!handles || typeof handles !== "object") return [];
  return Object.entries(handles)
    .filter(([, v]) => v)
    .map(([platform, handle]) => `${platform.charAt(0).toUpperCase()}${platform.slice(1)} @${String(handle).replace(/^@/, "")}`);
}

export function LocalsPanel() {
  const { addToast } = useToast();
  const [queue, setQueue] = useState({ cities: [], programs: [], applications: [], picks: [], reviews: [], payouts: [] });
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState("applications");
  const [agreementVersion, setAgreementVersion] = useState("");
  const [rowError, setRowError] = useState({});
  const [busy, setBusy] = useState(null);
  const [reasons, setReasons] = useState({});
  const [voidReason, setVoidReason] = useState({});

  const load = useCallback(async () => {
    setLoadError("");
    try { setQueue(await getLocalQueue()); } catch (cause) { setLoadError(programErrorMessage(cause, "Couldn't load Mingla Locals. Try again.")); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (key, action, success) => {
    setBusy(key);
    setRowError((e) => ({ ...e, [key]: undefined }));
    try {
      await action();
      addToast({ variant: "success", title: success });
      await load();
    } catch (cause) {
      setRowError((e) => ({ ...e, [key]: programErrorMessage(cause) }));
    } finally {
      setBusy(null);
    }
  };

  const saveProgram = async (input) => {
    try {
      await saveCityProgram(input);
      addToast({ variant: "success", title: "City program saved." });
      await load();
      return null;
    } catch (cause) {
      return programErrorMessage(cause, "Couldn't save this city. Try again.");
    }
  };

  const tabs = [
    { id: "applications", label: `Applications · ${queue.applications.length}` },
    { id: "picks", label: `Picks · ${queue.picks.length}` },
    { id: "reviews", label: `Reviews · ${queue.reviews.length}` },
    { id: "payouts", label: `Payouts · ${queue.payouts.length}` },
  ];
  const freeCities = queue.cities.filter((city) => !queue.programs.some((p) => p.city_id === city.id));

  return (
    <div className="space-y-6">
      {loadError ? <AlertCard variant="error" title="Couldn't load Mingla Locals">{loadError}</AlertCard> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {queue.programs.map((program) => {
          const rate = programRate(program);
          return <CityCard key={`${program.city_id}:${program.seats}:${rate.minor}:${rate.currency}:${program.is_open}`} program={program} onSave={saveProgram} />;
        })}
      </div>

      <SectionCard title="Add a city" subtitle="Each city has its own monthly rate and payout currency.">
        <NewCityForm cities={freeCities} onSave={saveProgram} />
      </SectionCard>

      <div className="space-y-4">
        <Tabs tabs={tabs} activeTab={tab} onChange={setTab} />

        {tab === "applications" ? (
          <div className="space-y-3" role="tabpanel" id="tabpanel-applications">
            <Input
              label="Approved agreement version"
              value={agreementVersion}
              onChange={(e) => setAgreementVersion(e.target.value)}
              placeholder="Required before accepting anyone"
              helper="The version of the Local agreement the person signs when seated."
            />
            {queue.applications.map((a) => (
              <Row key={a.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-[var(--color-text-primary)]">{a.display_name ?? a.name ?? "Applicant"} · {a.city}</p>
                  <Badge variant={a.status === "shortlisted" ? "brand" : "default"}>{APPLICATION_STATUS_WORDS[a.status] ?? "New"}</Badge>
                </div>
                {handleList(a.handles).length ? <p className="text-xs text-[var(--color-text-secondary)]">{handleList(a.handles).join(" · ")}</p> : null}
                <p className="text-sm text-[var(--color-text-primary)]">{a.why}</p>
                {Array.isArray(a.sample_links) && a.sample_links.length ? (
                  <ul className="flex flex-wrap gap-x-3 text-xs">
                    {a.sample_links.map((link, i) => (
                      <li key={`${a.id}-${i}`}><a className="text-[var(--color-brand-600)] hover:underline" href={String(link)} target="_blank" rel="noreferrer noopener">Sample {i + 1}</a></li>
                    ))}
                  </ul>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" loading={busy === `app-${a.id}-shortlisted`} onClick={() => void run(`app-${a.id}-shortlisted`, () => decideLocalApplication(a.id, "shortlisted"), "Shortlisted.")}>Shortlist</Button>
                  <Button size="sm" disabled={!agreementVersion.trim()} loading={busy === `app-${a.id}-accepted`} onClick={() => void run(`app-${a.id}-accepted`, () => decideLocalApplication(a.id, "accepted", agreementVersion), "Local seated.")}>Seat Local</Button>
                  <Button size="sm" variant="secondary" loading={busy === `app-${a.id}-waitlisted`} onClick={() => void run(`app-${a.id}-waitlisted`, () => decideLocalApplication(a.id, "waitlisted"), "Waitlisted.")}>Waitlist</Button>
                  <Button size="sm" variant="secondary" loading={busy === `app-${a.id}-rejected`} onClick={() => void run(`app-${a.id}-rejected`, () => decideLocalApplication(a.id, "rejected"), "Application declined.")}>Decline</Button>
                </div>
                {Object.entries(rowError).filter(([k, v]) => v && k.startsWith(`app-${a.id}`)).map(([k, v]) => <p key={k} role="alert" className="text-xs text-[var(--color-error-700)]">{v}</p>)}
              </Row>
            ))}
            {!queue.applications.length ? <p className="text-sm text-[var(--color-text-secondary)]">No Local applications need review.</p> : null}
          </div>
        ) : null}

        {tab === "picks" ? (
          <div className="space-y-3" role="tabpanel" id="tabpanel-picks">
            <p className="text-sm text-[var(--color-text-secondary)]">This month's places. Picks are checked automatically; cancel one only if it breaks the rules.</p>
            {queue.picks.map((p) => (
              <Row key={p.local_month_id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-[var(--color-text-primary)]">{p.local_name} · {p.place_name}</p>
                  <Badge variant="default">{LOCAL_MONTH_WORDS[p.status] ?? "Picked"} · {monthWord(p.month)}</Badge>
                </div>
                {p.blocked_reason ? <p className="text-sm text-[var(--color-warning-700)]">{p.blocked_reason}</p> : null}
                <div className="flex flex-wrap items-start gap-2">
                  <div className="w-full sm:w-72">
                    <Input aria-label="Reason for cancelling this pick" placeholder="Reason for cancelling" value={voidReason[p.local_month_id] ?? ""} onChange={(e) => setVoidReason((r) => ({ ...r, [p.local_month_id]: e.target.value }))} />
                  </div>
                  <Button size="sm" variant="danger" disabled={!String(voidReason[p.local_month_id] ?? "").trim()} loading={busy === `pick-${p.local_month_id}`} onClick={() => void run(`pick-${p.local_month_id}`, () => voidLocalMonth(p.local_month_id, voidReason[p.local_month_id]), "Pick cancelled.")}>Cancel pick</Button>
                </div>
                {rowError[`pick-${p.local_month_id}`] ? <p role="alert" className="text-xs text-[var(--color-error-700)]">{rowError[`pick-${p.local_month_id}`]}</p> : null}
              </Row>
            ))}
            {!queue.picks.length ? <p className="text-sm text-[var(--color-text-secondary)]">No picks need a look.</p> : null}
          </div>
        ) : null}

        {tab === "reviews" ? (
          <div className="space-y-3" role="tabpanel" id="tabpanel-reviews">
            {queue.reviews.map((item) => {
              const key = `rev-${item.local_month_id}`;
              const reasonText = reasons[item.local_month_id] ?? "";
              const reasonList = reasonText.split("\n").map((r) => r.trim()).filter(Boolean);
              const social = item.review?.social_check_status;
              return (
                <Row key={item.local_month_id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-[var(--color-text-primary)]">{item.local_name} at {item.place_name}</p>
                    <Badge variant={item.status === "changes_requested" ? "warning" : "brand"}>{LOCAL_MONTH_WORDS[item.status] ?? "Review sent"} · {monthWord(item.month)}</Badge>
                  </div>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">{"★".repeat(Number(item.review?.rating ?? 0))}<span className="sr-only">{item.review?.rating} out of 5</span> {item.review?.title}</p>
                  <p className="whitespace-pre-line text-sm text-[var(--color-text-secondary)]">{item.review?.body}</p>
                  <p className="text-xs">
                    <Badge variant={social === "passed" ? "success" : social === "failed" ? "error" : "warning"}>{SOCIAL_CHECK_WORDS[social] ?? "Social post not checked yet"}</Badge>
                    {item.review?.social_post_url ? <a className="ml-2 text-[var(--color-brand-600)] hover:underline" href={item.review.social_post_url} target="_blank" rel="noreferrer noopener">Open post</a> : null}
                  </p>
                  {item.status === "submitted" ? (
                    <>
                      <Textarea label="Changes to ask for (one per line)" className="min-h-20 font-sans" value={reasonText} onChange={(e) => setReasons((r) => ({ ...r, [item.local_month_id]: e.target.value }))} />
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" loading={busy === `${key}-approve`} onClick={() => void run(`${key}-approve`, () => decideLocalReview(item.local_month_id, "approve"), "Review approved and published.")}>Approve and publish</Button>
                        <Button size="sm" variant="secondary" disabled={!reasonList.length} loading={busy === `${key}-changes`} onClick={() => void run(`${key}-changes`, () => decideLocalReview(item.local_month_id, "changes_requested", reasonList), "Changes requested.")}>Request changes</Button>
                      </div>
                    </>
                  ) : <p className="text-xs text-[var(--color-text-secondary)]">Waiting for the Local to send changes.</p>}
                  {Object.entries(rowError).filter(([k, v]) => v && k.startsWith(key)).map(([k, v]) => <p key={k} role="alert" className="text-xs text-[var(--color-error-700)]">{v}</p>)}
                </Row>
              );
            })}
            {!queue.reviews.length ? <p className="text-sm text-[var(--color-text-secondary)]">No Local reviews need a decision.</p> : null}
          </div>
        ) : null}

        {tab === "payouts" ? (
          <div className="space-y-2" role="tabpanel" id="tabpanel-payouts">
            {queue.payouts.map((item) => {
              const key = `pay-${item.local_month_id}`;
              return (
                <div key={item.local_month_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-3 text-sm">
                  <span className="text-[var(--color-text-primary)]">
                    {item.local_name} · {monthWord(item.month)}
                    {item.amount_minor ? ` · ${money(item.amount_minor, item.currency)}` : ""}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge variant={item.share_status === "paid" ? "success" : item.share_status === "releasable" ? "info" : "warning"} dot>{moneyStateWord(item.share_status)}</Badge>
                    {!item.share_status ? (
                      <Button size="sm" variant="secondary" loading={busy === key} onClick={() => void run(key, () => prepareLocalPayout(item.local_month_id), "Payout queued.")}>Fix the amount and queue payout</Button>
                    ) : null}
                  </span>
                  {rowError[key] ? <p role="alert" className="w-full text-xs text-[var(--color-error-700)]">{rowError[key]}</p> : null}
                </div>
              );
            })}
            {!queue.payouts.length ? <p className="text-sm text-[var(--color-text-secondary)]">No Local payouts yet.</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
