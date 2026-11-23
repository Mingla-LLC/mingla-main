import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { CONTROL_CLASS, Field, LABEL_CLASS, Segmented, Select, TEXTAREA_CLASS } from "./fields";
import { newRequestKey } from "../../services/crmService";
import { CALL_OUTCOMES, callOutcomeForKey, callSuggestionWords, isOutboundCall, logRuleWarning, parseCallLength, usablePhones } from "../../lib/crmModel";
import { usePanelDraft } from "../../hooks/usePanelDraft";
import { DraftKeptNote } from "../ui/PanelStack";

const KINDS = [
  { value: "note", label: "Note" },
  { value: "touch", label: "Touch" },
];
const DIRECTIONS = [
  { value: "outbound", label: "I reached out" },
  { value: "inbound", label: "They replied" },
];

/**
 * Add a note or a touch to a card's log. A touch keeps the channel, the
 * direction, an optional message link and (for a reply) what kind of reply it
 * was as separate values, so they can be counted later.
 *
 * #4571 W2: a call the rep made (phone, I reached out) also takes its outcome
 * (keys 1 to 6), its length, the PressOne link, the number that was wrong
 * (for Wrong number) and, optionally, the Work card it belongs to. Each is
 * its own field; nothing is written into the note.
 */
export function LogForm({ record, config, def = null, disabled = false, onSubmit, callTick = 0 }) {
  const [kind, setKind] = useState(callTick > 0 ? "touch" : "note");
  // #4255: the note being written is kept per card while panels change beside it.
  const [body, setBody, bodyDraft] = usePanelDraft(record?.id ? `record:${record.id}:log` : "", "");
  const [channel, setChannel] = useState(record.channel || "");
  const [direction, setDirection] = useState("outbound");
  const [messageRef, setMessageRef] = useState("");
  const [replyClass, setReplyClass] = useState("");
  const [outcome, setOutcome] = useState("");
  const [length, setLength] = useState("");
  const [badPhone, setBadPhone] = useState("");
  const [workCard, setWorkCard] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef(null);
  const channelRef = useRef(null);
  const outcomesRef = useRef(null);
  // One key per distinct entry: pressing the button twice, or again after a
  // dropped connection, can never add the same line twice.
  const keyRef = useRef(newRequestKey());
  const freshKey = () => {
    keyRef.current = newRequestKey();
  };
  const id = useId();

  const submit = async (e) => {
    e.preventDefault();
    if (busy || disabled) return;
    const text = body.trim();
    let entry;
    if (kind === "note") {
      if (!text) {
        setError("Write what happened first.");
        bodyRef.current?.focus();
        return;
      }
      entry = { kind: "note", body: text };
    } else {
      if (!channel) {
        setError("Pick how you were in touch first.");
        channelRef.current?.focus();
        return;
      }
      entry = { kind: "touch", channel, direction };
      if (text) entry.body = text;
      if (messageRef.trim()) entry.message_ref = messageRef.trim();
      if (direction === "inbound" && replyClass) entry.reply_class = replyClass;
      if (isOutboundCall(entry)) {
        const parsed = parseCallLength(length);
        if (parsed.error) {
          setError(parsed.error);
          return;
        }
        if (parsed.seconds !== null) entry.duration_seconds = parsed.seconds;
        if (outcome) entry.outcome = outcome;
        if (outcome === "wrong_number") {
          if (!badPhone) {
            setError("Pick the number that was wrong, so nobody calls it again.");
            return;
          }
          entry.identifier_id = badPhone;
        }
        const card = workCard.trim().replace(/^#/, "");
        if (card) {
          if (!/^\d{1,9}$/.test(card)) {
            setError("Write the Work card's number, like 4571.");
            return;
          }
          entry.work_card = Number(card);
        }
      }
    }
    setError("");
    setBusy(true);
    const result = await onSubmit(entry, keyRef.current);
    setBusy(false);
    if (result?.ok) {
      setBody("");
      setMessageRef("");
      setReplyClass("");
      setOutcome("");
      setLength("");
      setBadPhone("");
      setWorkCard("");
      setSuggestion(callSuggestionWords(result.result, def));
      freshKey();
    } else if (result?.message) {
      // What was typed stays in the form.
      setError(result.message);
      if (!result.retryable) freshKey();
    }
  };

  const change = (setter) => (e) => {
    setter(e.target.value);
    freshKey();
    if (error) setError("");
    if (suggestion) setSuggestion("");
  };
  const isCall = kind === "touch" && channel === "phone" && direction === "outbound";
  // #4571 rework: "Log call" opens the form as a phone call I made, on its six outcomes.
  useEffect(() => {
    if (!callTick) return;
    setKind("touch");
    setChannel("phone");
    setDirection("outbound");
  }, [callTick]);
  useEffect(() => {
    if (callTick && isCall) outcomesRef.current?.querySelector?.("button")?.focus?.();
  }, [callTick, isCall]);
  const phones = usablePhones(record);
  const pickOutcome = (value) => {
    setOutcome((cur) => (cur === value ? "" : value));
    freshKey();
    if (error) setError("");
  };
  // Keys 1 to 6 pick an outcome while the outcome buttons have focus.
  const outcomeKeys = (e) => {
    const value = callOutcomeForKey(e.key);
    if (!value || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    pickOutcome(value);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`${LABEL_CLASS} !mb-0`}>Log activity</span>
        <Segmented
          label="Kind of entry"
          options={KINDS}
          value={kind}
          disabled={disabled || busy}
          onChange={(k) => {
            setKind(k);
            setError("");
            freshKey();
          }}
        />
      </div>
      {kind === "touch" && (
        <div className="grid grid-cols-1 gap-3">
          <Field label="Channel" htmlFor={`${id}-channel`}>
            <Select
              id={`${id}-channel`}
              ref={channelRef}
              value={channel}
              disabled={disabled || busy}
              placeholder="Pick one"
              options={(config.channels || []).map((c) => ({ value: c.id, label: c.label }))}
              onChange={change(setChannel)}
            />
          </Field>
          <div>
            <span className={LABEL_CLASS}>Direction</span>
            <Segmented
              label="Direction"
              options={DIRECTIONS}
              value={direction}
              disabled={disabled || busy}
              onChange={(d) => {
                setDirection(d);
                freshKey();
              }}
            />
          </div>
        </div>
      )}
      <div>
        <label htmlFor={`${id}-body`} className={LABEL_CLASS}>
          {kind === "note" ? "Note" : "What was said (optional)"}
        </label>
        <textarea
          id={`${id}-body`}
          ref={bodyRef}
          rows={2}
          value={body}
          maxLength={4000}
          disabled={disabled || busy}
          onChange={change(setBody)}
          placeholder="What happened?"
          className={TEXTAREA_CLASS}
        />
        <DraftKeptNote kept={bodyDraft.kept} onDiscard={bodyDraft.clear} />
      </div>
      {kind === "touch" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={isCall ? "PressOne link (optional)" : "Message link or id (optional)"} htmlFor={`${id}-ref`}>
            <input
              id={`${id}-ref`}
              type="text"
              value={messageRef}
              maxLength={500}
              disabled={disabled || busy}
              onChange={change(setMessageRef)}
              className={CONTROL_CLASS}
            />
          </Field>
          {direction === "inbound" && (
            <Field label="Reply was (optional)" htmlFor={`${id}-reply`}>
              <Select
                id={`${id}-reply`}
                value={replyClass}
                disabled={disabled || busy}
                placeholder="Not sure yet"
                options={(config.reply_classes || []).map((c) => ({ value: c.id, label: c.label }))}
                onChange={change(setReplyClass)}
              />
            </Field>
          )}
        </div>
      )}
      {isCall && (
        <div className="flex flex-col gap-3" data-call-fields="">
          <div>
            <span id={`${id}-outcome-label`} className={LABEL_CLASS}>Call outcome (keys 1 to 6)</span>
            <div ref={outcomesRef} role="group" aria-labelledby={`${id}-outcome-label`} onKeyDown={outcomeKeys} className="flex flex-wrap gap-1.5">
              {CALL_OUTCOMES.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={outcome === o.value}
                  aria-keyshortcuts={o.key}
                  disabled={disabled || busy}
                  onClick={() => pickOutcome(o.value)}
                  className={`min-h-11 rounded-lg border px-3 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] disabled:opacity-60 ${outcome === o.value ? "border-[var(--color-brand-800)] bg-[var(--color-brand-800)] text-white" : "border-[var(--gray-300)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]"}`}
                >
                  <span className="mr-1 tabular-nums opacity-70">{o.key}</span>{o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Length (optional, like 4:05)" htmlFor={`${id}-length`}>
              <input id={`${id}-length`} type="text" inputMode="numeric" value={length} maxLength={8}
                disabled={disabled || busy} onChange={change(setLength)} className={CONTROL_CLASS} />
            </Field>
            <Field label="Work card number (optional)" htmlFor={`${id}-card`}>
              <input id={`${id}-card`} type="text" inputMode="numeric" value={workCard} maxLength={10}
                disabled={disabled || busy} onChange={change(setWorkCard)} className={CONTROL_CLASS} />
            </Field>
          </div>
          {outcome === "wrong_number" && (
            phones.length ? (
              <Field label="Which number was wrong" htmlFor={`${id}-bad`}>
                <Select
                  id={`${id}-bad`}
                  value={badPhone}
                  disabled={disabled || busy}
                  placeholder="Pick the number"
                  options={phones.map((p) => ({ value: p.id, label: p.value }))}
                  onChange={change(setBadPhone)}
                />
              </Field>
            ) : (
              <p role="status" className="text-xs text-[var(--color-text-secondary)]">This card has no usable phone number to mark. Add the number first.</p>
            )
          )}
        </div>
      )}
      {suggestion && (
        <p role="status" data-call-suggestion="" className="rounded-lg bg-[var(--color-info-50)] p-2.5 text-xs text-[var(--color-info-700)]">
          {suggestion}
        </p>
      )}
      {logRuleWarning(record, { kind, direction }) && (
        <p role="status" className="rounded-lg bg-[var(--color-warning-50)] p-2.5 text-xs text-[var(--color-warning-700)]">
          {logRuleWarning(record, { kind, direction })}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-[var(--color-error-700)]">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" size="sm" className="max-sm:h-11" loading={busy} disabled={disabled}>
          Add to log
        </Button>
      </div>
    </form>
  );
}
