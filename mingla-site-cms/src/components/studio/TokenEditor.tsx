"use client";

import { useField, useFormFields } from "@payloadcms/ui";
import { useMemo, useState } from "react";
import {
  allColoursFor,
  lookWarnings,
  resolvedLook,
  restoredDefaults,
  swatchesFor,
  swatchValue,
  withColor,
  type Swatch,
} from "./lookModel";

/*
 * #2829 AD-2 — Studio's colour editor: the primary swatches the chosen
 * design draws (A8: never a control that changes nothing; stored values for
 * other roles are kept), every colour it draws behind "All colours", a live readability panel and "Restore design
 * defaults". Any colour is allowed; warnings never block saving, previewing
 * or publishing, and nothing here changes a colour the owner chose.
 */

const box: React.CSSProperties = { display: "grid", gap: 12, margin: "16px 0 24px" };
const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" };

function ColorInput({ swatch, value, onSet }: { swatch: Swatch; value: string; onSet: (hex: string) => void }) {
  const [draft, setDraft] = useState(value);
  const id = `swatch-${swatch.role}-${swatch.step ?? "x"}`;
  return (
    <div style={row}>
      <input
        type="color"
        aria-label={`${swatch.label} colour picker`}
        value={value}
        onChange={(event) => {
          setDraft(event.target.value);
          onSet(event.target.value);
        }}
      />
      <label htmlFor={id} style={{ minWidth: 120 }}>{swatch.label}</label>
      <input
        id={id}
        value={draft}
        maxLength={7}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onSet(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSet(draft);
          }
        }}
        style={{ width: 96, fontFamily: "monospace" }}
      />
    </div>
  );
}

export default function TokenEditor({ path }: { path: string }) {
  const { value, setValue } = useField<unknown>({ path });
  const designKey = useFormFields(([fields]) => fields.design?.value);
  const [showAll, setShowAll] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const tokens = useMemo(() => resolvedLook(designKey, value), [designKey, value]);
  const warnings = useMemo(() => lookWarnings(tokens), [tokens]);
  const swatches = useMemo(() => swatchesFor(designKey), [designKey]);
  const allColours = useMemo(() => allColoursFor(designKey), [designKey]);

  const set = (swatch: Swatch, hex: string, mode: "seed" | "step" = "seed") => {
    const next = withColor(value, swatch, hex, mode);
    if (!next) {
      setRefused(`${swatch.label}: use a six-digit colour like #1a2b3c.`);
      return;
    }
    setRefused(null);
    setValue(next);
  };

  return (
    <section style={box} aria-labelledby="site-colours-heading">
      <h3 id="site-colours-heading" style={{ margin: 0 }}>Colours</h3>
      <p style={{ margin: 0 }}>Choose any colours. We will tell you if text gets hard to read, but we never change your choice.</p>
      {swatches.map((swatch) => (
        <ColorInput key={`${swatch.role}-${swatch.step ?? ""}-${swatchValue(tokens, swatch)}`} swatch={swatch} value={swatchValue(tokens, swatch)} onSet={(hex) => set(swatch, hex)} />
      ))}
      {refused ? <p role="alert" style={{ margin: 0 }}>{refused}</p> : null}
      <div role="status" aria-live="polite" style={{ border: "1px solid currentColor", borderRadius: 8, padding: 12 }}>
        <strong>Readability</strong>
        {warnings.length === 0 ? (
          <p style={{ margin: "6px 0 0" }}>All text is easy to read with these colours.</p>
        ) : (
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {warnings.map((warning) => (
              <li key={warning.pair}>
                {warning.sentence}
                {warning.suggestion ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
                    <span aria-hidden="true" style={{ width: 14, height: 14, background: warning.suggestion, display: "inline-block", borderRadius: 3, border: "1px solid #888" }} />
                    A shade that would pass: <code>{warning.suggestion}</code>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p style={{ margin: "6px 0 0", fontSize: 12 }}>Warnings never stop you saving, previewing or publishing.</p>
      </div>
      <div style={row}>
        <button type="button" onClick={() => setShowAll((open) => !open)} aria-expanded={showAll}>
          {showAll ? "Hide all colours" : "All colours"}
        </button>
        <button type="button" onClick={() => setValue(restoredDefaults(value))}>Restore design defaults</button>
      </div>
      {showAll ? (
        <div style={box}>
          {allColours.map((swatch) => (
            <ColorInput
              key={`${swatch.role}-${swatch.step ?? ""}-${swatchValue(tokens, swatch)}`}
              swatch={swatch}
              value={swatchValue(tokens, swatch)}
              onSet={(hex) => set(swatch, hex, swatch.step === undefined ? "seed" : "step")}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
