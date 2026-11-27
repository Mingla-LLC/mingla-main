// #4636 — the right rail for a selected section: its fields from the site's
// registry (text, media, links, the allowed colours, the city), list items
// with add / move / remove, and the section actions. Layout, spacing, type and
// motion are not editable (R2). Problems show on the field they belong to.
import { useEffect } from "react";
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, ImageIcon, Plus, Trash2, Video, X } from "lucide-react";
import { CITIES, COLOUR_SWATCH, COPY, actionTargetKind, allowedColours, emptyItem, fieldId, getAt, mediaLabel, publicUrl, setAt, targetLabel } from "../../lib/siteEditorModel";
import { FIELD, FIELD_BAD, Hint, MiniButton, Note, TextField } from "./editorUi";

const ALL_TARGETS = ["internal", "web", "mail", "explorer", "host"];

function ActionField({ id, field, value, onChange, error, errors, path, disabled }) {
  const targets = field.targets || ALL_TARGETS;
  const v = value || {};
  const kind = actionTargetKind(v.to) || (targets.includes("internal") ? "internal" : targets[0]);
  const isApp = kind === "explorer" || kind === "host";
  const setKind = (k) => onChange({ ...v, to: k === "explorer" ? "app:explorer" : k === "host" ? "app:host" : k === "mail" ? "mailto:" : k === "web" ? "https://" : "/" });
  const toErr = errors[`${path}.to`];
  const labelErr = errors[`${path}.label`];
  return (
    <fieldset className="mt-3 rounded-xl border border-[var(--a-line)] p-2.5" data-field={id}>
      <legend className="px-1 text-xs font-medium text-[var(--a-text2)]">{field.label}{field.required === false ? " (optional)" : ""}</legend>
      <TextField id={`${id}-label`} label="Button words" max={40} value={v.label ?? ""} disabled={disabled} error={labelErr}
        hint={isApp ? "Leave empty to use the app's own words." : undefined}
        onChange={(t) => onChange(t === "" && isApp ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "label")) : { ...v, label: t })} />
      <label htmlFor={`${id}-kind`} className="mb-1 mt-3 block text-xs font-medium text-[var(--a-text2)]">Goes to</label>
      <select id={`${id}-kind`} className={FIELD} value={kind} disabled={disabled} onChange={(e) => setKind(e.target.value)}>
        {targets.map((t) => <option key={t} value={t}>{targetLabel(t).replace(/^./, (c) => c.toUpperCase())}</option>)}
      </select>
      {!isApp && (
        <input aria-label={`${field.label}: address`} className={`${FIELD} mt-2 ${toErr ? FIELD_BAD : ""}`} value={v.to ?? ""} disabled={disabled}
          placeholder={kind === "internal" ? "/host" : kind === "mail" ? "mailto:hello@usemingla.com" : "https://"} onChange={(e) => onChange({ ...v, to: e.target.value })} />
      )}
      {toErr ? <p role="alert" className="mt-1 text-xs text-[var(--color-error-700)]">{toErr}</p> : null}
      {error && !toErr && !labelErr ? <p role="alert" className="mt-1 text-xs text-[var(--color-error-700)]">{error}</p> : null}
    </fieldset>
  );
}

function MediaField({ id, field, value, onPick, error, disabled, media, supabaseUrl }) {
  const m = mediaLabel(value, media);
  const still = m.item ? publicUrl(supabaseUrl, "site-media", m.item.thumb_path) : null;
  return (
    <div className="mt-3" data-field={id}>
      <span className="mb-1 block text-xs font-medium text-[var(--a-text2)]">{field.label}{field.required === false ? " (optional)" : ""}</span>
      <button type="button" id={id} disabled={disabled} onClick={() => onPick(field.accept)}
        className={`flex w-full items-center gap-2 rounded-xl border bg-[var(--a-bg)] p-1.5 text-left hover:border-[var(--a-dim)] disabled:cursor-not-allowed ${error ? FIELD_BAD : "border-[var(--a-line)]"}`}>
        <span className="grid h-12 w-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-[var(--a-soft)]">
          {still ? <img src={still} alt="" className="h-full w-full object-cover" /> : m.kind === "video" ? <Video size={18} aria-hidden="true" /> : <ImageIcon size={18} aria-hidden="true" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{m.label}</span>
          <span className="text-[11px] text-[var(--a-dim)]">{disabled ? "" : "Click to change"} · {field.accept.includes("video") ? (field.accept.includes("photo") ? "picture or video" : "video") : "picture"}</span>
        </span>
      </button>
      {value && field.required === false && !disabled ? <button type="button" className="mt-1 text-xs text-[var(--a-dim)] underline" onClick={() => onPick(null)}>Remove</button> : null}
      {error ? <p role="alert" className="mt-1 text-xs text-[var(--color-error-700)]">{error}</p> : null}
    </div>
  );
}

function ListField({ index, field, value, path, onChange, errors, ctx }) {
  const items = Array.isArray(value) ? value : [];
  const set = (next) => onChange(next);
  const move = (i, d) => { const n = items.slice(); const [x] = n.splice(i, 1); n.splice(i + d, 0, x); set(n); };
  const id = fieldId(index, path);
  return (
    <fieldset className="mt-4" data-field={id}>
      <legend className="flex w-full items-center justify-between text-xs font-semibold text-[var(--a-text2)]">
        <span>{field.label} <span className="font-normal text-[var(--a-dim)]">({items.length}, {field.min}–{field.max})</span></span>
      </legend>
      {errors[path] ? <p role="alert" className="mt-1 text-xs text-[var(--color-error-700)]">{errors[path]}</p> : null}
      <ol className="mt-1 space-y-2">
        {items.map((item, i) => (
          <li key={i} className="rounded-xl border border-[var(--a-line)] p-2">
            <div className="flex items-center gap-1">
              <span className="mr-auto font-mono text-[10.5px] uppercase tracking-wider text-[var(--a-dim)]">{i + 1}</span>
              <MiniButton aria-label={`Move item ${i + 1} up`} disabled={ctx.disabled || i === 0} onClick={() => move(i, -1)}><ArrowUp size={12} /></MiniButton>
              <MiniButton aria-label={`Move item ${i + 1} down`} disabled={ctx.disabled || i === items.length - 1} onClick={() => move(i, 1)}><ArrowDown size={12} /></MiniButton>
              <MiniButton aria-label={`Remove item ${i + 1}`} disabled={ctx.disabled || items.length <= field.min} onClick={() => set(items.filter((_, j) => j !== i))}><X size={12} /></MiniButton>
            </div>
            {field.textItem ? (
              <TextField id={fieldId(index, `${path}[${i}]`)} label={`Item ${i + 1}`} max={field.textItem.max} value={item} disabled={ctx.disabled}
                error={errors[`${path}[${i}]`]} hint={field.textItem.em ? "Wrap words in *stars* for the orange italic." : undefined}
                onChange={(t) => set(items.map((x, j) => (j === i ? t : x)))} />
            ) : (
              field.item.map((f) => <Field key={f.key} index={index} field={f} path={`${path}[${i}].${f.key}`} value={item?.[f.key]} errors={errors} ctx={ctx}
                onChange={(v) => set(items.map((x, j) => (j === i ? setAt(x, f.key, v) : x)))} />)
            )}
          </li>
        ))}
      </ol>
      <MiniButton className="mt-2" disabled={ctx.disabled || items.length >= field.max} onClick={() => set([...items, emptyItem(field)])}><Plus size={12} /> Add</MiniButton>
    </fieldset>
  );
}

function Field({ index, field, path, value, onChange, errors, ctx }) {
  const id = fieldId(index, path);
  const error = errors[path];
  if (field.hidden) return null;
  switch (field.kind) {
    case "text":
      if (ctx.blockType === "form" && field.key === "formId") {
        return (
          <div className="mt-3" data-field={id}>
            <label htmlFor={id} className="mb-1 block text-xs font-medium text-[var(--a-text2)]">Form</label>
            <select id={id} className={`${FIELD} ${error ? FIELD_BAD : ""}`} value={value || ""} disabled={ctx.disabled} onChange={(e) => onChange(e.target.value)}>
              <option value="">Pick a form…</option>
              {ctx.forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            {error ? <p role="alert" className="mt-1 text-xs text-[var(--color-error-700)]">{error}</p> : null}
          </div>
        );
      }
      return <TextField id={id} label={`${field.label}${field.required === false ? " (optional)" : ""}`} max={field.max} value={value ?? ""} multiline={field.max > 140}
        disabled={ctx.disabled} error={error} hint={field.em ? "Wrap words in *stars* for the orange italic." : undefined}
        onChange={(t) => onChange(t === "" && field.required === false ? undefined : t)} />;
    case "media":
      return <MediaField id={id} field={field} value={value} error={error} disabled={ctx.disabled} media={ctx.media} supabaseUrl={ctx.supabaseUrl}
        onPick={(accept) => (accept === null ? onChange(undefined) : ctx.openMedia(accept, onChange))} />;
    case "action":
      return <ActionField id={id} field={field} value={value} path={path} error={error} errors={errors} disabled={ctx.disabled} onChange={onChange} />;
    case "enum":
      return (
        <div className="mt-3" data-field={id}>
          <label htmlFor={id} className="mb-1 block text-xs font-medium text-[var(--a-text2)]">{field.label}</label>
          <select id={id} className={FIELD} value={value ?? field.options[0]} disabled={ctx.disabled} onChange={(e) => onChange(e.target.value)}>
            {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      );
    case "city":
      return (
        <div className="mt-3" data-field={id}>
          <label htmlFor={id} className="mb-1 block text-xs font-medium text-[var(--a-text2)]">{field.label}</label>
          <select id={id} className={`${FIELD} ${error ? FIELD_BAD : ""}`} value={value ?? ""} disabled={ctx.disabled} onChange={(e) => onChange(e.target.value)}>
            {CITIES.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}
          </select>
        </div>
      );
    case "list":
      return <ListField index={index} field={field} value={value} path={path} onChange={onChange} errors={errors} ctx={ctx} />;
    default:
      return null;
  }
}

export function BlockPanel({ def, block, index, count, errors = {}, canEdit, focusField, onChange, onAction, onAddBelow, openMedia, media, forms, supabaseUrl }) {
  // A click on words in the preview focuses that field here.
  useEffect(() => {
    if (!focusField) return undefined;
    // After the click inside the preview settles (the frame keeps focus until then).
    const t = setTimeout(() => {
      const el = document.getElementById(fieldId(index, focusField)) || document.querySelector(`[data-field="${fieldId(index, focusField.split(/[.[]/)[0])}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      if (typeof el.focus === "function") el.focus({ preventScroll: true });
    }, 80);
    return () => clearTimeout(t);
  }, [focusField, index]);

  if (!def) return <Note tone="bad">This section type isn't known to the site. Delete it, or ask engineering.</Note>;
  const colours = allowedColours(def, block.content?.variant);
  const ctx = { disabled: !canEdit, openMedia, media, forms, supabaseUrl, blockType: def.key };
  const setField = (key, v) => onChange({ ...block, content: setAt(block.content, key, v) });
  return (
    <div data-block-panel={def.key}>
      <h3 className="text-sm font-semibold">{def.name}{block.hidden ? <span className="ml-2 text-xs font-normal text-[var(--a-dim)]">(hidden from visitors)</span> : null}</h3>
      <Hint className="mt-0.5">{def.description}</Hint>
      {errors[""] ? <Note tone="bad" className="mt-2">{errors[""]}</Note> : null}
      <span className="mb-1 mt-3 block text-xs font-medium text-[var(--a-text2)]">Colour</span>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Section colour">
        {colours.map((c) => {
          const on = (block.colour || colours[0]) === c;
          return (
            <button key={c} type="button" aria-pressed={on} aria-label={c} title={c} disabled={!canEdit || colours.length < 2} data-colour={c}
              onClick={() => onChange({ ...block, colour: c })}
              className={`h-7 w-7 rounded-full border-2 ${on ? "border-[#eb7825] shadow-[inset_0_0_0_2px_var(--a-panel)]" : "border-[var(--a-line)]"} disabled:cursor-default`}
              style={{ background: COLOUR_SWATCH[c] }} />
          );
        })}
        {colours.length < 2 ? <span className="self-center text-[11px] text-[var(--a-dim)]">The only colour this section has today.</span> : null}
      </div>
      {errors.colour ? <p role="alert" className="mt-1 text-xs text-[var(--color-error-700)]">{errors.colour}</p> : null}
      {def.live ? <Note className="mt-3">{COPY.liveBlock}</Note> : null}
      {def.fields.map((f) => <Field key={f.key} index={index} field={f} path={f.key} value={getAt(block.content, f.key)} errors={errors} ctx={ctx} onChange={(v) => setField(f.key, v)} />)}
      {def.fields.filter((f) => !f.hidden).length === 0 ? <Hint className="mt-3">Nothing to fill in: this section shows live data as it is.</Hint> : null}
      <Note className="mt-4">{COPY.layoutLocked}</Note>
      {canEdit && (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Section actions">
          <MiniButton onClick={() => onAction("up", index)} disabled={index === 0}><ArrowUp size={12} /> Up</MiniButton>
          <MiniButton onClick={() => onAction("down", index)} disabled={index >= count - 1}><ArrowDown size={12} /> Down</MiniButton>
          <MiniButton onClick={() => onAction("dup", index)}><Copy size={12} /> Duplicate</MiniButton>
          <MiniButton onClick={() => onAction("hide", index)}>{block.hidden ? <Eye size={12} /> : <EyeOff size={12} />} {block.hidden ? "Show" : "Hide"}</MiniButton>
          <MiniButton onClick={() => onAction("del", index)}><Trash2 size={12} /> Delete</MiniButton>
          <MiniButton onClick={() => onAddBelow(index + 1)}><Plus size={12} /> Add below</MiniButton>
        </div>
      )}
    </div>
  );
}
