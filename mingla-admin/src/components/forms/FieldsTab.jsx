// #4452 §7.4 Fields tab (design fieldsTab): the palette of 11 types, the canvas
// in page order (drag, or the up and down buttons), and the props panel
// (label, help, options, Required, "Show this question only when…",
// Validation). Locked rows have no remove button; consent can never be required.
import { useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Lock, Plus, Trash2, X } from "lucide-react";
import { Button } from "../ui/Button";
import { Input, Select, Toggle } from "../ui/Input";
import { Panel } from "./formsUi";
import {
  CONSENT_HINT, FIELD_TYPES, LOCKED_HINT, TYPE_LABEL, canAddType, fieldSummary, moveField, newField, patchField, removeField,
  showIfTargets, validationLine,
} from "../../lib/formsModel";

export function FieldsTab({ def, edit, canEdit, form }) {
  const fields = def.fields;
  const [sel, setSel] = useState(fields[1]?.key || fields[0]?.key || null);
  const [drag, setDrag] = useState(null);
  const f = fields.find((x) => x.key === sel) || null;
  const set = (next) => edit({ ...def, fields: next });
  const targets = f ? showIfTargets(fields, f.key) : [];
  const target = f?.show_if ? fields.find((x) => x.key === f.show_if.field_key) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_minmax(280px,340px)]" data-fields-tab="">
      <Panel title="Add a field">
        <div className="flex flex-col gap-1">
          {FIELD_TYPES.map((t) => (
            <button key={t} type="button" disabled={!canEdit || !canAddType(fields, t)} data-add-field={t}
              onClick={() => { const nf = newField(t, fields); set([...fields, nf]); setSel(nf.key); }}
              className="flex h-9 items-center justify-between rounded-[10px] px-2.5 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--a-soft)] disabled:cursor-not-allowed disabled:opacity-50">
              {TYPE_LABEL[t]} <Plus aria-hidden="true" className="h-4 w-4 text-[var(--a-dim)]" />
            </button>
          ))}
        </div>
      </Panel>

      <div className="min-w-0">
        <div className="mb-2 flex justify-between text-xs text-[var(--color-text-tertiary)]"><span>{fields.length} fields, in page order</span><span>Click to edit</span></div>
        <ol className="flex flex-col gap-2" data-field-canvas="">
          {fields.map((x, i) => (
            <li key={x.key}
              draggable={canEdit}
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => { if (drag !== null) e.preventDefault(); }}
              onDrop={() => { if (drag !== null && drag !== i) set(moveField(fields, drag, i - drag)); setDrag(null); }}
              data-field-row={x.key}
              className={`flex items-start gap-2 rounded-2xl border bg-[var(--color-background-primary)] p-3 ${x.key === sel ? "border-[var(--a-text)] shadow-[0_0_0_3px_rgba(235,120,37,.16)]" : "border-[var(--a-line)]"}`}>
              <GripVertical aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 cursor-grab text-[var(--a-dim)]" />
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSel(x.key)}>
                <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-[var(--color-text-primary)]">
                  {x.label}
                  {x.required && <span className="rounded-full bg-[var(--a-soft)] px-1.5 text-[11px] font-semibold text-[var(--a-text2)]">Required</span>}
                  {x.locked && <span className="inline-flex items-center gap-1 rounded-full bg-[var(--a-chip)] px-1.5 text-[11px] font-semibold text-[var(--a-chip-ink)]"><Lock aria-hidden="true" className="h-3 w-3" /> locked</span>}
                </span>
                <span className="block truncate text-xs text-[var(--color-text-tertiary)]">{fieldSummary(x)}</span>
              </button>
              <div className="flex shrink-0 gap-0.5">
                <Button variant="ghost" size="sm" icon={ArrowUp} aria-label={`Move ${x.label} up`} disabled={!canEdit || i === 0} onClick={() => set(moveField(fields, i, -1))} />
                <Button variant="ghost" size="sm" icon={ArrowDown} aria-label={`Move ${x.label} down`} disabled={!canEdit || i === fields.length - 1} onClick={() => set(moveField(fields, i, 1))} />
                {!x.locked && <Button variant="ghost" size="sm" icon={Trash2} aria-label={`Remove ${x.label}`} disabled={!canEdit} onClick={() => { set(removeField(fields, x.key)); if (sel === x.key) setSel(null); }} />}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <Panel title={f ? `${TYPE_LABEL[f.type]} field` : "Field"} data-field-props="">
        {!f ? <p className="text-sm text-[var(--color-text-tertiary)]">Pick a field.</p> : (
          <div className="flex flex-col gap-3">
            <Input label="Label" value={f.label} maxLength={120} disabled={!canEdit} onChange={(e) => set(patchField(fields, f.key, { label: e.target.value }))} />
            <Input label="Help text" value={f.help || ""} maxLength={200} placeholder="Optional" disabled={!canEdit} onChange={(e) => set(patchField(fields, f.key, { help: e.target.value }))} />
            {f.type === "dropdown" && (
              <Select label="Choices come from" value={f.source || "options"} disabled={!canEdit}
                onChange={(e) => set(patchField(fields, f.key, e.target.value === "google_city" ? { source: "google_city", options: undefined } : { source: "options", options: f.options?.length ? f.options : ["Option 1", "Option 2"] }))}
                options={[{ value: "options", label: "A list of options" }, { value: "google_city", label: "Google city search" }]} />
            )}
            {Array.isArray(f.options) && (
              <div>
                <span className="mb-1.5 block text-[12.5px] font-semibold text-[var(--a-text2)]">Options</span>
                <div className="flex flex-col gap-1.5">
                  {f.options.map((o, j) => (
                    <div key={j} className="flex items-center gap-1.5">
                      <input aria-label={`Option ${j + 1}`} value={o} maxLength={60} disabled={!canEdit}
                        onChange={(e) => set(patchField(fields, f.key, { options: f.options.map((x2, k) => (k === j ? e.target.value : x2)) }))}
                        className="h-10 min-w-0 flex-1 rounded-xl border-[1.5px] border-[var(--a-line)] bg-[var(--color-background-primary)] px-3 text-sm outline-none focus:border-[var(--a-text)]" />
                      <Button variant="ghost" size="sm" icon={X} aria-label={`Remove option ${j + 1}`} disabled={!canEdit || f.options.length <= 1}
                        onClick={() => set(patchField(fields, f.key, { options: f.options.filter((_, k) => k !== j) }))} />
                    </div>
                  ))}
                  <Button variant="secondary" size="sm" disabled={!canEdit || f.options.length >= 20} onClick={() => set(patchField(fields, f.key, { options: [...f.options, `Option ${f.options.length + 1}`] }))}>+ Add option</Button>
                </div>
              </div>
            )}
            <div className="flex items-start justify-between gap-3 rounded-xl border border-[var(--a-line)] px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Required</p>
                {f.locked && <p className="text-xs text-[var(--color-text-tertiary)]">{form.template === "locals" ? LOCKED_HINT.replace("Creators", "Locals") : LOCKED_HINT}</p>}
                {f.type === "consent" && <p className="text-xs text-[var(--color-text-tertiary)]">{CONSENT_HINT}</p>}
              </div>
              <Toggle checked={Boolean(f.required)} disabled={!canEdit || f.locked || f.type === "consent" || f.type === "email"} onChange={(v) => set(patchField(fields, f.key, { required: v }))} />
            </div>
            {f.type !== "email" && !f.locked && (
              <div data-show-if="">
                <span className="mb-1.5 block text-[12.5px] font-semibold text-[var(--a-text2)]">Show this question only when…</span>
                {targets.length === 0 ? <p className="text-xs text-[var(--color-text-tertiary)]">Add a choice question above this one to make it depend on the answer.</p> : (
                  <div className="grid gap-1.5">
                    <Select aria-label="Question" value={f.show_if?.field_key || ""} disabled={!canEdit} placeholder="Always show it"
                      onChange={(e) => {
                        const t = targets.find((x) => x.key === e.target.value);
                        set(patchField(fields, f.key, t ? { show_if: { field_key: t.key, op: t.type === "multi" ? "includes" : "is", value: t.options[0] } } : { show_if: undefined }));
                      }}
                      options={targets.map((t) => ({ value: t.key, label: t.label }))} />
                    {f.show_if && target && (
                      <div className="grid grid-cols-2 gap-1.5">
                        <Select aria-label="Condition" value={f.show_if.op} disabled={!canEdit}
                          onChange={(e) => set(patchField(fields, f.key, { show_if: { ...f.show_if, op: e.target.value } }))}
                          options={target.type === "multi" ? [{ value: "includes", label: "includes" }] : [{ value: "is", label: "is" }, { value: "is_not", label: "is not" }]} />
                        <Select aria-label="Answer" value={f.show_if.value} disabled={!canEdit}
                          onChange={(e) => set(patchField(fields, f.key, { show_if: { ...f.show_if, value: e.target.value } }))}
                          options={target.options.map((o) => ({ value: o, label: o }))} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <div>
              <span className="mb-1 block text-[12.5px] font-semibold text-[var(--a-text2)]">Validation</span>
              <p className="text-xs text-[var(--color-text-tertiary)]" data-validation-line="">{validationLine(f.type)}</p>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
