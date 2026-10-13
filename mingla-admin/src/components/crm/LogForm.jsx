import { useId, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { CONTROL_CLASS, Field, LABEL_CLASS, Segmented, Select, TEXTAREA_CLASS } from "./fields";
import { newRequestKey } from "../../services/crmService";

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
 */
export function LogForm({ record, config, disabled = false, onSubmit }) {
  const [kind, setKind] = useState("note");
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState(record.channel || "");
  const [direction, setDirection] = useState("outbound");
  const [messageRef, setMessageRef] = useState("");
  const [replyClass, setReplyClass] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef(null);
  const channelRef = useRef(null);
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
    }
    setError("");
    setBusy(true);
    const result = await onSubmit(entry, keyRef.current);
    setBusy(false);
    if (result?.ok) {
      setBody("");
      setMessageRef("");
      setReplyClass("");
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
      </div>
      {kind === "touch" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Message link or id (optional)" htmlFor={`${id}-ref`}>
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
      {error && (
        <p role="alert" className="text-xs text-[var(--color-error-700)]">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" size="sm" className="max-sm:h-10" loading={busy} disabled={disabled}>
          Add to log
        </Button>
      </div>
    </form>
  );
}
