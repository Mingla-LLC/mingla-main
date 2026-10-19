/**
 * Issue #3697 — the Creative Library drop zone (design §8.1), shared by the
 * library and the Campaign Builder's video step (compact). It is one button:
 * click, Enter or Space opens the file dialog; files can also be dropped.
 * It only hands files over — the caller checks and uploads them.
 */

import { useId, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { dragSummary } from "./creativeLibraryModel";

function countDragged(dataTransfer) {
  const counts = { videos: 0, images: 0, other: 0 };
  for (const item of Array.from(dataTransfer?.items ?? [])) {
    if (item.kind !== "file") continue;
    if (item.type.startsWith("video/")) counts.videos += 1;
    else if (item.type.startsWith("image/")) counts.images += 1;
    else counts.other += 1;
  }
  return counts;
}

export function CreativeDropZone({
  onFiles,
  accept,
  multiple = true,
  compact = false,
  title,
  sub,
  ariaLabel = "Upload images or videos. Drop files here or press Enter to browse.",
  disabled = false,
}) {
  const inputRef = useRef(null);
  const subId = useId();
  const [drag, setDrag] = useState(null);
  const depth = useRef(0);

  const open = () => {
    if (!disabled) inputRef.current?.click();
  };
  const hand = (fileList) => {
    const files = Array.from(fileList ?? []);
    if (files.length > 0 && !disabled) onFiles(files);
  };
  const dragging = drag !== null;
  const summary = dragging ? dragSummary(drag) : null;

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-describedby={subId}
      aria-disabled={disabled || undefined}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        depth.current += 1;
        setDrag(countDragged(event.dataTransfer));
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDrag(null);
      }}
      onDrop={(event) => {
        event.preventDefault();
        depth.current = 0;
        setDrag(null);
        hand(event.dataTransfer?.files);
      }}
      className={[
        "flex cursor-pointer gap-4 rounded-2xl border-2 border-dashed",
        "transition-colors duration-150 motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2",
        compact
          ? "min-h-[72px] items-center px-4 py-3.5"
          : "min-h-[116px] flex-col items-start p-4 sm:flex-row sm:items-center sm:p-6",
        dragging
          ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
          : "border-[var(--gray-300)] bg-[var(--color-background-secondary)]",
        disabled ? "cursor-not-allowed opacity-60" : "",
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className={[
          "grid shrink-0 place-items-center rounded-xl transition-colors duration-150 motion-reduce:transition-none",
          compact ? "h-10 w-10" : "h-12 w-12",
          dragging
            ? "bg-[var(--color-brand-500)] text-white"
            : "bg-[var(--gray-100)] text-[var(--color-text-secondary)]",
        ].join(" ")}
      >
        <Upload className={compact ? "h-[18px] w-[18px]" : "h-[22px] w-[22px]"} />
      </span>
      <span className="min-w-0">
        <span className={`block font-semibold text-[var(--color-text-primary)] ${compact ? "text-sm" : "text-[15px]"}`}>
          {summary ? summary.title : title}
        </span>
        <span
          id={subId}
          className="mt-1 block whitespace-pre-line text-[12.5px] leading-normal text-[var(--color-text-tertiary-strong)]"
        >
          {summary ? summary.sub : sub}
        </span>
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          hand(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
