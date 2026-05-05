/**
 * LabelEditor — ORCH-0708 Phase 0
 *
 * Controlled-component form for labeling a single place's photo-aesthetic
 * answer key. Used by both AnchorsTab (with role='anchor' + label_category)
 * and FixturesTab (with role='fixture' + city). Parent owns persistence.
 *
 * Spec §24.3 — eleven form fields:
 *   aesthetic_score       slider, 1.0–10.0, step 0.1
 *   lighting              dropdown (9)
 *   composition           dropdown (3)
 *   subject_clarity       dropdown (3)
 *   primary_subject       dropdown (9)
 *   vibe_tags             multiselect chips (24, neutral)
 *   appropriate_for       multiselect chips (16 signal IDs, GREEN)
 *   inappropriate_for     multiselect chips (16 signal IDs, RED)
 *   safety_flags          multiselect chips (5, ORANGE warning)
 *   photo_quality_notes   textarea, max 300 chars
 *   notes                 textarea, optional, no max
 */

import { useState } from "react";
import { Textarea } from "../ui/Input";
import { Button } from "../ui/Button";
import { PhotoLightbox } from "../ui/PhotoLightbox";
import {
  AESTHETIC_SCORE_MIN,
  AESTHETIC_SCORE_MAX,
  AESTHETIC_SCORE_STEP,
  LIGHTING_OPTIONS,
  COMPOSITION_OPTIONS,
  SUBJECT_CLARITY_OPTIONS,
  PRIMARY_SUBJECT_OPTIONS,
  VIBE_TAG_OPTIONS,
  SAFETY_FLAG_OPTIONS,
  MINGLA_SIGNAL_IDS,
  PHOTO_QUALITY_NOTES_MAX,
} from "../../constants/photoLabeling";

// ─── ChipMultiselect — inline sub-component ─────────────────────────────────
// `tone` controls the selected-state color: neutral (brand) | positive (green) |
// negative (red) | warning (orange).

const TONE_CLASSES = {
  neutral: {
    selected:
      "bg-[var(--color-brand-500)] text-white border-[var(--color-brand-500)]",
    unselected:
      "bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] border-[var(--gray-300)] hover:border-[var(--color-brand-300)] hover:text-[var(--color-text-primary)]",
  },
  positive: {
    selected: "bg-[#16a34a] text-white border-[#16a34a]",
    unselected:
      "bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] border-[var(--gray-300)] hover:border-[#16a34a] hover:text-[#16a34a]",
  },
  negative: {
    selected: "bg-[#dc2626] text-white border-[#dc2626]",
    unselected:
      "bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] border-[var(--gray-300)] hover:border-[#dc2626] hover:text-[#dc2626]",
  },
  warning: {
    selected: "bg-[#ea580c] text-white border-[#ea580c]",
    unselected:
      "bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] border-[var(--gray-300)] hover:border-[#ea580c] hover:text-[#ea580c]",
  },
};

function ChipMultiselect({ label, options, selected, onChange, tone = "neutral", helperText }) {
  const tones = TONE_CLASSES[tone] || TONE_CLASSES.neutral;
  const selectedSet = new Set(selected || []);

  function toggle(option) {
    const next = new Set(selectedSet);
    if (next.has(option)) next.delete(option);
    else next.add(option);
    onChange(Array.from(next));
  }

  return (
    <div>
      {label && (
        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
          {label}
        </label>
      )}
      {helperText && (
        <p className="text-xs text-[var(--color-text-tertiary)] mb-2">{helperText}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const isSelected = selectedSet.has(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              aria-pressed={isSelected}
              className={[
                "px-3 py-1.5 text-xs font-medium border rounded-full",
                "transition-colors duration-150 cursor-pointer",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-1",
                isSelected ? tones.selected : tones.unselected,
              ].join(" ")}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatType(t) {
  if (!t) return "—";
  return t.replace(/_/g, " ");
}

function PlaceHeader({ place }) {
  if (!place) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-2 border-b border-[var(--gray-200)]">
      <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
        {place.name || "Unknown place"}
      </h3>
      <span className="text-xs text-[var(--color-text-tertiary)] font-mono uppercase tracking-wide">
        {formatType(place.primary_type)}
      </span>
      {place.rating != null && (
        <span className="text-xs text-[var(--color-text-secondary)]">
          ★ {Number(place.rating).toFixed(1)}
          {place.review_count != null && (
            <span className="text-[var(--color-text-tertiary)]"> · {place.review_count} reviews</span>
          )}
        </span>
      )}
      {place.address && (
        <span className="text-xs text-[var(--color-text-tertiary)] truncate max-w-full">
          {place.address}
        </span>
      )}
    </div>
  );
}

function PhotoStrip({ photos, onPhotoClick }) {
  const safe = (photos || []).slice(0, 5);
  if (safe.length === 0) {
    return (
      <div className="border border-dashed border-[var(--gray-300)] rounded-lg p-6 text-center text-sm text-[var(--color-text-tertiary)]">
        No photos available for this place. Run photo backfill first.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-5 gap-2">
      {safe.map((url, idx) => (
        <button
          key={url + idx}
          type="button"
          onClick={() => onPhotoClick(idx)}
          aria-label={`Open photo ${idx + 1}`}
          className="aspect-square rounded-lg overflow-hidden border border-[var(--gray-200)] hover:border-[var(--color-brand-500)] transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
        >
          <img
            src={url}
            alt={`Photo ${idx + 1}`}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </button>
      ))}
    </div>
  );
}

function FieldDropdown({ label, value, options, onChange }) {
  return (
    <div>
      <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-10 px-3 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)] border border-[var(--gray-300)] rounded-lg outline-none transition-all duration-150 focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)] cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}

function AestheticScoreSlider({ value, onChange }) {
  const safeValue = Number.isFinite(value) ? value : 5.0;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-sm font-medium text-[var(--color-text-primary)]">
          Aesthetic score
        </label>
        <span className="text-base font-mono font-semibold text-[var(--color-brand-500)]">
          {safeValue.toFixed(1)}
        </span>
      </div>
      <input
        type="range"
        min={AESTHETIC_SCORE_MIN}
        max={AESTHETIC_SCORE_MAX}
        step={AESTHETIC_SCORE_STEP}
        value={safeValue}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer accent-[var(--color-brand-500)]"
        aria-label="Aesthetic score, 1 to 10"
      />
      <div className="flex justify-between text-[10px] text-[var(--color-text-tertiary)] mt-1 font-mono">
        <span>1.0 poor</span>
        <span>5.0 acceptable</span>
        <span>10.0 stunning</span>
      </div>
    </div>
  );
}

// ─── LabelEditor — main export ──────────────────────────────────────────────

export function LabelEditor({
  place,
  value,
  notes,
  onChange,
  onNotesChange,
  onSaveDraft,
  onCommit,
  onCancel,
  submitting = false,
  committed = false,
}) {
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const photos = place?.stored_photo_urls || [];

  function setField(field, fieldValue) {
    onChange({ ...value, [field]: fieldValue });
  }

  const photoQualityLen = (value?.photo_quality_notes || "").length;
  const photoQualityOver = photoQualityLen > PHOTO_QUALITY_NOTES_MAX;

  return (
    <div className="space-y-5">
      <PlaceHeader place={place} />

      <div>
        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
          Photos (click to enlarge)
        </label>
        <PhotoStrip photos={photos} onPhotoClick={(i) => setLightboxIndex(i)} />
      </div>

      <AestheticScoreSlider
        value={value?.aesthetic_score}
        onChange={(v) => setField("aesthetic_score", v)}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FieldDropdown
          label="Lighting"
          value={value?.lighting || LIGHTING_OPTIONS[0]}
          options={LIGHTING_OPTIONS}
          onChange={(v) => setField("lighting", v)}
        />
        <FieldDropdown
          label="Composition"
          value={value?.composition || COMPOSITION_OPTIONS[1]}
          options={COMPOSITION_OPTIONS}
          onChange={(v) => setField("composition", v)}
        />
        <FieldDropdown
          label="Subject clarity"
          value={value?.subject_clarity || SUBJECT_CLARITY_OPTIONS[0]}
          options={SUBJECT_CLARITY_OPTIONS}
          onChange={(v) => setField("subject_clarity", v)}
        />
        <FieldDropdown
          label="Primary subject"
          value={value?.primary_subject || PRIMARY_SUBJECT_OPTIONS[8]}
          options={PRIMARY_SUBJECT_OPTIONS}
          onChange={(v) => setField("primary_subject", v)}
        />
      </div>

      <ChipMultiselect
        label="Vibe tags"
        helperText="Pick 1–5 most applicable. Leave empty if nothing fits."
        options={VIBE_TAG_OPTIONS}
        selected={value?.vibe_tags || []}
        onChange={(v) => setField("vibe_tags", v)}
        tone="neutral"
      />

      <ChipMultiselect
        label="Appropriate for"
        helperText="Which Mingla signals SHOULD this place's photo-aesthetic match?"
        options={MINGLA_SIGNAL_IDS}
        selected={value?.appropriate_for || []}
        onChange={(v) => setField("appropriate_for", v)}
        tone="positive"
      />

      <ChipMultiselect
        label="Inappropriate for"
        helperText="Which signals should this place NEVER score well on?"
        options={MINGLA_SIGNAL_IDS}
        selected={value?.inappropriate_for || []}
        onChange={(v) => setField("inappropriate_for", v)}
        tone="negative"
      />

      <ChipMultiselect
        label="Safety flags"
        helperText="Adult content, weapons, drugs, etc. Pick 'none' if nothing applies."
        options={SAFETY_FLAG_OPTIONS}
        selected={value?.safety_flags || []}
        onChange={(v) => setField("safety_flags", v)}
        tone="warning"
      />

      <div>
        <Textarea
          label={`Photo quality notes (max ${PHOTO_QUALITY_NOTES_MAX} chars)`}
          helper={`${photoQualityLen}/${PHOTO_QUALITY_NOTES_MAX}`}
          error={photoQualityOver ? `Over by ${photoQualityLen - PHOTO_QUALITY_NOTES_MAX} chars` : null}
          value={value?.photo_quality_notes || ""}
          onChange={(e) => setField("photo_quality_notes", e.target.value)}
          placeholder='e.g. "Warm intimate lighting, food-forward shots, strong composition"'
        />
      </div>

      <div>
        <Textarea
          label="Operator notes (optional)"
          helper="Free-text rationale for future operators. No length limit."
          value={notes || ""}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Why this place + this category? Anything noteworthy about the photos?"
        />
      </div>

      <div className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--gray-200)]">
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="secondary"
          onClick={onSaveDraft}
          loading={submitting}
          disabled={photoQualityOver}
        >
          Save draft
        </Button>
        <Button
          variant="primary"
          onClick={onCommit}
          loading={submitting}
          disabled={photoQualityOver}
        >
          {committed ? "Recommit" : "Commit"}
        </Button>
      </div>

      {lightboxIndex != null && (
        <PhotoLightbox
          photos={photos}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}

export default LabelEditor;
