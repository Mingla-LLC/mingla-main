import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Save, Trash2, History, BarChart3, GitCompare, FileText } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Button } from "../ui/Button";
import { AlertCard } from "../ui/Card";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { RuleKindChip } from "./RuleKindChip";
import { EntryPillGrid } from "./EntryPillGrid";
import { ImpactPreviewBanner } from "./ImpactPreviewBanner";
import { VersionHistoryList } from "./VersionHistoryList";
import { VersionDiffView } from "./VersionDiffView";
import { TimeWindowEditor } from "./TimeWindowEditor";
import { NumericRangeEditor } from "./NumericRangeEditor";

const PREVIEW_DEBOUNCE_MS = 400;

const REASON_REQUIRED_KINDS = new Set(["blacklist", "demotion"]);

const SUB_TABS = [
  { id: "entries", label: "Entries", Icon: FileText },
  { id: "history", label: "History", Icon: History },
  { id: "stats", label: "Stats", Icon: BarChart3 },
  { id: "diff", label: "Diff", Icon: GitCompare },
];

const buildEntryKey = (e) => `${(e?.value || "").toLowerCase()}::${e?.sub_category || ""}`;

export function RuleSidePanel({ ruleSetId, onClose, onSaveSuccess, toast, selectedCityId }) {
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState(null);

  const [pendingAdds, setPendingAdds] = useState([]);
  const [pendingRemovals, setPendingRemovals] = useState([]); // entry IDs (or buildEntryKey if no id)
  const [pendingThresholds, setPendingThresholds] = useState(null);
  const [changeSummary, setChangeSummary] = useState("");

  const [saving, setSaving] = useState(false);
  const [subTab, setSubTab] = useState("entries");

  // Version history state (loaded on demand when user opens History tab)
  const [versions, setVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState(null);
  const [versionsLoaded, setVersionsLoaded] = useState(false);
  const [versionsForDiff, setVersionsForDiff] = useState({ a: null, b: null });
  const [rollbackInflight, setRollbackInflight] = useState(false);

  // Impact preview state
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const containerRef = useRef(null);

  // Load rule detail
  const loadDetail = useCallback(async () => {
    if (!ruleSetId) return;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const { data, error } = await supabase.rpc("admin_rule_detail", { p_rule_set_id: ruleSetId });
      if (error) throw error;
      setDetail(data);
      setPendingAdds([]);
      setPendingRemovals([]);
      setPendingThresholds(null);
      setChangeSummary("");
    } catch (err) {
      setDetailError(err.message || "Couldn't load rule detail.");
    } finally {
      setDetailLoading(false);
    }
  }, [ruleSetId]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  const loadVersions = useCallback(async () => {
    if (!ruleSetId || versionsLoaded) return;
    setVersionsLoading(true);
    setVersionsError(null);
    try {
      const { data, error } = await supabase.rpc("admin_rule_set_versions", { p_rule_set_id: ruleSetId });
      if (error) throw error;
      setVersions(Array.isArray(data) ? data : []);
      setVersionsLoaded(true);
    } catch (err) {
      setVersionsError(err.message || "Couldn't load history.");
    } finally {
      setVersionsLoading(false);
    }
  }, [ruleSetId, versionsLoaded]);

  // Lazy-load versions when user opens History or Diff tab
  useEffect(() => {
    if ((subTab === "history" || subTab === "diff") && !versionsLoaded) loadVersions();
  }, [subTab, versionsLoaded, loadVersions]);

  // Compute proposed entries for impact preview (existing minus pendingRemovals + pendingAdds)
  const proposedEntries = useMemo(() => {
    const existing = (detail?.entries || []).filter((e) => {
      const k = e.id || buildEntryKey(e);
      return !pendingRemovals.includes(k);
    });
    return [...existing.map((e) => e.value), ...pendingAdds.map((e) => e.value)];
  }, [detail, pendingAdds, pendingRemovals]);

  const pendingChangeCount = pendingAdds.length + pendingRemovals.length + (pendingThresholds ? 1 : 0);

  // Debounced impact preview
  const previewDebounceRef = useRef(null);
  useEffect(() => {
    if (!detail?.rule_set?.id) return;
    if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    if (pendingChangeCount === 0) {
      setPreview(null);
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }
    if (!selectedCityId) return;
    setPreviewLoading(true);
    setPreviewError(null);
    previewDebounceRef.current = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc("admin_rules_preview_impact", {
          p_rule_set_id: detail.rule_set.id,
          p_proposed_entries: proposedEntries,
          p_proposed_thresholds: pendingThresholds,
          p_city_id: selectedCityId,
        });
        if (error) throw error;
        setPreview(data);
      } catch (err) {
        setPreviewError(err.message || "Preview failed.");
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => previewDebounceRef.current && clearTimeout(previewDebounceRef.current);
  }, [proposedEntries, pendingThresholds, selectedCityId, detail, pendingChangeCount]);

  // Handlers
  const handleAddEntry = useCallback((entry) => {
    if (!entry) return;
    setPendingAdds((prev) => [...prev, entry]);
  }, []);

  const handleUndoAddEntry = useCallback((index) => {
    setPendingAdds((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleRemoveEntry = useCallback((entryKey) => {
    setPendingRemovals((prev) => prev.includes(entryKey) ? prev : [...prev, entryKey]);
  }, []);

  const handleUndoRemoveEntry = useCallback((entryKey) => {
    setPendingRemovals((prev) => prev.filter((k) => k !== entryKey));
  }, []);

  const handleSelectForDiff = useCallback((versionId) => {
    setVersionsForDiff((prev) => {
      if (prev.a === versionId) return { a: null, b: prev.b };
      if (prev.b === versionId) return { a: prev.a, b: null };
      if (!prev.a) return { a: versionId, b: prev.b };
      if (!prev.b) {
        // Both filled now → auto-switch to diff tab
        setSubTab("diff");
        return { a: prev.a, b: versionId };
      }
      // Replace A with new selection
      return { a: versionId, b: prev.b };
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!detail?.rule_set?.id || pendingChangeCount === 0 || saving) return;
    setSaving(true);
    try {
      const newEntries = [
        ...(detail.entries || [])
          .filter((e) => !pendingRemovals.includes(e.id || buildEntryKey(e)))
          .map((e, i) => ({
            value: e.value,
            sub_category: e.sub_category,
            position: i,
            reason: e.reason,
          })),
        ...pendingAdds.map((e, i) => ({
          value: e.value,
          sub_category: e.sub_category || null,
          position: (detail.entries?.length || 0) + i,
          reason: e.reason,
        })),
      ];
      const { data, error } = await supabase.rpc("admin_rules_save", {
        p_rule_set_id: detail.rule_set.id,
        p_new_entries: newEntries,
        p_change_summary: changeSummary || `Edited ${detail.rule_set.name}`,
        p_new_thresholds: pendingThresholds,
      });
      if (error) throw error;
      toast({
        variant: "success",
        title: `Saved v${data?.new_version_number}`,
        description: selectedCityId
          ? `Run on the selected city to apply.`
          : `Pick a city and run rules-filter to apply.`,
      });
      onSaveSuccess?.(data);
    } catch (err) {
      toast({
        variant: "error",
        title: "Couldn't save",
        description: err.message || "Save failed. Try again.",
      });
    } finally {
      setSaving(false);
    }
  }, [detail, pendingAdds, pendingRemovals, pendingThresholds, changeSummary, saving, pendingChangeCount, toast, selectedCityId, onSaveSuccess]);

  const handleRollback = useCallback(async (targetVersionId, reason) => {
    if (!detail?.rule_set?.id || rollbackInflight) return;
    setRollbackInflight(true);
    try {
      const { data, error } = await supabase.rpc("admin_rules_rollback", {
        p_rule_set_id: detail.rule_set.id,
        p_target_version_id: targetVersionId,
        p_reason: reason,
      });
      if (error) throw error;
      toast({
        variant: "success",
        title: `Rolled back to v${data?.rolled_back_to_version}`,
        description: `New version v${data?.new_version_number} created. Run on city to apply.`,
      });
      onSaveSuccess?.(data);
    } catch (err) {
      toast({
        variant: "error",
        title: "Couldn't roll back",
        description: err.message || "Rollback failed. Try again.",
      });
    } finally {
      setRollbackInflight(false);
    }
  }, [detail, rollbackInflight, toast, onSaveSuccess]);

  const requestClose = useCallback(() => {
    if (pendingChangeCount > 0) {
      setConfirmDiscard(true);
    } else {
      onClose();
    }
  }, [pendingChangeCount, onClose]);

  // Esc key (input-aware) + Cmd/Ctrl+S to save
  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "Escape") {
        if (isInput) {
          document.activeElement.blur();
          return;
        }
        e.preventDefault();
        requestClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (pendingChangeCount > 0 && !saving) handleSave();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [requestClose, handleSave, pendingChangeCount, saving]);

  const ruleSet = detail?.rule_set;
  const reasonRequired = REASON_REQUIRED_KINDS.has(ruleSet?.kind);

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={requestClose}
        className="fixed inset-0 bg-black/30 backdrop-blur-[2px]"
        style={{ zIndex: "var(--z-modal, 50)" }}
      />

      {/* Panel */}
      <motion.aside
        ref={containerRef}
        initial={{ x: 480, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 480, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed top-0 right-0 h-full w-[480px] bg-[var(--color-background-primary)] shadow-[var(--shadow-xl)] flex flex-col"
        style={{ zIndex: "calc(var(--z-modal, 50) + 1)" }}
        role="dialog"
        aria-modal="true"
        aria-label={ruleSet?.name || "Rule editor"}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--gray-200)] shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold text-[var(--color-text-primary)] font-mono truncate">
                {ruleSet?.name || (detailLoading ? "Loading…" : "Unknown rule")}
              </p>
              <div className="flex items-center gap-2 mt-1">
                {ruleSet?.kind && <RuleKindChip kind={ruleSet.kind} size="sm" />}
                {ruleSet?.scope_kind === "category" && ruleSet?.scope_value && (
                  <span className="text-[11px] text-[var(--color-text-tertiary)]">
                    scope: {ruleSet.scope_value}
                  </span>
                )}
                {ruleSet?.is_active === false && (
                  <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] font-medium">
                    inactive
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={requestClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Sub-tabs */}
          <div className="flex items-center gap-1 mt-3">
            {SUB_TABS.map((t) => {
              const Icon = t.Icon;
              const disabled = t.id === "diff" && (!versionsForDiff.a || !versionsForDiff.b);
              return (
                <button
                  key={t.id}
                  onClick={() => !disabled && setSubTab(t.id)}
                  disabled={disabled}
                  className={[
                    "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium",
                    "transition-colors",
                    subTab === t.id
                      ? "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                      : disabled
                      ? "text-[var(--color-text-tertiary)] cursor-not-allowed opacity-50"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] cursor-pointer",
                  ].join(" ")}
                  title={disabled ? "Pick two versions in History to enable Diff" : t.label}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {detailLoading && (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-10 rounded bg-[var(--gray-100)] animate-pulse" />
              ))}
            </div>
          )}

          {detailError && (
            <AlertCard
              variant="error"
              title="Couldn't load rule"
              action={<Button size="sm" onClick={loadDetail}>Try Again</Button>}
            >
              {detailError}
            </AlertCard>
          )}

          {!detailLoading && !detailError && detail && (
            <>
              {subTab === "entries" && (
                <>
                  <ImpactPreviewBanner
                    preview={preview}
                    loading={previewLoading}
                    error={previewError}
                    pendingChangeCount={pendingChangeCount}
                    cityIsSelected={!!selectedCityId}
                    onViewAffected={() => toast({
                      variant: "info",
                      title: "Affected places drill-down",
                      description: "Per-place affected list ships in M3.4 (Run Detail panel).",
                    })}
                  />

                  {ruleSet?.kind === "time_window" ? (
                    <TimeWindowEditor />
                  ) : ruleSet?.kind === "numeric_range" ? (
                    <NumericRangeEditor />
                  ) : ruleSet?.kind === "min_data_guard" ? (
                    <MinDataGuardEditor
                      thresholds={pendingThresholds || detail.current_version?.thresholds}
                      onChange={(next) => setPendingThresholds(next)}
                    />
                  ) : (
                    <EntryPillGrid
                      entries={detail.entries || []}
                      pendingAdds={pendingAdds}
                      pendingRemovals={pendingRemovals}
                      onAdd={handleAddEntry}
                      onUndoAdd={handleUndoAddEntry}
                      onRemove={handleRemoveEntry}
                      onUndoRemove={handleUndoRemoveEntry}
                      reasonRequired={reasonRequired}
                    />
                  )}

                  {(ruleSet?.kind === "promotion" || ruleSet?.kind === "demotion") && (
                    <ThresholdEditor
                      kind={ruleSet.kind}
                      thresholds={pendingThresholds || detail.current_version?.thresholds}
                      onChange={(next) => setPendingThresholds(next)}
                    />
                  )}
                </>
              )}

              {subTab === "history" && (
                <VersionHistoryList
                  versions={versions}
                  loading={versionsLoading}
                  error={versionsError}
                  versionsForDiff={versionsForDiff}
                  onSelectForDiff={handleSelectForDiff}
                  onRollback={handleRollback}
                  rollbackInflight={rollbackInflight}
                />
              )}

              {subTab === "stats" && (
                <StatsView detail={detail} />
              )}

              {subTab === "diff" && (
                <VersionDiffView
                  versionAId={versionsForDiff.a}
                  versionBId={versionsForDiff.b}
                />
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--gray-200)] shrink-0 bg-[var(--color-background-secondary,var(--gray-50))]">
          {pendingChangeCount > 0 ? (
            <div className="space-y-2">
              <input
                type="text"
                value={changeSummary}
                onChange={(e) => setChangeSummary(e.target.value)}
                placeholder="Summarize this change (optional)..."
                className={[
                  "w-full h-9 px-3 text-[12px] rounded-md outline-none",
                  "bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
                  "border border-[var(--gray-300)]",
                  "focus:border-[var(--color-brand-500)] focus:ring-1 focus:ring-[var(--color-brand-100)]",
                ].join(" ")}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-[var(--color-text-secondary)]">
                  {pendingChangeCount} pending change{pendingChangeCount === 1 ? "" : "s"}
                  {selectedCityId ? "" : " · pick a city to preview impact"}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Trash2}
                    onClick={() => {
                      setPendingAdds([]);
                      setPendingRemovals([]);
                      setPendingThresholds(null);
                      setChangeSummary("");
                    }}
                    disabled={saving}
                  >
                    Discard
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={Save}
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-[var(--color-text-tertiary)] text-center">
              No pending changes. Press <kbd className="px-1 py-0.5 rounded bg-[var(--gray-200)] font-mono text-[10px]">Esc</kbd> to close.
            </p>
          )}
        </div>
      </motion.aside>

      {/* Confirm discard modal */}
      <Modal
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title="Discard pending changes?"
        size="sm"
        destructive
      >
        <ModalBody>
          <p className="text-[13px] text-[var(--color-text-primary)]">
            You have {pendingChangeCount} unsaved change{pendingChangeCount === 1 ? "" : "s"}.
            Closing the panel will discard them.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setConfirmDiscard(false)}>
            Keep editing
          </Button>
          <Button
            variant="primary"
            onClick={() => { setConfirmDiscard(false); onClose(); }}
          >
            Discard & close
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}

// ── Sub-editors used inline ──────────────────────────────────────────────────

function MinDataGuardEditor({ thresholds, onChange }) {
  const t = thresholds || {};
  const setKey = (k, v) => onChange({ ...t, [k]: v });

  const checks = [
    { key: "require_rating", label: "Require rating" },
    { key: "require_reviews", label: "Require reviews" },
    { key: "require_website", label: "Require website" },
  ];

  return (
    <div className="space-y-3">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
        Data requirements
      </p>
      <div className="space-y-2">
        {checks.map((c) => (
          <label
            key={c.key}
            className="flex items-center gap-2 text-[13px] text-[var(--color-text-primary)] cursor-pointer"
          >
            <input
              type="checkbox"
              checked={!!t[c.key]}
              onChange={(e) => setKey(c.key, e.target.checked)}
              className="cursor-pointer"
            />
            {c.label}
          </label>
        ))}
      </div>
      <div>
        <label className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] block mb-1">
          Rejection reason (shown in admin)
        </label>
        <input
          type="text"
          value={t.rejection_reason || ""}
          onChange={(e) => setKey("rejection_reason", e.target.value)}
          className="w-full h-9 px-3 text-sm rounded-md border border-[var(--gray-300)] bg-[var(--color-background-primary)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)] outline-none"
        />
      </div>
    </div>
  );
}

function ThresholdEditor({ kind, thresholds, onChange }) {
  const t = thresholds || {};
  const setKey = (k, v) => onChange({ ...t, [k]: v });

  return (
    <div className="border-t border-[var(--gray-200)] pt-4 space-y-3">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
        Thresholds
      </p>
      {kind === "promotion" && (
        <>
          <div>
            <label className="text-[11px] text-[var(--color-text-secondary)] block mb-1">
              Minimum rating
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="5"
              value={t.rating_min ?? ""}
              onChange={(e) => setKey("rating_min", parseFloat(e.target.value) || 0)}
              className="w-full h-9 px-3 text-sm rounded-md border border-[var(--gray-300)] bg-[var(--color-background-primary)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)] outline-none"
            />
          </div>
          <div>
            <label className="text-[11px] text-[var(--color-text-secondary)] block mb-1">
              Price levels (comma-separated, e.g. PRICE_LEVEL_VERY_EXPENSIVE)
            </label>
            <input
              type="text"
              value={(t.price_levels || []).join(", ")}
              onChange={(e) => setKey("price_levels", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
              className="w-full h-9 px-3 text-sm rounded-md border border-[var(--gray-300)] bg-[var(--color-background-primary)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)] outline-none font-mono"
            />
          </div>
        </>
      )}
      {kind === "demotion" && (
        <div>
          <label className="text-[11px] text-[var(--color-text-secondary)] block mb-1">
            Demote to category
          </label>
          <input
            type="text"
            value={t.demote_to || ""}
            onChange={(e) => setKey("demote_to", e.target.value)}
            className="w-full h-9 px-3 text-sm rounded-md border border-[var(--gray-300)] bg-[var(--color-background-primary)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)] outline-none font-mono"
          />
        </div>
      )}
    </div>
  );
}

function StatsView({ detail }) {
  const fires = detail?.fires_7d_by_outcome || {};
  const recent = detail?.most_recent_fires || [];

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-2">
          Fires (last 7 days)
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="p-3 rounded border border-[var(--gray-200)] bg-[var(--color-background-primary)]">
            <p className="text-[11px] text-[var(--color-text-secondary)]">Reject</p>
            <p className="text-[20px] font-bold text-[var(--color-text-primary)]">{fires.reject || 0}</p>
          </div>
          <div className="p-3 rounded border border-[var(--gray-200)] bg-[var(--color-background-primary)]">
            <p className="text-[11px] text-[var(--color-text-secondary)]">Modify</p>
            <p className="text-[20px] font-bold text-[var(--color-text-primary)]">{fires.modify || 0}</p>
          </div>
        </div>
      </div>
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-2">
          Most recent fires
        </p>
        {recent.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-tertiary)]">This rule hasn't fired recently.</p>
        ) : (
          <div className="space-y-2">
            {recent.map((r, i) => (
              <div key={i} className="text-[12px] p-2 rounded border border-[var(--gray-200)]">
                <p className="font-medium text-[var(--color-text-primary)]">{r.place_name}</p>
                <p className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">
                  {r.decision} · {r.reason}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
