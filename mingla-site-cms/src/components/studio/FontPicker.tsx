"use client";

import { useField, useFormFields } from "@payloadcms/ui";
import { useEffect, useMemo, useState } from "react";
import type { OwnerFontOverrides } from "../../contracts/generated/fontSlots.ts";
import { fontSlotsFor } from "./lookModel";

/*
 * #2829 AD-3 — Studio's font picker: any family from the Google Fonts
 * catalogue for headings, body text and an optional accent script, searched
 * by name and category, with a live specimen. The specimen file comes from
 * Studio's own preview route (fetched once, validated and stored by Mingla);
 * the published site serves its fonts itself, so visitors never contact
 * Google. Weights come from what the design uses. Only the slots the chosen
 * design draws are shown (#2829 A8); a stored choice for another slot is kept.
 */

type Slot = "display" | "body" | "accent";
type Result = { family: string; category: string; weights: number[] };
const SLOTS: Array<{ key: Slot; label: string; sample: string }> = [
  { key: "display", label: "Headings", sample: "The quick brown fox jumps over the lazy dog" },
  { key: "body", label: "Body text", sample: "Sphinx of black quartz, judge my vow. 0123456789" },
  { key: "accent", label: "Accent script (optional)", sample: "Little moments, big adventures" },
];
const CATEGORIES = ["", "sans-serif", "serif", "display", "handwriting", "monospace"];

function Specimen({ family, sample }: { family: string; sample: string }) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const alias = `MinglaPreview ${family}`;
  useEffect(() => {
    let active = true;
    const face = new FontFace(alias, `url(/api/mingla/fonts/preview?family=${encodeURIComponent(family)}&weight=400)`);
    face.load().then((loaded) => {
      if (!active) return;
      document.fonts.add(loaded);
      setState("ready");
    }).catch(() => active && setState("failed"));
    return () => {
      active = false;
    };
  }, [alias, family]);
  if (state === "failed") return <p role="status">The preview of {family} could not load right now. You can still choose it.</p>;
  return <p style={{ fontFamily: state === "ready" ? `"${alias}"` : "inherit", fontSize: 22, margin: "6px 0" }}>{state === "loading" ? "Loading preview…" : sample}</p>;
}

function SlotPicker({ slot, value, onChoose, onReset }: {
  slot: (typeof SLOTS)[number];
  value: OwnerFontOverrides;
  onChoose: (family: string) => void;
  onReset: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState<string | null>(null);
  const chosen = value[slot.key];
  const searching = query.trim().length >= 2 || Boolean(category);
  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/mingla/fonts/search?q=${encodeURIComponent(query)}${category ? `&category=${category}` : ""}`, {
        credentials: "same-origin",
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = await response.json();
          if (!response.ok || !body.ok) throw new Error(body?.error?.code ?? "FAILED");
          setError(null);
          setResults(body.data as Result[]);
        })
        .catch((reason: unknown) => {
          if ((reason as Error).name !== "AbortError") setError("Fonts could not be searched just now. Try again.");
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, category, searching]);
  const visible = searching ? results : [];
  return (
    <fieldset style={{ border: "1px solid currentColor", borderRadius: 8, padding: 12 }}>
      <legend>{slot.label}</legend>
      <p style={{ margin: "0 0 6px" }}>
        {chosen === null ? "None" : chosen ? <>Chosen: <strong>{chosen.family}</strong></> : "Using your design's font"}
      </p>
      {chosen ? <Specimen family={chosen.family} sample={slot.sample} /> : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input aria-label={`Search fonts for ${slot.label}`} placeholder="Search Google Fonts" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="Font style" value={category} onChange={(event) => setCategory(event.target.value)}>
          {CATEGORIES.map((value) => <option key={value} value={value}>{value || "Any style"}</option>)}
        </select>
        {chosen !== undefined ? <button type="button" onClick={onReset}>Use the design&apos;s font</button> : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {visible.length ? (
        <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", maxHeight: 220, overflow: "auto" }}>
          {visible.map((result) => (
            <li key={result.family}>
              <button type="button" onClick={() => onChoose(result.family)} aria-pressed={chosen?.family === result.family}>
                {result.family} <span style={{ opacity: 0.7 }}>({result.category})</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </fieldset>
  );
}

export default function FontPicker({ path }: { path: string }) {
  const { value, setValue } = useField<OwnerFontOverrides | null>({ path });
  const current: OwnerFontOverrides = value && typeof value === "object" ? value : {};
  const designKey = useFormFields(([fields]) => fields.design?.value);
  const slots = useMemo(() => {
    const drawn = fontSlotsFor(designKey);
    return SLOTS.filter((slot) => drawn.includes(slot.key));
  }, [designKey]);
  return (
    <section style={{ display: "grid", gap: 12, margin: "16px 0 24px" }} aria-labelledby="site-fonts-heading">
      <h3 id="site-fonts-heading" style={{ margin: 0 }}>Fonts</h3>
      <p style={{ margin: 0 }}>Any Google font. Your website serves the files itself, so visitors never contact Google.</p>
      {slots.map((slot) => (
        <SlotPicker
          key={slot.key}
          slot={slot}
          value={current}
          onChoose={(family) => setValue({ ...current, [slot.key]: { family, source: "google" } })}
          onReset={() => {
            const next = { ...current };
            delete next[slot.key];
            setValue(next);
          }}
        />
      ))}
    </section>
  );
}
