/**
 * SignalAnchorsTab — ORCH-0712
 *
 * 16 sections (one per Mingla signal), each with 2 slots. Operator picks
 * candidates from places that score >= threshold for that signal.
 */

import { useEffect, useState, useCallback } from "react";
import { Plus, RefreshCw, Camera, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useToast } from "../../context/ToastContext";
import { SectionCard, AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Input } from "../ui/Input";
import { PhotoLightbox } from "../ui/PhotoLightbox";
import {
  MINGLA_SIGNAL_IDS,
  DEFAULT_CANDIDATE_SCORE_THRESHOLD,
  ANCHORS_PER_SIGNAL,
} from "../../constants/placeIntelligenceTrial";

// ── Candidate picker modal ──────────────────────────────────────────────────

function CandidatePicker({ open, onClose, signalId, anchorIndex, onPick, onOpenLightbox }) {
  const { addToast } = useToast();
  const [threshold, setThreshold] = useState(DEFAULT_CANDIDATE_SCORE_THRESHOLD);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [picking, setPicking] = useState(null);

  const load = useCallback(async () => {
    if (!open || !signalId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await supabase
        .from("place_scores")
        .select("place_id, score, place:place_pool!place_id(id, name, primary_type, rating, review_count, address, city, stored_photo_urls)")
        .eq("signal_id", signalId)
        .gte("score", threshold)
        .order("score", { ascending: false })
        .limit(40);
      if (e) throw e;
      const rows = (data || []).filter((r) =>
        r.place?.is_active !== false &&
        Array.isArray(r.place?.stored_photo_urls) &&
        r.place.stored_photo_urls.length > 0
      );
      setCandidates(rows);
    } catch (err) {
      console.error("[CandidatePicker] load failed:", err);
      setError(err?.message || "Couldn't load candidates");
    } finally {
      setLoading(false);
    }
  }, [open, signalId, threshold]);

  useEffect(() => {
    load();
  }, [load]);

  async function handlePick(place) {
    setPicking(place.id);
    try {
      await onPick(place);
    } catch (err) {
      console.error("[CandidatePicker] pick failed:", err);
      addToast({ variant: "error", title: "Couldn't pick anchor", description: err.message });
    } finally {
      setPicking(null);
    }
  }

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title={`Pick anchor ${anchorIndex} for ${signalId}`} size="lg">
      <ModalBody>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wide font-mono">Min score</span>
          <Input
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value) || 0)}
            className="w-24"
          />
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={load} disabled={loading}>
            Refresh
          </Button>
          <span className="text-xs text-[var(--color-text-tertiary)] ml-auto">
            {candidates.length} candidates ≥ {threshold}
          </span>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Spinner size="md" />
          </div>
        )}

        {!loading && error && (
          <AlertCard variant="error" title="Couldn't load candidates" action={
            <Button size="sm" variant="secondary" icon={RefreshCw} onClick={load}>Retry</Button>
          }>
            {error}
          </AlertCard>
        )}

        {!loading && !error && candidates.length === 0 && (
          <AlertCard variant="warning" title={`No candidates ≥ score ${threshold}`}>
            Lower the threshold to find more candidates for this signal.
          </AlertCard>
        )}

        {!loading && !error && candidates.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {candidates.map((row) => {
              const place = row.place;
              const photos = (place.stored_photo_urls || []).slice(0, 5);
              return (
                <div key={place.id} className="border border-[var(--gray-200)] rounded-lg p-3 flex flex-col gap-2 bg-[var(--color-background-primary)]">
                  <div className="flex items-baseline justify-between gap-2">
                    <h4 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{place.name}</h4>
                    <span className="text-xs text-[var(--color-text-secondary)] font-mono shrink-0">
                      score {Number(row.score).toFixed(0)}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--color-text-tertiary)] uppercase tracking-wide font-mono">
                    {(place.primary_type || "—").replace(/_/g, " ")}
                    {place.city && <span className="ml-2 normal-case tracking-normal">· {place.city}</span>}
                  </div>
                  {photos.length > 0 && (
                    <div className="grid grid-cols-5 gap-1">
                      {photos.map((url, idx) => (
                        <button
                          key={url + idx}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenLightbox?.(photos, idx);
                          }}
                          aria-label={`Open photo ${idx + 1} of ${photos.length}`}
                          className="aspect-square rounded overflow-hidden border border-[var(--gray-200)] hover:border-[var(--color-brand-500)] transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
                        >
                          <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-baseline justify-between gap-2 mt-1">
                    {place.rating != null && (
                      <span className="text-[11px] text-[var(--color-text-secondary)] font-mono">
                        ★ {Number(place.rating).toFixed(1)} · {place.review_count ?? 0}
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => handlePick(place)}
                      loading={picking === place.id}
                      disabled={picking != null}
                    >
                      Pick
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </ModalFooter>
    </Modal>
  );
}

// ── Slot card ───────────────────────────────────────────────────────────────

function AnchorSlot({ signalId, anchorIndex, anchor, onPickClick, onUncommit, onDelete, onOpenLightbox }) {
  if (!anchor) {
    return (
      <div className="border border-dashed border-[var(--gray-300)] rounded-lg p-4 flex flex-col items-center justify-center gap-2 min-h-[120px]">
        <span className="text-xs text-[var(--color-text-tertiary)] font-mono">slot {anchorIndex}</span>
        <Button size="sm" variant="primary" icon={Plus} onClick={onPickClick}>Pick anchor</Button>
      </div>
    );
  }

  const place = anchor.place;
  const photos = (place?.stored_photo_urls || []).slice(0, 4);
  const isCommitted = !!anchor.committed_at;

  return (
    <div className="border border-[var(--gray-200)] rounded-lg p-3 bg-[var(--color-background-primary)] flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{place?.name || "—"}</h4>
        <span className={[
          "text-[10px] uppercase tracking-wide font-mono px-1.5 py-0.5 rounded shrink-0",
          isCommitted
            ? "bg-[var(--color-success-50)] text-[var(--color-success-700)]"
            : "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]"
        ].join(" ")}>
          {isCommitted ? "committed" : "draft"}
        </span>
      </div>
      <div className="text-[11px] text-[var(--color-text-tertiary)] font-mono uppercase tracking-wide">
        {(place?.primary_type || "—").replace(/_/g, " ")}
      </div>
      {photos.length > 0 && (
        <div className="grid grid-cols-4 gap-1">
          {photos.map((url, idx) => (
            <button
              key={url + idx}
              type="button"
              onClick={() => onOpenLightbox?.(photos, idx)}
              aria-label={`Open photo ${idx + 1} of ${photos.length}`}
              className="aspect-square rounded overflow-hidden border border-[var(--gray-200)] hover:border-[var(--color-brand-500)] transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
            >
              <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 mt-1">
        <Button size="sm" variant="ghost" onClick={onPickClick}>Replace</Button>
        <Button size="sm" variant="ghost" icon={X} onClick={() => onDelete(anchor)}>Remove</Button>
      </div>
    </div>
  );
}

// ── Section: per signal ─────────────────────────────────────────────────────

function SignalSection({ signalId, anchors, onPickAnchor, onDeleteAnchor, onOpenLightbox }) {
  const slots = [1, 2].map((idx) => ({
    anchorIndex: idx,
    anchor: anchors.find((a) => a.anchor_index === idx) || null,
  }));
  const committedCount = anchors.filter((a) => a.committed_at).length;

  return (
    <div className="border border-[var(--gray-200)] rounded-lg p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{signalId}</h3>
        <span className="text-xs text-[var(--color-text-tertiary)] font-mono">
          {committedCount} / {ANCHORS_PER_SIGNAL} committed
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {slots.map(({ anchorIndex, anchor }) => (
          <AnchorSlot
            key={anchorIndex}
            signalId={signalId}
            anchorIndex={anchorIndex}
            anchor={anchor}
            onPickClick={() => onPickAnchor(signalId, anchorIndex)}
            onDelete={onDeleteAnchor}
            onOpenLightbox={onOpenLightbox}
          />
        ))}
      </div>
    </div>
  );
}

// ── Tab ─────────────────────────────────────────────────────────────────────

export function SignalAnchorsTab() {
  const { addToast } = useToast();
  const [anchors, setAnchors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSignal, setPickerSignal] = useState(null);
  const [pickerIndex, setPickerIndex] = useState(null);
  const [lightbox, setLightbox] = useState(null); // { photos: string[], startIndex: number } | null

  function openLightbox(photos, startIndex = 0) {
    if (!photos || photos.length === 0) return;
    setLightbox({ photos, startIndex });
  }

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await supabase
        .from("signal_anchors")
        .select("*, place:place_pool!place_pool_id(id, name, primary_type, rating, review_count, stored_photo_urls)")
        .order("signal_id");
      if (e) throw e;
      setAnchors(data || []);
    } catch (err) {
      console.error("[SignalAnchorsTab] load failed:", err);
      setError(err?.message || "Couldn't load anchors");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function openPicker(signalId, anchorIndex) {
    setPickerSignal(signalId);
    setPickerIndex(anchorIndex);
    setPickerOpen(true);
  }

  async function handlePick(place) {
    if (!pickerSignal || !pickerIndex) return;

    // Delete any existing draft/commit for this slot
    const existing = anchors.find(
      (a) => a.signal_id === pickerSignal && a.anchor_index === pickerIndex
    );
    if (existing) {
      const { error: delErr } = await supabase
        .from("signal_anchors")
        .delete()
        .eq("id", existing.id);
      if (delErr) throw delErr;
    }

    // Insert new committed anchor
    const labeledBy = (await supabase.auth.getUser()).data?.user?.id || null;
    const { error: insErr } = await supabase
      .from("signal_anchors")
      .insert({
        signal_id: pickerSignal,
        anchor_index: pickerIndex,
        place_pool_id: place.id,
        labeled_by: labeledBy,
        committed_at: new Date().toISOString(),
      });
    if (insErr) throw insErr;

    addToast({
      variant: "success",
      title: `Anchor committed: ${pickerSignal} #${pickerIndex}`,
      description: place.name,
    });
    setPickerOpen(false);
    await refresh();
  }

  async function handleDelete(anchor) {
    try {
      const { error: e } = await supabase
        .from("signal_anchors")
        .delete()
        .eq("id", anchor.id);
      if (e) throw e;
      addToast({ variant: "info", title: "Anchor removed" });
      await refresh();
    } catch (err) {
      console.error("[SignalAnchorsTab] delete failed:", err);
      addToast({ variant: "error", title: "Couldn't remove anchor", description: err.message });
    }
  }

  const committedCount = anchors.filter((a) => a.committed_at).length;
  const targetTotal = MINGLA_SIGNAL_IDS.length * ANCHORS_PER_SIGNAL;

  return (
    <SectionCard
      title="Signal Anchors"
      subtitle={`${committedCount} / ${targetTotal} committed across ${MINGLA_SIGNAL_IDS.length} signals`}
      action={
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={refresh} disabled={loading}>Refresh</Button>
      }
    >
      {loading && (
        <div className="flex items-center justify-center py-12"><Spinner size="md" /></div>
      )}

      {!loading && error && (
        <AlertCard variant="error" title="Couldn't load anchors" action={
          <Button size="sm" variant="secondary" icon={RefreshCw} onClick={refresh}>Retry</Button>
        }>
          {error}
        </AlertCard>
      )}

      {!loading && !error && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {MINGLA_SIGNAL_IDS.map((sid) => (
            <SignalSection
              key={sid}
              signalId={sid}
              anchors={anchors.filter((a) => a.signal_id === sid)}
              onPickAnchor={openPicker}
              onDeleteAnchor={handleDelete}
              onOpenLightbox={openLightbox}
            />
          ))}
        </div>
      )}

      <CandidatePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        signalId={pickerSignal}
        anchorIndex={pickerIndex}
        onPick={handlePick}
        onOpenLightbox={openLightbox}
      />

      {lightbox && (
        <PhotoLightbox
          photos={lightbox.photos}
          startIndex={lightbox.startIndex}
          onClose={() => setLightbox(null)}
        />
      )}
    </SectionCard>
  );
}

export default SignalAnchorsTab;
