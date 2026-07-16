/**
 * ISSUE-864 WP4 — Step: Copy (SPEC A4.b, blueprint §1.6). ONE shared
 * composer, PER-CHANNEL counters, per-channel hard caps — never one shared
 * cap — with the live truncation preview strip showing exactly what each
 * channel renders. Google gets repeatable RSA headlines (3–15 ≤30) and
 * descriptions (2–4 ≤90) seeded from Headline/Description, plus REQUIRED
 * keywords; Google never gets a CTA (not an RSA field).
 */

import { Plus, X } from "lucide-react";
import { Input, Textarea } from "../ui/Input";
import { Button } from "../ui/Button";
import {
  META_CTA_OPTIONS,
  truncationPreview,
  validateCopy,
  weightedLength,
} from "../../lib/adBuilder/copyRules";
import { PLATFORM_LABELS } from "../../lib/adBuilder/channelPlan";

function Counter({ value, cap, warnAt }) {
  const n = weightedLength(value);
  const over = cap && n > cap;
  const warn = !over && warnAt && n > warnAt;
  return (
    <span
      className={[
        "text-[10px] font-mono",
        over ? "text-[#ef4444]" : warn ? "text-[var(--color-warning-700)]" : "text-[var(--color-text-tertiary)]",
      ].join(" ")}
    >
      {n}{cap ? `/${cap}` : ""}
    </span>
  );
}

function ChipsInput({ label, chips, onChange, placeholder, helper }) {
  const add = (raw) => {
    const value = raw.trim();
    if (!value || chips.includes(value)) return;
    onChange([...chips, value]);
  };
  return (
    <div>
      <span className="block text-sm font-medium mb-1.5">{label}</span>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {chips.map((chip) => (
          <span key={chip} className="inline-flex items-center gap-1 h-7 px-2.5 text-xs rounded-full bg-[var(--gray-100)]">
            {chip}
            <button
              type="button"
              aria-label={`Remove ${chip}`}
              onClick={() => onChange(chips.filter((c) => c !== chip))}
              className="hover:text-[#ef4444]"
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <Input
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(e.currentTarget.value);
            e.currentTarget.value = "";
          }
        }}
        onBlur={(e) => {
          add(e.currentTarget.value);
          e.currentTarget.value = "";
        }}
        helper={helper}
      />
    </div>
  );
}

function RepeatableFields({ label, values, onChange, min, max, cap, addLabel }) {
  return (
    <div>
      <span className="block text-sm font-medium mb-1.5">
        {label} <span className="text-xs text-[var(--color-text-tertiary)]">({min}–{max}, ≤{cap} chars each)</span>
      </span>
      <div className="space-y-1.5">
        {values.map((value, index) => (
          <div key={index} className="flex items-center gap-2">
            <div className="flex-1">
              <Input
                value={value}
                aria-label={`${label} ${index + 1}`}
                onChange={(e) => {
                  const next = [...values];
                  next[index] = e.target.value;
                  onChange(next);
                }}
              />
            </div>
            <Counter value={value} cap={cap} />
            {values.length > min && (
              <Button
                variant="ghost"
                size="sm"
                icon={X}
                aria-label={`Remove ${label} ${index + 1}`}
                onClick={() => onChange(values.filter((_, i) => i !== index))}
              />
            )}
          </div>
        ))}
      </div>
      {values.length < max && (
        <Button
          variant="ghost"
          size="sm"
          icon={Plus}
          className="mt-1.5"
          onClick={() => onChange([...values, ""])}
        >
          {addLabel}
        </Button>
      )}
    </div>
  );
}

export function StepCopy({ copy, onCopyChange, channelRows }) {
  const set = (patch) => onCopyChange({ ...copy, ...patch });
  const platforms = channelRows.filter((r) => r.eligible).map((r) => r.platform);
  const googleEligible = platforms.includes("google");
  const validation = validateCopy(copy, platforms);
  const strip = truncationPreview(copy, platforms);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">What does it say?</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Write once — the strip below shows exactly what each channel will do to it. Never
          discover a character limit from a rejection.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium">Primary text</span>
          <div className="flex gap-2">
            {platforms.includes("meta") && <span className="text-[10px] text-[var(--color-text-tertiary)]">Meta <Counter value={copy.primary} cap={1024} warnAt={125} /></span>}
            {platforms.includes("tiktok") && <span className="text-[10px] text-[var(--color-text-tertiary)]">TikTok <Counter value={copy.primary} cap={100} /></span>}
            {platforms.includes("reddit") && <span className="text-[10px] text-[var(--color-text-tertiary)]">Reddit <Counter value={copy.primary} cap={300} warnAt={80} /></span>}
          </div>
        </div>
        <Textarea
          aria-label="Primary text"
          rows={3}
          value={copy.primary}
          onChange={(e) => set({ primary: e.target.value })}
          placeholder="Sold-out energy, Tuesday night. The room only holds 40…"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium">Headline</span>
            <div className="flex gap-2">
              {platforms.includes("meta") && <span className="text-[10px] text-[var(--color-text-tertiary)]">Meta <Counter value={copy.headline} cap={255} warnAt={27} /></span>}
              {platforms.includes("snapchat") && <span className="text-[10px] text-[var(--color-text-tertiary)]">Snap <Counter value={copy.headline} cap={34} /></span>}
            </div>
          </div>
          <Input
            aria-label="Headline"
            value={copy.headline}
            onChange={(e) => {
              const headline = e.target.value;
              // Seed Google's first RSA headline from the shared headline.
              const gh = [...(copy.googleHeadlines ?? [])];
              if (gh.length > 0 && (gh[0] === copy.headline || gh[0] === "")) gh[0] = headline;
              set({ headline, googleHeadlines: gh });
            }}
            placeholder="Book the night"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium">Description <span className="text-xs text-[var(--color-text-tertiary)]">(optional)</span></span>
            {platforms.includes("meta") && <span className="text-[10px] text-[var(--color-text-tertiary)]">Meta <Counter value={copy.description} cap={255} warnAt={30} /></span>}
          </div>
          <Input
            aria-label="Description"
            value={copy.description}
            onChange={(e) => {
              const description = e.target.value;
              const gd = [...(copy.googleDescriptions ?? [])];
              if (gd.length > 0 && (gd[0] === copy.description || gd[0] === "")) gd[0] = description;
              set({ description, googleDescriptions: gd });
            }}
          />
        </div>
      </div>

      {platforms.includes("meta") && (
        <label className="block text-sm max-w-xs">
          <span className="block mb-1 font-medium">Call to action <span className="text-xs text-[var(--color-text-tertiary)]">(Meta — Google Search ads have no CTA button)</span></span>
          <select
            className="w-full h-10 px-3 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] text-sm"
            value={copy.cta}
            onChange={(e) => set({ cta: e.target.value })}
          >
            {META_CTA_OPTIONS.map((c) => <option key={c} value={c}>{c.replaceAll("_", " ")}</option>)}
          </select>
        </label>
      )}

      {googleEligible && (
        <div className="space-y-3 p-3 rounded-xl border border-[var(--gray-200)]">
          <p className="text-sm font-semibold">Google Search (RSA)</p>
          <RepeatableFields
            label="Headlines"
            values={copy.googleHeadlines}
            onChange={(googleHeadlines) => set({ googleHeadlines })}
            min={3}
            max={15}
            cap={30}
            addLabel="Add headline"
          />
          <RepeatableFields
            label="Descriptions"
            values={copy.googleDescriptions}
            onChange={(googleDescriptions) => set({ googleDescriptions })}
            min={2}
            max={4}
            cap={90}
            addLabel="Add description"
          />
          <ChipsInput
            label="Keywords (required for Search)"
            chips={copy.keywords}
            onChange={(keywords) => set({ keywords })}
            placeholder="venue name, neighbourhood, 'things to do tuesday'…"
            helper="Press Enter to add. Start with the venue name, the neighbourhood, and what people would type to find this kind of night out."
          />
          <ChipsInput
            label="Negative keywords (optional)"
            chips={copy.negativeKeywords}
            onChange={(negativeKeywords) => set({ negativeKeywords })}
            placeholder="free, jobs…"
          />
        </div>
      )}

      {/* The live truncation preview strip (blueprint §1.6). */}
      {strip.length > 0 && (
        <div className="p-3 rounded-xl border border-[var(--gray-200)] font-mono text-xs space-y-1 overflow-x-auto" data-testid="truncation-strip">
          <p className="font-sans font-semibold text-sm mb-1.5">What each channel renders</p>
          {strip.map((row) => (
            <div key={row.surface} className="flex gap-3 whitespace-nowrap">
              <span className="w-36 shrink-0 text-[var(--color-text-secondary)]">{row.surface}</span>
              <span className="truncate max-w-96">"{row.text}"</span>
              {row.suffix && <span className="text-[var(--color-text-tertiary)]">{row.suffix}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Per-channel validation results. */}
      {Object.entries(validation).map(([platform, result]) => (
        <div key={platform}>
          {result.hard.map((message) => (
            <p key={message} className="text-xs text-[#ef4444] mt-1">
              {PLATFORM_LABELS[platform]}: {message}
            </p>
          ))}
          {result.warn.map((message) => (
            <p key={message} className="text-xs text-[var(--color-warning-700)] mt-1">
              {PLATFORM_LABELS[platform]}: {message}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
