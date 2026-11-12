// Issue #4402 — the 9:16 showcase player on the Admin creator record.
// Playback is the same admin-only, server-signed Bunny embed the Local review
// uses (creator-media-status); there is no download and no autoplay. Every
// job state has its own frame: none, processing, failed, loading, error, ready.

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Video } from "lucide-react";
import { Button } from "../ui/Button";
import { getCreatorMediaPlayback } from "../../services/creatorProgramsService";
import { programErrorMessage } from "../../lib/creatorPrograms";

const FRAME = "relative flex aspect-[9/16] w-full max-w-[268px] mx-auto items-center justify-center overflow-hidden rounded-xl bg-[var(--gray-900)] text-center text-white";

function seconds(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function CreatorShowcasePlayer({ job, onRefresh = null, refreshing = false }) {
  const ready = job?.status === "ready";
  const jobId = job?.job_id ?? null;
  // The parent keys this player by job id, so a new job starts clean.
  const [playback, setPlayback] = useState({ grant: null, error: "", loading: ready });
  const [attempt, setAttempt] = useState(0);
  const { grant, error, loading } = playback;

  useEffect(() => {
    if (!ready || !jobId) return undefined;
    let current = true;
    getCreatorMediaPlayback(jobId).then(
      (next) => { if (current) setPlayback({ grant: next, error: "", loading: false }); },
      (cause) => {
        if (current) setPlayback({ grant: null, error: programErrorMessage(cause, "This video cannot be played right now."), loading: false });
      },
    );
    return () => { current = false; };
  }, [ready, jobId, attempt]);

  const load = () => {
    setPlayback((p) => ({ ...p, error: "", loading: true }));
    setAttempt((n) => n + 1);
  };

  if (!job) {
    return (
      <div className={FRAME} role="img" aria-label="No showcase video yet">
        <span className="px-6 text-sm"><Video className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />No showcase video yet. The creator adds it in Creator setup.</span>
      </div>
    );
  }
  if (job.status === "processing" || job.status === "awaiting_upload") {
    // #4402 P3-2: a real control refetches the record (the job status lives there).
    return (
      <div className="space-y-2">
        <div className={FRAME} role="img" aria-label="Showcase video still processing">
          <span className="px-6 text-sm">
            <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <b className="block">Processing</b>
            {onRefresh ? "Usually under 2 minutes." : "Usually under 2 minutes. Reload the page to check again."}
          </span>
        </div>
        {onRefresh ? (
          <Button className="w-full" size="sm" variant="secondary" icon={RefreshCw} loading={refreshing} onClick={onRefresh}>
            Check again
          </Button>
        ) : null}
      </div>
    );
  }
  if (job.status === "failed") {
    return (
      <div className={`${FRAME} bg-[var(--color-error-50)] text-[var(--color-error-700)]`} role="img" aria-label="Showcase video failed to process">
        <span className="px-6 text-sm">
          <AlertTriangle className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
          <b className="block">Couldn't process this video</b>
          {job.failure_code ? <span className="font-mono text-xs">{job.failure_code}</span> : null}
          <span className="mt-1 block">The creator needs to upload a new video.</span>
        </span>
      </div>
    );
  }
  if (!ready) {
    return <div className={FRAME} role="img" aria-label="Showcase video unavailable"><span className="px-6 text-sm">This video is not available.</span></div>;
  }
  const length = seconds(job.duration_s);
  return (
    <div className="space-y-2">
      {grant?.url ? (
        <iframe
          className="mx-auto block aspect-[9/16] w-full max-w-[268px] rounded-xl bg-black"
          src={grant.url}
          title={length ? `Showcase video, ${length} seconds` : "Showcase video"}
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <div className={FRAME} aria-busy={loading}>
          <span className="px-6 text-sm">
            {loading ? <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Video className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />}
            {loading ? "Loading the private video…" : "Private showcase video"}
          </span>
        </div>
      )}
      {error ? <p role="alert" className="text-center text-xs text-[var(--color-error-700)]">{error}</p> : null}
      {!loading && (error || grant?.url) ? (
        <Button className="w-full" size="sm" variant="secondary" icon={RefreshCw} onClick={load}>
          {error ? "Try again" : "Refresh video"}
        </Button>
      ) : null}
    </div>
  );
}
