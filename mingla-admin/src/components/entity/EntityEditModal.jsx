// ORCH-1276 [Admin Identity console — WAVE-2 EDIT] — the SHARED, config-driven
// edit-form modal. Generalizes HighRiskActionModal to carry form FIELDS plus the
// SAME optional reason + confirm-phrase gate. GENERIC + REUSABLE by design —
// ORCH-1277/1278 (offerings/money edits) attach their own `fields` config; keep
// it domain-agnostic (no identity-specific logic lives here).
//
// HARD contract (mirrors HighRiskActionModal's gate verbatim):
//   - submit is DISABLED until: every required field is valid AND every `json`
//     field parses AND (reason non-empty when requireReason) AND (typed phrase ===
//     confirmPhrase when set).
//   - on submit → submitting (spinner, inputs disabled) → await onSave(values, {reason})
//     → success Toast + close; on throw → inline error (stay open, values + reason
//     preserved).
//   - onSave receives `json` fields as PARSED objects (or undefined when blank);
//     other fields as their raw value (string for text/textarea/select, boolean
//     for switch).
//   - MOUNT-FRESH-PER-OPEN: `values` initializes from initialValues on mount, so
//     callers conditionally MOUNT this modal per open (`{open && <EntityEditModal…/>}`)
//     to get fresh initial values — no setState-in-effect (React Compiler safe).
//     Reset of reason/phrase is event-driven on close (mirrors HighRiskActionModal).
//
// field shape:
//   { key, label, type:'text'|'textarea'|'select'|'switch'|'json',
//     options?:[{value,label}], placeholder?, required?, help? }

import { useState } from "react";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Button } from "../ui/Button";
import { AlertCard } from "../ui/Card";
import { useToast } from "../../context/ToastContext";

const INPUT_CLASS = [
  "w-full h-10 px-3 text-sm rounded-lg",
  "bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
  "border border-[var(--gray-300)] outline-none transition-all duration-150",
  "focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]",
  "disabled:opacity-50 disabled:cursor-not-allowed",
].join(" ");

const TEXTAREA_CLASS = [
  "w-full min-h-[88px] px-3 py-2 text-sm rounded-lg resize-y",
  "bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
  "border border-[var(--gray-300)] outline-none transition-all duration-150",
  "focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]",
  "disabled:opacity-50 disabled:cursor-not-allowed",
].join(" ");

/** Parse a `json` field's raw text. Returns { ok, value, error }. Blank == ok/undefined. */
function parseJsonField(raw) {
  const text = (raw ?? "").trim();
  if (text === "") return { ok: true, value: undefined, error: null };
  try {
    return { ok: true, value: JSON.parse(text), error: null };
  } catch (e) {
    return { ok: false, value: undefined, error: e?.message || "Invalid JSON." };
  }
}

/** Is a field's current value present (for the `required` gate)? */
function isFilled(field, value) {
  if (field.type === "switch") return true; // booleans are always "filled"
  if (field.type === "json") return parseJsonField(value).ok && (value ?? "").trim() !== "";
  return (value ?? "").toString().trim() !== "";
}

export function EntityEditModal({
  open,
  onClose,
  title,
  description,
  fields = [],
  initialValues = {},
  submitLabel = "Save",
  requireReason = false,
  reasonLabel,
  confirmPhrase,
  destructive = false,
  onSave,
  successMessage = "Saved.",
}) {
  const { addToast } = useToast();
  // Initialized once from initialValues on mount — callers mount this modal fresh
  // per open (see MOUNT-FRESH-PER-OPEN above), so this captures the right values.
  const [values, setValues] = useState(initialValues);
  const [reason, setReason] = useState("");
  const [phrase, setPhrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Plain function (no useCallback): the React Compiler auto-memoizes, and Modal
  // keeps onClose in a ref so a fresh identity each render is harmless.
  const handleClose = () => {
    setReason("");
    setPhrase("");
    setSubmitting(false);
    setError(null);
    onClose();
  };

  const setField = (key, value) => setValues((prev) => ({ ...prev, [key]: value }));

  // Per-field JSON parse state (for inline field errors + submit gate).
  const jsonState = {};
  for (const f of fields) {
    if (f.type === "json") jsonState[f.key] = parseJsonField(values[f.key]);
  }

  const requiredOk = fields.every((f) => !f.required || isFilled(f, values[f.key]));
  const jsonOk = fields.every((f) => f.type !== "json" || jsonState[f.key].ok);
  const reasonOk = !requireReason || reason.trim().length > 0;
  const phraseOk = !confirmPhrase || phrase === confirmPhrase;
  const canSubmit = requiredOk && jsonOk && reasonOk && phraseOk && !submitting;

  const buildValues = () => {
    const out = {};
    for (const f of fields) {
      if (f.type === "readonly") {
        continue; // display-only, never submitted (e.g. a trigger-derived column)
      } else if (f.type === "json") {
        out[f.key] = jsonState[f.key].value; // parsed object or undefined (blank)
      } else if (f.type === "switch") {
        out[f.key] = Boolean(values[f.key]);
      } else {
        out[f.key] = values[f.key] ?? "";
      }
    }
    return out;
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSave(buildValues(), { reason: reason.trim() });
      addToast({ variant: "success", title: successMessage });
      handleClose();
    } catch (err) {
      setError(err?.message || "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  const resolvedReasonLabel =
    reasonLabel || (requireReason ? "Reason (required)" : "Note (audit, optional)");

  return (
    <Modal open={open} onClose={handleClose} title={title} size="md" destructive={destructive}>
      <ModalBody className="flex flex-col gap-4">
        {description && (
          <p className="text-sm text-[var(--color-text-secondary)]">{description}</p>
        )}

        {fields.map((f) => {
          const id = `entity-edit-${f.key}`;
          const jerr = f.type === "json" ? jsonState[f.key]?.error : null;
          return (
            <div key={f.key} className="flex flex-col gap-1.5">
              <label htmlFor={id} className="text-xs font-medium text-[var(--color-text-secondary)]">
                {f.label}
                {f.required && <span className="text-[var(--color-error-700)]"> *</span>}
              </label>

              {f.type === "readonly" && (
                <input
                  id={id}
                  type="text"
                  value={values[f.key] ?? ""}
                  readOnly
                  disabled
                  aria-readonly="true"
                  className={INPUT_CLASS}
                />
              )}

              {f.type === "textarea" && (
                <textarea
                  id={id}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setField(f.key, e.target.value)}
                  disabled={submitting}
                  placeholder={f.placeholder}
                  className={TEXTAREA_CLASS}
                />
              )}

              {f.type === "json" && (
                <textarea
                  id={id}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setField(f.key, e.target.value)}
                  disabled={submitting}
                  placeholder={f.placeholder || '{ "instagram": "https://…" }'}
                  className={TEXTAREA_CLASS}
                  spellCheck={false}
                />
              )}

              {f.type === "select" && (
                <select
                  id={id}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setField(f.key, e.target.value)}
                  disabled={submitting}
                  className={INPUT_CLASS}
                >
                  {!f.required && <option value="">—</option>}
                  {(f.options || []).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}

              {f.type === "switch" && (
                <button
                  type="button"
                  id={id}
                  role="switch"
                  aria-checked={Boolean(values[f.key])}
                  disabled={submitting}
                  onClick={() => setField(f.key, !values[f.key])}
                  className={[
                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-150 disabled:opacity-50",
                    values[f.key] ? "bg-[var(--color-brand-500)]" : "bg-[var(--gray-300)]",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-150",
                      values[f.key] ? "translate-x-6" : "translate-x-1",
                    ].join(" ")}
                  />
                </button>
              )}

              {(!f.type || f.type === "text") && (
                <input
                  id={id}
                  type="text"
                  value={values[f.key] ?? ""}
                  onChange={(e) => setField(f.key, e.target.value)}
                  disabled={submitting}
                  placeholder={f.placeholder}
                  className={INPUT_CLASS}
                  autoComplete="off"
                />
              )}

              {jerr && <span className="text-xs text-[var(--color-error-700)]">Invalid JSON: {jerr}</span>}
              {f.help && !jerr && <span className="text-xs text-[var(--color-text-tertiary)]">{f.help}</span>}
            </div>
          );
        })}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="entity-edit-reason" className="text-xs font-medium text-[var(--color-text-secondary)]">
            {resolvedReasonLabel}
          </label>
          <textarea
            id="entity-edit-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting}
            placeholder="Why are you making this change? (recorded in the audit log)"
            className={TEXTAREA_CLASS}
          />
        </div>

        {confirmPhrase && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="entity-edit-phrase" className="text-xs font-medium text-[var(--color-text-secondary)]">
              Type <span className="font-semibold text-[var(--color-text-primary)]">{confirmPhrase}</span> to confirm
            </label>
            <input
              id="entity-edit-phrase"
              type="text"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              disabled={submitting}
              className={INPUT_CLASS}
              autoComplete="off"
            />
          </div>
        )}

        {error && (
          <AlertCard variant="error" title="Couldn't save">
            {error}
          </AlertCard>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" size="md" onClick={handleClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant={destructive ? "danger" : "primary"}
          size="md"
          onClick={handleSubmit}
          disabled={!canSubmit}
          loading={submitting}
        >
          {submitLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
