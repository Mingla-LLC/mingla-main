// Issue #3802 (Wave 4) — one agent's setup: copy a message, paste it into
// the agent, and the agent connects itself.
//
// The message holds a one-time code and never a key. It lives in this tab's
// memory only while it is on screen: it is never written to browser storage,
// an address or a cookie, and it is dropped on Done, once it is used, when it
// runs out and on leaving the page.
//
// What the card shows comes from setupCardView() in lib/agentConnect.js, so
// every state has words and a next step.
import { useEffect, useRef, useState } from "react";
import { Bot } from "lucide-react";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";

const TONE_CLASS = {
  success: "bg-[var(--color-success-50)] text-[var(--color-success-700)]",
  warning: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  error: "bg-[var(--color-error-50)] text-[var(--color-error-700)]",
  info: "bg-[var(--gray-50)] text-[var(--color-text-primary)]",
  default: "text-[var(--color-text-secondary)]",
};

export function AgentSetupCard({ agent, view, message, busy, onCopy, onCopyAgain, onDone, onKeep, onDisconnect }) {
  const [asking, setAsking] = useState(false); // the Disconnect question
  const statusRef = useRef(null);
  const boxRef = useRef(null);
  const copyRef = useRef(null);
  const keepRef = useRef(null);
  const headingId = `agent-setup-${agent.id}`;
  const lastState = useRef(view.state);

  // When the card changes state, focus follows: to the button that makes a
  // new message once one has run out, otherwise to the line that says what
  // happened, so a keyboard and a screen reader are never left behind.
  useEffect(() => {
    if (lastState.current === view.state) return;
    const from = lastState.current;
    lastState.current = view.state;
    if (from === "asking" && view.state !== "ready" && view.state !== "blocked" && view.state !== "failed" && view.state !== "lost") return;
    if (view.focus === "copy") copyRef.current?.focus();
    else if (view.state === "confirm") keepRef.current?.focus();
    else if (["ready", "blocked", "used", "failed", "lost"].includes(view.state)) statusRef.current?.focus();
  }, [view.state, view.focus]);

  // The browser did not copy: the message is selected, so one key press does.
  useEffect(() => {
    if (!view.selectMessage || !message) return;
    const node = boxRef.current;
    if (node && typeof window.getSelection === "function") {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, [view.selectMessage, message]);

  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);

  const press = (id) => {
    if (id === "copy") onCopy(agent.id);
    else if (id === "again") onCopyAgain(agent.id);
    else if (id === "done") onDone(agent.id);
    else if (id === "keep") onKeep(agent.id);
    else if (id === "disconnect") setAsking(true);
  };
  const onKeyDown = (event) => {
    if (event.key !== "Escape") return;
    if (asking) {
      event.stopPropagation();
      setAsking(false);
    } else if (view.state === "confirm") {
      event.stopPropagation();
      onKeep(agent.id);
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      onKeyDown={onKeyDown}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4 shadow-[var(--shadow-sm)] sm:p-5"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-50)]">
          <Bot className="h-[18px] w-[18px] text-[var(--color-brand-500)]" aria-hidden="true" />
        </span>
        <h3 id={headingId} className="text-[15px] font-semibold text-[var(--color-text-primary)]">
          {agent.product}
        </h3>
        <Badge variant={view.status.variant} dot className="max-w-full !whitespace-normal">
          {view.status.text}
        </Badge>
      </div>

      <div
        ref={statusRef}
        role="status"
        aria-live="polite"
        tabIndex={-1}
        className={[
          "flex min-w-0 flex-col gap-1 rounded-lg text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]",
          view.lines.length > 0 && view.tone !== "default" ? "p-3" : "",
          TONE_CLASS[view.tone] || TONE_CLASS.default,
        ].join(" ")}
      >
        {view.lines.map((line) => (
          <p key={line} className="break-words">
            {line}
          </p>
        ))}
        {view.lines.length === 0 && view.state === "none" && (
          <p>One message sets up {agent.product} on your own computer. It carries your role and nothing more.</p>
        )}
      </div>

      {view.showMessage && message && (
        <pre
          ref={boxRef}
          tabIndex={0}
          aria-label={`The setup message for ${agent.product}`}
          className={[
            "m-0 max-h-56 min-w-0 overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] px-3 py-2.5",
            "font-mono text-[12px] leading-relaxed text-[var(--color-text-primary)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]",
          ].join(" ")}
        >
          {message}
        </pre>
      )}

      {asking ? (
        <div role="group" aria-label={`Disconnect ${agent.label}?`} className="flex min-w-0 flex-col gap-2 rounded-lg bg-[var(--color-warning-50)] p-3">
          <p className="text-[13px] text-[var(--color-warning-700)]">
            Disconnect {agent.label}? Its key stops working at once. This can&apos;t be undone, but a new setup message is one
            press away.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="danger"
              disabled={!!view.offlineWords}
              title={view.offlineWords || undefined}
              onClick={() => {
                setAsking(false);
                onDisconnect(agent.id);
              }}
              className="max-sm:h-11"
            >
              Disconnect
            </Button>
            <Button ref={keepRef} type="button" variant="secondary" onClick={() => setAsking(false)} className="max-sm:h-11">
              Keep
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {view.buttons.map((b) => (
            <Button
              key={b.id}
              ref={b.id === "copy" ? copyRef : b.id === "keep" ? keepRef : undefined}
              type="button"
              variant={b.variant === "primary" ? undefined : b.variant}
              loading={!!b.busy || (busy && b.id === "copy")}
              disabled={!!b.disabled || (busy && b.id !== "copy")}
              title={b.disabled ? view.offlineWords : undefined}
              onClick={() => press(b.id)}
              className="max-sm:h-11"
            >
              {b.label}
            </Button>
          ))}
        </div>
      )}
      {view.offlineWords && <p className="text-xs text-[var(--color-text-secondary)]">{view.offlineWords}</p>}
    </section>
  );
}
