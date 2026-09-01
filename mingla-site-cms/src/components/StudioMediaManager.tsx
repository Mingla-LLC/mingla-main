"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  attachStudioMedia,
  canSelectStudioMedia,
  isStudioSessionEnded,
  isStudioMediaRecoverable,
  loadStudioMediaLibrary,
  removeUnusedStudioMedia,
  restoreStudioMedia,
  uploadStudioMedia,
  validateStudioMediaFile,
  type StudioMediaLibrary,
  type StudioMediaProgress,
} from "../lib/studioMediaClient";

const EMPTY: StudioMediaProgress = {
  phase: "uploading",
  progress: 0,
  mediaId: null,
  message: "Choose an image to begin.",
};

function returnExpiredStudioSession(error: unknown): boolean {
  if (!isStudioSessionEnded(error)) return false;
  window.location.replace("/mingla/session-expired");
  return true;
}

export default function StudioMediaManager() {
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<StudioMediaProgress>(EMPTY);
  const [library, setLibrary] = useState<StudioMediaLibrary | null>(null);
  const [targetId, setTargetId] = useState("");
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [altText, setAltText] = useState("");
  const [decorative, setDecorative] = useState(false);
  const [busy, setBusy] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refreshLibrary = useCallback(async () => {
    setLibraryError(null);
    try {
      setLibrary(await loadStudioMediaLibrary());
    } catch (error) {
      if (returnExpiredStudioSession(error)) return;
      setLibraryError(
        "Media could not be refreshed. Your draft has not been changed.",
      );
    }
  }, []);

  useEffect(() => {
    let active = true;
    void loadStudioMediaLibrary().then((next) => {
      if (active) setLibrary(next);
    }).catch((error) => {
      if (active) {
        if (returnExpiredStudioSession(error)) return;
        setLibraryError(
          "Media could not be refreshed. Your draft has not been changed.",
        );
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const start = async (candidate: File) => {
    const validation = validateStudioMediaFile(candidate);
    setFile(candidate);
    setSuccess(null);
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
      const result = await uploadStudioMedia(candidate, setProgress);
      if (result.phase === "ready" && result.mediaId) {
        setSelectedMediaId(result.mediaId);
        await refreshLibrary();
      }
    } catch (error) {
      if (returnExpiredStudioSession(error)) return;
      setProgress({
        phase: "retryable_failed",
        progress: 0,
        mediaId: null,
        message:
          "The image could not be started. Check your connection and retry.",
      });
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    setFile(null);
    setProgress(EMPTY);
    if (picker.current) picker.current.value = "";
  };

  const selectedTarget =
    library?.targets.find((target) => target.id === targetId) ?? null;
  const selectedMedia =
    library?.media.find((item) => item.id === selectedMediaId) ?? null;
  const canUse = Boolean(
    selectedTarget &&
      selectedMedia?.state === "READY" &&
      canSelectStudioMedia({ state: "READY", altText, decorative }) &&
      (!selectedTarget.decorativeOnly || decorative),
  );

  const chooseTarget = (nextId: string) => {
    setTargetId(nextId);
    setSuccess(null);
    const target = library?.targets.find((item) => item.id === nextId);
    if (!target) {
      setAltText("");
      setDecorative(false);
      return;
    }
    setAltText(target.currentAlt);
    setDecorative(
      target.decorativeOnly ||
        (target.currentMediaId !== null && target.currentAlt === ""),
    );
    setSelectedMediaId((current) => current ?? target.currentMediaId);
  };

  const attach = async () => {
    if (!selectedTarget || !selectedMediaId || !canUse) return;
    setBusy(true);
    setSuccess(null);
    try {
      const result = await attachStudioMedia(selectedMediaId, selectedTarget, {
        altText,
        decorative,
      });
      setSuccess(
        `Draft revision ${result.draft_revision} saved. Returning to the page editor…`,
      );
      window.location.assign(result.return_url);
    } catch (error) {
      if (returnExpiredStudioSession(error)) return;
      setLibraryError(
        "This draft location changed or the image is no longer READY. Refresh and choose again.",
      );
      await refreshLibrary();
    } finally {
      setBusy(false);
    }
  };

  const removeUnused = async (mediaId: string, inUse: boolean) => {
    if (inUse) return;
    setBusy(true);
    setLibraryError(null);
    try {
      await removeUnusedStudioMedia(mediaId);
      if (selectedMediaId === mediaId) setSelectedMediaId(null);
      await refreshLibrary();
    } catch (error) {
      if (returnExpiredStudioSession(error)) return;
      setLibraryError(
        "That image is now used by the draft or could not be removed. Nothing was detached.",
      );
    } finally {
      setBusy(false);
    }
  };

  const restoreRemoved = async (mediaId: string) => {
    setBusy(true);
    setLibraryError(null);
    try {
      await restoreStudioMedia(mediaId);
      setSelectedMediaId(mediaId);
      setSuccess("The image is READY to use again.");
      await refreshLibrary();
    } catch (error) {
      if (returnExpiredStudioSession(error)) return;
      setLibraryError(
        "That image could not be restored. Its recovery window may have ended or its protected copy may be unavailable.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="studio-media-manager">
      <header className="studio-page-heading studio-media-heading">
        <div>
          <p className="studio-eyebrow">Mingla Studio</p>
          <h1>Media</h1>
          <p>
            Upload safe website images, choose an exact draft location, then
            return to Pages with the relationship already saved.
          </p>
        </div>
        <Link className="studio-secondary-button" href="/admin/collections/pages">
          Close
        </Link>
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
          Choose images
        </button>
      </section>

      {file ? (
        <section className="studio-media-file" aria-live="polite">
          <div className="studio-media-file-heading">
            <div>
              <h2>{file.name}</h2>
              <p>{Math.ceil(file.size / 1024)} KB</p>
            </div>
            <span
              className={`studio-media-status studio-media-status--${progress.phase}`}
            >
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

      <section className="studio-media-library" aria-labelledby="media-library-title">
        <div className="studio-media-section-heading">
          <div>
            <p className="studio-eyebrow">Processed library</p>
            <h2 id="media-library-title">Choose a READY image</h2>
          </div>
          <button
            type="button"
            className="studio-text-button"
            onClick={() => void refreshLibrary()}
            disabled={busy}
          >
            Refresh
          </button>
        </div>
        {libraryError ? (
          <p className="studio-media-error" role="alert">{libraryError}</p>
        ) : null}
        {library === null ? <p>Loading tenant media…</p> : null}
        {library?.media.length === 0 ? (
          <p>No processed images yet. Upload the first one above.</p>
        ) : null}
        <div className="studio-media-grid">
          {library?.media.map((item) => (
            <article
              key={item.id}
              className={`studio-media-tile${
                selectedMediaId === item.id ? " studio-media-tile--selected" : ""
              }`}
            >
              <button
                type="button"
                className="studio-media-tile-select"
                disabled={item.state !== "READY" || busy}
                aria-pressed={selectedMediaId === item.id}
                onClick={() => {
                  setSelectedMediaId(item.id);
                  setSuccess(null);
                }}
              >
                <span className="studio-media-thumbnail">
                  {item.thumbnail_url ? (
                    <Image
                      src={item.thumbnail_url}
                      alt=""
                      fill
                      unoptimized
                      sizes="(max-width: 600px) 100vw, (max-width: 960px) 50vw, 25vw"
                    />
                  ) : (
                    <span>{item.state.replaceAll("_", " ")}</span>
                  )}
                </span>
                <strong>{item.filename}</strong>
                <span>
                  {item.width && item.height
                    ? `${item.width} × ${item.height}`
                    : "Dimensions pending"}
                </span>
                <span>
                  {item.in_use
                    ? "Used in draft · alt choice saved"
                    : item.state === "READY"
                    ? selectedMediaId === item.id
                      ? "Selected · alt choice below"
                      : "READY"
                    : item.rejection_code ?? item.state.replaceAll("_", " ")}
                </span>
              </button>
              {item.state === "TOMBSTONED" ? (
                <button
                  type="button"
                  className="studio-text-button"
                  disabled={
                    busy ||
                    !isStudioMediaRecoverable(item.recoverable_until)
                  }
                  onClick={() => void restoreRemoved(item.id)}
                >
                  {isStudioMediaRecoverable(item.recoverable_until)
                    ? "Restore image"
                    : "Recovery ended"}
                </button>
              ) : (
                <button
                  type="button"
                  className="studio-text-button"
                  disabled={item.in_use || item.state !== "READY" || busy}
                  onClick={() => void removeUnused(item.id, item.in_use)}
                >
                  {item.in_use ? "Used in draft" : "Remove unused"}
                </button>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="studio-media-bind" aria-labelledby="media-bind-title">
        <p className="studio-eyebrow">Draft relationship</p>
        <h2 id="media-bind-title">Choose where to use it</h2>
        <label htmlFor="studio-media-target">Page and image location</label>
        <select
          id="studio-media-target"
          value={targetId}
          onChange={(event) => chooseTarget(event.target.value)}
        >
          <option value="">Choose a draft location</option>
          {library?.targets.map((target) => (
            <option key={target.id} value={target.id}>{target.label}</option>
          ))}
        </select>
        {selectedTarget ? (
          <fieldset className="studio-media-accessibility">
            <legend>Describe this image before using it</legend>
            <label htmlFor="studio-media-alt">Alt text</label>
            <input
              id="studio-media-alt"
              value={altText}
              disabled={decorative}
              onChange={(event) => setAltText(event.target.value)}
              placeholder="What is important in this image?"
              maxLength={240}
            />
            <label className="studio-checkbox">
              <input
                type="checkbox"
                checked={decorative}
                disabled={selectedTarget.decorativeOnly}
                onChange={(event) => {
                  setDecorative(event.target.checked);
                  if (event.target.checked) setAltText("");
                }}
              />
              This image is decorative and should be ignored by screen readers
            </label>
            {selectedTarget.decorativeOnly ? (
              <p className="studio-field-help">
                Hero artwork is decorative in Restaurant Website v1.
              </p>
            ) : null}
            {!canUse ? (
              <p className="studio-field-help">
                Choose a READY image and add useful alt text or mark it decorative.
              </p>
            ) : null}
          </fieldset>
        ) : null}
        <button
          className="studio-primary-button"
          type="button"
          disabled={!canUse || busy}
          onClick={() => void attach()}
        >
          Use in draft
        </button>
        {success ? <p className="studio-success" role="status">{success}</p> : null}
      </section>
    </main>
  );
}
