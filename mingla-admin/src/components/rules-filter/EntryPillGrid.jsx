import { useState, useMemo } from "react";
import { Plus } from "lucide-react";
import { SearchInput } from "../ui/SearchInput";
import { Button } from "../ui/Button";
import { EntryPill } from "./EntryPill";

const buildKey = (e) => `${(e?.value || "").toLowerCase()}::${e?.sub_category || ""}`;

export function EntryPillGrid({
  entries,
  pendingAdds,
  pendingRemovals,
  onAdd,
  onUndoAdd,
  onRemove,
  onUndoRemove,
  reasonRequired,
}) {
  const [search, setSearch] = useState("");
  const [draftValue, setDraftValue] = useState("");
  const [draftReason, setDraftReason] = useState("");
  const [showReason, setShowReason] = useState(false);
  const [validationError, setValidationError] = useState(null);

  const persistedEntries = entries || [];
  const adds = pendingAdds || [];
  const removals = new Set(pendingRemovals || []);

  // Pre-compute existing keys for duplicate detection
  const existingKeys = useMemo(() => {
    const set = new Set();
    persistedEntries.forEach((e) => set.add(buildKey(e)));
    adds.forEach((e) => set.add(buildKey(e)));
    return set;
  }, [persistedEntries, adds]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return persistedEntries;
    return persistedEntries.filter((e) =>
      (e.value || "").toLowerCase().includes(s) ||
      (e.sub_category || "").toLowerCase().includes(s)
    );
  }, [persistedEntries, search]);

  const handleAdd = () => {
    const v = draftValue.trim().toLowerCase();
    if (!v) {
      setValidationError("Entry can't be empty.");
      return;
    }
    if (existingKeys.has(`${v}::`)) {
      setValidationError("This entry already exists.");
      return;
    }
    if (reasonRequired && !draftReason.trim()) {
      setValidationError("Reason is required for this rule type.");
      setShowReason(true);
      return;
    }
    onAdd({ value: v, reason: draftReason.trim() || null });
    setDraftValue("");
    setDraftReason("");
    setShowReason(false);
    setValidationError(null);
  };

  const isEntryPending = (id) => removals.has(id);
  const isEmpty = persistedEntries.length === 0 && adds.length === 0;
  const filteredIsEmpty = !isEmpty && filtered.length === 0 && search;

  return (
    <div className="space-y-4">
      {/* Search */}
      {persistedEntries.length > 4 && (
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder="Search entries..."
        />
      )}

      {/* Add input */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={draftValue}
            onChange={(e) => { setDraftValue(e.target.value); setValidationError(null); }}
            onFocus={() => reasonRequired && setShowReason(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder="Add a new entry..."
            className={[
              "flex-1 h-10 px-3 text-sm rounded-lg outline-none",
              "bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
              "border border-[var(--gray-300)]",
              "focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]",
            ].join(" ")}
          />
          <Button
            size="md"
            icon={Plus}
            onClick={handleAdd}
            disabled={!draftValue.trim()}
          >
            Add
          </Button>
        </div>
        {showReason && (
          <textarea
            value={draftReason}
            onChange={(e) => { setDraftReason(e.target.value); setValidationError(null); }}
            placeholder={reasonRequired ? "Reason (required)..." : "Reason (optional)..."}
            rows={2}
            className={[
              "w-full px-3 py-2 text-sm rounded-lg outline-none resize-none",
              "bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
              "border border-[var(--gray-300)]",
              "focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]",
            ].join(" ")}
          />
        )}
        {reasonRequired && !showReason && (
          <p className="text-[11px] text-[var(--color-text-tertiary)]">
            Reason will be required when you add this entry.
          </p>
        )}
        {validationError && (
          <p className="text-[12px] text-[var(--color-error-700)]">{validationError}</p>
        )}
      </div>

      {/* Pending adds */}
      {adds.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-2">
            Pending adds ({adds.length})
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1.5">
            {adds.map((e, i) => (
              <EntryPill
                key={`add-${i}-${e.value}`}
                entry={e}
                status="pending_add"
                onRemove={typeof onUndoAdd === "function" ? () => onUndoAdd(i) : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {/* Existing entries */}
      <div>
        {persistedEntries.length > 0 && (
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-2">
            Existing entries ({persistedEntries.length}{search ? ` · ${filtered.length} match` : ""})
          </p>
        )}
        {isEmpty ? (
          <p className="text-[13px] text-[var(--color-text-tertiary)] text-center py-6">
            No entries yet. Add the first one above.
          </p>
        ) : filteredIsEmpty ? (
          <p className="text-[13px] text-[var(--color-text-tertiary)] text-center py-6">
            No entries match "{search}".
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1.5">
            {filtered.map((e) => {
              const pendingRemove = isEntryPending(e.id || buildKey(e));
              return (
                <EntryPill
                  key={e.id || buildKey(e)}
                  entry={e}
                  status={pendingRemove ? "pending_remove" : "persisted"}
                  onRemove={pendingRemove ? undefined : () => onRemove(e.id || buildKey(e))}
                  onUndo={pendingRemove ? () => onUndoRemove(e.id || buildKey(e)) : undefined}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
