/**
 * Issue #3697 — Creative Library cards (design §8.2–§8.4) and the Campaign
 * Builder's video rows (design §9). Shared by AdEnginePage and StepCreative.
 *
 * Fit tiles are advice: "Use in campaign" never depends on them. The Builder
 * row (VideoPickRow) is the one place a misfit is blocked.
 * Invariant I-ADS-MISFIT-BLOCKED-IN-BUILDER (declared in mingla-admin/src/pages/__tests__/creativeLibraryFit.issue3697.test.js)
 */

import { useEffect, useId, useState } from "react";
import { Archive, Film, Image as ImageIcon, MoreHorizontal, Play, Trash2 } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dropdown } from "../ui/Dropdown";
import {
  cardFitTiles,
  durationBadge,
  fitSentence,
  purgeBlockedReason,
  ratioLabel,
  sourceLine,
  usageLine,
  useInCampaignState,
} from "./creativeLibraryModel";
import { formatClock, formatMegabytes } from "../../services/adminVideoUpload";

const TILE_CLASS = {
  fits: "border-[var(--gray-200)] text-[var(--color-success-700)]",
  warn: "border-[var(--gray-200)] text-[var(--color-warning-700)]",
  misfit: "border-transparent bg-[var(--color-error-50)] text-[var(--color-error-700)]",
};

function MediaBox({ media, children, dim = false, grey = false }) {
  return (
    <div className="relative aspect-[4/5] overflow-hidden bg-[var(--gray-100)]">
      <div className={`absolute inset-0 ${dim ? "opacity-60" : ""} ${grey ? "grayscale brightness-[.7]" : ""}`}>
        {media}
      </div>
      {children}
    </div>
  );
}

function Badges({ children }) {
  return <div className="absolute left-2 top-2 flex flex-wrap gap-1">{children}</div>;
}

function Scrim({ children }) {
  return (
    <>
      <div className="absolute inset-0 bg-[rgba(15,17,23,.55)]" aria-hidden="true" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center text-[13px] font-semibold text-white">
        {children}
      </div>
    </>
  );
}

function Spinner({ light = false, size = 16 }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={[
        "inline-block rounded-full border-2 motion-safe:animate-spin",
        light ? "border-white/30 border-t-white" : "border-[var(--gray-300)] border-t-[var(--color-brand-500)]",
      ].join(" ")}
    />
  );
}

function ProgressBar({ percent, frozen = false, label = "Upload progress" }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className="h-1 overflow-hidden rounded-full bg-[var(--gray-200)]"
    >
      <div
        className={`h-full origin-left transition-transform duration-200 ease-out motion-reduce:transition-none ${frozen ? "bg-[var(--gray-400)]" : "bg-[var(--color-brand-500)]"}`}
        style={{ transform: `scaleX(${Math.max(0, Math.min(100, percent)) / 100})` }}
      />
    </div>
  );
}

function CardShell({ labelledBy, children, muted = false }) {
  return (
    <article
      aria-labelledby={labelledBy}
      className={[
        "flex min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)]",
        "motion-safe:animate-[fade-in_200ms_ease-out]",
        muted ? "opacity-[.85]" : "",
      ].join(" ")}
    >
      {children}
    </article>
  );
}

function Footer({ note, children }) {
  return (
    <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--gray-100)] pt-2.5">
      <span className="text-[11.5px] text-[var(--color-text-tertiary-strong)]">{note}</span>
      <span className="flex shrink-0 gap-1.5">{children}</span>
    </div>
  );
}

function Poster({ src, video }) {
  if (src) return <img src={src} alt="" className="h-full w-full object-contain" />;
  return (
    <span className="grid h-full w-full place-items-center text-[var(--color-text-tertiary-strong)]">
      {video ? <Film className="h-8 w-8" aria-hidden="true" /> : <ImageIcon className="h-8 w-8" aria-hidden="true" />}
    </span>
  );
}

/** A finished library item: L-03 Ready, L-07 image, L-08 Host-only, L-09 Archived. */
export function CreativeCard({
  creative,
  purge,
  canManage,
  onUse,
  onPlay,
  onArchive,
  onRestore,
  onOpenMenu,
  onDelete,
}) {
  const nameId = useId();
  const reasonId = useId();
  const deleteReasonId = useId();
  const isVideo = creative.kind === "video";
  const archived = creative.status === "archived";
  const tiles = cardFitTiles(creative);
  const use = useInCampaignState(creative);
  const ratio = ratioLabel(creative.width, creative.height, creative.aspect_ratio);
  const blockedReason = purge?.blockers ? purgeBlockedReason(purge.blockers, creative) : null;
  const deleteReady = Boolean(purge?.blockers) && !blockedReason;

  return (
    <CardShell labelledBy={nameId} muted={archived}>
      <MediaBox dim={archived} media={<Poster src={creative.preview_url} video={isVideo} />}>
        <Badges>
          {archived && <Badge variant="default">Archived</Badge>}
          {isVideo
            ? <Badge variant="ink">Video · {durationBadge(creative.duration_seconds)}</Badge>
            : <Badge variant="ink">Image</Badge>}
          {ratio && <Badge variant="ink">{ratio}</Badge>}
          {creative.width && creative.height && isVideo && (
            <Badge variant="ink">{creative.width}×{creative.height}</Badge>
          )}
          {creative.house_reuse_allowed !== true && <Badge variant="brand">From host</Badge>}
        </Badges>
        {isVideo && creative.playback_url && (
          <button
            type="button"
            onClick={() => onPlay?.(creative)}
            aria-label={`Play ${creative.name}`}
            className="absolute left-1/2 top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/30 bg-[rgba(17,24,39,.6)] text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
          >
            <Play className="h-4 w-4 fill-white" aria-hidden="true" />
          </button>
        )}
      </MediaBox>
      <div className="flex flex-1 flex-col gap-2.5 p-3">
        <div className="min-w-0">
          <h4 id={nameId} className="truncate text-[13px] font-semibold leading-[18px] text-[var(--color-text-primary)]">
            {creative.name}
          </h4>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
            {archived
              ? `Archived${creative.archived_by_name ? ` by ${creative.archived_by_name}` : ""}${creative.archived_at ? ` · ${new Date(creative.archived_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}`
              : sourceLine(creative)}
          </p>
        </div>

        {archived ? (
          <p className="text-[13px] leading-[18px] text-[var(--color-text-secondary)]">
            Hidden from new campaigns.{" "}
            {Number(creative.usage?.active_campaign_count ?? 0) > 0
              ? `${creative.usage.active_campaign_count} running campaign${creative.usage.active_campaign_count === 1 ? "" : "s"} still use${creative.usage.active_campaign_count === 1 ? "s" : ""} it.`
              : "No running campaign uses it."}
          </p>
        ) : use.reason ? (
          <p id={reasonId} className="text-[13px] leading-[18px] text-[var(--color-text-secondary)]">{use.reason}</p>
        ) : null}

        {!archived && (
          <div className="grid grid-cols-2 gap-1.5" role="group" aria-label={fitSentence(tiles)}>
            {tiles.map((tile) => (
              <div
                key={tile.platform}
                aria-hidden="true"
                className={`min-w-0 rounded-lg border px-2 py-1.5 text-xs leading-4 ${TILE_CLASS[tile.state]}`}
              >
                <b className="flex items-center gap-1 font-semibold">{tile.symbol} {tile.name}</b>
                <span className="mt-px block text-[var(--color-text-secondary)]">{tile.reason}</span>
              </div>
            ))}
          </div>
        )}

        <Footer note={archived ? "Shown under Archived only" : usageLine(creative)}>
          {archived ? (
            canManage && <Button size="sm" variant="secondary" onClick={() => onRestore?.(creative)}>Restore</Button>
          ) : (
            use.shown && (
              <Button
                size="sm"
                variant="secondary"
                aria-disabled={use.disabled || undefined}
                aria-describedby={use.disabled ? reasonId : undefined}
                className={use.disabled ? "cursor-not-allowed opacity-50" : ""}
                onClick={() => {
                  if (!use.disabled) onUse?.(creative);
                }}
              >
                Use in campaign
              </Button>
            )
          )}
          {canManage && (
            <Dropdown
              trigger={
                <span
                  aria-label={`More actions for ${creative.name}`}
                  onClick={() => onOpenMenu?.(creative)}
                  className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]"
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </span>
              }
            >
              {(close) => (
                <div className="w-[260px]">
                  {!archived && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { close(); onArchive?.(creative); }}
                      className="flex w-full items-start gap-2 rounded-lg px-2.5 py-[9px] text-left text-[13.5px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand-500)]"
                    >
                      <Archive className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>
                        Archive
                        <small className="mt-0.5 block text-xs font-normal leading-snug text-[var(--color-text-tertiary-strong)]">
                          Hide from new campaigns. Nothing is deleted.
                        </small>
                      </span>
                    </button>
                  )}
                  {isVideo && (
                    <button
                      type="button"
                      role="menuitem"
                      aria-disabled={!deleteReady || undefined}
                      aria-describedby={deleteReasonId}
                      onClick={() => {
                        if (!deleteReady) return;
                        close();
                        onDelete?.(creative);
                      }}
                      className={[
                        "flex w-full items-start gap-2 rounded-lg px-2.5 py-[9px] text-left text-[13.5px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand-500)]",
                        deleteReady
                          ? "text-[var(--color-error-700)] hover:bg-[var(--color-error-50)]"
                          : "cursor-not-allowed text-[var(--color-text-tertiary-strong)]",
                      ].join(" ")}
                    >
                      <Trash2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>
                        Delete permanently
                        <small id={deleteReasonId} className="mt-0.5 block text-xs font-normal leading-snug text-[var(--color-text-tertiary-strong)]">
                          {purge?.loading
                            ? "Checking what uses it…"
                            : purge?.error
                              ? purge.error
                              : !purge?.blockers
                                ? "Checking what uses it…"
                                : blockedReason ?? "Not used by any campaign. Removes the file from Mingla."}
                        </small>
                      </span>
                    </button>
                  )}
                </div>
              )}
            </Dropdown>
          )}
        </Footer>
      </div>
    </CardShell>
  );
}

/**
 * An upload that is not a library item yet: L-00 Waiting, L-01 Uploading,
 * L-01o Offline, L-02 Preparing, L-05 Failed, L-06 Needs file.
 */
/** A clock that ticks once a second while `running` (for the elapsed timer). */
function useTickingNow(running) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return nowMs;
}

export function UploadCard({ entry, onCancel, onRetry, onRemove, onChooseFile, onCheckAgain }) {
  const nameId = useId();
  const nowMs = useTickingNow(["preparing", "saving"].includes(entry.phase));
  const percent = Math.max(0, Math.min(100, Number(entry.percent ?? 0)));
  const total = Number(entry.totalBytes ?? entry.size ?? 0);
  const sent = Number(entry.confirmedBytes ?? 0);
  const preparingFor = entry.sourceUploadedAt ? nowMs - Date.parse(entry.sourceUploadedAt) : entry.preparingSince ? nowMs - entry.preparingSince : 0;
  const slow = entry.phase === "preparing" && preparingFor > 120_000;
  const failed = entry.phase === "failed";
  const needsFile = entry.phase === "needs_file";
  const uploading = ["uploading", "offline", "reconnecting", "checking", "starting", "confirming"].includes(entry.phase);
  const preparing = ["preparing", "saving"].includes(entry.phase);

  const poster = entry.previewUrl
    ? <video src={entry.previewUrl} muted preload="metadata" className="h-full w-full object-contain" aria-hidden="true" />
    : <Poster src={entry.posterUrl} video />;

  let centre = null;
  if (entry.phase === "waiting") centre = <span>Waiting to upload</span>;
  else if (entry.phase === "checking" || entry.phase === "starting") centre = <><Spinner light size={22} /><span>Checking file</span></>;
  else if (entry.phase === "confirming") centre = <><Spinner light size={22} /><span>Confirming upload</span></>;
  else if (uploading) centre = <span>Uploading {Math.floor(percent)}%</span>;
  else if (entry.phase === "saving") centre = <><Spinner light size={22} /><span>Saving to the library</span></>;
  else if (preparing) centre = <><Spinner light size={22} /><span>Preparing video…</span></>;

  return (
    <CardShell labelledBy={nameId}>
      <MediaBox grey={failed} media={poster}>
        {(centre || needsFile) && <Scrim>{centre}</Scrim>}
        <Badges>
          {failed && <Badge variant="error">Failed</Badge>}
          {needsFile && <Badge variant="warning">{entry.lastPercent ? `Paused at ${Math.floor(entry.lastPercent)}%` : "Paused"}</Badge>}
          {!failed && !needsFile && entry.durationMs ? <Badge variant="ink">Video · {formatClock(entry.durationMs)}</Badge> : null}
        </Badges>
        {(uploading || needsFile) && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/25" aria-hidden="true">
            <div
              className={`h-full ${needsFile || entry.phase === "offline" ? "bg-[var(--gray-400)]" : "bg-[var(--color-brand-500)]"}`}
              style={{ width: `${needsFile ? entry.lastPercent ?? 0 : percent}%` }}
            />
          </div>
        )}
      </MediaBox>
      <div className="flex flex-1 flex-col gap-2.5 p-3">
        <div className="min-w-0">
          <h4 id={nameId} className="truncate text-[13px] font-semibold leading-[18px] text-[var(--color-text-primary)]">{entry.name}</h4>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Uploaded by you</p>
        </div>

        {uploading && entry.phase !== "checking" && entry.phase !== "starting" && (
          <>
            <ProgressBar percent={percent} frozen={entry.phase === "offline"} />
            <div className="flex justify-between text-xs tabular-nums text-[var(--color-text-tertiary-strong)]" aria-live="polite">
              {entry.phase === "offline" ? (
                <span className="text-[var(--color-warning-700)]">Paused — reconnect to continue</span>
              ) : (
                <>
                  <span>{formatMegabytes(sent)} of {formatMegabytes(total)} MB</span>
                  <span>{entry.phase === "reconnecting" ? "Reconnecting…" : entry.secondsLeft ? `About ${entry.secondsLeft} s left` : ""}</span>
                </>
              )}
            </div>
          </>
        )}
        {preparing && (
          <p className={`text-[13px] leading-[18px] ${slow ? "text-[var(--color-warning-700)]" : "text-[var(--color-text-secondary)]"}`} aria-live="polite">
            {slow
              ? "Taking longer than usual · we're on it"
              : entry.phase === "saving"
                ? "Checking how it fits each platform"
                : `Usually under a minute · ${formatClock(preparingFor)} so far`}
          </p>
        )}
        {failed && (
          <p role="alert" className="text-[13px] leading-[18px] text-[var(--color-error-700)]">
            <b>Couldn&apos;t prepare this video.</b> {entry.error ?? "The file may be damaged. Try exporting it again as MP4 under 100 MB."}
          </p>
        )}
        {needsFile && (
          <p role="alert" className="text-[13px] leading-[18px] text-[var(--color-warning-700)]">
            This tab was closed before the upload finished. Choose the same file to finish it.
          </p>
        )}

        <Footer
          note={
            entry.phase === "waiting"
              ? ""
              : uploading
                ? "Keep this tab open, or come back to resume"
                : preparing
                  ? "Not selectable until ready"
                  : ""
          }
        >
          {(entry.phase === "waiting" || uploading || preparing) && (
            <>
              {slow && <Button size="sm" variant="secondary" onClick={() => onCheckAgain?.(entry)}>Check again</Button>}
              <Button size="sm" variant="ghost" onClick={() => onCancel?.(entry)}>Cancel</Button>
            </>
          )}
          {failed && (
            <>
              <Button size="sm" variant="ghost" onClick={() => onRemove?.(entry)}>Remove</Button>
              <Button size="sm" variant="secondary" onClick={() => onRetry?.(entry)}>Retry</Button>
            </>
          )}
          {needsFile && (
            <>
              <Button size="sm" variant="ghost" onClick={() => onRemove?.(entry)}>Remove</Button>
              <Button size="sm" variant="secondary" onClick={() => onChooseFile?.(entry)}>Choose file</Button>
            </>
          )}
        </Footer>
      </div>
    </CardShell>
  );
}

/** A Builder video row (design §9). `state` comes from builderVideoRow(). */
export function VideoPickRow({ row, state, selected, onSelect, onChangePlatforms, upload, onCancelUpload, onRetry }) {
  const reasonId = useId();
  const blocked = Boolean(state && !state.selectable);
  const ratio = row ? ratioLabel(row.width, row.height, row.aspect_ratio) : null;
  const meta = row
    ? [durationBadge(row.duration_seconds), ratio, row.width && row.height ? `${row.width}×${row.height}` : null]
      .filter(Boolean)
      .join(" · ")
    : null;

  if (upload) {
    const failed = upload.phase === "failed";
    const uploadingNow = ["uploading", "offline", "reconnecting", "confirming", "checking", "starting", "waiting"].includes(upload.phase);
    return (
      <div className="flex min-w-0 items-center gap-3 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-2">
        <span className="h-5 w-5 shrink-0 rounded-full border-2 border-[var(--gray-300)]" aria-hidden="true" />
        <span className={`h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-[var(--gray-100)] ${failed ? "grayscale" : ""}`} aria-hidden="true">
          {upload.previewUrl && <video src={upload.previewUrl} muted preload="metadata" className="h-full w-full object-cover" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{upload.name}</span>
          {failed ? (
            <span className="mt-1 block text-xs leading-[1.45] text-[var(--color-error-700)]">Couldn&apos;t prepare this video.</span>
          ) : uploadingNow ? (
            <>
              <span className="mt-0.5 block text-xs text-[var(--color-text-secondary)]">
                {upload.phase === "waiting"
                  ? "Waiting to upload"
                  : `Uploading ${Math.floor(upload.percent ?? 0)}% · ${formatMegabytes(upload.confirmedBytes ?? 0)} of ${formatMegabytes(upload.totalBytes ?? upload.size ?? 0)} MB`}
              </span>
              <span className="mt-1.5 block"><ProgressBar percent={upload.percent ?? 0} /></span>
            </>
          ) : (
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
              <Spinner /> Preparing video… usually under a minute
            </span>
          )}
        </span>
        {failed
          ? <Button size="sm" variant="secondary" onClick={() => onRetry?.(upload)}>Retry</Button>
          : uploadingNow && <Button size="sm" variant="ghost" onClick={() => onCancelUpload?.(upload)}>Cancel</Button>}
      </div>
    );
  }

  return (
    <div
      role="radio"
      tabIndex={0}
      aria-checked={selected}
      aria-disabled={blocked || undefined}
      aria-describedby={blocked ? reasonId : undefined}
      onClick={() => {
        if (!blocked) onSelect?.(row);
      }}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !blocked) {
          event.preventDefault();
          onSelect?.(row);
        }
      }}
      className={[
        "flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border p-2 text-left",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]",
        selected
          ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
          : blocked
            ? "cursor-not-allowed border-[var(--gray-200)] bg-[var(--gray-50)]"
            : "border-[var(--gray-200)] bg-[var(--color-background-primary)] hover:bg-[var(--gray-50)]",
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className={[
          "h-5 w-5 shrink-0 rounded-full",
          selected ? "border-[6px] border-[var(--color-brand-500)]" : `border-2 border-[var(--gray-300)] ${blocked ? "border-dashed" : ""}`,
        ].join(" ")}
      />
      <span className={`h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-[var(--gray-100)] ${blocked ? "grayscale brightness-75" : ""}`} aria-hidden="true">
        {row.preview_url && <img src={row.preview_url} alt="" className="h-full w-full object-cover" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{row.name}</span>
        <span className="mt-0.5 block text-xs text-[var(--color-text-secondary)]">
          {meta}{selected ? " · Selected" : ""}
        </span>
        {selected && state?.fitsLine && (
          <span className="mt-0.5 block text-xs font-semibold text-[var(--color-success-700)]">{state.fitsLine}</span>
        )}
        {blocked && (
          <span id={reasonId} className="mt-1 block text-xs leading-[1.45] text-[var(--color-error-700)]">
            {state.reason}{" "}
            <button
              type="button"
              className="font-semibold text-[var(--color-brand-700)] hover:underline"
              onClick={(event) => {
                event.stopPropagation();
                onChangePlatforms?.();
              }}
            >
              Change platforms
            </button>{" "}
            or pick another video.
          </span>
        )}
      </span>
    </div>
  );
}
