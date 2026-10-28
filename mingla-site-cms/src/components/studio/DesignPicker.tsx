"use client";

import { useField } from "@payloadcms/ui";
import { DESIGN_KEYS, DESIGNS, isDesignKey } from "../../contracts/generated/designs.ts";

/*
 * #2829 AD-1 — choose the site's design. Switching keeps every page, block
 * and setting; each block's layout becomes the new design's default for its
 * type unless the new design draws the same layout (applied at publish).
 */
export default function DesignPicker({ path }: { path: string }) {
  const { value, setValue } = useField<string>({ path });
  const current = isDesignKey(value) ? value : "atelier";
  return (
    <section style={{ display: "grid", gap: 8, margin: "16px 0 24px" }}>
      <label htmlFor="site-design-picker"><strong>Design</strong></label>
      <select
        id="site-design-picker"
        value={current}
        onChange={(event) => {
          const next = event.target.value;
          if (next === current) return;
          if (window.confirm(`Switch to ${DESIGNS[next as keyof typeof DESIGNS]?.label ?? next}? Your content stays; section layouts change to the new design's.`)) {
            setValue(next);
          }
        }}
      >
        {DESIGN_KEYS.map((key) => <option key={key} value={key}>{DESIGNS[key].label} — {DESIGNS[key].description}</option>)}
      </select>
    </section>
  );
}
