// #4640 — one plain-language place to choose what a visitor sees after send.
// Scheduler keys are data from the registry, not fixed UI constants.
import { ExternalLink, CalendarDays, CircleCheck } from "lucide-react";
import { Input, Select } from "../ui/Input";
import { Panel } from "./formsUi";

const CHOICES = [
  { id: "thank_you", label: "Show a thank-you", detail: "Keep them on the form and confirm it was sent.", icon: <CircleCheck aria-hidden="true" className="h-4.5 w-4.5" /> },
  { id: "book_call", label: "Let them book a call", detail: "Open a Mingla calendar with their answers already filled in.", icon: <CalendarDays aria-hidden="true" className="h-4.5 w-4.5" /> },
  { id: "link", label: "Send them to a link", detail: "Open another page after the form is sent.", icon: <ExternalLink aria-hidden="true" className="h-4.5 w-4.5" /> },
];

export function AfterSendTab({ def, edit, canEdit, schedulers = [] }) {
  const after = def.after_submit || { action: "thank_you" };
  const set = (patch) => edit({ ...def, after_submit: { ...after, ...patch } });
  const choices = schedulers.filter((x) => x.audience === def.audience);
  const selected = choices.some((x) => x.key === after.scheduler_key) ? after.scheduler_key : choices[0]?.key || "";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,.85fr)]" data-after-send-tab="">
      <Panel title="After someone sends this form">
        <div className="grid gap-2" role="radiogroup" aria-label="What happens after send">
          {CHOICES.map(({ id, label, detail, icon }) => {
            const active = after.action === id;
            return (
              <button key={id} type="button" role="radio" aria-checked={active} disabled={!canEdit}
                onClick={() => set(id === "book_call" ? { action: id, scheduler_key: selected || undefined, url: undefined } : id === "link" ? { action: id, url: after.url || "", scheduler_key: undefined } : { action: id, scheduler_key: undefined, url: undefined })}
                className={`flex min-h-20 items-start gap-3 rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${active ? "border-[var(--a-text)] bg-[var(--a-soft)] shadow-[0_0_0_3px_rgba(235,120,37,.16)]" : "border-[var(--a-line)] bg-[var(--color-background-primary)] hover:border-[var(--a-dim)]"}`}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--a-chip)] text-[var(--a-chip-ink)]">{icon}</span>
                <span><strong className="block text-sm text-[var(--color-text-primary)]">{label}</strong><span className="mt-0.5 block text-xs text-[var(--color-text-tertiary)]">{detail}</span></span>
              </button>
            );
          })}
        </div>
      </Panel>
      <Panel title="Set it up">
        {after.action === "book_call" ? (
          <div className="flex flex-col gap-3">
            <Select label="Call calendar" value={selected} disabled={!canEdit || choices.length === 0}
              onChange={(e) => set({ action: "book_call", scheduler_key: e.target.value, url: undefined })}
              placeholder={choices.length ? "Choose a calendar" : "No calendar is available"}
              options={choices.map((x) => ({ value: x.key, label: `${x.name} · ${x.duration_minutes} min` }))} />
            <p className="text-xs text-[var(--color-text-tertiary)]">Their name, email, phone and answers are carried securely to the calendar. They can still correct anything before booking.</p>
          </div>
        ) : after.action === "link" ? (
          <Input label="Link" value={after.url || ""} disabled={!canEdit} maxLength={500} placeholder="https://… or /page"
            helper="Use a full https link or a page that starts with /."
            onChange={(e) => set({ action: "link", url: e.target.value, scheduler_key: undefined })} />
        ) : (
          <div className="rounded-2xl bg-[var(--a-soft)] p-4">
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">Thanks — we’ve got it.</p>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">The form’s usual confirmation is shown. Nothing else opens.</p>
          </div>
        )}
      </Panel>
    </div>
  );
}
