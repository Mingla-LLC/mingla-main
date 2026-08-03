import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Eye,
  LoaderCircle,
  LockKeyhole,
  PauseCircle,
  Play,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { AlertCard } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { PLATFORM_LABELS } from "../../lib/adBuilder/channelPlan";
import { PREPARATION_ORDER } from "../../lib/adBuilder/preparationState";

const CAPABILITY = {
  meta: "Build + real platform preview",
  snapchat: "Build + Mingla approximation",
  tiktok: "Real preview only · no Phase A video create",
  google: "Mingla approximation · no Phase A video create",
};

const FAILURE_COPY = {
  provider_terminal: "The platform couldn't process this video. Retry this platform.",
  provider_init_failed: "The platform couldn't accept this video. Check the format or connection, then retry.",
  preparation_deadline_exceeded: "The platform is taking longer than this check allowed. Check status before uploading again.",
};

function elapsed(startedAt) {
  const start = Date.parse(startedAt ?? "");
  if (!Number.isFinite(start)) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function presentation(platform, row, queued, stopped) {
  if (platform === "google") {
    return { Icon: Eye, tone: "warning", primary: "Mingla approximation · video create not in Phase A" };
  }
  if (queued) return { Icon: Clock3, tone: "info", primary: "Queued" };
  if (stopped && (row.state === "uploading" || row.state === "processing")) {
    return { Icon: PauseCircle, tone: "neutral", primary: "Status not checked" };
  }
  if (row.state === "uploading") {
    return { Icon: LoaderCircle, tone: "info", spin: true, primary: `Uploading to ${PLATFORM_LABELS[platform]}${elapsed(row.started_at) ? ` · ${elapsed(row.started_at)} elapsed` : ""}` };
  }
  if (row.state === "processing") {
    return { Icon: LoaderCircle, tone: "info", spin: true, primary: `${PLATFORM_LABELS[platform]} is processing${elapsed(row.started_at) ? ` · ${elapsed(row.started_at)} elapsed` : ""}` };
  }
  if (row.state === "ready") {
    if (platform === "meta") return { Icon: CheckCircle2, tone: "success", primary: "Ready to build + preview" };
    if (platform === "snapchat") return { Icon: CheckCircle2, tone: "success", primary: "Ready to build" };
    return { Icon: Eye, tone: "info", primary: "Real preview ready · video create not in Phase A" };
  }
  if (row.state === "failed" || row.state === "timed_out") {
    return { Icon: AlertCircle, tone: "error", primary: `${PLATFORM_LABELS[platform]} couldn't prepare this video` };
  }
  return { Icon: Clock3, tone: "neutral", primary: "Not started" };
}

export function VideoPreparationPanel({
  creativeId,
  fundedPlatforms = [],
  rows = {},
  runningPlatform,
  stopped,
  onPrepare,
  onStop,
  onResume,
  onRetry,
  onCheck,
  online = true,
}) {
  const recorded = Boolean(creativeId);
  const prepPlatforms = PREPARATION_ORDER.filter((p) => fundedPlatforms.includes(p));
  const visiblePlatforms = [...prepPlatforms, ...(fundedPlatforms.includes("google") ? ["google"] : [])];
  const readyBuild = ["meta", "snapchat"].filter((p) =>
    fundedPlatforms.includes(p) && rows[p]?.state === "ready"
  );
  const buildCount = ["meta", "snapchat"].filter((p) => fundedPlatforms.includes(p)).length;

  return (
    <section className="phase-a-panel space-y-3" aria-labelledby="video-prepare-title">
      <div className="phase-a-panel-header">
        <div>
          <h3 id="video-prepare-title" className="text-sm font-semibold">Prepare video for platforms</h3>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Platforms need their own processed copy. We’ll do one at a time and show real elapsed time.
          </p>
        </div>
        <Badge variant="info"><ShieldCheck size={13} /> Media only · no ad created</Badge>
      </div>

      {!recorded ? (
        <div className="phase-a-platform-row">
          <LockKeyhole size={20} aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold">Waiting for this creative</p>
            <p className="text-xs text-[var(--color-text-secondary)]">Validate and use the video first.</p>
          </div>
        </div>
      ) : (
        <>
          {!online && (
            <AlertCard variant="warning" title="You’re offline. Nothing new started.">
              Reconnect to continue; completed platform work is preserved.
            </AlertCard>
          )}
          <div className="space-y-2">
            {visiblePlatforms.map((platform) => {
              const row = rows[platform] ?? { state: "not_started" };
              const index = prepPlatforms.indexOf(platform);
              const runningIndex = prepPlatforms.indexOf(runningPlatform);
              const queued = runningPlatform && index > runningIndex && row.state === "not_started";
              const view = presentation(platform, row, queued, stopped);
              const action = platform === "google"
                ? null
                : row.state === "failed" || row.state === "timed_out"
                ? <Button size="sm" variant="secondary" disabled={!online} onClick={() => onRetry(platform)}>Retry {PLATFORM_LABELS[platform]}</Button>
                : stopped && (row.state === "uploading" || row.state === "processing")
                ? <Button size="sm" variant="secondary" disabled={!online} onClick={() => onCheck(platform)}>Check status</Button>
                : null;
              return (
                <div key={platform} className={`phase-a-platform-row phase-a-${view.tone}`}>
                  <view.Icon className={view.spin ? "animate-spin" : ""} size={20} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{PLATFORM_LABELS[platform]}</p>
                    <p className="text-xs text-[var(--color-text-secondary)]">{CAPABILITY[platform]}</p>
                    <p className="text-xs font-medium tabular-nums mt-0.5">{view.primary}</p>
                    {(row.state === "uploading" || row.state === "processing") && !stopped && (
                      <p className="text-xs text-[var(--color-text-tertiary)]">
                        Platforms do not provide a reliable percentage. No ad exists yet.
                      </p>
                    )}
                    {(row.state === "failed" || row.state === "timed_out") && (
                      <>
                        <p className="text-xs text-[var(--color-text-secondary)]">
                          {FAILURE_COPY[row.error?.code] ?? row.error?.message ?? "Nothing was created. Retry this platform."}
                        </p>
                        {row.trace_id && (
                          <details className="text-xs mt-1">
                            <summary>Technical details</summary>
                            <span className="font-mono">Trace {row.trace_id}</span>
                          </details>
                        )}
                      </>
                    )}
                  </div>
                  {action}
                </div>
              );
            })}
          </div>

          {fundedPlatforms.includes("reddit") && (
            <p className="text-xs text-[var(--color-text-secondary)]">
              Reddit video builds directly from the hosted clip — no per-platform preparation is needed. Its preview is a Mingla approximation (Reddit has no video-ad preview API). The paused ad is created on launch.
            </p>
          )}

          <div aria-live="polite">
            {buildCount > 0 && readyBuild.length === buildCount ? (
              <AlertCard variant="success" title="Video is ready for Meta and Snapchat">
                Preparation created media copies only. No campaign or ad was created.
              </AlertCard>
            ) : readyBuild.length > 0 ? (
              <AlertCard variant="warning" title={`Ready on ${readyBuild.length} of ${buildCount} build platforms`}>
                Continuing will include {readyBuild.map((p) => PLATFORM_LABELS[p]).join(", ")} and exclude unready platforms.
              </AlertCard>
            ) : null}
          </div>

          <div className="phase-a-panel-footer">
            <p className="text-xs text-[var(--color-text-secondary)]">
              {stopped ? "We stopped waiting. A platform may still finish; no campaign or ad was created." : "Preparation never creates or launches an ad."}
            </p>
            <div className="flex flex-wrap gap-2">
              {runningPlatform && !stopped ? (
                <Button size="sm" variant="secondary" icon={PauseCircle} onClick={onStop}>Stop waiting</Button>
              ) : stopped ? (
                <Button size="sm" icon={Play} disabled={!online} onClick={onResume}>Resume preparation</Button>
              ) : (
                <Button size="sm" icon={Play} disabled={!online || prepPlatforms.length === 0} onClick={onPrepare}>
                  Prepare video for {prepPlatforms.length} platform{prepPlatforms.length === 1 ? "" : "s"}
                </Button>
              )}
              {!runningPlatform && prepPlatforms.some((p) => ["uploading", "processing"].includes(rows[p]?.state)) && (
                <Button size="sm" variant="secondary" icon={RefreshCw} disabled={!online} onClick={onResume}>Check existing status</Button>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
