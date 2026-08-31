"use client";

import { useRef, useState } from "react";
import {
  canSelectStudioMedia,
  uploadStudioMedia,
  validateStudioMediaFile,
  type StudioMediaProgress,
} from "../lib/studioMediaClient";

const EMPTY: StudioMediaProgress = {
  phase: "uploading",
  progress: 0,
  mediaId: null,
  message: "Choose an image to begin.",
};

export default function StudioMediaManager() {
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<StudioMediaProgress>(EMPTY);
  const [altText, setAltText] = useState("");
  const [decorative, setDecorative] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(false);

  const start = async (candidate: File) => {
    const validation = validateStudioMediaFile(candidate);
    setFile(candidate);
    setSelected(false);
    if (validation) {
      setProgress({
        phase: "rejected",
        progress: 0,
        mediaId: null,
        message: validation,
      });
      return;
    }
    setBusy(true);
    try {
      await uploadStudioMedia(candidate, setProgress);
    } catch {
      setProgress({
        phase: "retryable_failed",
        progress: 0,
        mediaId: null,
        message: "The image could not be started. Check your connection and retry.",
      });
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    setFile(null);
    setProgress(EMPTY);
    setAltText("");
    setDecorative(false);
    setSelected(false);
    if (picker.current) picker.current.value = "";
  };

  const canUse = canSelectStudioMedia({
    state: progress.phase === "ready" ? "READY" : progress.phase,
    altText,
    decorative,
  });

  return (
    <main className="studio-media-manager">
      <header className="studio-page-heading">
        <p className="studio-eyebrow">Mingla Studio</p>
        <h1>Media</h1>
        <p>
          Add website images without exposing storage controls. Mingla checks,
          cleans and creates responsive versions before an image can be used.
        </p>
      </header>

      <section className="studio-media-rules" aria-label="Accepted image rules">
        <strong>JPEG, PNG or WebP</strong>
        <span>Up to 20 MB and 40 megapixels</span>
        <span>Metadata is removed during processing</span>
      </section>

      <section
        className="studio-drop-zone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const candidate = event.dataTransfer.files.item(0);
          if (candidate) void start(candidate);
        }}
      >
        <input
          ref={picker}
          id="studio-media-picker"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(event) => {
            const candidate = event.target.files?.item(0);
            if (candidate) void start(candidate);
          }}
        />
        <h2>Drop an image here</h2>
        <p>or choose one from this device</p>
        <button
          className="studio-primary-button"
          type="button"
          onClick={() => picker.current?.click()}
          disabled={busy}
        >
          Choose image
        </button>
      </section>

      {file ? (
        <section className="studio-media-file" aria-live="polite">
          <div className="studio-media-file-heading">
            <div>
              <h2>{file.name}</h2>
              <p>{Math.ceil(file.size / 1024)} KB</p>
            </div>
            <span className={`studio-media-status studio-media-status--${progress.phase}`}>
              {progress.phase.replaceAll("_", " ")}
            </span>
          </div>
          <div
            className="studio-media-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress.progress * 100)}
          >
            <span style={{ width: `${Math.round(progress.progress * 100)}%` }} />
          </div>
          <p>{progress.message}</p>

          {progress.phase === "ready" ? (
            <fieldset className="studio-media-accessibility">
              <legend>Describe this image before using it</legend>
              <label htmlFor="studio-media-alt">Alt text</label>
              <input
                id="studio-media-alt"
                value={altText}
                disabled={decorative}
                onChange={(event) => setAltText(event.target.value)}
                placeholder="What is important in this image?"
                maxLength={300}
              />
              <label className="studio-checkbox">
                <input
                  type="checkbox"
                  checked={decorative}
                  onChange={(event) => {
                    setDecorative(event.target.checked);
                    if (event.target.checked) setAltText("");
                  }}
                />
                This image is decorative and should be ignored by screen readers
              </label>
              {!canUse ? (
                <p className="studio-field-help">
                  Add useful alt text or mark the image decorative.
                </p>
              ) : null}
              <button
                className="studio-primary-button"
                type="button"
                disabled={!canUse}
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("mingla:media-selected", {
                      detail: {
                        mediaId: progress.mediaId,
                        alt: decorative ? "" : altText.trim(),
                        decorative,
                      },
                    }),
                  );
                  setSelected(true);
                }}
              >
                Use image
              </button>
              {selected ? (
                <p className="studio-success">Image selected and ready for the page editor.</p>
              ) : null}
            </fieldset>
          ) : null}

          <div className="studio-media-actions">
            {["expired", "retryable_failed"].includes(progress.phase) ? (
              <button
                type="button"
                className="studio-secondary-button"
                disabled={busy}
                onClick={() => void start(file)}
              >
                Retry
              </button>
            ) : null}
            {["rejected", "replayed", "retryable_failed", "expired"].includes(
              progress.phase,
            ) ? (
              <button
                type="button"
                className="studio-secondary-button"
                onClick={() => picker.current?.click()}
              >
                Replace
              </button>
            ) : null}
            <button type="button" className="studio-text-button" onClick={dismiss}>
              Dismiss
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
