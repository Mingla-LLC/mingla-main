// Issue #3802 (Wave 4) — a line (or a few lines) to copy, with its own Copy
// button. When the browser refuses to copy, the text is selected instead and
// the person is told which keys to press, so the button is never a dead end.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "../ui/Button";

const COPIED_MS = 2500;

export function CopyBlock({
  text,
  label,
  copyLabel = "Copy",
  copiedLabel = "Copied",
  note,
  onCopied,
  id,
  buttonVariant = "secondary",
  className = "",
}) {
  const boxRef = useRef(null);
  const timer = useRef(null);
  const [state, setState] = useState("idle"); // idle | copied | blocked
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async () => {
    clearTimeout(timer.current);
    setState("copying");
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      onCopied?.();
      timer.current = setTimeout(() => setState("idle"), COPIED_MS);
    } catch (err) {
      console.error("[agent] copy was blocked:", err?.name || "error");
      // Select the text so one key press finishes the job.
      const node = boxRef.current;
      if (node && typeof window.getSelection === "function") {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        node.focus();
      }
      // The selected prompt lets the person press Ctrl or Cmd + C to copy.
      setState("blocked");
    }
  }, [text, onCopied]);

  return (
    <div className={`min-w-0 ${className}`}>
      {label && <p className="mb-1.5 text-[13px] font-medium text-[var(--color-text-primary)]">{label}</p>}
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
        <pre
          ref={boxRef}
          id={id}
          tabIndex={0}
          className={[
            "m-0 min-w-0 flex-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-tertiary)] px-3 py-2.5",
            "font-mono text-[13px] leading-relaxed text-[var(--color-text-primary)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2",
          ].join(" ")}
        >
          {text}
        </pre>
        <Button
          type="button"
          variant={buttonVariant}
          icon={state === "copied" ? Check : Copy}
          onClick={copy}
          disabled={state === "copying"}
          className="min-h-11 shrink-0 max-sm:h-11 max-sm:w-full"
        >
          {state === "copying" ? "Copying..." : state === "copied" ? copiedLabel : copyLabel}
        </Button>
      </div>
      <p role="status" aria-live="polite" className="mt-1 min-h-[18px] text-xs text-[var(--color-text-secondary)]">
        {state === "blocked" ? "Press Ctrl or Cmd + C to copy." : note || ""}
      </p>
    </div>
  );
}
