/**
 * ISSUE-864 WP4 — ImageUploader (SPEC §4.1 new primitive, A4.c dropzone).
 * Keyboard-operable dropzone (a real <input type="file"> behind a labeled
 * button), client-side pre-checks (UX only), per-channel byte-cap honesty —
 * the Meta-shaped "≥1080×1080 · ≤30 MB" hint is REPLACED by per-channel
 * requirements (A4.c); the #866 server byte-probe is the validator of record.
 */

import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { Button } from "./Button";
import { Spinner } from "./Spinner";
import { CHANNEL_BYTE_CAPS, channelSizeWarnings, precheckImageFile } from "../../services/mediaUpload";

export function ImageUploader({ file, previewUrl, uploading, onFilePicked, onClear, disabled }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [problems, setProblems] = useState([]);
  const [warnings, setWarnings] = useState([]);

  const handleFile = (picked) => {
    if (!picked) return;
    const blocking = precheckImageFile(picked);
    setProblems(blocking);
    setWarnings(blocking.length === 0 ? channelSizeWarnings(picked) : []);
    if (blocking.length === 0) onFilePicked(picked);
  };

  return (
    <div className="w-full">
      {!previewUrl ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (!disabled) handleFile(e.dataTransfer.files?.[0]);
          }}
          className={[
            "border-2 border-dashed rounded-xl p-6 text-center transition-colors",
            dragOver ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]" : "border-[var(--gray-300)]",
          ].join(" ")}
        >
          <ImagePlus className="w-6 h-6 mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
          <p className="text-sm text-[var(--color-text-secondary)] mb-1">
            Drag an ad image here, or
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? "Uploading…" : "Choose image"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            aria-label="Upload ad image"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          {/* A4.c: per-channel caps — never one shared Meta-shaped hint. */}
          <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">
            JPG/PNG. Per-channel limits:{" "}
            {CHANNEL_BYTE_CAPS.map((c) => `${c.label} ${c.capLabel}`).join(" · ")}.
            The server validates the actual bytes per channel after upload.
          </p>
        </div>
      ) : (
        <div className="relative inline-block">
          <img
            src={previewUrl}
            alt={file?.name ? `Ad creative preview — ${file.name}` : "Ad creative preview"}
            className="max-h-64 rounded-xl border border-[var(--gray-200)]"
          />
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-xl">
              <Spinner size="sm" />
            </div>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={X}
            aria-label="Remove image"
            className="!absolute top-2 right-2"
            onClick={onClear}
            disabled={uploading}
          />
        </div>
      )}
      {problems.map((p) => (
        <p key={p} className="mt-2 text-xs text-[#ef4444]">{p}</p>
      ))}
      {warnings.map((w) => (
        <p key={w} className="mt-2 text-xs text-[var(--color-warning-700)]">{w}</p>
      ))}
    </div>
  );
}
