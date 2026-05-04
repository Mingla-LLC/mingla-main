/**
 * AnchorsTab — ORCH-0708 Phase 0
 *
 * Renders 6 anchor slots (one per ANCHOR_CATEGORIES). Each slot shows the
 * current committed anchor (if any) or an empty CTA. Click empty/edit →
 * CandidatePicker → LabelEditor → Save Draft / Commit. Anchor swap collision
 * is handled with an explicit confirmation dialog (NEVER silently overwrite).
 */

import { useEffect, useState, useCallback } from "react";
import { Plus, Pencil, AlertTriangle, RefreshCw, Camera } from "lucide-react";
import { SectionCard, AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../../context/ToastContext";
import {
  ANCHOR_CATEGORIES,
  EMPTY_EXPECTED_AGGREGATE,
} from "../../constants/photoLabeling";
import { CandidatePicker } from "./CandidatePicker";
import { LabelEditor } from "./LabelEditor";
import {
  fetchAnchorLabels,
  insertAnchorLabel,
  updateLabel,
  uncommitAnchorByCategory,
} from "./labelsService";

// ── Slot card ───────────────────────────────────────────────────────────────

function AnchorSlot({ category, label, onPick, onEdit, onUncommit }) {
  const isFilled = !!label && !!label.committed_at;
  const isDraft = !!label && !label.committed_at;
  const place = label?.place;
  const photos = (place?.stored_photo_urls || []).slice(0, 5);

  return (
    <div className="border border-[var(--gray-200)] rounded-xl p-4 bg-[var(--color-background-primary)] flex flex-col gap-3 min-h-[220px]">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          {category.label}
        </h3>
        {isFilled && (
          <span className="text-[10px] uppercase tracking-wide font-mono px-1.5 py-0.5 rounded bg-[var(--color-success-50)] text-[var(--color-success-700)]">
            committed
          </span>
        )}
        {isDraft && (
          <span className="text-[10px] uppercase tracking-wide font-mono px-1.5 py-0.5 rounded bg-[var(--color-warning-50)] text-[var(--color-warning-700)]">
            draft
          </span>
        )}
      </div>
      <p className="text-xs text-[var(--color-text-tertiary)]">{category.description}</p>

      {!label && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 py-4 border border-dashed border-[var(--gray-300)] rounded-lg">
          <Camera className="w-6 h-6 text-[var(--color-text-tertiary)]" />
          <Button size="sm" variant="primary" icon={Plus} onClick={() => onPick(category)}>
            Pick a candidate
          </Button>
        </div>
      )}

      {label && (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
              {place?.name || "Unknown"}
            </span>
            {place?.rating != null && (
              <span className="text-xs text-[var(--color-text-secondary)] font-mono shrink-0">
                ★ {Number(place.rating).toFixed(1)}
              </span>
            )}
          </div>
          {photos.length > 0 ? (
            <div className="grid grid-cols-5 gap-1">
              {photos.map((url, idx) => (
                <div key={url + idx} className="aspect-square rounded overflow-hidden border border-[var(--gray-200)]">
                  <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--color-text-tertiary)] italic">No photos backfilled</p>
          )}
          <div className="flex items-center gap-2 mt-auto">
            <Button size="sm" variant="secondary" icon={Pencil} onClick={() => onEdit(label)}>
              Edit
            </Button>
            {isFilled && (
              <Button size="sm" variant="ghost" onClick={() => onUncommit(label)}>
                Un-commit + Re-label
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main tab ────────────────────────────────────────────────────────────────

export function AnchorsTab() {
  const { addToast } = useToast();
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCategory, setPickerCategory] = useState(null);

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPlace, setEditorPlace] = useState(null);
  const [editorCategory, setEditorCategory] = useState(null);
  const [editorLabelId, setEditorLabelId] = useState(null);
  const [editorValue, setEditorValue] = useState(EMPTY_EXPECTED_AGGREGATE);
  const [editorNotes, setEditorNotes] = useState("");
  const [editorCommitted, setEditorCommitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Swap-collision dialog
  const [collisionOpen, setCollisionOpen] = useState(false);
  const [collisionExisting, setCollisionExisting] = useState(null);
  const [pendingCommit, setPendingCommit] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAnchorLabels();
      setLabels(data);
    } catch (err) {
      console.error("[AnchorsTab] fetchAnchorLabels failed:", err);
      setError(err?.message || "Couldn't load anchors.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Group labels by category — committed wins; falls back to draft if multiple drafts.
  const labelByCategory = {};
  for (const l of labels) {
    const cat = l.label_category;
    if (!cat) continue;
    const existing = labelByCategory[cat];
    if (!existing) {
      labelByCategory[cat] = l;
    } else if (!existing.committed_at && l.committed_at) {
      labelByCategory[cat] = l; // committed beats draft
    }
  }

  function openPickerForCategory(category) {
    setPickerCategory(category);
    setPickerOpen(true);
  }

  function openEditorForExisting(label) {
    setEditorPlace(label.place);
    setEditorCategory(ANCHOR_CATEGORIES.find((c) => c.id === label.label_category) || null);
    setEditorLabelId(label.id);
    setEditorValue(label.expected_aggregate || EMPTY_EXPECTED_AGGREGATE);
    setEditorNotes(label.notes || "");
    setEditorCommitted(!!label.committed_at);
    setEditorOpen(true);
  }

  async function handleCandidatePick(place) {
    setPickerOpen(false);
    setEditorPlace(place);
    setEditorLabelId(null);
    setEditorValue(EMPTY_EXPECTED_AGGREGATE);
    setEditorNotes("");
    setEditorCommitted(false);
    setEditorCategory(pickerCategory);
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditorPlace(null);
    setEditorLabelId(null);
    setEditorValue(EMPTY_EXPECTED_AGGREGATE);
    setEditorNotes("");
    setEditorCommitted(false);
    setEditorCategory(null);
  }

  async function handleSaveDraft() {
    if (!editorPlace || !editorCategory) return;
    setSubmitting(true);
    try {
      if (editorLabelId) {
        await updateLabel({
          id: editorLabelId,
          expected_aggregate: editorValue,
          notes: editorNotes,
          commit: false,
        });
      } else {
        await insertAnchorLabel({
          place_pool_id: editorPlace.id,
          label_category: editorCategory.id,
          expected_aggregate: editorValue,
          notes: editorNotes,
          commit: false,
        });
      }
      addToast({ variant: "success", title: "Draft saved" });
      closeEditor();
      await refresh();
    } catch (err) {
      console.error("[AnchorsTab] save draft failed:", err);
      addToast({ variant: "error", title: "Couldn't save draft", description: err?.message });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCommit() {
    if (!editorPlace || !editorCategory) return;
    // Collision check: is there ALREADY a committed anchor for this category
    // that is NOT this same label?
    const existing = labels.find(
      (l) =>
        l.label_category === editorCategory.id &&
        l.committed_at &&
        l.id !== editorLabelId,
    );
    if (existing) {
      setCollisionExisting(existing);
      setPendingCommit({
        place: editorPlace,
        category: editorCategory,
        labelId: editorLabelId,
        value: editorValue,
        notes: editorNotes,
      });
      setCollisionOpen(true);
      return;
    }
    await doCommit({
      place: editorPlace,
      category: editorCategory,
      labelId: editorLabelId,
      value: editorValue,
      notes: editorNotes,
    });
  }

  async function doCommit({ place, category, labelId, value, notes }) {
    setSubmitting(true);
    try {
      if (labelId) {
        await updateLabel({
          id: labelId,
          expected_aggregate: value,
          notes,
          commit: true,
        });
      } else {
        await insertAnchorLabel({
          place_pool_id: place.id,
          label_category: category.id,
          expected_aggregate: value,
          notes,
          commit: true,
        });
      }
      addToast({ variant: "success", title: `Anchor committed: ${category.label}` });
      closeEditor();
      await refresh();
    } catch (err) {
      console.error("[AnchorsTab] commit failed:", err);
      addToast({ variant: "error", title: "Couldn't commit anchor", description: err?.message });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmSwap() {
    if (!pendingCommit || !collisionExisting) return;
    setCollisionOpen(false);
    setSubmitting(true);
    try {
      // Un-commit the existing committed anchor for this category first.
      await uncommitAnchorByCategory(pendingCommit.category.id);
      // Then commit the new one (insert or update).
      await doCommit(pendingCommit);
    } catch (err) {
      console.error("[AnchorsTab] swap commit failed:", err);
      addToast({ variant: "error", title: "Swap failed", description: err?.message });
    } finally {
      setSubmitting(false);
      setPendingCommit(null);
      setCollisionExisting(null);
    }
  }

  async function handleUncommit(label) {
    setSubmitting(true);
    try {
      await updateLabel({
        id: label.id,
        expected_aggregate: label.expected_aggregate,
        notes: label.notes,
        commit: false,
      });
      addToast({ variant: "info", title: "Anchor un-committed (draft retained)" });
      await refresh();
    } catch (err) {
      console.error("[AnchorsTab] uncommit failed:", err);
      addToast({ variant: "error", title: "Couldn't un-commit", description: err?.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SectionCard
      title="Anchors (6 slots)"
      subtitle="One per category — feeds Claude's calibration examples"
      action={
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={refresh} disabled={loading}>
          Refresh
        </Button>
      }
    >
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
        </div>
      )}

      {!loading && error && (
        <AlertCard
          variant="error"
          title="Couldn't load anchors"
          action={
            <Button size="sm" variant="secondary" icon={RefreshCw} onClick={refresh}>
              Retry
            </Button>
          }
        >
          {error}
        </AlertCard>
      )}

      {!loading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {ANCHOR_CATEGORIES.map((category) => (
            <AnchorSlot
              key={category.id}
              category={category}
              label={labelByCategory[category.id] || null}
              onPick={openPickerForCategory}
              onEdit={openEditorForExisting}
              onUncommit={handleUncommit}
            />
          ))}
        </div>
      )}

      {/* Candidate picker modal */}
      {pickerOpen && pickerCategory && (
        <CandidatePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          mode="anchor"
          category={pickerCategory.id}
          onPick={handleCandidatePick}
        />
      )}

      {/* Label editor modal */}
      {editorOpen && (
        <Modal
          open={editorOpen}
          onClose={() => !submitting && closeEditor()}
          title={`Label anchor · ${editorCategory?.label || ""}`}
          size="lg"
        >
          <ModalBody>
            <LabelEditor
              place={editorPlace}
              value={editorValue}
              notes={editorNotes}
              onChange={setEditorValue}
              onNotesChange={setEditorNotes}
              onSaveDraft={handleSaveDraft}
              onCommit={handleCommit}
              onCancel={closeEditor}
              submitting={submitting}
              committed={editorCommitted}
            />
          </ModalBody>
        </Modal>
      )}

      {/* Anchor swap collision confirmation */}
      {collisionOpen && (
        <Modal
          open={collisionOpen}
          onClose={() => !submitting && setCollisionOpen(false)}
          title="Replace existing anchor?"
          size="sm"
          destructive
        >
          <ModalBody>
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-[#ea580c] shrink-0 mt-0.5" />
              <div className="text-sm text-[var(--color-text-primary)] space-y-2">
                <p>
                  An anchor for <strong>{pendingCommit?.category?.label}</strong> is already
                  committed: <strong>{collisionExisting?.place?.name || "—"}</strong>.
                </p>
                <p className="text-[var(--color-text-secondary)]">
                  Committing this new anchor will un-commit the existing one (it stays as a
                  draft, not deleted). Continue?
                </p>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setCollisionOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleConfirmSwap} loading={submitting}>
              Replace
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </SectionCard>
  );
}

export default AnchorsTab;
