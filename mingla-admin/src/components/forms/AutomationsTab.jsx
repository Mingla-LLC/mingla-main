// #4452 §5.1–§5.8 Automations tab (design renderAuto / aEditor): the trigger,
// the flow with + between steps and Yes / No paths for branches, each card's
// title, sub-line and stats; the editor for the selected step (the email step
// uses the SAME EmailBodyEditor as Communications › Email); the stop rules; the
// On toggle, "Test the whole flow" and "Save changes" (publishes a version).
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarCheck, Clock, GitBranch, Mail, MailOpen, MoveRight, Plus, Send, Trash2, Users } from "lucide-react";
import { Button } from "../ui/Button";
import { Input, Select, Toggle } from "../ui/Input";
import { StatCard } from "../ui/Card";
import { useToast } from "../../context/ToastContext";
import { EmailBodyEditor } from "../email/EmailBodyEditor";
import { LimitedText, Panel, ToggleRow } from "./formsUi";
import {
  ACTION_BAR_OPTIONS, BRANCH_ON, FROM_OPTIONS, KIND_COPY, SAVED_TOAST, STEP_TYPES, STOP_RULES, TEAM_TO, WAIT_UNITS,
  findStep, insertStep, newStep, removeStep, stepStats, stepSub, stepTitle, updateStep,
} from "../../lib/flowModel";
import { formTokenOptions } from "../../lib/formsTokens";
import { flowSaveErrors } from "../../lib/formsModel";
import { crmChoices, formsErrorWords, publishAutomation, saveAutomationDraft, sendTestEmails, setAutomationEnabled, testWholeFlow } from "../../services/formsService";

const ICON = { email: Mail, team: Users, wait: Clock, branch: GitBranch, stage: MoveRight };
const NON_SCHEDULER_DESTINATIONS = [
  { value: "app", label: "Get the app" },
  { value: "url", label: "Any link" },
];
const LEGACY_SCHEDULER_DESTINATIONS = {
  schedule: "Book a call (older Host link)",
  schedule_creators: "Book a call (older Creator link)",
  schedule_locals: "Book a call (older Local link)",
};

function formEmailDestinations(schedulers, audience, current) {
  const choices = (schedulers || [])
    .filter((profile) => profile.audience === audience)
    .map((profile) => ({
      value: `scheduler:${profile.key}`,
      label: `${profile.name} · ${profile.duration_minutes} min`,
    }));
  // Existing saved flows keep rendering without silently changing their URL.
  if (LEGACY_SCHEDULER_DESTINATIONS[current]) {
    choices.push({ value: current, label: LEGACY_SCHEDULER_DESTINATIONS[current] });
  }
  return [...choices, ...NON_SCHEDULER_DESTINATIONS];
}

function AddMenu({ onAdd, disabled, cardOn, label = "Add a step" }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex justify-center py-1">
      <button type="button" aria-label={label} aria-expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)} data-flow-add=""
        className="grid h-7 w-7 place-items-center rounded-full border border-[var(--a-line)] bg-[var(--a-panel)] text-[var(--a-text2)] hover:border-[var(--a-text)] disabled:cursor-not-allowed disabled:opacity-50">
        <Plus aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div role="menu" className="absolute top-9 z-20 w-60 rounded-xl border border-[var(--a-line)] bg-[var(--a-panel)] p-1 shadow-[var(--shadow-lg)]">
          {STEP_TYPES.map((t) => (
            <button key={t.type} type="button" role="menuitem" disabled={t.type === "stage" && !cardOn} onClick={() => { setOpen(false); onAdd(t.type); }}
              className="block w-full rounded-lg px-2.5 py-2 text-left text-sm hover:bg-[var(--a-soft)] disabled:cursor-not-allowed disabled:opacity-50">
              <span className="block font-medium text-[var(--color-text-primary)]">{t.label}</span>
              <span className="block text-xs text-[var(--color-text-tertiary)]">{t.type === "stage" && !cardOn ? "Turn on the pipeline card first" : t.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function FlowList({ steps, path, ctx }) {
  return (
    <div className="flex flex-col">
      <AddMenu disabled={!ctx.canEdit} cardOn={ctx.cardOn} onAdd={(t) => ctx.add(path, 0, t)} />
      {steps.map((s, i) => {
        const Icon = ICON[s.type] || Mail;
        const stats = stepStats(ctx.stats[s.id]);
        // #4452 B23: a step the server refused is marked here, with the reason, not on Publish.
        const err = ctx.errors?.[s.id];
        return (
          <div key={s.id}>
            <button type="button" onClick={() => ctx.select(s.id)} data-flow-step={s.id} data-step-type={s.type} data-step-error={err ? "" : undefined}
              aria-invalid={err ? "true" : undefined}
              className={`w-full rounded-2xl border bg-[var(--color-background-primary)] p-3 text-left ${err ? "border-[#b91c1c] shadow-[0_0_0_3px_rgba(185,28,28,.14)]" : ctx.sel === s.id ? "border-[var(--a-text)] shadow-[0_0_0_3px_rgba(235,120,37,.16)]" : "border-[var(--a-line)]"}`}>
              <span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]"><Icon aria-hidden="true" className="h-4 w-4 text-[#eb7825]" /> {stepTitle(s, ctx.fields)}</span>
              <span className="mt-0.5 block text-xs text-[var(--color-text-tertiary)]">{stepSub(s, ctx.kinds)}</span>
              {stats && <span className="mt-1 block font-mono text-[11px] text-[var(--a-dim)]">{stats}</span>}
              {err && <span className="mt-1.5 block text-xs font-medium text-[#991b1b]" data-step-error-reason="">{err}</span>}
            </button>
            {s.type === "branch" && (
              <div className="mt-2 grid grid-cols-2 gap-2 rounded-2xl border border-dashed border-[var(--a-line)] p-2">
                {["yes", "no"].map((side) => (
                  <div key={side} className="min-w-0">
                    <p className="text-center font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--a-dim)]">{side === "yes" ? "Yes" : "No"}</p>
                    <FlowList steps={s[side] || []} path={[s.id, side]} ctx={ctx} />
                  </div>
                ))}
              </div>
            )}
            <AddMenu disabled={!ctx.canEdit} cardOn={ctx.cardOn} onAdd={(t) => ctx.add(path, i + 1, t)} />
          </div>
        );
      })}
    </div>
  );
}

function EmailEditor({ step, set, kinds, tokens, canEdit, formId, onTested, trackStale, schedulers, audience }) {
  const { addToast } = useToast();
  const [sending, setSending] = useState(false);
  const kind = kinds[step.id] || "confirmation";
  const [kindName, kindHint] = KIND_COPY[kind];
  const destinationOptions = formEmailDestinations(schedulers, audience, step.button?.to?.kind);
  const defaultDestination = destinationOptions.find((option) => option.value.startsWith("scheduler:"))?.value || "url";
  const test = async () => {
    setSending(true);
    try {
      await sendTestEmails(formId, step.id);
      addToast({ variant: "success", title: "Sent you this email with sample answers." });
      onTested();
    } catch (e) {
      // #4452 B24: a "save first" hint is not an error that needs closing by hand.
      if (e.code === "no_email_steps") trackStale(addToast({ variant: "info", title: "Save changes first: the test reads the saved emails." }));
      else addToast({ variant: "error", title: formsErrorWords(e) });
    } finally { setSending(false); }
  };
  return (
    <div className="flex flex-col gap-3" data-email-step={step.id}>
      <LimitedText label="Name (only the team sees it)" value={step.name} limit={60} disabled={!canEdit} onChange={(v) => set({ name: v })} />
      <div className="grid grid-cols-2 gap-2">
        <Select label="From" value={step.from} disabled={!canEdit} onChange={(e) => set({ from: e.target.value })} options={FROM_OPTIONS.map((o) => ({ value: o.id, label: o.label }))} />
        <Select label="Replies go to" value={step.reply_to} disabled={!canEdit} onChange={(e) => set({ reply_to: e.target.value })} options={[{ value: "team", label: "The team inbox" }, { value: "owner", label: "The card owner" }]} />
      </div>
      <LimitedText label="Subject" value={step.subject} limit={80} disabled={!canEdit} onChange={(v) => set({ subject: v })} />
      <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
        <span data-kind-pill={kind} className={`rounded-full px-2 py-0.5 font-semibold ${kind === "follow_up" ? "bg-[var(--a-stop-bg)] text-[var(--a-stop-ink)]" : "bg-[var(--a-live-bg)] text-[var(--a-live-ink)]"}`}>{kindName}</span>
        {kindHint}
      </p>
      <EmailBodyEditor value={step.doc || []} onChange={(next) => set({ doc: typeof next === "function" ? next(step.doc || []) : next })} tokens={tokens} />
      <div className="grid gap-2 sm:grid-cols-2">
        <LimitedText label="Main button (optional)" value={step.button?.text || ""} limit={28} disabled={!canEdit}
          onChange={(v) => set({ button: v ? { text: v, to: step.button?.to || { kind: defaultDestination } } : null })} />
        <Select label="Button goes to" value={step.button?.to?.kind || defaultDestination} disabled={!canEdit || !step.button?.text}
          onChange={(e) => set({ button: { ...step.button, to: { kind: e.target.value, ...(e.target.value === "url" ? { href: step.button?.to?.href || "https://usemingla.com" } : {}) } } })} options={destinationOptions} />
      </div>
      {step.button?.to?.kind === "url" && (
        <Input label="Link" value={step.button.to.href || ""} disabled={!canEdit} onChange={(e) => set({ button: { ...step.button, to: { kind: "url", href: e.target.value } } })} placeholder="https://" />
      )}
      <Select label="Buttons above the footer" value={step.action_bar || "auto"} disabled={!canEdit} onChange={(e) => set({ action_bar: e.target.value })}
        options={ACTION_BAR_OPTIONS.map((o) => ({ value: o.id, label: o.label }))} />
      <ToggleRow title="Show their answers in the email" checked={Boolean(step.show_answers)} disabled={!canEdit} onChange={(v) => set({ show_answers: v })} />
      <Button variant="secondary" icon={Send} onClick={test} loading={sending} disabled={!canEdit}>Send me this email</Button>
    </div>
  );
}

function StepEditor({ step, set, remove, ctx }) {
  if (!step) return <p className="text-sm text-[var(--color-text-tertiary)]">Pick a step to edit it.</p>;
  const choiceFields = ctx.fields.filter((f) => ["single", "multi", "dropdown"].includes(f.type) && f.source !== "google_city");
  return (
    <div className="flex flex-col gap-3">
      {step.type === "email" && <EmailEditor step={step} set={set} kinds={ctx.kinds} tokens={ctx.tokens} canEdit={ctx.canEdit} formId={ctx.formId} onTested={ctx.onTested} trackStale={ctx.trackStale} schedulers={ctx.schedulers} audience={ctx.audience} />}
      {step.type === "team" && (
        <>
          <LimitedText label="Name" value={step.name} limit={60} disabled={!ctx.canEdit} onChange={(v) => set({ name: v })} />
          <Select label="Send to" value={step.to} disabled={!ctx.canEdit} onChange={(e) => set({ to: e.target.value })} options={TEAM_TO.filter((t) => t.id !== "owner" || ctx.cardOn).map((t) => ({ value: t.id, label: t.label }))} />
          <ToggleRow title="Include their answers" hint="Reply-to is the person, so the team answers them directly." checked={Boolean(step.include_answers)} disabled={!ctx.canEdit} onChange={(v) => set({ include_answers: v })} />
        </>
      )}
      {step.type === "wait" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Input label="How long" type="number" min={1} max={60} value={step.n} disabled={!ctx.canEdit}
              onChange={(e) => set({ n: Math.max(1, Math.min(60, Math.round(Number(e.target.value) || 1))) })} />
            <Select label="Unit" value={step.unit} disabled={!ctx.canEdit} onChange={(e) => set({ unit: e.target.value })} options={WAIT_UNITS.map((u) => ({ value: u, label: u }))} />
          </div>
          <ToggleRow title="Then send at 10:00 in their time zone" hint="From the time zone their browser gave; UTC when it gave none." checked={Boolean(step.at10)} disabled={!ctx.canEdit} onChange={(v) => set({ at10: v })} />
          <ToggleRow title="Skip weekends" hint="Counts Monday to Friday only." checked={Boolean(step.skip_weekends)} disabled={!ctx.canEdit} onChange={(v) => set({ skip_weekends: v })} />
        </>
      )}
      {step.type === "branch" && (
        <>
          <Select label="Split on" value={step.cond?.on || "booked"} disabled={!ctx.canEdit}
            onChange={(e) => {
              const on = e.target.value;
              const f = choiceFields[0];
              set({ cond: on === "answer" ? { on, field_key: f?.key, op: "is", value: f?.options?.[0] || "" } : on === "lead_label" ? { on, op: "is", value: "creator" } : { on, op: "is", value: "yes" } });
            }}
            options={BRANCH_ON.filter((b) => b.id !== "answer" || choiceFields.length).map((b) => ({ value: b.id, label: b.label }))} />
          {step.cond?.on === "answer" && (
            <div className="grid gap-2">
              <Select label="Question" value={step.cond.field_key} disabled={!ctx.canEdit}
                onChange={(e) => { const f = choiceFields.find((x) => x.key === e.target.value); set({ cond: { ...step.cond, field_key: f.key, value: f.options[0] } }); }}
                options={choiceFields.map((f) => ({ value: f.key, label: f.label }))} />
              <div className="grid grid-cols-2 gap-2">
                <Select label="Is" value={step.cond.op} disabled={!ctx.canEdit} onChange={(e) => set({ cond: { ...step.cond, op: e.target.value } })}
                  options={[{ value: "is", label: "is" }, { value: "is_not", label: "is not" }, { value: "contains", label: "includes" }]} />
                <Select label="Answer" value={step.cond.value} disabled={!ctx.canEdit} onChange={(e) => set({ cond: { ...step.cond, value: e.target.value } })}
                  options={(choiceFields.find((f) => f.key === step.cond.field_key)?.options || []).map((o) => ({ value: o, label: o }))} />
              </div>
            </div>
          )}
          {step.cond?.on === "lead_label" && (
            <Select label="Label" value={step.cond.value} disabled={!ctx.canEdit} onChange={(e) => set({ cond: { ...step.cond, value: e.target.value } })}
              options={[{ value: "host", label: "Host lead" }, { value: "creator", label: "Creator lead" }, { value: "local", label: "Local lead" }]} />
          )}
          <p className="text-xs text-[var(--color-text-tertiary)]">Opened and clicked look only at emails sent in this person's run.</p>
        </>
      )}
      {step.type === "stage" && (
        <Select label="Move the card to" value={step.stage} disabled={!ctx.canEdit} onChange={(e) => set({ stage: e.target.value })} placeholder="Pick a stage"
          options={ctx.stages.map((s) => ({ value: s.id, label: s.label }))} />
      )}
      <Button variant="ghost" icon={Trash2} onClick={remove} disabled={!ctx.canEdit}>Remove this step</Button>
    </div>
  );
}

export function AutomationsTab({ form, def, canEdit, flow, setFlow, stops, setStops, kinds, auto, reloadAuto, setMeta, schedulers = [] }) {
  const { addToast, removeToast } = useToast();
  const [sel, setSel] = useState(flow?.steps?.[0]?.id || null);
  const [stepErrors, setStepErrors] = useState({});
  // #4452 B24: error toasts a successful save makes stale; closed when the save succeeds.
  const staleToasts = useRef([]);
  const trackStale = (id) => { if (id) staleToasts.current.push(id); };
  const [busy, setBusy] = useState("");
  const [stages, setStages] = useState([]);
  const cardOn = Boolean(def.routing?.card?.on);
  const tokens = useMemo(() => formTokenOptions(def), [def]);
  useEffect(() => {
    let live = true;
    if (!cardOn) return undefined;
    crmChoices(def.routing.card.pipeline).then((c) => { if (live) setStages(c.stages); }, () => { if (live) setStages([]); });
    return () => { live = false; };
  }, [cardOn, def.routing?.card?.pipeline]);

  const ctx = {
    canEdit, cardOn, kinds, fields: def.fields, tokens, stages: cardOn ? stages : [], sel, formId: form.id,
    schedulers, audience: def.audience,
    stats: auto?.steps || {}, errors: stepErrors, trackStale,
    select: setSel,
    add: (path, index, type) => {
      const step = newStep(type, flow, { from: def.audience === "local" ? "locals" : def.audience === "host" ? "hosts" : "creators", teamTo: def.audience === "local" ? "locals_inbox" : def.audience === "host" ? "hosts_inbox" : "creators_inbox", firstStage: stages[0]?.id });
      setFlow(insertStep(flow, path, index, step));
      setSel(step.id);
    },
    onTested: () => setMeta((m) => ({ ...m, form: { ...m.form, tested_at: new Date().toISOString() } })),
  };
  const step = findStep(flow?.steps, sel);

  const save = async () => {
    setBusy("save");
    try {
      const saved = await saveAutomationDraft(form.id, auto?.draft_rev ?? 0, flow, stops);
      await publishAutomation(form.id, saved.draft_rev);
      setStepErrors({});
      staleToasts.current.splice(0).forEach((id) => removeToast?.(id));
      addToast({ variant: "success", title: SAVED_TOAST });
      await reloadAuto();
    } catch (e) {
      if (e.code === "PT409") trackStale(addToast({ variant: "error", title: "Someone else changed these emails. Reload to see theirs." }));
      else if (/invalid_flow/.test(e.message || "")) {
        const { byStep, general } = flowSaveErrors(e.detail, flow, def, { cardOn, stages });
        setStepErrors(byStep);
        const ids = Object.keys(byStep);
        if (ids.length) setSel(ids[0]);
        const first = ids.length ? findStep(flow?.steps, ids[0]) : null;
        trackStale(addToast({
          variant: "error",
          title: ids.length ? `${ids.length === 1 ? "1 step needs" : `${ids.length} steps need`} fixing before these emails can be saved.` : "These emails could not be saved.",
          description: first ? `${stepTitle(first, def.fields)}: ${byStep[ids[0]]}` : general[0] || "Check each step and try again.",
        }));
      } else trackStale(addToast({ variant: "error", title: formsErrorWords(e) }));
    } finally { setBusy(""); }
  };
  const toggle = async (on) => {
    setBusy("toggle");
    try { await setAutomationEnabled(form.id, on); await reloadAuto(); }
    catch (e) { addToast({ variant: "error", title: formsErrorWords(e) }); }
    finally { setBusy(""); }
  };
  const testFlow = async () => {
    setBusy("flow");
    try {
      const res = await testWholeFlow(form.id);
      addToast({ variant: "success", title: res.message || "Test run sent to you: every email in order, with sample answers." });
    } catch (e) { addToast({ variant: "error", title: formsErrorWords(e) }); }
    finally { setBusy(""); }
  };

  if (form.template === "book_call_extra") return <p className="text-sm text-[var(--color-text-secondary)]">This form uses the Book-a-call emails.</p>;
  const k = auto?.kpis || {};

  return (
    <div className="flex flex-col gap-4" data-automations-tab="">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2"><Toggle checked={Boolean(auto?.enabled)} disabled={!canEdit || busy === "toggle" || !auto?.live_version} onChange={toggle} label="On" /></div>
        {!auto?.live_version && <span className="text-xs text-[var(--color-text-tertiary)]">Save the emails once to switch them on.</span>}
        <span className="flex-1" />
        <Button variant="secondary" onClick={testFlow} loading={busy === "flow"} disabled={!canEdit}>Test the whole flow</Button>
        <Button onClick={save} loading={busy === "save"} disabled={!canEdit}>Save changes</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Users} label="In this flow (30 days)" value={k.in_flow ?? 0} />
        <StatCard icon={Send} label="Emails sent" value={k.sent ?? 0} />
        <StatCard icon={MailOpen} label="Opened (approximate)" value={k.opened_pct == null ? "—" : `${k.opened_pct}%`} />
        <StatCard icon={CalendarCheck} label="Stopped because they booked" value={k.stopped_booked ?? 0} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(280px,400px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <Panel>
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">When someone sends “{form.name}”</p>
            <p className="text-xs text-[var(--color-text-tertiary)]">From any page or pop-up. Each person runs through once; sending again within a day is not a new run.</p>
          </Panel>
          <FlowList steps={flow?.steps || []} path={[]} ctx={ctx} />
          <Panel title="Stop the follow-ups when they" data-stop-rules="">
            <div className="flex flex-col gap-2">
              {STOP_RULES.map((r) => (
                <label key={r.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>{r.label}{r.soon ? <span className="ml-1 text-xs text-[var(--color-text-tertiary)]">(Coming soon)</span> : null}{r.id === "stage" && !cardOn ? <span className="ml-1 text-xs text-[var(--color-text-tertiary)]">(only with a pipeline card)</span> : null}</span>
                  <input type="checkbox" className="h-4 w-4 accent-[var(--a-text)]" aria-label={r.label} checked={r.id === "replied" ? false : r.id === "unsub" ? true : Boolean(stops?.[r.id])}
                    disabled={!canEdit || r.locked} onChange={(e) => setStops({ ...stops, [r.id]: e.target.checked })} />
                </label>
              ))}
            </div>
          </Panel>
        </div>
        <Panel title={step ? stepTitle(step, def.fields) : "Step"} data-step-editor="">
          <StepEditor step={step} ctx={ctx} set={(patch) => { setFlow(updateStep(flow, step.id, patch)); if (stepErrors[step.id]) setStepErrors((errs) => { const next = { ...errs }; delete next[step.id]; return next; }); }} remove={() => { setFlow(removeStep(flow, step.id)); setSel(null); }} />
        </Panel>
      </div>
    </div>
  );
}
