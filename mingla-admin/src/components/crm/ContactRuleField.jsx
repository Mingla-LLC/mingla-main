// Issue #3802 (Wave 4) — a record's contact rule: None, Warm intro only or Do
// not contact, with a one-line reason.
//
// Setting or changing a rule needs both the rule and the reason. Lifting one
// asks first, because it lets agents log a first touch again.
//
// `onSave(changes)` is given { contact_rule, contact_rule_reason } and
// resolves to { ok } or { message }.
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { CONTROL_CLASS, Field, Select } from "./fields";
import { CONTACT_RULES } from "../../lib/crmModel";

export function ContactRuleField({ record, disabled = false, onSave }) {
  const id = useId();
  const stored = record.contact_rule || "";
  const storedReason = record.contact_rule_reason || "";
  const [rule, setRule] = useState(stored);
  const [reason, setReason] = useState(storedReason);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const keepRef = useRef(null);
  const selectRef = useRef(null);
  const focusRule = useRef(false);

  // What the server holds changed (saved here, or by someone else): follow it.
  useEffect(() => {
    setRule(stored);
    setReason(storedReason);
  }, [stored, storedReason]);
  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);
  // After the rule is lifted (or kept), focus is back on the rule menu: only
  // once the save has ended, because a control that is still busy cannot take it.
  useEffect(() => {
    if (busy || asking || !focusRule.current) return;
    focusRule.current = false;
    selectRef.current?.focus();
  }, [busy, asking]);

  const changed = rule !== stored || (rule !== "" && reason.trim() !== storedReason);
  const ready = rule === "" ? stored !== "" : reason.trim() !== "" && changed;

  const send = async (changes) => {
    setBusy(true);
    setMessage("");
    let result;
    try {
      result = await onSave(changes);
    } finally {
      setBusy(false);
    }
    if (result && result.message) setMessage(result.message);
    return !(result && result.message);
  };

  const save = () => {
    if (disabled || busy || !ready) return;
    if (rule === "") {
      setAsking(true);
      return;
    }
    send({ contact_rule: rule, contact_rule_reason: reason.trim() });
  };
  const lift = async () => {
    focusRule.current = true;
    setAsking(false);
    await send({ contact_rule: null });
  };
  const keep = () => {
    focusRule.current = true;
    setAsking(false);
    setRule(stored);
    setReason(storedReason);
  };

  return (
    <fieldset
      className="grid grid-cols-1 gap-3 rounded-lg border border-[var(--gray-200)] p-3 sm:col-span-2 sm:grid-cols-2"
      onKeyDown={(e) => {
        if (asking && e.key === "Escape") {
          e.stopPropagation();
          keep();
        }
      }}
    >
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Contact rule</legend>
      <Field label="Rule" htmlFor={`${id}-rule`}>
        <Select
          id={`${id}-rule`}
          ref={selectRef}
          value={rule}
          disabled={disabled || busy || asking}
          placeholder="None"
          options={CONTACT_RULES.map((r) => ({ value: r.id, label: r.label }))}
          onChange={(e) => {
            setRule(e.target.value);
            setMessage("");
          }}
        />
      </Field>
      <Field
        label="Why"
        htmlFor={`${id}-reason`}
        helper={rule ? "One line, so the next person and their agent know." : "Pick a rule to say why."}
      >
        <input
          id={`${id}-reason`}
          type="text"
          maxLength={300}
          value={rule ? reason : ""}
          disabled={disabled || busy || asking || !rule}
          placeholder={rule ? "For example: asked us not to message again" : ""}
          onChange={(e) => {
            setReason(e.target.value);
            setMessage("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          className={CONTROL_CLASS}
        />
      </Field>
      {asking ? (
        <div role="group" aria-label="Lift this rule?" className="flex min-w-0 flex-col gap-2 rounded-lg bg-[var(--color-warning-50)] p-3 sm:col-span-2">
          <p className="text-[13px] text-[var(--color-warning-700)]">
            Lift this rule? Agents will be able to log a first touch again.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="danger" className="max-sm:h-11" onClick={lift} disabled={disabled}>
              Lift
            </Button>
            <Button ref={keepRef} type="button" variant="secondary" className="max-sm:h-11" onClick={keep}>
              Keep
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" className="max-sm:h-11" loading={busy} disabled={disabled || !ready} onClick={save}>
            {rule === "" && stored !== "" ? "Lift rule" : "Save rule"}
          </Button>
          <span className="text-xs text-[var(--color-text-tertiary)]">
            {rule === "" && stored === ""
              ? "No rule: anyone on the team, and their agent, may reach out."
              : !ready && !changed
                ? "Saved."
                : !ready
                  ? "Pick a rule and say why to save it."
                  : ""}
          </span>
        </div>
      )}
      {message && (
        <p role="alert" className="text-xs text-[var(--color-error-700)] sm:col-span-2">
          {message}
        </p>
      )}
    </fieldset>
  );
}
