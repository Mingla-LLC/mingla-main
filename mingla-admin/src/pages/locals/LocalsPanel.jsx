// Issues #3872 and #4182 — Mingla Locals are selected, reviewed and paid by
// Mingla. Admin manages capacity and decisions; the applicant alone signs the
// current agreement, and Local review approval requires private video playback
// plus an explicit watched-all attestation.

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSignature, MapPin, RefreshCw, Users, Video } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Input, Textarea, Toggle } from "../../components/ui/Input";
import { AlertCard, SectionCard } from "../../components/ui/Card";
import { Tabs } from "../../components/ui/Tabs";
import { useToast } from "../../context/ToastContext";
import { ProgramConversationPanel } from "../../components/programs/ProgramConversationPanel";
import {
  confirmLocalSocialPost,
  decideLocalApplication,
  decideLocalReview,
  getCreatorMediaPlayback,
  getLocalQueue,
  listLocalProgramPeople,
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
  shortDateTime,
} from "../../lib/creatorPrograms";

const selectClass = "h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]";
const focusClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2";

function programRate(program) {
  const currency = program.payout_currency ?? "USD";
  const minor = program.monthly_rate_minor ?? program.monthly_usd_minor ?? null;
  return { currency, minor };
}
function displayName(row, fallback = "Applicant") {
  return row?.display_name ?? row?.local_name ?? row?.name ?? fallback;
}

function initials(value) {
  return String(value || "M")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("") || "M";
}

function handleList(handles) {
  if (!handles || typeof handles !== "object") return [];
  return Object.entries(handles)
    .filter(([, value]) => value)
    .map(([platform, handle]) => `${platform.charAt(0).toUpperCase()}${platform.slice(1)} @${String(handle).replace(/^@/, "")}`);
}

function applicationState(application) {
  const awaitingSignature = application?.status === "agreement_pending";
  const signed = application?.status === "accepted" && application?.agreement_signed_at;
  const signatureRequired = application?.status === "accepted" && !application?.agreement_signed_at;
  const invitationExpired = Boolean(awaitingSignature && application?.agreement_due_at && new Date(application.agreement_due_at).getTime() <= Date.now());
  return { awaitingSignature, signed, signatureRequired, invitationExpired };
}

function applicationBadge(application) {
  const state = applicationState(application);
  const label = state.signatureRequired ? "Signature required" : APPLICATION_STATUS_WORDS[application?.status] ?? "New";
  const variant = state.signed ? "success" : application?.status === "shortlisted" ? "brand" : state.awaitingSignature || state.signatureRequired ? "warning" : "default";
  return { label, variant };
}

function programCapacity(program) {
  const active = Number(program?.active ?? 0);
  const reserved = Number(program?.reserved ?? 0);
  const total = Number(program?.seats ?? 0);
  return { active, reserved, total, open: Math.max(0, total - active - reserved) };
}

function QueueEmpty({ title, detail }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</p>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{detail}</p>
    </div>
  );
}

function QueueAvatar({ name }) {
  return (
    <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--gray-100)] text-xs font-semibold text-[var(--color-text-secondary)]">
      {initials(name)}
    </span>
  );
}

function MasterDetail({ list, detail, detailLabel }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 min-[1100px]:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.65fr)]">
      <div className="min-w-0">{list}</div>
      <section aria-label={detailLabel} className="min-w-0 self-start">{detail}</section>
    </div>
  );
}

function ProgramSummary({ programs, agreement, loading, onRefresh }) {
  const totals = programs.reduce((result, program) => {
    const capacity = programCapacity(program);
    return {
      active: result.active + capacity.active,
      reserved: result.reserved + capacity.reserved,
      seats: result.seats + capacity.total,
      openPrograms: result.openPrograms + (program.is_open ? 1 : 0),
    };
  }, { active: 0, reserved: 0, seats: 0, openPrograms: 0 });
  const iconClass = "h-4 w-4";
  const metrics = [
    { label: "Active Locals", value: totals.active, icon: <Users className={iconClass} aria-hidden="true" /> },
    { label: "Reserved seats", value: totals.reserved, icon: <FileSignature className={iconClass} aria-hidden="true" /> },
    { label: "Total seats", value: totals.seats, icon: <MapPin className={iconClass} aria-hidden="true" /> },
    { label: "Programs open", value: `${totals.openPrograms}/${programs.length}`, icon: <Video className={iconClass} aria-hidden="true" /> },
  ];
  return (
    <section aria-label="Mingla Local program status" className="overflow-hidden rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)]">
      <div className="grid grid-cols-2 divide-x divide-y divide-[var(--gray-200)] sm:grid-cols-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_minmax(190px,1.3fr)_auto] lg:divide-y-0">
        {metrics.map(({ label, value, icon }) => (
          <div key={label} className="flex min-w-0 items-center gap-3 px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand-50)] text-[var(--color-brand-600)]">{icon}</span>
            <span className="min-w-0"><strong className="block text-sm font-semibold text-[var(--color-text-primary)]">{value}</strong><span className="block truncate text-xs text-[var(--color-text-secondary)]">{label}</span></span>
          </div>
        ))}
        <div className="col-span-2 flex min-w-0 items-center gap-3 px-4 py-3 sm:col-span-1 lg:col-span-1">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand-50)] text-[var(--color-brand-600)]"><FileSignature className="h-4 w-4" aria-hidden="true" /></span>
          <span className="min-w-0"><strong className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">{agreement?.version ?? "Not published"}</strong><span className="block text-xs text-[var(--color-text-secondary)]">Current agreement</span></span>
        </div>
        <div className="col-span-2 flex items-center justify-end px-3 py-2 sm:col-span-1 lg:col-span-1">
          <Button size="sm" variant="secondary" icon={RefreshCw} loading={loading} onClick={onRefresh}>Refresh</Button>
        </div>
      </div>
    </section>
  );
}

function CityCard({ program, onSave }) {
  const rate = programRate(program);
  const capacity = programCapacity(program);
  const initial = { seats: String(program.seats), rate: minorToWhole(rate.minor, rate.currency), currency: rate.currency };
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const changed = draft.seats !== initial.seats || draft.rate !== initial.rate || draft.currency !== initial.currency;
  const set = (key, value) => { setDraft((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: undefined, form: undefined })); };
  const save = async (nextOpen) => {
    const checked = checkProgramDraft(draft, capacity.active + capacity.reserved);
    if (checked.errors) { setErrors(checked.errors); return; }
    setSaving(true);
    const problem = await onSave({ cityId: program.city_id, isOpen: nextOpen, ...checked.values });
    if (problem) setErrors({ form: problem });
    setSaving(false);
  };
  return (
    <article className="space-y-4 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-[var(--color-text-primary)]">{program.city}</p>
          <p className="text-sm text-[var(--color-text-secondary)]">{capacity.active} active · {capacity.reserved} reserved · {capacity.open} open · {capacity.total} total</p>
          <p className="text-xs text-[var(--color-text-tertiary)]">{money(rate.minor, rate.currency)} a month</p>
        </div>
        <Badge variant={program.is_open ? "success" : "default"} dot>{program.is_open ? "Open" : "Paused"}</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label="Seats" inputMode="numeric" value={draft.seats} onChange={(event) => set("seats", event.target.value)} error={errors.seats} />
        <Input label="Monthly rate" inputMode="numeric" value={draft.rate} onChange={(event) => set("rate", event.target.value)} error={errors.rate} />
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]" htmlFor={`cur-${program.city_id}`}>Paid in</label>
          <select id={`cur-${program.city_id}`} className={selectClass} value={draft.currency} onChange={(event) => set("currency", event.target.value)}>{PAYOUT_CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select>
          {errors.currency ? <p className="mt-1 text-xs text-[#ef4444]">{errors.currency}</p> : null}
        </div>
      </div>
      {errors.form ? <p role="alert" className="text-xs text-[var(--color-error-700)]">{errors.form}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!changed} loading={saving} onClick={() => void save(program.is_open)}>Save details</Button>
        <Button size="sm" variant="secondary" disabled={saving} onClick={() => void save(!program.is_open)}>{program.is_open ? "Pause applications" : "Open applications"}</Button>
      </div>
      <p className="text-xs text-[var(--color-text-tertiary)]">Seat capacity cannot be reduced below the {capacity.active + capacity.reserved} active or reserved Local seats.</p>
    </article>
  );
}

function NewCityForm({ cities, onSave }) {
  const [draft, setDraft] = useState({ cityId: "", seats: "3", rate: "150", currency: "USD", isOpen: true });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (key, value) => { setDraft((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: undefined, form: undefined })); };
  const submit = async (event) => {
    event.preventDefault();
    if (!draft.cityId) { setErrors({ cityId: "Choose a city." }); return; }
    const checked = checkProgramDraft(draft, 0);
    if (checked.errors) { setErrors(checked.errors); return; }
    setSaving(true);
    const problem = await onSave({ cityId: draft.cityId, isOpen: draft.isOpen, ...checked.values });
    setSaving(false);
    if (problem) setErrors({ form: problem });
    else setDraft((current) => ({ ...current, cityId: "" }));
  };
  return (
    <form className="grid items-start gap-3 md:grid-cols-6" onSubmit={(event) => void submit(event)}>
      <div className="md:col-span-2">
        <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]" htmlFor="new-local-city">City</label>
        <select id="new-local-city" className={selectClass} value={draft.cityId} onChange={(event) => set("cityId", event.target.value)}><option value="">Choose a city</option>{cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}</select>
        {errors.cityId ? <p className="mt-1 text-xs text-[#ef4444]">{errors.cityId}</p> : null}
      </div>
      <Input label="Seats" inputMode="numeric" value={draft.seats} onChange={(event) => set("seats", event.target.value)} error={errors.seats} />
      <Input label="Monthly rate" inputMode="numeric" value={draft.rate} onChange={(event) => set("rate", event.target.value)} error={errors.rate} />
      <div>
        <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]" htmlFor="new-local-currency">Paid in</label>
        <select id="new-local-currency" className={selectClass} value={draft.currency} onChange={(event) => set("currency", event.target.value)}>{PAYOUT_CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select>
      </div>
      <div className="md:pt-7"><Button type="submit" loading={saving} disabled={!draft.cityId}>Create city program</Button></div>
      <div className="md:col-span-6"><Toggle label="Open applications immediately" checked={draft.isOpen} onChange={(value) => set("isOpen", typeof value === "boolean" ? value : !draft.isOpen)} />{errors.form ? <p role="alert" className="mt-1 text-xs text-[var(--color-error-700)]">{errors.form}</p> : null}</div>
    </form>
  );
}

function ApplicationTimeline({ application }) {
  const state = applicationState(application);
  const stage = state.signed ? 4 : state.awaitingSignature ? 3 : application.status === "shortlisted" ? 2 : 1;
  const steps = ["Applied", "Shortlisted", "Invitation sent", "Seat active"];
  return <ol aria-label="Application progress" className="grid grid-cols-4 gap-1">{steps.map((step, index) => <li key={step} className="min-w-0"><span className={`block h-1 rounded-full ${index < stage ? "bg-[var(--color-success-600)]" : "bg-[var(--gray-200)]"}`} /><span className="mt-1 block truncate text-[11px] text-[var(--color-text-tertiary)]">{step}</span></li>)}</ol>;
}

function ApplicationDetail({ application, agreement, program, busy, rowError, run }) {
  if (!application) return <SectionCard><QueueEmpty title="Select an application" detail="Choose an applicant to review their city, work samples, agreement state, and seat decision." /></SectionCard>;
  const state = applicationState(application);
  const badge = applicationBadge(application);
  const capacity = programCapacity(program);
  const handles = handleList(application.handles);
  const errors = Object.entries(rowError).filter(([key, value]) => value && key.startsWith(`app-${application.id}`));
  return (
    <SectionCard title="Application detail" subtitle="Applicant owns the final signature" badge={<Badge variant={badge.variant}>{badge.label}</Badge>}>
      <div className="space-y-5" data-testid="local-application-detail">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold text-[var(--color-text-primary)]">{displayName(application)}</h3>{handles.length ? <p className="text-sm text-[var(--color-brand-600)]">{handles.join(" · ")}</p> : null}</div><Badge variant="default">{application.city}</Badge></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-[var(--gray-50)] p-3 sm:col-span-2"><p className="text-xs text-[var(--color-text-tertiary)]">Why they know the city</p><p className="mt-2 text-sm text-[var(--color-text-primary)]">{application.why || "No application note supplied."}</p></div>
          <div className="rounded-lg bg-[var(--gray-50)] p-3"><p className="text-xs text-[var(--color-text-tertiary)]">Work samples</p>{Array.isArray(application.sample_links) && application.sample_links.length ? <ul className="mt-2 flex flex-wrap gap-3 text-sm">{application.sample_links.map((link, index) => <li key={`${application.id}-${index}`}><a className="font-medium text-[var(--color-brand-600)] hover:underline" href={String(link)} target="_blank" rel="noreferrer noopener">Sample {index + 1}</a></li>)}</ul> : <p className="mt-2 text-sm text-[var(--color-text-secondary)]">No linked samples.</p>}</div>
          <div className="rounded-lg bg-[var(--gray-50)] p-3"><p className="text-xs text-[var(--color-text-tertiary)]">Capacity after reservation</p><p className="mt-2 text-sm text-[var(--color-text-primary)]">{program ? `${capacity.active} active · ${capacity.reserved} reserved · ${capacity.open} open` : "City program unavailable"}</p></div>
        </div>
        {agreement ? (
          <section className="space-y-4 rounded-lg border border-[var(--color-brand-100)] bg-[var(--color-brand-50)] p-4" aria-label="Applicant agreement">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold text-[var(--color-text-primary)]">Applicant agreement</p><p className="text-xs text-[var(--color-text-secondary)]">Server-owned and read-only in Admin</p></div><a className="text-xs font-semibold text-[var(--color-brand-700)] hover:underline" href={agreement.document_url} target="_blank" rel="noreferrer noopener">{agreement.version}</a></div>
            <div className="grid gap-3 text-sm sm:grid-cols-2"><div><span className="block text-xs text-[var(--color-text-tertiary)]">Reserved until</span><span className="mt-1 block text-[var(--color-text-primary)]">{state.awaitingSignature ? shortDateTime(application.agreement_due_at) : "Not reserved"}</span></div><div><span className="block text-xs text-[var(--color-text-tertiary)]">Signing authority</span><span className="mt-1 block text-[var(--color-text-primary)]">{displayName(application)} only</span></div></div>
            <ApplicationTimeline application={application} />
            <p className="text-xs text-[var(--color-text-secondary)]">Only the applicant can sign and activate the reserved seat. Admin can invite or renew; there is no Admin signature field.</p>
          </section>
        ) : <AlertCard variant="warning" title="No Local agreement is published">Shortlist or waitlist this applicant, but do not invite or activate them.</AlertCard>}
        {state.awaitingSignature ? <p className={`text-sm ${state.invitationExpired ? "text-[var(--color-warning-700)]" : "text-[var(--color-text-secondary)]"}`}>{state.invitationExpired ? "Signature window expired." : `Seat reserved until ${shortDateTime(application.agreement_due_at)}.`} Agreement {application.agreement_version} must be signed by the applicant.</p> : null}
        {state.signed ? <p className="text-sm text-[var(--color-success-700)]">Signed by {application.signature_name} on {shortDateTime(application.agreement_signed_at)}. The Local seat is active.</p> : null}
        {state.signatureRequired ? <AlertCard variant="warning" title="Legacy Local needs a signature">They must sign the current agreement in Mingla before starting another Local action.</AlertCard> : null}
        {!state.signed && !state.signatureRequired ? <div className="flex flex-wrap gap-2">{!state.awaitingSignature ? <Button size="sm" variant="secondary" loading={busy === `app-${application.id}-shortlisted`} onClick={() => void run(`app-${application.id}-shortlisted`, () => decideLocalApplication(application.id, "shortlisted"), "Shortlisted.")}>Shortlist</Button> : null}<Button size="sm" disabled={!agreement || (state.awaitingSignature && !state.invitationExpired)} loading={busy === `app-${application.id}-agreement`} onClick={() => void run(`app-${application.id}-agreement`, () => decideLocalApplication(application.id, "agreement_pending"), state.awaitingSignature ? "Agreement invitation renewed." : "Applicant invited to sign.")}>{state.awaitingSignature ? "Renew signing window" : "Invite to sign agreement"}</Button><Button size="sm" variant="secondary" loading={busy === `app-${application.id}-waitlisted`} onClick={() => void run(`app-${application.id}-waitlisted`, () => decideLocalApplication(application.id, "waitlisted"), "Waitlisted.")}>Waitlist</Button><Button size="sm" variant="secondary" loading={busy === `app-${application.id}-rejected`} onClick={() => void run(`app-${application.id}-rejected`, () => decideLocalApplication(application.id, "rejected"), "Application declined.")}>Decline</Button></div> : null}
        {errors.map(([key, value]) => <p key={key} role="alert" className="text-xs text-[var(--color-error-700)]">{value}</p>)}
      </div>
    </SectionCard>
  );
}

function ApplicationWorkspace({ queue, selectedId, onSelect, busy, rowError, run }) {
  const [cityId, setCityId] = useState("all");
  const applications = useMemo(() => cityId === "all" ? queue.applications : queue.applications.filter((application) => application.city_id === cityId), [cityId, queue.applications]);
  useEffect(() => { if (!applications.some((application) => application.id === selectedId)) onSelect(applications[0]?.id ?? null); }, [applications, onSelect, selectedId]);
  const selected = applications.find((application) => application.id === selectedId) ?? applications[0] ?? null;
  const program = queue.programs.find((item) => item.city_id === selected?.city_id) ?? null;
  const list = (
    <SectionCard title="Application queue" subtitle={`${applications.length} need attention`} noPadding action={<label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">City<select aria-label="Filter applications by city" className={`${selectClass} !h-8 !w-auto min-w-28`} value={cityId} onChange={(event) => setCityId(event.target.value)}><option value="all">All cities</option>{queue.programs.map((programItem) => <option key={programItem.city_id} value={programItem.city_id}>{programItem.city}</option>)}</select></label>}>
      {applications.length ? <ul className="divide-y divide-[var(--gray-200)]">{applications.map((application) => { const active = application.id === selected?.id; const badge = applicationBadge(application); return <li key={application.id}><button type="button" aria-pressed={active} onClick={() => onSelect(application.id)} className={`flex w-full items-center gap-3 px-4 py-3 text-left ${focusClass} ${active ? "bg-[var(--color-brand-50)]" : "hover:bg-[var(--gray-50)]"}`}><QueueAvatar name={displayName(application)} /><span className="min-w-0 flex-1"><strong className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">{displayName(application)}</strong><span className="block truncate text-xs text-[var(--color-text-secondary)]">{application.city} · {shortDateTime(application.created_at)}</span></span><Badge variant={badge.variant}>{badge.label}</Badge></button></li>; })}</ul> : <QueueEmpty title="No applications need review" detail={cityId === "all" ? "New applicants will appear here." : "Try another city or return to all cities."} />}
    </SectionCard>
  );
  return <MasterDetail list={list} detail={<ApplicationDetail application={selected} agreement={queue.agreement} program={program} busy={busy} rowError={rowError} run={run} />} detailLabel="Selected Local application" />;
}

function ReviewDetail({ item, mediaGrants, mediaLoading, mediaReviewed, setMediaReviewed, socialChecks, setSocialChecks, rowError, reasons, setReasons, loadReviewMedia, busy, run }) {
  if (!item) return <SectionCard><QueueEmpty title="Select a review" detail="Choose a submitted review to watch its private video and make a decision." /></SectionCard>;
  const key = `rev-${item.local_month_id}`;
  const reasonText = reasons[item.local_month_id] ?? "";
  const reasonList = reasonText.split("\n").map((reason) => reason.trim()).filter(Boolean);
  const social = item.review?.social_check_status;
  const mediaIds = Array.isArray(item.review?.media_job_ids) ? item.review.media_job_ids : [];
  const allMediaLoaded = mediaIds.length > 0 && mediaIds.every((mediaId) => mediaGrants[mediaId]?.url);
  const watchedAllMedia = mediaReviewed[item.local_month_id] === true;
  const socialReady = social === "passed" || social === "unverifiable";
  const socialChecklist = socialChecks[item.local_month_id] ?? {};
  const socialChecklistComplete = socialChecklist.videoMatches === true && socialChecklist.accountMatches === true && socialChecklist.hasDisclosure === true && socialChecklist.hasMinglaCollab === true;
  const setSocialCheck = (field, checked) => setSocialChecks((current) => ({ ...current, [item.local_month_id]: { ...(current[item.local_month_id] ?? {}), [field]: checked } }));
  const errors = Object.entries(rowError).filter(([errorKey, value]) => value && errorKey.startsWith(key));
  return (
    <SectionCard title={`Review ${item.place_name}`} subtitle="The place cannot approve or veto this review" badge={<Badge variant={item.status === "changes_requested" ? "warning" : "brand"}>{LOCAL_MONTH_WORDS[item.status] ?? "Review sent"}</Badge>}>
      <div className="space-y-5" data-testid="local-review-detail">
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.3fr)]">
          <section className="min-w-0 space-y-3" aria-label="Private Local review videos">
            <div><p className="text-sm font-semibold text-[var(--color-text-primary)]">Private Bunny video</p><p className="text-xs text-[var(--color-text-secondary)]">Admin-only signed playback. Download is unavailable.</p></div>
            {mediaIds.map((mediaId, index) => { const grant = mediaGrants[mediaId]; const errorKey = `${key}-media-${mediaId}`; return <div key={mediaId} className="space-y-2">{grant?.url ? <iframe className="aspect-[9/16] max-h-[520px] w-full rounded-xl bg-black" src={grant.url} title={`Local review video ${index + 1}`} allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /> : <div className="flex aspect-[9/16] max-h-[520px] items-center justify-center rounded-xl bg-[var(--gray-900)] px-4 text-center text-sm text-white"><span><Video className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />Private video {index + 1}</span></div>}<Button className="w-full" size="sm" variant="secondary" loading={mediaLoading === mediaId} onClick={() => void loadReviewMedia(item.local_month_id, mediaId)}>{grant?.url ? "Refresh video" : mediaIds.length === 1 ? "Load private video" : `Load video ${index + 1}`}</Button>{rowError[errorKey] ? <p role="alert" className="text-xs text-[var(--color-error-700)]">{rowError[errorKey]}</p> : null}</div>; })}
            {!mediaIds.length ? <p role="alert" className="text-xs text-[var(--color-error-700)]">No submitted video is attached. This review cannot be approved.</p> : null}
            <Toggle label="I watched every submitted video" checked={watchedAllMedia} disabled={!allMediaLoaded} onChange={(checked) => setMediaReviewed((value) => ({ ...value, [item.local_month_id]: checked }))} />
            <p className="text-xs text-[var(--color-text-tertiary)]">Playback uses an expiring Admin-only grant. Loading or refreshing never makes the source public.</p>
          </section>
          <section className="min-w-0 space-y-5" aria-label="Written Local review and decision">
            <div><p className="text-xs text-[var(--color-text-tertiary)]">Written review</p><h3 className="mt-2 text-base font-semibold text-[var(--color-text-primary)]">{item.review?.title || "Untitled review"}</h3><p className="mt-2 whitespace-pre-line text-sm leading-6 text-[var(--color-text-secondary)]">{item.review?.body}</p><p className="mt-3 text-[var(--color-brand-600)]" aria-label={`${item.review?.rating ?? 0} out of 5 stars`}>{"★".repeat(Number(item.review?.rating ?? 0))}</p></div>
            <div className="space-y-3 border-t border-[var(--gray-200)] pt-4"><div><p className="text-xs text-[var(--color-text-tertiary)]">Social proof</p><div className="mt-2 flex flex-wrap items-center gap-2"><Badge variant={social === "passed" ? "success" : social === "failed" ? "error" : "warning"}>{SOCIAL_CHECK_WORDS[social] ?? "Social post not checked yet"}</Badge>{item.review?.social_post_url ? <a className="text-sm font-medium text-[var(--color-brand-600)] hover:underline" href={item.review.social_post_url} target="_blank" rel="noreferrer noopener">Open public post</a> : null}</div></div>{!socialReady && item.review?.social_post_url ? <div className="space-y-3 rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] p-3" aria-label="Social post review checklist"><p className="text-sm font-semibold text-[var(--color-text-primary)]">Check the public post</p><Toggle label="It uses the submitted review video" checked={socialChecklist.videoMatches === true} onChange={(checked) => setSocialCheck("videoMatches", checked)} /><Toggle label="It is posted by the applicant's submitted account" checked={socialChecklist.accountMatches === true} onChange={(checked) => setSocialCheck("accountMatches", checked)} /><Toggle label="It includes a clear paid partnership or ad disclosure" checked={socialChecklist.hasDisclosure === true} onChange={(checked) => setSocialCheck("hasDisclosure", checked)} /><Toggle label="It tags or invites @usemingla as a collaborator" checked={socialChecklist.hasMinglaCollab === true} onChange={(checked) => setSocialCheck("hasMinglaCollab", checked)} /><Button size="sm" variant="secondary" disabled={!socialChecklistComplete} loading={busy === `${key}-social`} onClick={() => void run(`${key}-social`, () => confirmLocalSocialPost(item.local_month_id, socialChecklist), "Social post checked.")}>Mark social post checked</Button><p className="text-xs text-[var(--color-text-tertiary)]">This confirmation records the Admin reviewer, time, and every checked requirement.</p></div> : null}</div>
            {item.status === "submitted" ? <><Textarea label="Changes to request" placeholder="One concrete change per line" className="min-h-24 font-sans" value={reasonText} onChange={(event) => setReasons((current) => ({ ...current, [item.local_month_id]: event.target.value }))} /><div className="flex flex-wrap gap-2"><Button size="sm" disabled={!allMediaLoaded || !watchedAllMedia || !socialReady} loading={busy === `${key}-approve`} onClick={() => void run(`${key}-approve`, () => decideLocalReview(item.local_month_id, "approve"), "Review approved and published.")}>Approve and publish</Button><Button size="sm" variant="secondary" disabled={!reasonList.length} loading={busy === `${key}-changes`} onClick={() => void run(`${key}-changes`, () => decideLocalReview(item.local_month_id, "changes_requested", reasonList), "Changes requested.")}>Request changes</Button></div><p className="text-xs text-[var(--color-text-tertiary)]">Approval unlocks after every submitted video is loaded and watched, and the public social post is checked.</p></> : <AlertCard variant="warning" title="Waiting for changes">The Local must submit the requested changes before Admin can approve.</AlertCard>}
          </section>
        </div>
        {errors.map(([errorKey, value]) => <p key={errorKey} role="alert" className="text-xs text-[var(--color-error-700)]">{value}</p>)}
      </div>
    </SectionCard>
  );
}

function ReviewWorkspace(props) {
  const { queue, selectedId, onSelect } = props;
  useEffect(() => { if (!queue.reviews.some((item) => item.local_month_id === selectedId)) onSelect(queue.reviews[0]?.local_month_id ?? null); }, [onSelect, queue.reviews, selectedId]);
  const selected = queue.reviews.find((item) => item.local_month_id === selectedId) ?? queue.reviews[0] ?? null;
  const list = <SectionCard title="Review queue" subtitle={`${queue.reviews.length} need a decision`} noPadding>{queue.reviews.length ? <ul className="divide-y divide-[var(--gray-200)]">{queue.reviews.map((item) => { const active = item.local_month_id === selected?.local_month_id; const mediaCount = Array.isArray(item.review?.media_job_ids) ? item.review.media_job_ids.length : 0; return <li key={item.local_month_id}><button type="button" aria-pressed={active} onClick={() => onSelect(item.local_month_id)} className={`flex w-full items-center gap-3 px-4 py-3 text-left ${focusClass} ${active ? "bg-[var(--color-brand-50)]" : "hover:bg-[var(--gray-50)]"}`}><QueueAvatar name={item.local_name} /><span className="min-w-0 flex-1"><strong className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">{item.place_name}</strong><span className="block truncate text-xs text-[var(--color-text-secondary)]">{item.local_name} · {monthWord(item.month)} · {mediaCount} video{mediaCount === 1 ? "" : "s"}</span></span><Badge variant={item.status === "changes_requested" ? "warning" : "brand"}>{LOCAL_MONTH_WORDS[item.status] ?? "Submitted"}</Badge></button></li>; })}</ul> : <QueueEmpty title="No Local reviews need a decision" detail="Submitted reviews will appear here for private playback and approval." />}</SectionCard>;
  return <MasterDetail list={list} detail={<ReviewDetail item={selected} {...props} />} detailLabel="Selected Local review" />;
}

function PicksWorkspace({ picks, voidReason, setVoidReason, rowError, busy, run }) {
  return <SectionCard title="Current picks" subtitle="Eligibility is checked automatically; cancel only when a pick breaks the rules." noPadding>{picks.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-[var(--gray-50)] text-xs text-[var(--color-text-tertiary)]"><tr><th className="px-4 py-3 font-medium">Local</th><th className="px-4 py-3 font-medium">Place</th><th className="px-4 py-3 font-medium">City</th><th className="px-4 py-3 font-medium">State</th><th className="px-4 py-3 font-medium">Exception action</th></tr></thead><tbody className="divide-y divide-[var(--gray-200)]">{picks.map((pick) => { const key = `pick-${pick.local_month_id}`; return <tr key={pick.local_month_id} className="align-top"><td className="px-4 py-3 font-medium text-[var(--color-text-primary)]">{pick.local_name}</td><td className="px-4 py-3 text-[var(--color-text-primary)]">{pick.place_name || "Place unavailable"}{pick.blocked_reason ? <span className="mt-1 block text-xs text-[var(--color-warning-700)]">{pick.blocked_reason}</span> : null}</td><td className="px-4 py-3 text-[var(--color-text-secondary)]">{pick.city || "—"}</td><td className="px-4 py-3"><Badge variant="default">{LOCAL_MONTH_WORDS[pick.status] ?? "Picked"}{pick.month ? ` · ${monthWord(pick.month)}` : ""}</Badge></td><td className="w-[320px] px-4 py-3"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><Input aria-label={`Reason for cancelling ${pick.local_name}'s pick`} placeholder="Reason for cancelling" value={voidReason[pick.local_month_id] ?? ""} onChange={(event) => setVoidReason((current) => ({ ...current, [pick.local_month_id]: event.target.value }))} /></div><Button size="sm" variant="danger" disabled={!String(voidReason[pick.local_month_id] ?? "").trim()} loading={busy === key} onClick={() => void run(key, () => voidLocalMonth(pick.local_month_id, voidReason[pick.local_month_id]), "Pick cancelled.")}>Cancel</Button></div>{rowError[key] ? <p role="alert" className="mt-1 text-xs text-[var(--color-error-700)]">{rowError[key]}</p> : null}</td></tr>; })}</tbody></table></div> : <QueueEmpty title="No current picks" detail="Eligible place selections will appear here after a Local picks for the month." />}</SectionCard>;
}

function PayoutsWorkspace({ payouts, rowError, busy, run }) {
  return <SectionCard title="Local payouts" subtitle="Amounts come from each city program and unlock only after publication." noPadding>{payouts.length ? <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-[var(--gray-50)] text-xs text-[var(--color-text-tertiary)]"><tr><th className="px-4 py-3 font-medium">Local</th><th className="px-4 py-3 font-medium">Month</th><th className="px-4 py-3 font-medium">Amount</th><th className="px-4 py-3 font-medium">State</th><th className="px-4 py-3 font-medium text-right">Action</th></tr></thead><tbody className="divide-y divide-[var(--gray-200)]">{payouts.map((item) => { const key = `pay-${item.local_month_id}`; return <tr key={item.local_month_id}><td className="px-4 py-3 font-medium text-[var(--color-text-primary)]">{item.local_name}</td><td className="px-4 py-3 text-[var(--color-text-secondary)]">{monthWord(item.month)}</td><td className="px-4 py-3 text-[var(--color-text-primary)]">{item.amount_minor ? money(item.amount_minor, item.currency) : "Not fixed"}</td><td className="px-4 py-3"><Badge variant={item.share_status === "paid" ? "success" : item.share_status === "releasable" ? "info" : "warning"} dot>{moneyStateWord(item.share_status)}</Badge></td><td className="px-4 py-3 text-right">{!item.share_status ? <Button size="sm" variant="secondary" loading={busy === key} onClick={() => void run(key, () => prepareLocalPayout(item.local_month_id), "Payout queued.")}>Fix amount and queue</Button> : null}{!item.share_status && rowError[key] ? <p role="alert" className="mt-1 text-xs text-[var(--color-error-700)]">{rowError[key]}</p> : null}</td></tr>; })}</tbody></table></div> : <QueueEmpty title="No Local payouts yet" detail="Approved and published months will appear here." />}</SectionCard>;
}

function CityProgramsWorkspace({ queue, freeCities, onSave }) {
  return <div className="space-y-4" data-testid="local-city-programs"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{queue.programs.map((program) => { const rate = programRate(program); return <CityCard key={`${program.city_id}:${program.seats}:${rate.minor}:${rate.currency}:${program.is_open}`} program={program} onSave={onSave} />; })}</div>{!queue.programs.length ? <SectionCard><QueueEmpty title="No city programs yet" detail="Create the first city program below." /></SectionCard> : null}<SectionCard title="Add a city" subtitle="Each city has its own seats, monthly rate, payout currency, and application state."><NewCityForm cities={freeCities} onSave={onSave} /></SectionCard></div>;
}

function localStatusWord(person) {
  if (person.has_local_record && person.program_status === "active") return "Active Local";
  if (person.has_local_record) return String(person.program_status || "Local").replaceAll("_", " ");
  return APPLICATION_STATUS_WORDS[person.program_status] ?? String(person.program_status || "Applicant").replaceAll("_", " ");
}

function LocalMessagesWorkspace({ people }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return people;
    return people.filter((person) => [person.display_name, person.city, localStatusWord(person)]
      .some((value) => String(value || "").toLowerCase().includes(needle)));
  }, [people, query]);
  const selected = filtered.find((person) => person.target_user_id === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="grid min-w-0 gap-4 min-[1050px]:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.4fr)]" role="tabpanel" id="tabpanel-messages">
      <SectionCard title="Locals and applicants" subtitle={`${people.length} people can receive a program message`} noPadding>
        <div className="border-b border-[var(--gray-200)] p-3">
          <Input aria-label="Search Locals and applicants" placeholder="Search by name, city or status" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        {filtered.length ? (
          <ul className="max-h-[560px] divide-y divide-[var(--gray-200)] overflow-y-auto">
            {filtered.map((person) => {
              const active = person.target_user_id === selected?.target_user_id;
              return (
                <li key={person.target_user_id}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelectedId(person.target_user_id)}
                    className={`w-full px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand-500)] ${active ? "bg-[var(--color-brand-50)]" : "hover:bg-[var(--gray-50)]"}`}
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <strong className="block truncate text-sm text-[var(--color-text-primary)]">{person.display_name}</strong>
                        <span className="mt-0.5 block truncate text-xs text-[var(--color-text-secondary)]">{person.city || "City unavailable"} · {localStatusWord(person)}</span>
                      </span>
                      {person.conversation_id ? <Badge variant="brand">Chat</Badge> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : <p className="px-5 py-10 text-center text-sm text-[var(--color-text-secondary)]">No people match that search.</p>}
      </SectionCard>
      <div className="min-w-0 self-start">
        {selected ? (
          <ProgramConversationPanel
            key={selected.target_user_id}
            programKind="local"
            targetUserId={selected.target_user_id}
            recipientName={selected.display_name}
          />
        ) : (
          <SectionCard><p className="py-12 text-center text-sm text-[var(--color-text-secondary)]">Choose a Local or applicant to message.</p></SectionCard>
        )}
      </div>
    </div>
  );
}


export function LocalsPanel() {
  const { addToast } = useToast();
  const [queue, setQueue] = useState({ agreement: null, cities: [], programs: [], applications: [], picks: [], reviews: [], payouts: [], people: [] });
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("applications");
  const [selectedApplicationId, setSelectedApplicationId] = useState(null);
  const [selectedReviewId, setSelectedReviewId] = useState(null);
  const [rowError, setRowError] = useState({});
  const [busy, setBusy] = useState(null);
  const [reasons, setReasons] = useState({});
  const [voidReason, setVoidReason] = useState({});
  const [mediaGrants, setMediaGrants] = useState({});
  const [mediaLoading, setMediaLoading] = useState(null);
  const [mediaReviewed, setMediaReviewed] = useState({});
  const [socialChecks, setSocialChecks] = useState({});
  const load = useCallback(async () => {
    setLoadError(""); setLoading(true);
    try {
      const [nextQueue, people] = await Promise.all([getLocalQueue(), listLocalProgramPeople()]);
      setQueue({ ...nextQueue, people });
      setLoaded(true);
    } catch (cause) {
      setLoadError(programErrorMessage(cause, "Couldn't load Mingla Locals. Try again."));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const run = async (key, action, success) => {
    setBusy(key); setRowError((current) => ({ ...current, [key]: undefined }));
    try { await action(); addToast({ variant: "success", title: success }); await load(); }
    catch (cause) { setRowError((current) => ({ ...current, [key]: programErrorMessage(cause) })); }
    finally { setBusy(null); }
  };
  const saveProgram = async (input) => {
    try { await saveCityProgram(input); addToast({ variant: "success", title: "City program saved." }); await load(); return null; }
    catch (cause) { return programErrorMessage(cause, "Couldn't save this city. Try again."); }
  };
  const loadReviewMedia = async (monthId, mediaId) => {
    const errorKey = `rev-${monthId}-media-${mediaId}`;
    setMediaLoading(mediaId); setRowError((current) => ({ ...current, [errorKey]: undefined }));
    try { const grant = await getCreatorMediaPlayback(mediaId); setMediaGrants((current) => ({ ...current, [mediaId]: grant })); setMediaReviewed((current) => ({ ...current, [monthId]: false })); }
    catch (cause) { setRowError((current) => ({ ...current, [errorKey]: programErrorMessage(cause, "This video cannot be played right now. Do not approve the review yet.") })); }
    finally { setMediaLoading(null); }
  };
  const tabs = [
    { id: "messages", label: `Messages · ${queue.people.length}` },
    { id: "applications", label: `Applications · ${queue.applications.length}` },
    { id: "picks", label: `Picks · ${queue.picks.length}` },
    { id: "reviews", label: `Reviews · ${queue.reviews.length}` },
    { id: "payouts", label: `Payouts · ${queue.payouts.length}` },
    { id: "city-programs", label: "City programs" },
  ];
  const freeCities = queue.cities.filter((city) => !queue.programs.some((program) => program.city_id === city.id));
  if (!loaded && loading) return <SectionCard><div className="py-12 text-center text-sm text-[var(--color-text-secondary)]" role="status">Loading Mingla Locals…</div></SectionCard>;
  return (
    <div className="space-y-4">
      {loadError ? <AlertCard variant="error" title="Couldn't load Mingla Locals" action={<Button size="sm" variant="secondary" onClick={() => void load()}>Try again</Button>}>{loadError}</AlertCard> : null}
      <ProgramSummary programs={queue.programs} agreement={queue.agreement} loading={loading} onRefresh={() => void load()} />
      <div className="space-y-4">
        <Tabs tabs={tabs} activeTab={tab} onChange={setTab} />
        {tab === "messages" ? <LocalMessagesWorkspace people={queue.people} /> : (
        <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === "applications" ? <ApplicationWorkspace queue={queue} selectedId={selectedApplicationId} onSelect={setSelectedApplicationId} busy={busy} rowError={rowError} run={run} /> : null}
          {tab === "picks" ? <PicksWorkspace picks={queue.picks} voidReason={voidReason} setVoidReason={setVoidReason} rowError={rowError} busy={busy} run={run} /> : null}
          {tab === "reviews" ? <ReviewWorkspace queue={queue} selectedId={selectedReviewId} onSelect={setSelectedReviewId} mediaGrants={mediaGrants} mediaLoading={mediaLoading} mediaReviewed={mediaReviewed} setMediaReviewed={setMediaReviewed} socialChecks={socialChecks} setSocialChecks={setSocialChecks} rowError={rowError} reasons={reasons} setReasons={setReasons} loadReviewMedia={loadReviewMedia} busy={busy} run={run} /> : null}
          {tab === "payouts" ? <PayoutsWorkspace payouts={queue.payouts} rowError={rowError} busy={busy} run={run} /> : null}
          {tab === "city-programs" ? <CityProgramsWorkspace queue={queue} freeCities={freeCities} onSave={saveProgram} /> : null}
        </div>
        )}
      </div>
    </div>
  );
}
