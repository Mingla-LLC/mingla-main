/**
 * FixturesTab — ORCH-0708 Phase 0
 *
 * 30 fixture slots organised 10 per city across 3 columns (Raleigh / Cary /
 * Durham). Each slot card: place name + thumbnail + commit-status badge +
 * Edit / Un-commit / Re-label affordances. Fixtures use the broader candidate
 * picker (ORDER BY review_count DESC LIMIT 50). No collision check — fixtures
 * have no per-city uniqueness constraint.
 */

import { useEffect, useState, useCallback } from "react";
import { Plus, Pencil, RefreshCw, Camera } from "lucide-react";
import { SectionCard, AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Modal, ModalBody } from "../ui/Modal";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../../context/ToastContext";
import {
  FIXTURE_CITIES,
  EMPTY_EXPECTED_AGGREGATE,
} from "../../constants/photoLabeling";
import { CandidatePicker } from "./CandidatePicker";
import { LabelEditor } from "./LabelEditor";
import {
  fetchFixtureLabels,
  insertFixtureLabel,
  updateLabel,
  deleteLabel,
} from "./labelsService";

const FIXTURES_PER_CITY = 10;

// ── Slot row (compact) ──────────────────────────────────────────────────────

function FixtureSlot({ index, label, onPick, onEdit, onDelete }) {
  if (!label) {
    return (
      <div className="border border-dashed border-[var(--gray-300)] rounded-lg p-3 flex items-center gap-3 min-h-[64px]">
        <span className="w-6 text-xs font-mono text-[var(--color-text-tertiary)] shrink-0">
          {index + 1}
        </span>
        <Camera className="w-4 h-4 text-[var(--color-text-tertiary)] shrink-0" />
        <Button size="sm" variant="ghost" icon={Plus} onClick={onPick}>
          Pick a candidate
        </Button>
      </div>
    );
  }

  const place = label.place;
  const photo = (place?.stored_photo_urls || [])[0];
  const isFilled = !!label.committed_at;

  return (
    <div className="border border-[var(--gray-200)] rounded-lg p-3 flex items-center gap-3 min-h-[64px] bg-[var(--color-background-primary)] hover:border-[var(--color-brand-300)] transition-colors duration-150">
      <span className="w-6 text-xs font-mono text-[var(--color-text-tertiary)] shrink-0">
        {index + 1}
      </span>
      <div className="w-10 h-10 rounded overflow-hidden border border-[var(--gray-200)] shrink-0 bg-[var(--gray-100)]">
        {photo ? (
          <img src={photo} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <Camera className="w-4 h-4 m-auto mt-3 text-[var(--color-text-tertiary)]" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
          {place?.name || "Unknown"}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span
            className={[
              "text-[10px] uppercase tracking-wide font-mono px-1.5 py-0.5 rounded",
              isFilled
                ? "bg-[var(--color-success-50)] text-[var(--color-success-700)]"
                : "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
            ].join(" ")}
          >
            {isFilled ? "committed" : "draft"}
          </span>
          {place?.rating != null && (
            <span className="text-[10px] text-[var(--color-text-tertiary)] font-mono">
              ★ {Number(place.rating).toFixed(1)}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button size="sm" variant="ghost" icon={Pencil} onClick={() => onEdit(label)} aria-label="Edit fixture" />
        {isFilled && (
          <Button size="sm" variant="ghost" onClick={() => onDelete(label)}>
            Re-label
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Main tab ────────────────────────────────────────────────────────────────

export function FixturesTab() {
  const { addToast } = useToast();
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCity, setPickerCity] = useState(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPlace, setEditorPlace] = useState(null);
  const [editorCity, setEditorCity] = useState(null);
  const [editorLabelId, setEditorLabelId] = useState(null);
  const [editorValue, setEditorValue] = useState(EMPTY_EXPECTED_AGGREGATE);
  const [editorNotes, setEditorNotes] = useState("");
  const [editorCommitted, setEditorCommitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFixtureLabels();
      setLabels(data);
    } catch (err) {
      console.error("[FixturesTab] fetchFixtureLabels failed:", err);
      setError(err?.message || "Couldn't load fixtures.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Group labels by city; cap at 10 visible per city.
  const labelsByCity = {};
  for (const c of FIXTURE_CITIES) labelsByCity[c] = [];
  for (const l of labels) {
    if (l.city && labelsByCity[l.city]) {
      labelsByCity[l.city].push(l);
    }
  }

  function openPickerForCity(city) {
    setPickerCity(city);
    setPickerOpen(true);
  }

  function openEditorForExisting(label) {
    setEditorPlace(label.place);
    setEditorCity(label.city);
    setEditorLabelId(label.id);
    setEditorValue(label.expected_aggregate || EMPTY_EXPECTED_AGGREGATE);
    setEditorNotes(label.notes || "");
    setEditorCommitted(!!label.committed_at);
    setEditorOpen(true);
  }

  async function handleCandidatePick(place) {
    setPickerOpen(false);
    setEditorPlace(place);
    setEditorCity(pickerCity);
    setEditorLabelId(null);
    setEditorValue(EMPTY_EXPECTED_AGGREGATE);
    setEditorNotes("");
    setEditorCommitted(false);
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditorPlace(null);
    setEditorCity(null);
    setEditorLabelId(null);
    setEditorValue(EMPTY_EXPECTED_AGGREGATE);
    setEditorNotes("");
    setEditorCommitted(false);
  }

  async function handleSaveDraft() {
    if (!editorPlace || !editorCity) return;
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
        await insertFixtureLabel({
          place_pool_id: editorPlace.id,
          city: editorCity,
          expected_aggregate: editorValue,
          notes: editorNotes,
          commit: false,
        });
      }
      addToast({ variant: "success", title: "Draft saved" });
      closeEditor();
      await refresh();
    } catch (err) {
      console.error("[FixturesTab] save draft failed:", err);
      addToast({ variant: "error", title: "Couldn't save draft", description: err?.message });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCommit() {
    if (!editorPlace || !editorCity) return;
    setSubmitting(true);
    try {
      if (editorLabelId) {
        await updateLabel({
          id: editorLabelId,
          expected_aggregate: editorValue,
          notes: editorNotes,
          commit: true,
        });
      } else {
        await insertFixtureLabel({
          place_pool_id: editorPlace.id,
          city: editorCity,
          expected_aggregate: editorValue,
          notes: editorNotes,
          commit: true,
        });
      }
      addToast({ variant: "success", title: `Fixture committed: ${editorCity}` });
      closeEditor();
      await refresh();
    } catch (err) {
      console.error("[FixturesTab] commit failed:", err);
      addToast({ variant: "error", title: "Couldn't commit fixture", description: err?.message });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(label) {
    if (!window.confirm(`Re-label "${label.place?.name || "this fixture"}"? The old label will be deleted.`)) {
      return;
    }
    setSubmitting(true);
    try {
      await deleteLabel(label.id);
      addToast({ variant: "info", title: "Fixture deleted (slot now empty)" });
      await refresh();
    } catch (err) {
      console.error("[FixturesTab] delete failed:", err);
      addToast({ variant: "error", title: "Couldn't delete fixture", description: err?.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SectionCard
      title="Fixtures (30 slots)"
      subtitle={`10 per city — ${FIXTURE_CITIES.join(" · ")}`}
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
          title="Couldn't load fixtures"
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {FIXTURE_CITIES.map((city) => {
            const cityLabels = labelsByCity[city] || [];
            const slots = Array.from({ length: FIXTURES_PER_CITY }, (_, i) => cityLabels[i] || null);
            const filledCount = cityLabels.filter((l) => l.committed_at).length;
            return (
              <div key={city} className="space-y-2">
                <div className="flex items-baseline justify-between px-1">
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{city}</h3>
                  <span className="text-xs text-[var(--color-text-tertiary)] font-mono">
                    {filledCount} / {FIXTURES_PER_CITY} committed
                  </span>
                </div>
                <div className="space-y-2">
                  {slots.map((label, idx) => (
                    <FixtureSlot
                      key={label?.id || `${city}-empty-${idx}`}
                      index={idx}
                      label={label}
                      onPick={() => openPickerForCity(city)}
                      onEdit={openEditorForExisting}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Candidate picker */}
      {pickerOpen && pickerCity && (
        <CandidatePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          mode="fixture"
          city={pickerCity}
          onPick={handleCandidatePick}
        />
      )}

      {/* Label editor */}
      {editorOpen && (
        <Modal
          open={editorOpen}
          onClose={() => !submitting && closeEditor()}
          title={`Label fixture · ${editorCity || ""}`}
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
    </SectionCard>
  );
}

export default FixturesTab;
