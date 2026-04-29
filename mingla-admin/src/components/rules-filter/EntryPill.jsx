import { useState, useEffect } from "react";
import { X, RotateCcw } from "lucide-react";

const STATE_CONFIG = {
  persisted: {
    bg: "bg-[var(--gray-100)]",
    border: "border-[var(--gray-300)]",
    text: "text-[var(--color-text-primary)]",
    decoration: "",
  },
  pending_add: {
    bg: "bg-[var(--color-success-50)]",
    border: "border-[#22c55e]",
    text: "text-[var(--color-success-700)]",
    decoration: "",
  },
  pending_remove: {
    bg: "bg-[var(--color-error-50)]",
    border: "border-[#ef4444]",
    text: "text-[var(--color-error-700)]",
    decoration: "line-through",
  },
};

const UNDO_VISIBLE_MS = 5000;

export function EntryPill({ entry, status, onRemove, onUndo }) {
  const [hovered, setHovered] = useState(false);
  const [undoVisible, setUndoVisible] = useState(false);

  useEffect(() => {
    if (status === "pending_remove") {
      setUndoVisible(true);
      const t = setTimeout(() => setUndoVisible(false), UNDO_VISIBLE_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [status, entry?.value]);

  const config = STATE_CONFIG[status] || STATE_CONFIG.persisted;
  const showRemove = hovered && (status === "persisted" || status === "pending_add") && typeof onRemove === "function";
  const showUndo = status === "pending_remove" && undoVisible && typeof onUndo === "function";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={[
        "inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[12px]",
        "transition-colors duration-150 group",
        config.bg, config.border, config.text,
      ].join(" ")}
      title={entry?.reason ? `Reason: ${entry.reason}` : entry?.value}
    >
      <span className={`font-mono ${config.decoration}`}>{entry?.value}</span>
      {entry?.sub_category && (
        <span className="text-[10px] text-[var(--color-text-tertiary)]">
          [{entry.sub_category}]
        </span>
      )}
      {showRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="ml-0.5 hover:text-[#ef4444] transition-colors cursor-pointer"
          aria-label={`Remove ${entry.value}`}
        >
          <X className="w-3 h-3" />
        </button>
      )}
      {showUndo && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onUndo(); }}
          className="inline-flex items-center gap-0.5 ml-1 text-[10px] underline hover:no-underline cursor-pointer"
        >
          <RotateCcw className="w-2.5 h-2.5" />
          Undo
        </button>
      )}
    </div>
  );
}
