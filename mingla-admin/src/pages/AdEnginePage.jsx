/**
 * Admin Ads control center.
 *
 * Provider connections, app readiness, and preflight live here. All campaign
 * creation goes through the immutable-plan Campaign Builder; all lifecycle,
 * spend, and reporting actions live on Campaigns. This page intentionally has
 * no quick-create or direct-launch bypass.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Megaphone, RefreshCw, Rocket, Upload } from "lucide-react";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Spinner } from "../components/ui/Spinner";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { SearchInput } from "../components/ui/SearchInput";
import { useToast } from "../context/ToastContext";
import { loadFeatureFlags } from "../lib/featureFlags";
import { invokeWithRefresh } from "../lib/supabase";
import { AdConnectionsPanel } from "../components/AdConnectionsPanel";
import { AppDownloadReadinessPanel } from "../components/app-readiness/AppDownloadReadinessPanel";
import { CreativeDropZone } from "../components/ad-engine/CreativeDropZone";
import { CreativeCard, UploadCard } from "../components/ad-engine/CreativeCard";
import { useAdminVideoUploads } from "../components/ad-engine/useAdminVideoUploads";
import {
  LIBRARY_FILTERS,
  canManageLifecycle,
  libraryBodyState,
  libraryFilter,
  libraryRequest,
  libraryViewKey,
  loadWithDeadline,
  refusalTitle,
  visibleLibraryRows,
} from "../components/ad-engine/creativeLibraryModel";
import { ADMIN_VIDEO_ACCEPT, formatMegabytes, isVideoFile } from "../services/adminVideoUpload";
import { precheckImageFile, uploadAdImage } from "../services/mediaUpload";
import {
  archiveCreative,
  checkCreativePurge,
  creativeUpload,
  listAdCreatives,
  loadAdsOperationsOverview,
  parseEdgeError,
  purgeCreative,
  runPreflight,
  unarchiveCreative,
} from "../services/adEngineService";
import { PageHeader } from "../components/ui/PageHeader";
import { Tabs } from "../components/ui/Tabs";
import { CampaignsPage } from "./CampaignsPage";

const PREFLIGHT_BADGE = {
  green: "success",
  amber: "warning",
  red: "error",
  not_connected: "default",
};

const ADS_TABS = [
  { id: "overview", label: "Overview" },
  { id: "campaigns", label: "Campaigns" },
  { id: "creative-library", label: "Creative Library" },
  { id: "connections", label: "Connections" },
];

const AD_PLATFORMS = ["meta", "tiktok", "snapchat", "google", "reddit"];

function sentenceCase(value) {
  return String(value ?? "")
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function tabFromHash() {
  const query = window.location.hash.split("?")[1] ?? "";
  const requested = new URLSearchParams(query).get("tab") ?? "overview";
  return ADS_TABS.some((tab) => tab.id === requested) ? requested : "overview";
}

function formatMinor(currency, minor) {
  if (!/^[A-Z]{3}$/.test(currency ?? "") || !Number.isFinite(Number(minor))) {
    return "—";
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(Number(minor) / 100);
  } catch {
    return `${currency} ${(Number(minor) / 100).toFixed(2)}`;
  }
}

function evidenceVariant(state) {
  if (state === "current" || state === "verified") return "success";
  if (state === "not_required") return "default";
  if (state === "missing" || state === "needs_attention") return "error";
  return "warning";
}

function observedAtLabel(value) {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString()
    : "not observed";
}

function AdsOperationsOverview({ onOpenCampaigns, onOpenConnections }) {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await loadAdsOperationsOverview();
    setSnapshot(loadError ? null : data);
    setError(loadError?.message ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Initial server snapshot; state transitions live inside the async loader.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (loading && !snapshot) {
    return (
      <SectionCard title="Operations snapshot">
        <div className="flex items-center gap-2 py-4">
          <Spinner size="sm" /> Loading governed Ads evidence…
        </div>
      </SectionCard>
    );
  }

  if (error) {
    return (
      <AlertCard variant="error" title="Ads operations snapshot unavailable">
        <p>{error}</p>
        <Button className="mt-3" size="sm" variant="secondary" onClick={load}>
          Retry
        </Button>
      </AlertCard>
    );
  }

  const campaigns = snapshot?.campaigns ?? {};
  const queues = snapshot?.queues ?? {};
  const delivery = snapshot?.delivery_evidence ?? {};
  const connections = snapshot?.connections ?? [];
  const connectionByPlatform = new Map(
    connections.map((connection) => [connection.platform, connection]),
  );
  const alertCount =
    Number(campaigns.needs_attention ?? 0) +
    Number(queues.staff_review ?? 0) +
    Number(queues.mingla_recovery ?? 0) +
    Number(queues.settlement_attention ?? 0);

  return (
    <>
      <SectionCard
        title="Operations snapshot"
        subtitle="Live evidence from campaigns, queues, provider connections, spend and attributed results."
        action={
          <Button
            size="sm"
            variant="secondary"
            icon={RefreshCw}
            loading={loading}
            onClick={load}
          >
            Refresh
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ["All campaigns", campaigns.total ?? 0],
            ["Live", campaigns.live ?? 0],
            ["Paused", campaigns.paused ?? 0],
            ["Ended", campaigns.ended ?? 0],
            ["Needs attention", campaigns.needs_attention ?? 0],
          ].map(([label, value]) => (
            <button
              type="button"
              key={label}
              className="rounded-xl border border-[var(--gray-200)] p-3 text-left hover:border-[var(--color-brand-500)]"
              onClick={onOpenCampaigns}
            >
              <div className="text-xs uppercase text-[var(--color-text-tertiary)]">
                {label}
              </div>
              <div className="mt-1 text-2xl font-semibold">{value}</div>
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Action queue"
        subtitle="Every count links to the governed campaign workspace; no provider action runs from this summary."
      >
        {alertCount === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            No campaign, review, recovery or settlement action is currently
            recorded.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            {[
              ["Campaign attention", campaigns.needs_attention ?? 0],
              ["Staff review", queues.staff_review ?? 0],
              ["Create recovery", queues.mingla_recovery ?? 0],
              ["Settlement attention", queues.settlement_attention ?? 0],
            ].map(([label, value]) => (
              <button
                type="button"
                key={label}
                className="flex items-center justify-between rounded-xl border border-[var(--gray-200)] p-3 text-left hover:border-[var(--color-brand-500)]"
                onClick={onOpenCampaigns}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <AlertTriangle size={15} /> {label}
                </span>
                <Badge variant={Number(value) > 0 ? "warning" : "default"}>
                  {value}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SectionCard
          title="Spend by provider currency"
          subtitle="Currencies are separated and never cross-summed. A missing feed stays visibly empty."
        >
          {(snapshot?.spend_by_currency ?? []).length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)]">
              No provider spend has been observed yet.
            </p>
          ) : (
            <div className="space-y-2">
              {snapshot.spend_by_currency.map((row) => (
                <div
                  key={row.currency}
                  className="flex items-center justify-between rounded-lg border border-[var(--gray-200)] p-3"
                >
                  <div>
                    <div className="font-semibold">
                      {formatMinor(row.currency, row.spend_cents)}
                    </div>
                    <div className="text-xs text-[var(--color-text-secondary)]">
                      {Number(row.impressions ?? 0).toLocaleString()}{" "}
                      impressions · {Number(row.clicks ?? 0).toLocaleString()}{" "}
                      clicks
                    </div>
                  </div>
                  <Badge>{row.currency}</Badge>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Attributed results"
          subtitle="Recorded Mingla outcomes only; result value remains separated by source currency."
        >
          <div className="text-2xl font-semibold">
            {Number(snapshot?.results?.total ?? 0).toLocaleString()}
          </div>
          <div className="mb-3 text-xs uppercase text-[var(--color-text-tertiary)]">
            total attributed results
          </div>
          <div className="flex flex-wrap gap-2">
            {(snapshot?.results?.by_type ?? []).map((row) => (
              <Badge key={row.event_type} variant="info">
                {sentenceCase(row.event_type)} · {row.count}
              </Badge>
            ))}
          </div>
          {(snapshot?.results?.value_by_currency ?? []).length > 0 && (
            <div className="mt-3 space-y-1 text-sm">
              {snapshot.results.value_by_currency.map((row) => (
                <div key={row.currency} className="flex justify-between gap-3">
                  <span>{row.currency} attributed value</span>
                  <strong>{formatMinor(row.currency, row.value_cents)}</strong>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Provider and automation evidence"
        subtitle="Verification and delivery freshness come from recorded provider observations. This does not claim the external scheduler configuration was inspected."
        action={
          <Button size="sm" variant="secondary" onClick={onOpenConnections}>
            Manage connections
          </Button>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--gray-50)] p-3 text-sm">
          <span className="font-medium">Delivery evidence</span>
          <Badge variant={evidenceVariant(delivery.evidence_state)}>
            {sentenceCase(delivery.evidence_state)}
          </Badge>
          <span className="text-[var(--color-text-secondary)]">
            {Number(delivery.active_campaigns ?? 0)} active ·{" "}
            {Number(delivery.missing_spend_campaigns ?? 0)} missing spend feed ·{" "}
            {Number(delivery.stale_campaigns ?? 0)} stale
          </span>
          <span className="basis-full text-xs text-[var(--color-text-tertiary)]">
            Status observed {observedAtLabel(delivery.latest_status_synced_at)}{" "}
            · Spend observed {observedAtLabel(delivery.latest_spend_synced_at)}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
          {AD_PLATFORMS.map((platform) => {
            const connection = connectionByPlatform.get(platform);
            const state = connection?.verification_state ?? "not_connected";
            return (
              <button
                type="button"
                key={platform}
                className="rounded-lg border border-[var(--gray-200)] p-3 text-left hover:border-[var(--color-brand-500)]"
                onClick={onOpenConnections}
              >
                <div className="font-medium">{sentenceCase(platform)}</div>
                <Badge className="mt-2" variant={evidenceVariant(state)}>
                  {sentenceCase(state)}
                </Badge>
                <div className="mt-2 text-xs text-[var(--color-text-secondary)]">
                  {connection?.currency ?? "Currency unavailable"}
                </div>
                <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
                  Verified {observedAtLabel(connection?.token_last_verified_at)}
                </div>
              </button>
            );
          })}
        </div>
      </SectionCard>
    </>
  );
}

// ── Issue #3697 — Creative Library (design §8) ───────────────────────────────
// Upload once, reuse in any campaign. Videos go through the shared #3040 lane
// (useAdminVideoUploads → services/adminVideoUpload.js → packages/video-upload);
// the library row is made by the server from the finished job. Removing a
// creative means archiving it; "Delete permanently" is guarded by the server.

const IMAGE_ACCEPT = "image/jpeg,image/png";
const LIBRARY_ACCEPT = `${IMAGE_ACCEPT},${ADMIN_VIDEO_ACCEPT}`;
const DROP_SUB =
  "Images: JPG or PNG · Under 30 MB\nVideos: MP4, MOV, M4V or WebM · 5 seconds to 1 minute · Under 100 MB";

function imageRefusal(file) {
  const problems = precheckImageFile(file);
  if (problems.length === 0) return null;
  if (file.size > 30 * 1024 * 1024) {
    return `${file.name} is ${formatMegabytes(file.size)} MB. Images must be under 30 MB.`;
  }
  return `${file.name} isn't a supported type.`;
}

function CreativeLibraryPanel() {
  const { addToast } = useToast();
  const [filterId, setFilterId] = useState("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [rows, setRows] = useState(null);
  // #3697 — the view (chip + search) the rows were loaded for. The body shows
  // "Loading" only while this differs from the selected view, so every load
  // ends in content, empty or an error.
  const [rowsKey, setRowsKey] = useState(null);
  const [pending, setPending] = useState([]);
  const [counts, setCounts] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [error, setError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refusals, setRefusals] = useState([]);
  const [imageUploads, setImageUploads] = useState(0);
  const [purge, setPurge] = useState({});
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletePhrase, setDeletePhrase] = useState("");
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [hidden, setHidden] = useState(() => new Set());
  const uploadInputRef = useRef(null);
  const fileForRef = useRef(null);
  const requestRef = useRef(0);

  const filter = libraryFilter(filterId);
  const viewKey = libraryViewKey(filter.id, debouncedQuery);

  const load = useCallback(async ({ append = false, before = null } = {}) => {
    const request = (requestRef.current += 1);
    const key = libraryViewKey(filter.id, debouncedQuery);
    if (!append) setError(null);
    // #3697 — a deadline, so a request that never answers ends in an error
    // with Retry instead of "Loading creatives…" forever.
    const { data, error: loadError } = await loadWithDeadline(() =>
      listAdCreatives(libraryRequest(filter.id, debouncedQuery, before)),
    );
    if (request !== requestRef.current) return;
    if (loadError) {
      const parsed = loadError.timeout ? loadError : await parseEdgeError(loadError);
      setError(String(parsed?.message ?? "The Creative Library could not be loaded."));
      if (!append) {
        setRows([]);
        setRowsKey(key);
      }
      return;
    }
    setRows((current) => (append ? [...(current ?? []), ...(data?.creatives ?? [])] : data?.creatives ?? []));
    if (!append) {
      setRowsKey(key);
      setPending(data?.pending ?? []);
      // A fresh server answer replaces this view's optimistic removals.
      setHidden(new Set());
    }
    setCounts(data?.counts ?? null);
    setCursor(data?.next_cursor ?? null);
  }, [filter, debouncedQuery]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    // Server snapshot; state transitions live inside the async loader.
    void load();
  }, [load]);

  const uploads = useAdminVideoUploads({
    onFinished: ({ name }) => {
      addToast({ variant: "success", title: "Video ready", description: `${name} is in the library.` });
      void load();
    },
  });

  // In-flight uploads from another tab or browser: refresh while any exist.
  useEffect(() => {
    if (pending.length === 0) return undefined;
    const timer = setInterval(() => void load(), 10000);
    return () => clearInterval(timer);
  }, [pending.length, load]);

  const localOps = new Set(uploads.entries.map((entry) => entry.record?.opId).filter(Boolean));
  const serverOnly = filter.id === "all" || filter.id === "videos"
    ? pending.filter((item) => !localOps.has(item.clientOperationId))
    : [];
  const showUploads = filter.id === "all" || filter.id === "videos";

  const addFiles = async (files) => {
    setRefusals([]);
    const lines = [];
    const images = [];
    const videos = [];
    for (const file of files) {
      if (isVideoFile(file)) videos.push(file);
      else if (String(file.type).startsWith("image/")) {
        const refusal = imageRefusal(file);
        if (refusal) lines.push(refusal);
        else images.push(file);
      } else {
        lines.push(`${file.name} isn't a supported type.`);
      }
    }
    const result = await uploads.addVideos(videos);
    lines.push(...result.refusals);
    setRefusals(lines);
    if (images.length > 0) void uploadImages(images);
  };

  const uploadImages = async (images) => {
    setImageUploads((n) => n + images.length);
    for (const file of images) {
      try {
        const { publicUrl, path } = await uploadAdImage(file);
        const { error: recordError } = await creativeUpload({
          action: "record",
          kind: "image",
          name: file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 120) || "Image",
          source_url: publicUrl,
          storage_bucket: "meta-ad-creatives",
          storage_path: path,
        });
        if (recordError) {
          const parsed = await parseEdgeError(recordError);
          throw new Error(String(parsed?.message ?? "The image could not be added."));
        }
      } catch (uploadError) {
        addToast({ variant: "error", title: `${file.name} wasn't added`, description: uploadError.message });
      } finally {
        setImageUploads((n) => n - 1);
      }
    }
    void load();
  };

  const openPicker = (forEntry = null) => {
    fileForRef.current = forEntry;
    uploadInputRef.current?.click();
  };

  const onPickerFiles = (fileList) => {
    const files = Array.from(fileList ?? []);
    const target = fileForRef.current;
    fileForRef.current = null;
    if (files.length === 0) return;
    if (target?.serverItem) uploads.adopt(target.serverItem, files[0]);
    else if (target?.localId) uploads.chooseFileFor(target, files[0]);
    else void addFiles(files);
  };

  const checkPurge = async (creative) => {
    if (creative.kind !== "video") return;
    setPurge((current) => ({ ...current, [creative.id]: { loading: true } }));
    const { data, error: checkError } = await checkCreativePurge(creative.id);
    if (checkError) {
      const parsed = await parseEdgeError(checkError);
      setPurge((current) => ({
        ...current,
        [creative.id]: { error: String(parsed?.message ?? "Couldn't check what uses it. Try again.") },
      }));
      return;
    }
    setPurge((current) => ({ ...current, [creative.id]: { blockers: data?.blockers ?? [] } }));
  };

  const hide = (id) => setHidden((current) => new Set([...current, id]));
  const unhide = (id) =>
    setHidden((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });

  const confirmArchive = async () => {
    const target = archiveTarget;
    setArchiving(true);
    const { error: archiveError } = await archiveCreative(target.id);
    setArchiving(false);
    if (archiveError) {
      const parsed = await parseEdgeError(archiveError);
      addToast({ variant: "error", title: "Couldn't archive it", description: String(parsed?.message ?? "Try again.") });
      return;
    }
    setArchiveTarget(null);
    hide(target.id);
    addToast({
      variant: "success",
      title: "Archived. Running ads aren't affected.",
      duration: 6000,
      action: {
        label: "Undo",
        onClick: async () => {
          const { error: undoError } = await unarchiveCreative(target.id);
          if (undoError) {
            addToast({ variant: "error", title: "Couldn't undo the archive", description: "Restore it from Archived." });
            return;
          }
          unhide(target.id);
          void load();
        },
      },
    });
    void load();
  };

  const restore = async (creative) => {
    const { error: restoreError } = await unarchiveCreative(creative.id);
    if (restoreError) {
      const parsed = await parseEdgeError(restoreError);
      addToast({ variant: "error", title: "Couldn't restore it", description: String(parsed?.message ?? "Try again.") });
      return;
    }
    hide(creative.id);
    addToast({ variant: "success", title: "Restored. It's available for new campaigns again." });
    void load();
  };

  const confirmDelete = async () => {
    const target = deleteTarget;
    setDeleting(true);
    setDeleteError(null);
    const { error: purgeError } = await purgeCreative(target.id);
    setDeleting(false);
    if (purgeError) {
      const parsed = await parseEdgeError(purgeError);
      if (parsed?.body?.error === "creative_in_use") {
        setDeleteError("Something started using this video. Archive it instead.");
        setPurge((current) => ({ ...current, [target.id]: { blockers: parsed.body.blockers ?? ["campaign"] } }));
        return;
      }
      if (parsed?.body?.removed_from_library) {
        // Gone from the library (immutable record kept); the file delete is
        // retryable on its own.
        setDeleteTarget(null);
        setDeletePhrase("");
        hide(target.id);
        addToast({
          variant: "warning",
          title: "Removed from the library",
          description: "The video file couldn't be deleted yet. Try again in a moment.",
          action: { label: "Try again", onClick: () => void retryFileDelete(target) },
        });
        void load();
        return;
      }
      setDeleteError(String(parsed?.message ?? "Couldn't delete it. Try again."));
      return;
    }
    setDeleteTarget(null);
    setDeletePhrase("");
    hide(target.id);
    addToast({ variant: "success", title: "Deleted permanently." });
    void load();
  };

  const retryFileDelete = async (target) => {
    const { error: retryError } = await purgeCreative(target.id);
    if (retryError) {
      addToast({
        variant: "error",
        title: "The video file still couldn't be deleted",
        description: "It stays out of the library. Try again later.",
        action: { label: "Try again", onClick: () => void retryFileDelete(target) },
      });
      return;
    }
    addToast({ variant: "success", title: "Deleted permanently." });
  };

  const requestCancel = (entry) => {
    if (Number(entry.percent ?? 0) >= 50) {
      setCancelTarget(entry);
      return;
    }
    void cancelUpload(entry);
  };

  const cancelUpload = async (entry) => {
    setCancelTarget(null);
    try {
      if (entry.serverItem) await createAdminVideoUploaderCancel(entry.serverItem.jobId);
      else await uploads.cancel(entry);
      void load();
    } catch (cancelError) {
      addToast({ variant: "error", title: "Couldn't cancel the upload", description: cancelError.message });
    }
  };

  const createAdminVideoUploaderCancel = async (jobId) => {
    const { error: cancelError } = await invokeWithRefresh("event-cover-video-cancel", { body: { jobId } });
    if (cancelError) {
      const parsed = await parseEdgeError(cancelError);
      throw new Error(String(parsed?.message ?? "Try again."));
    }
  };

  // L-06: the picked file is not the one the paused upload started with.
  const differentEntry = uploads.entries.find((entry) => entry.differentFile) ?? null;

  const visibleRows = visibleLibraryRows(rows, hidden);
  const bodyState = libraryBodyState({
    error,
    rowsKey,
    viewKey,
    empty: visibleRows.length === 0 && (!showUploads || (uploads.entries.length === 0 && serverOnly.length === 0)),
  });

  return (
    <SectionCard
      title="Creative Library"
      subtitle="Upload once, reuse in any campaign. Each video shows which platforms it fits."
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="md"
            icon={Rocket}
            onClick={() => {
              window.location.hash = "#/campaign-builder?step=creative";
            }}
          >
            Build a campaign
          </Button>
          <Button variant="brandContrast" icon={Upload} onClick={() => openPicker()}>
            Upload media
          </Button>
        </div>
      }
    >
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        accept={LIBRARY_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          onPickerFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <CreativeDropZone
        accept={LIBRARY_ACCEPT}
        onFiles={(files) => void addFiles(files)}
        title={
          <>
            Drop images or videos here, or{" "}
            <u className="text-[var(--color-brand-700)] underline-offset-[3px]">browse</u>
          </>
        }
        sub={DROP_SUB}
      />

      {refusals.length > 0 && (
        <div role="alert" className="mt-3">
          <AlertCard variant="error" title={refusalTitle(refusals.length)}>
            <ul className="space-y-0.5">
              {refusals.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </AlertCard>
        </div>
      )}
      {imageUploads > 0 && (
        <p className="mt-3 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]" aria-live="polite">
          <Spinner size="sm" /> Adding {imageUploads} image{imageUploads === 1 ? "" : "s"}…
        </p>
      )}

      <div className="my-4 flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label="Filter creatives" className="flex flex-wrap items-center gap-1.5">
          {LIBRARY_FILTERS.map((item) => {
            const selected = item.id === filterId;
            const count = counts?.[item.count];
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  // Re-selecting the current chip changes nothing (it used to
                  // clear the rows without a new request: an endless spinner).
                  if (selected) return;
                  setFilterId(item.id);
                  setHidden(new Set());
                }}
                className={[
                  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors duration-150 motion-reduce:transition-none",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2",
                  selected
                    ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] font-semibold text-[var(--color-brand-700)]"
                    : "border-[var(--gray-200)] bg-[var(--color-background-primary)] font-medium text-[var(--color-text-secondary)]",
                ].join(" ")}
              >
                {item.label}
                {typeof count === "number" && (
                  <span className="font-medium tabular-nums text-[var(--color-text-tertiary-strong)]">{count}</span>
                )}
              </button>
            );
          })}
        </div>
        <SearchInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
          placeholder="Search by name"
          aria-label="Search creatives by name"
          className="w-full max-w-[320px]"
        />
      </div>

      {bodyState === "error" ? (
        <AlertCard variant="error" title="Creative Library unavailable">
          <p>{error}</p>
          <Button
            className="mt-3"
            size="sm"
            variant="secondary"
            onClick={() => {
              setRowsKey(null);
              void load();
            }}
          >
            Retry
          </Button>
        </AlertCard>
      ) : bodyState === "loading" ? (
        <div className="flex items-center gap-2 py-4">
          <Spinner size="sm" /> Loading creatives…
        </div>
      ) : bodyState === "empty" ? (
        debouncedQuery ? (
          <p className="py-6 text-sm text-[var(--color-text-secondary)]">
            No media matches &quot;{debouncedQuery}&quot;.{" "}
            <button type="button" className="font-medium text-[var(--color-brand-700)] underline" onClick={() => setQuery("")}>
              Clear search
            </button>
          </p>
        ) : filterId === "archived" ? (
          <p className="py-6 text-sm text-[var(--color-text-secondary)]">
            Nothing archived. Archived media stays here and never affects running ads.
          </p>
        ) : (
          <div className="px-5 py-8 text-center">
            <p className="text-[15px] font-semibold">No media yet</p>
            <p className="mx-auto mb-4 mt-1.5 max-w-md text-sm text-[var(--color-text-secondary)]">
              Drop an image or video to start. Event covers can show up here once a host approves ad use.
            </p>
            <Button variant="brandContrast" icon={Upload} onClick={() => openPicker()}>
              Upload media
            </Button>
          </div>
        )
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {showUploads && uploads.entries.map((entry) => (
              <UploadCard
                key={entry.localId}
                entry={entry}
                onCancel={requestCancel}
                onRemove={(item) => void cancelUpload(item)}
                onRetry={(item) => {
                  if (!uploads.retry(item)) openPicker(item);
                }}
                onChooseFile={(item) => openPicker(item)}
                onCheckAgain={(item) => void uploads.checkAgain(item)}
              />
            ))}
            {serverOnly.map((item) => {
              const entry = {
                localId: `server-${item.jobId}`,
                serverItem: item,
                name: item.fileName ?? "Video",
                durationMs: item.sourceDurationMs,
                totalBytes: item.sourceBytes,
                phase: item.status === "source_uploading" ? "needs_file" : item.status === "ready" ? "saving" : "preparing",
                sourceUploadedAt: item.sourceUploadedAt,
              };
              return (
                <UploadCard
                  key={entry.localId}
                  entry={entry}
                  onCancel={() => void cancelUpload(entry)}
                  onRemove={() => void cancelUpload(entry)}
                  onChooseFile={() => openPicker(entry)}
                  onCheckAgain={() => void load()}
                />
              );
            })}
            {visibleRows.map((creative) => (
              <CreativeCard
                key={creative.id}
                creative={creative}
                purge={purge[creative.id]}
                canManage={canManageLifecycle(creative)}
                onUse={(row) => {
                  window.location.hash = `#/campaign-builder?step=creative&creative=${encodeURIComponent(row.id)}`;
                }}
                onPlay={(row) => setPlaying(row)}
                onArchive={(row) => setArchiveTarget(row)}
                onRestore={(row) => void restore(row)}
                onOpenMenu={(row) => void checkPurge(row)}
                onDelete={(row) => {
                  setDeleteTarget(row);
                  setDeletePhrase("");
                  setDeleteError(null);
                }}
              />
            ))}
          </div>
          {cursor && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="secondary"
                size="sm"
                loading={loadingMore}
                onClick={async () => {
                  setLoadingMore(true);
                  await load({ append: true, before: cursor });
                  setLoadingMore(false);
                }}
              >
                Load more
              </Button>
            </div>
          )}
        </>
      )}

      <Modal open={Boolean(archiveTarget)} onClose={() => setArchiveTarget(null)} title={`Archive "${archiveTarget?.name ?? ""}"?`} size="sm">
        <ModalBody>
          <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
            It won&apos;t show up when you build new campaigns.{" "}
            {Number(archiveTarget?.usage?.campaign_count ?? 0) > 0
              ? `The ${archiveTarget.usage.campaign_count} campaign${archiveTarget.usage.campaign_count === 1 ? "" : "s"} already using it keep${archiveTarget.usage.campaign_count === 1 ? "s" : ""} running, and nothing is deleted.`
              : "Nothing is deleted."}{" "}
            You can restore it any time from Archived.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setArchiveTarget(null)}>Cancel</Button>
          <Button variant="brandContrast" loading={archiving} onClick={() => void confirmArchive()}>Archive</Button>
        </ModalFooter>
      </Modal>

      <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title={`Delete "${deleteTarget?.name ?? ""}" permanently?`} size="sm" destructive>
        <ModalBody>
          <div role="alertdialog" aria-label="Delete permanently" className="space-y-3">
            <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
              This deletes the video file from Mingla. It isn&apos;t used by any campaign, ad platform, event or brand. This can&apos;t be undone.
            </p>
            <label className="block text-[12.5px] font-semibold" htmlFor="creative-delete-phrase">
              Type DELETE to confirm
            </label>
            <input
              id="creative-delete-phrase"
              value={deletePhrase}
              onChange={(event) => setDeletePhrase(event.target.value)}
              autoComplete="off"
              className="h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 font-mono text-sm outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]"
            />
            {deleteError && (
              <p role="alert" className="text-sm text-[var(--color-error-700)]">{deleteError}</p>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button variant="danger" loading={deleting} disabled={deletePhrase !== "DELETE"} onClick={() => void confirmDelete()}>
            Delete permanently
          </Button>
        </ModalFooter>
      </Modal>

      <Modal open={Boolean(cancelTarget)} onClose={() => setCancelTarget(null)} title="Cancel this upload?" size="sm">
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">You&apos;ll need to start it again.</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setCancelTarget(null)}>Keep uploading</Button>
          <Button variant="danger" onClick={() => void cancelUpload(cancelTarget)}>Cancel upload</Button>
        </ModalFooter>
      </Modal>

      <Modal open={Boolean(differentEntry)} onClose={() => uploads.keepWaitingForFile(differentEntry)} title="That's a different file. Start a new upload instead?" size="sm">
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">
            The paused upload needs the same file it started with. A new upload starts from the beginning.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => uploads.keepWaitingForFile(differentEntry)}>Cancel</Button>
          <Button
            variant="brandContrast"
            onClick={() => void uploads.startOverWith(differentEntry)}
          >
            Start new upload
          </Button>
        </ModalFooter>
      </Modal>

      <Modal open={Boolean(playing)} onClose={() => setPlaying(null)} title={playing?.name ?? "Video"} size="md">
        <ModalBody>
          {playing?.playback_url && (
            <video src={playing.playback_url} controls muted autoPlay playsInline className="mx-auto max-h-[65vh] w-full rounded-lg bg-black" />
          )}
        </ModalBody>
      </Modal>
    </SectionCard>
  );
}

export function AdEnginePage() {
  const { addToast } = useToast();
  const [preflightRows, setPreflightRows] = useState(null);
  const [preflightRunning, setPreflightRunning] = useState(false);
  const [appDownloadReadinessEnabled, setAppDownloadReadinessEnabled] =
    useState(false);
  // #3697 (C-20) — the Creative Library follows enable_ads_console (fail-open).
  const [adsConsoleEnabled, setAdsConsoleEnabled] = useState(true);
  const [activeTab, setActiveTab] = useState(tabFromHash);
  const visibleTabs = ADS_TABS.filter(
    (tab) => adsConsoleEnabled || tab.id !== "creative-library",
  );
  const shownTab =
    !adsConsoleEnabled && activeTab === "creative-library" ? "overview" : activeTab;

  useEffect(() => {
    const applyHash = () => setActiveTab(tabFromHash());
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  const changeTab = (tab) => {
    setActiveTab(tab);
    window.location.hash =
      tab === "overview" ? "#/ad-engine" : `#/ad-engine?tab=${tab}`;
  };

  useEffect(() => {
    let mounted = true;
    loadFeatureFlags().then((flags) => {
      if (mounted) {
        setAppDownloadReadinessEnabled(
          flags.enable_app_download_readiness === true,
        );
        setAdsConsoleEnabled(flags.enable_ads_console !== false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handlePreflight = async () => {
    setPreflightRunning(true);
    const { data, error } = await runPreflight();
    if (error) {
      const parsed = await parseEdgeError(error);
      addToast({
        variant: "error",
        title: "Preflight failed",
        description: String(parsed?.message ?? ""),
      });
    } else {
      setPreflightRows(data?.rows ?? []);
    }
    setPreflightRunning(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        titleId="ads-console-heading"
        title="Ads"
        description="One governed workspace for campaigns, creative, provider connections, spend, results and settlement."
        actions={
          <Button
            size="sm"
            icon={Rocket}
            onClick={() => {
              window.location.hash = "#/campaign-builder";
            }}
          >
            New campaign
          </Button>
        }
        tabs={
          <Tabs tabs={visibleTabs} activeTab={shownTab} onChange={changeTab} />
        }
      />

      {shownTab === "campaigns" && <CampaignsPage embedded />}
      {shownTab === "creative-library" && <CreativeLibraryPanel />}

      {shownTab === "connections" && (
        <>
          <AdConnectionsPanel />

          {appDownloadReadinessEnabled ? (
            <AppDownloadReadinessPanel />
          ) : (
            <section
              aria-label="App-download readiness"
              className="rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4 text-sm text-[var(--color-text-secondary)]"
            >
              App-download readiness is being connected. No campaigns can be
              created here.
            </section>
          )}
        </>
      )}

      {shownTab === "overview" && (
        <>
          <section
            aria-labelledby="governed-campaign-operations-heading"
            className="space-y-1"
          >
            <h2
              id="governed-campaign-operations-heading"
              className="text-lg font-semibold"
            >
              Governed campaign operations
            </h2>
            <p className="text-sm text-[var(--color-text-secondary)]">
              The five-stage builder creates one immutable plan. Campaign
              lifecycle, spend, results and settlement stay in this Ads area.
            </p>
          </section>

          <AdsOperationsOverview
            onOpenCampaigns={() => changeTab("campaigns")}
            onOpenConnections={() => changeTab("connections")}
          />

          <SectionCard
            title="Channel preflight"
            subtitle="Verify current account, billing, identity, market, pixel, and provider readiness before opening the builder."
            action={
              <Button
                variant="secondary"
                size="sm"
                icon={Megaphone}
                loading={preflightRunning}
                onClick={handlePreflight}
              >
                Run preflight
              </Button>
            }
          >
            {!preflightRows && !preflightRunning && (
              <p className="text-sm text-[var(--color-text-secondary)]">
                Not run yet.
              </p>
            )}
            {preflightRunning && (
              <div className="flex items-center gap-2 py-2">
                <Spinner size="sm" /> Probing channels…
              </div>
            )}
            {preflightRows && !preflightRunning && (
              <div className="space-y-3">
                {preflightRows.map((row) => (
                  <div
                    key={row.platform}
                    className="border border-[var(--gray-200)] rounded-lg p-3"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Badge
                        variant={PREFLIGHT_BADGE[row.overall] ?? "default"}
                        dot
                      >
                        {row.platform}
                      </Badge>
                      <span className="text-xs text-[var(--color-text-secondary)]">
                        {row.overall}
                      </span>
                    </div>
                    <ul className="space-y-1">
                      {row.checks.map((check) => (
                        <li key={check.id} className="text-xs flex gap-2">
                          <Badge
                            variant={
                              check.status === "pass"
                                ? "success"
                                : check.status === "warn"
                                  ? "warning"
                                  : check.status === "n/a"
                                    ? "default"
                                    : "error"
                            }
                          >
                            {check.id}
                          </Badge>
                          <span>
                            {check.label}
                            {check.detail ? ` — ${check.detail}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Campaign work"
            subtitle="One engine, one immutable plan, and no direct provider-write shortcut."
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                type="button"
                className="rounded-xl border border-[var(--gray-200)] p-4 text-left hover:border-[var(--color-brand-500)]"
                onClick={() => {
                  window.location.hash = "#/campaign-builder";
                }}
              >
                <div className="font-semibold">Build a campaign</div>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  Destination, targeting, budget, media, review, and paused
                  provider creation stay bound to one plan version.
                </p>
              </button>
              <button
                type="button"
                className="rounded-xl border border-[var(--gray-200)] p-4 text-left hover:border-[var(--color-brand-500)]"
                onClick={() => {
                  changeTab("campaigns");
                }}
              >
                <div className="font-semibold">Manage campaigns</div>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  Review, launch, pause, spend, results, stop, settlement, and
                  audit evidence live together.
                </p>
              </button>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
