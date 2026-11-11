// #4382 Wave 2 — the support uploader: paste (Cmd+V), drop or choose up to
// 10 images, 10 MB each. Each thumbnail shows its progress, a Retry when it
// failed and a remove button. Clicking a thumbnail opens it full size.
import { useRef, useState } from "react";
import { ImagePlus, RotateCw, X } from "lucide-react";
import { ACCEPT_ATTRIBUTE, SUPPORT_UPLOAD_LIMITS } from "./supportUploadModel";
import { PhotoLightbox } from "../ui/PhotoLightbox";

export function UploadThumbnails({ uploads, disabled = false }) {
  const [open, setOpen] = useState(null);
  if (!uploads.items.length) return null;
  return (
    <>
      <ul className="flex flex-wrap gap-2" aria-label="Images to send">
        {uploads.items.map((item, index) => (
          <li key={item.localId} className="relative h-16 w-16">
            <button
              type="button"
              onClick={() => setOpen(index)}
              aria-label={`Open ${item.name}`}
              className="h-16 w-16 overflow-hidden rounded-lg border border-[var(--gray-200)] bg-[var(--gray-100)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
            >
              <img src={item.previewUrl} alt="" className={`h-full w-full object-cover ${item.status === "done" ? "" : "opacity-60"}`} />
            </button>
            {item.status !== "done" && item.status !== "error" && (
              <div className="pointer-events-none absolute inset-x-1 bottom-1 h-1.5 overflow-hidden rounded-full bg-white/70" role="progressbar" aria-label={`Uploading ${item.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress * 100)}>
                <div className="h-full bg-[var(--color-brand-500)] transition-[width] duration-300" style={{ width: `${Math.max(8, Math.round(item.progress * 100))}%` }} />
              </div>
            )}
            {item.status === "error" && (
              <button
                type="button"
                onClick={() => uploads.retry(item.localId)}
                disabled={disabled}
                title={item.error || "The upload didn't finish"}
                aria-label={`Retry ${item.name}: ${item.error || "the upload didn't finish"}`}
                className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 rounded-lg bg-[rgba(185,28,28,.78)] text-[10px] font-semibold text-white"
              >
                <RotateCw className="h-4 w-4" aria-hidden="true" />
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={() => uploads.remove(item.localId)}
              disabled={disabled}
              aria-label={`Remove ${item.name}`}
              className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-[var(--gray-300)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] shadow-sm hover:text-[var(--color-error-700)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {uploads.items.some((item) => item.status === "error") && (
        <p role="alert" className="mt-1 text-xs text-[var(--color-error-700)]">
          {uploads.items.find((item) => item.status === "error")?.error} Retry or remove it to continue.
        </p>
      )}
      {open !== null && (
        <PhotoLightbox photos={uploads.items.map((item) => item.previewUrl)} startIndex={open} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

/** The "Add images" button plus a hidden picker. */
export function AddImagesButton({ uploads, disabled = false, label = "Add images" }) {
  const inputRef = useRef(null);
  const full = uploads.items.length >= SUPPORT_UPLOAD_LIMITS.maxImages;
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        multiple
        hidden
        onChange={(event) => {
          uploads.addFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled || full}
        onClick={() => inputRef.current?.click()}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ImagePlus className="h-4 w-4" aria-hidden="true" />
        {full ? "10 images added" : label}
      </button>
    </>
  );
}

/** The full drop box used by the New ticket form. */
export function AttachmentDropZone({ uploads, disabled = false }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  return (
    <div className="space-y-2">
      <div
        onDragEnter={(event) => { event.preventDefault(); setOver(true); }}
        onDragOver={(event) => { event.preventDefault(); setOver(true); }}
        onDragLeave={(event) => { event.preventDefault(); setOver(false); }}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          if (!disabled && event.dataTransfer?.files) uploads.addFiles(event.dataTransfer.files);
        }}
        onPaste={uploads.onPaste}
        tabIndex={0}
        aria-label="Images: paste, drop or choose files"
        className={`rounded-xl border-2 border-dashed p-4 text-center text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] ${over ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]" : "border-[var(--gray-300)] bg-[var(--gray-50)]"}`}
      >
        <p className="text-[var(--color-text-primary)]">
          Paste with <kbd className="rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-1 text-xs">Cmd+V</kbd>, drop images here, or{" "}
          <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className="font-semibold text-[var(--color-brand-600)] underline-offset-2 hover:underline">
            choose files
          </button>
        </p>
        <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
          Up to 10 images, 10 MB each. Location data is removed before upload. {uploads.items.length} of 10.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          multiple
          hidden
          onChange={(event) => {
            uploads.addFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      {uploads.notice && <p role="status" className="text-xs text-[var(--color-warning-700)]">{uploads.notice}</p>}
      <UploadThumbnails uploads={uploads} disabled={disabled} />
    </div>
  );
}
