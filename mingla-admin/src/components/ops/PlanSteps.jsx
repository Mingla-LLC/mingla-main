// Issue #3980 — the plan on a card: numbered steps, each naming the
// connector tool that does it or a person, with its status and result.
import { useState } from "react";
import { ArrowDown, ArrowUp, Check, Circle, Trash2, User, X } from "lucide-react";
import { PLAN_TOOLS, planToolLabel } from "../../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const STATUS = {
  done: { Icon: Check, label: "Done", cls: "text-[var(--color-success-700)]" },
  failed: { Icon: X, label: "Failed", cls: "text-[var(--color-error-700)]" },
  person: { Icon: User, label: "Left to a person", cls: "text-[var(--color-warning-700)]" },
  todo: { Icon: Circle, label: "Not done yet", cls: "text-[var(--color-text-tertiary)]" },
};

function renumber(steps) {
  return steps.map((s, i) => ({ ...s, n: i + 1 }));
}

export function PlanSteps({ plan = [], editable, disabled, onChange }) {
  const [text, setText] = useState("");
  const [tool, setTool] = useState("person");
  const steps = Array.isArray(plan) ? plan : [];
  const move = (i, d) => {
    const next = [...steps];
    const [s] = next.splice(i, 1);
    next.splice(i + d, 0, s);
    onChange(renumber(next));
  };
  const add = () => {
    const t = text.trim();
    if (t.length < 3) return;
    onChange(renumber([...steps, { n: steps.length + 1, text: t, tool, status: "todo" }]));
    setText("");
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {steps.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-tertiary)]">No plan yet.</p>
      ) : (
        <ol className="flex min-w-0 flex-col gap-1.5">
          {steps.map((s, i) => {
            const st = STATUS[s.status] || STATUS.todo;
            return (
              <li key={`${s.n}-${s.text}`} className="flex min-w-0 items-start gap-2 rounded-lg border border-[var(--gray-200)] p-2">
                <span className="mt-0.5 w-5 shrink-0 text-right text-[12px] font-semibold text-[var(--color-text-tertiary)]">{s.n}</span>
                <st.Icon aria-label={st.label} className={`mt-0.5 h-4 w-4 shrink-0 ${st.cls}`} />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-[13px] text-[var(--color-text-primary)]">{s.text}</span>
                  <span className="block break-words text-[11.5px] text-[var(--color-text-tertiary)]">{planToolLabel(s.tool)}</span>
                  {s.result && <span className="block break-words text-[12px] text-[var(--color-text-secondary)]">{s.result}</span>}
                </span>
                {editable && (
                  <span className="flex shrink-0 items-center">
                    <button type="button" aria-label={`Move step ${s.n} up`} disabled={disabled || i === 0} onClick={() => move(i, -1)} className={`inline-grid min-h-9 min-w-9 place-items-center rounded-lg hover:bg-[var(--gray-100)] disabled:opacity-40 ${FOCUS}`}><ArrowUp aria-hidden="true" className="h-3.5 w-3.5" /></button>
                    <button type="button" aria-label={`Move step ${s.n} down`} disabled={disabled || i === steps.length - 1} onClick={() => move(i, 1)} className={`inline-grid min-h-9 min-w-9 place-items-center rounded-lg hover:bg-[var(--gray-100)] disabled:opacity-40 ${FOCUS}`}><ArrowDown aria-hidden="true" className="h-3.5 w-3.5" /></button>
                    <button type="button" aria-label={`Remove step ${s.n}`} disabled={disabled} onClick={() => onChange(renumber(steps.filter((_, j) => j !== i)))} className={`inline-grid min-h-9 min-w-9 place-items-center rounded-lg hover:bg-[var(--gray-100)] disabled:opacity-40 ${FOCUS}`}><Trash2 aria-hidden="true" className="h-3.5 w-3.5" /></button>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {editable && steps.length < 20 && (
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <label className="flex min-w-[180px] flex-1 flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">New step</span>
            <input value={text} maxLength={200} disabled={disabled} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder="What happens in this step" className={`min-h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-[13px] ${FOCUS}`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Done by</span>
            <select value={tool} disabled={disabled} onChange={(e) => setTool(e.target.value)} className={`min-h-11 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 text-[12px] ${FOCUS}`}>
              {PLAN_TOOLS.map((t) => <option key={t} value={t}>{planToolLabel(t)}</option>)}
            </select>
          </label>
          <button type="button" disabled={disabled || text.trim().length < 3} onClick={add} className={`min-h-11 rounded-lg border border-[var(--gray-300)] px-3 text-[13px] font-semibold hover:bg-[var(--gray-50)] disabled:opacity-50 ${FOCUS}`}>Add step</button>
        </div>
      )}
    </div>
  );
}
