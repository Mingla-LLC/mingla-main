// #4452 §7.3 — Admin › Outreach › Forms. The list (status filter, KPIs, the
// table with Edit / Duplicate / Archive), New form, the Google conversions
// setup card (admins only, §7.8), and Submissions (the Leads list filtered to
// forms, A1.8). A form opens its builder at #/forms/<id>?tab=<tab>.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ClipboardList, Copy, Inbox, Mail, Pencil, PhoneCall, Plus } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { StatCard } from "../components/ui/Card";
import { Tabs } from "../components/ui/Tabs";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Input, Select } from "../components/ui/Input";
import { LoadError } from "../components/ui/LoadError";
import { Skeleton } from "../components/ui/Skeleton";
import { useToast } from "../context/ToastContext";
import { useServerRead } from "../hooks/useServerRead";
import { LeadsList } from "../components/leads/LeadsList";
import { FormBuilder } from "../components/forms/FormBuilder";
import { GoogleConversionsCard } from "../components/forms/GoogleConversionsCard";
import { LabelPill, ReadOnlyHint } from "../components/forms/formsUi";
import {
  ARCHIVED_TOAST, DUPLICATED_TOAST, STATUS_FILTERS, STATUS_PILL, archiveQuestion, TOOL_FORM_BADGE, formSubLine, formsHash, isToolForm, formsRoute,
  placementTags, weekChange,
} from "../lib/formsModel";
import { archiveForm, createForm, duplicateForm, formsErrorWords, listForms, siteRefreshWarning } from "../services/formsService";

function useFormsRoute() {
  const [route, setRoute] = useState(() => formsRoute(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(formsRoute(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((id, tab) => {
    const next = formsHash(id, tab);
    if (window.location.hash !== next) window.location.hash = next;
  }, []);
  return [route, go];
}

const TEMPLATES = [
  { value: "creators", label: "Creators" },
  { value: "locals", label: "Locals" },
  { value: "", label: "Blank" },
  { value: "book_call_extra", label: "Book a call: extra questions" },
];

function NewFormDialog({ open, onClose, onCreated }) {
  const { addToast } = useToast();
  const [name, setName] = useState("");
  const [audience, setAudience] = useState("creator");
  const [template, setTemplate] = useState("creators");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (name.trim().length < 2) { setError("Give it a name (2 to 80 characters)."); return; }
    setBusy(true);
    setError("");
    try {
      const res = await createForm(name.trim(), audience, template || null);
      onCreated(res.id);
    } catch (e) {
      addToast({ variant: "error", title: formsErrorWords(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="New form" size="sm">
      <ModalBody>
        <div className="space-y-3">
          <Input label="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} error={error} placeholder="Creators: join the program" />
          <Select label="Audience" value={audience} onChange={(e) => setAudience(e.target.value)}
            options={[{ value: "host", label: "Host" }, { value: "creator", label: "Creator" }, { value: "local", label: "Local" }]} />
          <Select label="Template" value={template} onChange={(e) => setTemplate(e.target.value)} options={TEMPLATES} />
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={submit} loading={busy}>Create the draft</Button>
      </ModalFooter>
    </Modal>
  );
}

export function FormsTable({ rows, canEdit, onEdit, onDuplicate, onArchive }) {
  if (!rows.length) {
    return (
      <div className="px-4 py-10 text-center" data-forms-empty="">
        <p className="font-semibold text-[var(--color-text-primary)]">Nothing here.</p>
        <p className="text-sm text-[var(--color-text-tertiary)]">Archived forms keep their answers.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table data-admin-table="" className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {["Form", "Status", "Lead label", "Where it shows", "7 days", "Goes to", ""].map((h) => (
              <th key={h} className="whitespace-nowrap border-b border-[var(--a-line)] bg-[var(--a-panel)] px-4 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => {
            const [variant, word] = STATUS_PILL[f.status] || ["draft", f.status];
            const tags = placementTags(f);
            return (
              <tr key={f.id} data-form-row={f.id} className="border-b border-[var(--a-line)] last:border-0">
                <td className="px-4 py-3.5">
                  <button type="button" onClick={() => onEdit(f.id)} className="text-left font-semibold text-[var(--color-text-primary)] hover:underline">{f.name}</button>
                  <div className="text-xs text-[var(--color-text-tertiary)]">{formSubLine(f)}</div>
                </td>
                <td className="px-4 py-3.5"><Badge variant={variant}>{word}{f.live_version ? ` v${f.live_version}` : ""}</Badge></td>
                <td className="px-4 py-3.5">{isToolForm(f) ? <span data-tool-form-badge=""><Badge variant="info">{TOOL_FORM_BADGE}</Badge></span> : <LabelPill label={f.audience} />}</td>
                <td className="px-4 py-3.5">
                  {tags.length ? (
                    <div className="flex flex-wrap gap-1">{tags.map((t) => <span key={t} className="rounded-full bg-[var(--a-soft)] px-2 py-0.5 text-xs text-[var(--a-text2)]">{t}</span>)}{f.own_page && <span className="rounded-full bg-[var(--a-soft)] px-2 py-0.5 text-xs text-[var(--a-text2)]">/apply/{f.own_page}</span>}</div>
                  ) : f.own_page ? <span className="rounded-full bg-[var(--a-soft)] px-2 py-0.5 text-xs text-[var(--a-text2)]">/apply/{f.own_page}</span> : <span className="text-xs text-[var(--color-text-tertiary)]">Not on any page</span>}
                </td>
                <td className="px-4 py-3.5 tabular-nums">{f.subs_7d}</td>
                <td className="px-4 py-3.5">{f.goes_to}</td>
                <td className="px-4 py-3.5">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" icon={Pencil} aria-label={`Edit ${f.name}`} title="Edit" onClick={() => onEdit(f.id)} />
                    <Button variant="ghost" size="sm" icon={Copy} aria-label={`Duplicate ${f.name}`} title={canEdit ? "Duplicate" : "Ask an admin for the Website editor role"} disabled={!canEdit} onClick={() => onDuplicate(f)} />
                    {f.status !== "archived" && <Button variant="ghost" size="sm" icon={Archive} aria-label={`Archive ${f.name}`} title={canEdit ? "Archive" : "Ask an admin for the Website editor role"} disabled={!canEdit} onClick={() => onArchive(f)} />}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FormsList({ onOpen, tab, onTab }) {
  const { addToast } = useToast();
  const [filter, setFilter] = useState("all");
  const status = STATUS_FILTERS.find((s) => s.id === filter)?.status ?? null;
  const load = useCallback(() => listForms(status), [status]);
  const { status: st, data, error, retry } = useServerRead(load);
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState(null);
  const [busy, setBusy] = useState(false);
  const canEdit = Boolean(data?.can_edit);
  const kpis = data?.kpis || {};
  const anySubs = useMemo(() => (data?.rows || []).some((r) => r.subs_7d > 0 || r.booked_after_pct !== null), [data]);
  const bookedAfter = useMemo(() => {
    const vals = (data?.rows || []).map((r) => r.booked_after_pct).filter((v) => typeof v === "number");
    return vals.length ? `${Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)}%` : "n/a";
  }, [data]);

  const duplicate = async (f) => {
    try {
      await duplicateForm(f.id);
      addToast({ variant: "success", title: DUPLICATED_TOAST });
      retry();
    } catch (e) { addToast({ variant: "error", title: formsErrorWords(e) }); }
  };
  const confirmArchive = async () => {
    setBusy(true);
    try {
      const { refreshed } = await archiveForm(archiving.id);
      if (refreshed) addToast({ variant: "success", title: ARCHIVED_TOAST });
      else siteRefreshWarning(addToast, "Archived.");
      setArchiving(null);
      retry();
    } catch (e) { addToast({ variant: "error", title: formsErrorWords(e) }); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-6" data-forms-list="">
      <PageHeader
        title="Forms"
        description="Forms on usemingla.com, what they collect and who follows up."
        actions={(
          <>
            {tab !== "submissions" && (
              <div role="group" aria-label="Status" className="flex rounded-xl bg-[var(--a-soft)] p-1">
                {STATUS_FILTERS.map((s) => (
                  <button key={s.id} type="button" aria-pressed={filter === s.id} onClick={() => setFilter(s.id)}
                    className={`h-8 rounded-[9px] px-3 text-sm font-medium ${filter === s.id ? "bg-[var(--a-panel)] text-[var(--a-text)] shadow-[0_1px_3px_rgba(20,20,19,.1)]" : "text-[var(--a-text2)]"}`}>{s.label}</button>
                ))}
              </div>
            )}
            <Button icon={Plus} onClick={() => setCreating(true)} disabled={!canEdit} title={canEdit ? undefined : "Ask an admin for the Website editor role"}>New form</Button>
          </>
        )}
        tabs={<Tabs tabs={[{ id: "forms", label: "Forms" }, { id: "submissions", label: "Submissions" }]} activeTab={tab === "submissions" ? "submissions" : "forms"} onChange={(t) => onTab(t === "submissions" ? "submissions" : null)} />}
      />
      {!canEdit && data && <ReadOnlyHint />}

      {tab === "submissions" ? (
        <LeadsList search="" onSearch={() => {}} fixed={{ sources: ["form"] }} forms={(data?.rows || []).map((r) => ({ id: r.id, name: r.name }))} />
      ) : (
        <>
          {data?.is_admin && <GoogleConversionsCard />}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-forms-kpis="">
            {st === "loading" ? [0, 1, 2, 3].map((i) => <Skeleton key={i} height={128} rounded="16px" />) : (
              <>
                <StatCard icon={Inbox} label="Submissions, 7 days" value={kpis.subs_7d ?? 0} trend={weekChange(kpis.subs_7d, kpis.subs_prev_7d)} trendUp={(kpis.subs_7d ?? 0) > (kpis.subs_prev_7d ?? 0) ? true : (kpis.subs_7d ?? 0) < (kpis.subs_prev_7d ?? 0) ? false : undefined} />
                <StatCard icon={ClipboardList} label="Live forms" value={kpis.live ?? 0} />
                <StatCard icon={Mail} label="Emails waiting to send" value={kpis.emails_waiting ?? 0} />
                <StatCard icon={PhoneCall} label="Booked a call after" value={anySubs ? bookedAfter : "n/a"} />
              </>
            )}
          </div>
          <section className="overflow-hidden rounded-2xl border border-[var(--a-line)] bg-[var(--color-background-primary)] shadow-[var(--a-shadow)]">
            <div className="flex items-center border-b border-[var(--a-line)] px-4 py-3"><h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">All forms</h2></div>
            {st === "loading" ? (
              <div className="space-y-px p-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={57} />)}</div>
            ) : st === "error" ? (
              <LoadError message={formsErrorWords(error)} onRetry={retry} className="m-4" />
            ) : (
              <FormsTable rows={data?.rows || []} canEdit={canEdit} onEdit={(id) => onOpen(id, "fields")} onDuplicate={duplicate} onArchive={setArchiving} />
            )}
          </section>
        </>
      )}

      <NewFormDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); onOpen(id, "fields"); }} />
      <Modal open={Boolean(archiving)} onClose={() => !busy && setArchiving(null)} title="Archive this form?" size="sm" destructive>
        <ModalBody><p className="text-sm text-[var(--color-text-secondary)]">{archiving ? archiveQuestion(archiving.name) : ""}</p></ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setArchiving(null)} disabled={busy}>Keep it</Button>
          <Button variant="danger" onClick={confirmArchive} loading={busy}>Archive</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

export function FormsPage() {
  const [route, go] = useFormsRoute();
  if (route.id) return <FormBuilder formId={route.id} tab={route.tab || "fields"} onTab={(t) => go(route.id, t)} onBack={() => go(null, null)} />;
  return <FormsList onOpen={go} tab={route.tab} onTab={(t) => go(null, t)} />;
}
