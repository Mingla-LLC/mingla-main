/**
 * ISSUE-864 WP4 — Step: Creative (SPEC A4.c, blueprint §1.5). Upload ONE ad
 * image to the meta-ad-creatives bucket, then run the #866 server-side
 * BYTE-PROBE (admin-ad-creative-upload action='validate') and render the
 * per-channel validation panel with the validator's tiers (pass / warn /
 * reject / needs_transcode / not_evaluable). "Use this creative" records the
 * ad_creatives row (action='record').
 *
 * "Continue anyway (build paused)" semantics: warns never block; a REJECT on
 * an eligible channel blocks Next for that channel set (a hard blocker makes
 * the create call itself fail — offering the button there would be a lie).
 */

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { AlertCard } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input, Toggle } from "../ui/Input";
import { ImageUploader } from "../ui/ImageUploader";
import { useToast } from "../../context/ToastContext";
import { uploadAdImage } from "../../services/mediaUpload";
import { creativeUpload, parseEdgeError } from "../../services/adEngineService";
import { PLATFORM_LABELS } from "../../lib/adBuilder/channelPlan";

const TIER_BADGE = {
  pass: "success",
  warn: "warning",
  reject: "error",
  needs_transcode: "warning",
  not_evaluable: "default",
};

export function StepCreative({ creative, onCreativeChange, channelRows, destination }) {
  const { addToast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [recording, setRecording] = useState(false);
  const [serverError, setServerError] = useState(null);
  const set = (patch) => onCreativeChange({ ...creative, ...patch });

  const eligiblePlatforms = channelRows.filter((r) => r.eligible).map((r) => r.platform);

  const handleFilePicked = async (file) => {
    setUploading(true);
    setServerError(null);
    try {
      const { publicUrl, path } = await uploadAdImage(file);
      set({
        file,
        localPreviewUrl: URL.createObjectURL(file),
        publicUrl,
        path,
        validation: null,
        creativeRow: null,
        name: creative.name || file.name.replace(/\.[a-z]+$/i, ""),
      });
    } catch (err) {
      setServerError({ message: err.message });
      addToast({ variant: "error", title: "Upload failed", description: err.message });
    }
    setUploading(false);
  };

  const runValidate = async () => {
    if (!creative.publicUrl) return;
    setValidating(true);
    setServerError(null);
    const { data, error } = await creativeUpload({
      action: "validate",
      kind: "image",
      name: creative.name || "Campaign builder creative",
      source_url: creative.publicUrl,
      storage_bucket: "meta-ad-creatives",
      storage_path: creative.path,
      platforms: eligiblePlatforms.length > 0 ? eligiblePlatforms : undefined,
      ai_generated: creative.aiGenerated,
    });
    if (error) {
      const parsed = await parseEdgeError(error);
      setServerError({
        code: parsed?.body?.error,
        message: String(parsed?.body?.message ?? parsed?.message ?? "Validation failed."),
      });
    } else {
      set({ validation: data?.validation ?? null });
      const channels = data?.validation?.channels ?? [];
      const bad = channels.filter((c) => !c.ok).length;
      addToast({
        variant: bad === 0 ? "success" : "warning",
        title: bad === 0
          ? `Ready on ${channels.length} of ${channels.length} channels.`
          : `${bad} channel${bad === 1 ? "" : "s"} with problems to fix.`,
      });
    }
    setValidating(false);
  };

  const recordCreative = async () => {
    if (!creative.publicUrl) return;
    setRecording(true);
    setServerError(null);
    const { data, error } = await creativeUpload({
      action: "record",
      kind: "image",
      name: creative.name || "Campaign builder creative",
      source_url: creative.publicUrl,
      storage_bucket: "meta-ad-creatives",
      storage_path: creative.path,
      platforms: eligiblePlatforms.length > 0 ? eligiblePlatforms : undefined,
      ai_generated: creative.aiGenerated,
    });
    if (error) {
      const parsed = await parseEdgeError(error);
      setServerError({
        code: parsed?.body?.error,
        message: String(parsed?.body?.message ?? parsed?.message ?? "Recording failed."),
      });
    } else {
      set({ creativeRow: data?.creative ?? null, validation: data?.validation ?? creative.validation });
      addToast({ variant: "success", title: "Creative recorded to the library." });
    }
    setRecording(false);
  };

  const channels = creative.validation?.channels ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">What are people going to see?</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          The server probes the actual bytes per channel — admin-supplied dimensions are never
          trusted. Fix rejects before a platform review cycle eats 24 hours.
        </p>
      </div>

      <ImageUploader
        file={creative.file}
        previewUrl={creative.localPreviewUrl ?? creative.publicUrl}
        uploading={uploading}
        onFilePicked={handleFilePicked}
        onClear={() => set({ file: null, localPreviewUrl: null, publicUrl: null, path: null, validation: null, creativeRow: null })}
      />

      {creative.publicUrl && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
          <Input
            label="Creative name"
            value={creative.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="July London push — hero"
          />
          <div className="flex items-center gap-3">
            <Toggle
              label="AI-generated (discloses OPT_IN to Meta)"
              checked={creative.aiGenerated}
              onChange={(v) => set({ aiGenerated: v })}
            />
          </div>
        </div>
      )}

      {creative.publicUrl && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={ShieldCheck}
            loading={validating}
            onClick={runValidate}
          >
            Validate per channel
          </Button>
          <Button
            size="sm"
            loading={recording}
            disabled={!creative.validation || Boolean(creative.creativeRow)}
            onClick={recordCreative}
          >
            {creative.creativeRow ? "Recorded ✓" : "Use this creative"}
          </Button>
        </div>
      )}

      {serverError && (
        <AlertCard variant="error" title={`Creative check failed${serverError.code ? ` — ${serverError.code}` : ""}`}>
          {serverError.message}
        </AlertCard>
      )}

      {channels && (
        <div className="space-y-3">
          {channels.map((channel) => (
            <div key={channel.platform} className="border border-[var(--gray-200)] rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant={channel.ok ? "success" : "error"} dot>
                  {PLATFORM_LABELS[channel.platform] ?? channel.platform}
                </Badge>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {channel.ok ? "ready" : channel.needsTranscode ? "needs a variant/transcode" : "blocked"}
                </span>
              </div>
              <ul className="space-y-1">
                {(channel.checks ?? []).map((check, i) => (
                  <li key={`${check.rule}-${i}`} className="text-xs flex items-start gap-2">
                    <Badge variant={TIER_BADGE[check.level] ?? "default"}>{check.level}</Badge>
                    <span>
                      <span className="font-medium">{check.rule}</span> — {check.message}
                      <span className="text-[var(--color-text-tertiary)]"> [{check.confidence}]</span>
                    </span>
                  </li>
                ))}
                {(channel.checks ?? []).length === 0 && (
                  <li className="text-xs text-[var(--color-text-secondary)]">No findings — clean.</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}

      {destination && !creative.publicUrl && (
        <p className="text-xs text-[var(--color-text-tertiary)]">
          Tip: the event's cover works as a starting point, but ads with a dedicated 4:5 or
          1:1 crop outperform reused covers.
        </p>
      )}
    </div>
  );
}
