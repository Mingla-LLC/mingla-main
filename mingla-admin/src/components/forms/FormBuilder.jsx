// #4452 §7.4 — the form builder: header, the tabs (Fields, Design,
// Automations, Leads and lead label, Own page, Where it shows, Publish,
// Results), and the draft's autosave.
//
// Autosave: 800 ms after the last change, admin_form_save_draft with the rev
// the draft was read at. A PT409 means someone else saved first: the builder
// says so ("Load their version") and KEEPS the local edit until the person
// chooses. Leaving with an unsaved edit asks Keep or Discard, in the page.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";
import { PageHeader } from "../ui/PageHeader";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Tabs } from "../ui/Tabs";
import { LoadError } from "../ui/LoadError";
import { Skeleton } from "../ui/Skeleton";
import { useToast } from "../../context/ToastContext";
import { AUTOSAVE_MS, BUILDER_TABS, CONFLICT_COPY, autosaveReducer, TOOL_FORM_BADGE, TOOL_FORM_HINT, UNARCHIVED_TOAST, builderSubLine, isToolForm, publishReview } from "../../lib/formsModel";
import { kindsOf, normalizeStops } from "../../lib/flowModel";
import { formsErrorWords, getAutomation, getForm, getSchedulerProfiles, saveFormDraft, sendTestEmails, siteRefreshWarning, unarchiveForm } from "../../services/formsService";
import { ReadOnlyHint } from "./formsUi";
import { FieldsTab } from "./FieldsTab";
import { DesignTab } from "./DesignTab";
import { AutomationsTab } from "./AutomationsTab";
import { RoutingTab } from "./RoutingTab";
import { AfterSendTab } from "./AfterSendTab";
import { OwnPageTab } from "./OwnPageTab";
import { WhereTab } from "./WhereTab";
import { PublishTab } from "./PublishTab";
import { ResultsTab } from "./ResultsTab";

export function FormBuilder({ formId, tab, onTab, onBack }) {
  const { addToast } = useToast();
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState(null); // { form, live_version, versions, own_page }
  const [s, setS] = useState({ draft: null, rev: 1, dirty: false, saving: false, conflict: false, saveError: null });
  const [auto, setAuto] = useState(null); // admin_automation_get
  const [flow, setFlow] = useState(null);
  const [stops, setStops] = useState(null);
  const [flowDirty, setFlowDirty] = useState(false);
  const [leaving, setLeaving] = useState(null);
  const [testing, setTesting] = useState(false);
  const [schedulers, setSchedulers] = useState([]);
  const timer = useRef(null);
  const stateRef = useRef(s);
  useEffect(() => { stateRef.current = s; }, [s]);
  const dispatch = useCallback((e) => setS((cur) => autosaveReducer(cur, e)), []);

  const [unarchiving, setUnarchiving] = useState(false);
  const unarchive = async () => {
    setUnarchiving(true);
    try {
      const { refreshed } = await unarchiveForm(formId);
      if (refreshed) addToast({ variant: "success", title: UNARCHIVED_TOAST });
      else siteRefreshWarning(addToast, "Unarchived as a draft.");
      await load();
    } catch (e) { addToast({ variant: "error", title: formsErrorWords(e) }); }
    finally { setUnarchiving(false); }
  };
  const load = useCallback(async () => {
    setStatus((cur) => (cur === "ready" ? "refreshing" : "loading"));
    setError(null);
    try {
      // The web deploy can briefly lead the database migration. Forms must
      // still open during that window; only the new scheduler choices wait.
      const [f, a, schedulerRows] = await Promise.all([
        getForm(formId),
        getAutomation(formId),
        getSchedulerProfiles().catch(() => []),
      ]);
      setMeta({ form: f.form, live_version: f.live_version, versions: f.versions, own_page: f.own_page });
      dispatch({ type: "load", draft: f.draft, rev: f.draft_rev });
      setAuto(a);
      setSchedulers(Array.isArray(schedulerRows) ? schedulerRows : []);
      setFlow(a.draft || { v: 1, steps: [] });
      setStops(normalizeStops(a.stops));
      setFlowDirty(false);
      setStatus("ready");
    } catch (e) {
      setError(e);
      setStatus("error");
    }
  }, [dispatch, formId]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const canEdit = Boolean(meta?.form?.can_edit) && meta?.form?.status !== "archived";

  // Autosave 800 ms after the last change. A stale rev is a conflict, never an overwrite.
  const save = useCallback(async () => {
    const cur = stateRef.current;
    if (!cur.dirty || cur.saving || cur.conflict) return;
    const sent = cur.draft;
    dispatch({ type: "saving" });
    try {
      const res = await saveFormDraft(formId, cur.rev, sent);
      dispatch({ type: "saved", rev: res.draft_rev, sent });
    } catch (e) {
      if (e.code === "PT409") dispatch({ type: "conflict" });
      else dispatch({ type: "error", message: formsErrorWords(e) });
    }
  }, [dispatch, formId]);

  const edit = useCallback((next) => {
    if (!canEdit) return;
    dispatch({ type: "edit", draft: typeof next === "function" ? next(stateRef.current.draft) : next });
  }, [canEdit, dispatch]);

  useEffect(() => {
    if (!s.dirty || s.conflict) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(save, AUTOSAVE_MS);
    return () => clearTimeout(timer.current);
  }, [s.draft, s.dirty, s.conflict, save]);

  // Leaving with an unsaved edit: Keep or Discard, inside the page.
  const unsaved = s.dirty || s.saving || flowDirty;
  useEffect(() => {
    const before = (e) => { if (unsaved) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [unsaved]);
  const guard = (fn) => () => (unsaved ? setLeaving(() => fn) : fn());

  const def = s.draft;
  const kinds = useMemo(() => kindsOf(flow), [flow]);
  const review = useMemo(() => (def ? publishReview(def, flow, meta?.form?.tested_at ?? null) : null), [def, flow, meta]);
  const publishBad = review ? !review.ok : false;

  const testAll = async () => {
    setTesting(true);
    try {
      const res = await sendTestEmails(formId);
      addToast({ variant: "success", title: `Sent you ${res.sent} test ${res.sent === 1 ? "email" : "emails"}.` });
      setMeta((m) => ({ ...m, form: { ...m.form, tested_at: new Date().toISOString() } }));
    } catch (e) {
      // #4452 B22/B24: no email steps means nothing to test (check 5 passes); an info toast that closes itself.
      if (e.code === "no_email_steps") addToast({ variant: "info", title: "This form sends no emails yet, so there is nothing to test." });
      else addToast({ variant: "error", title: formsErrorWords(e) });
    } finally {
      setTesting(false);
    }
  };

  if (status === "loading") {
    return <div className="flex flex-col gap-6" data-builder-loading=""><PageHeader title="Form" back={{ label: "Forms", onClick: onBack }} /><Skeleton height={44} /><Skeleton height={420} rounded="16px" /></div>;
  }
  if (status === "error") {
    return <div className="flex flex-col gap-6"><PageHeader title="Form" back={{ label: "Forms", onClick: onBack }} /><LoadError message={formsErrorWords(error)} onRetry={load} /></div>;
  }

  const form = meta.form;
  const liveV = meta.live_version?.version;
  const pill = form.status === "live" ? ["live", `Live v${liveV}`] : form.status === "archived" ? ["stop", "Archived"] : ["draft", `Draft v${(meta.versions || 0) + 1}`];
  const tabs = BUILDER_TABS.filter((t) => !(t.id === "automations" && form.template === "book_call_extra"))
    .map((t) => ({ ...t, label: t.id === "publish" && publishBad ? <span className="inline-flex items-center gap-1.5">Publish <span aria-label="Some checks fail" className="h-2 w-2 rounded-full bg-[#eb7825]" /></span> : t.id === "fields" ? `Fields ${def.fields.length}` : t.label }));
  const common = { form, def, edit, canEdit, schedulers, flow, setFlow: (f) => { setFlow(f); setFlowDirty(true); }, stops, setStops: (x) => { setStops(x); setFlowDirty(true); }, kinds, auto, reloadAuto: async () => { const a = await getAutomation(formId); setAuto(a); setFlow(a.draft); setStops(normalizeStops(a.stops)); setFlowDirty(false); }, meta, setMeta, review, reload: load, onTab };

  return (
    <div className="flex flex-col gap-6" data-form-builder={formId}>
      <div className="flex flex-col gap-3">
        <PageHeader
          back={{ label: "Forms", onClick: guard(onBack) }}
          title={form.name}
          meta={<span className="inline-flex items-center gap-2"><Badge variant={pill[0]}>{pill[1]}</Badge>{isToolForm(form) && <Badge variant="info">{TOOL_FORM_BADGE}</Badge>}</span>}
          description={<span data-builder-sub="">{isToolForm(form) ? TOOL_FORM_HINT : builderSubLine(def, kinds)}</span>}
          actions={(
            <>
              <span className="text-xs text-[var(--color-text-tertiary)]" aria-live="polite" data-save-state="">
                {s.saving ? "Saving…" : s.conflict ? "Not saved" : s.saveError ? "Not saved" : s.dirty ? "Unsaved changes" : "Saved"}
              </span>
              <Button variant="secondary" icon={Send} onClick={testAll} loading={testing} disabled={!canEdit}>Send me a test</Button>
              <Button onClick={() => onTab("publish")} disabled={!canEdit}>Review and publish</Button>
            </>
          )}
          tabs={<Tabs tabs={tabs} activeTab={tab} onChange={onTab} />}
        />
        {!form.can_edit && <ReadOnlyHint />}
        {form.status === "archived" && (
          <div data-archived-banner="" className="flex flex-wrap items-center gap-3 rounded-xl bg-[var(--a-stop-bg)] px-3 py-2 text-sm text-[var(--a-stop-ink)]">
            <span>This form is archived. Its answers stay. Unarchiving brings it back as a draft, not on any page, until you publish it again.</span>
            <Button size="sm" variant="secondary" onClick={unarchive} loading={unarchiving} disabled={!form.can_edit}>Unarchive</Button>
          </div>
        )}
        {s.conflict && (
          <div role="alert" data-builder-conflict="" className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--a-line)] bg-[var(--a-stop-bg)] px-3 py-2 text-sm text-[var(--a-stop-ink)]">
            <span>{CONFLICT_COPY} Your edit is kept here until you choose.</span>
            <Button size="sm" variant="secondary" onClick={load}>Load their version</Button>
          </div>
        )}
        {s.saveError && !s.conflict && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-[#fee2e2] px-3 py-2 text-sm text-[#991b1b]">
            <span>{s.saveError}</span>
            <Button size="sm" variant="secondary" onClick={save}>Try again</Button>
          </div>
        )}
      </div>
      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "fields" && <FieldsTab {...common} />}
        {tab === "design" && <DesignTab {...common} />}
        {tab === "automations" && <AutomationsTab {...common} />}
        {tab === "routing" && <RoutingTab {...common} />}
        {tab === "aftersend" && <AfterSendTab {...common} />}
        {tab === "ownpage" && <OwnPageTab {...common} />}
        {tab === "where" && <WhereTab {...common} />}
        {tab === "publish" && <PublishTab {...common} rev={s.rev} dirty={s.dirty || s.saving} flush={save} />}
        {tab === "results" && <ResultsTab {...common} />}
      </div>

      {leaving && (
        <div role="alertdialog" aria-label="Unsaved changes" data-leave-prompt="" className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-[min(560px,calc(100vw-32px))] flex-wrap items-center gap-3 rounded-2xl border border-[var(--a-line)] bg-[var(--color-background-primary)] p-3 shadow-[var(--shadow-lg)]">
          <span className="flex-1 text-sm text-[var(--color-text-primary)]">You have changes that are not saved yet.</span>
          <Button size="sm" variant="secondary" onClick={() => setLeaving(null)}>Keep editing</Button>
          <Button size="sm" variant="danger" onClick={() => { const go = leaving; setLeaving(null); dispatch({ type: "load", draft: s.draft, rev: s.rev }); setFlowDirty(false); go(); }}>Discard</Button>
        </div>
      )}
    </div>
  );
}
