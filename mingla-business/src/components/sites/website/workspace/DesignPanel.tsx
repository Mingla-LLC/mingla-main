import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { color, radius, space } from "../../../../constants/designSystem";
import { useWebsite } from "../WebsiteContext";
import { Banner, Card, CardTitle, Skeleton, WButton, ui } from "../ui";
import { ColoursCard, CoverCard, DesignCard, FontsCard, ShapeRow } from "../sections/DesignSection";
import { useBrandSiteLook } from "../../../../hooks/useBrandSite";
import { BrandSiteContentConflict, setSiteLook, type SiteWorkspace } from "../../../../sites/contentApi";
import { brandSiteKeys } from "../../../../sites/brandSiteKeys";
import { BrandSitesError } from "../../../../services/brandSitesService";
import { AUTOSAVE_IDLE_MS } from "../../../../sites/draftWriter";
import { restoreColours, safeFontOverrides, safeTokenOverrides } from "../../../../sites/siteLook";
import { activeMood, applyMood, drawnContrastIssues, fixDrawnContrast, moodsFor, type MoodKey } from "../../../../sites/designMoods";
import { changeLabel } from "../../../../sites/sectionEdits";
import { DESIGNS, designFor, type DesignDefinition } from "../../../../../../packages/site-contracts/src/designs.ts";
import { resolveTokens, tokenCssDeclarations, type OwnerTokenOverrides } from "../../../../../../packages/site-contracts/src/tokens.ts";
import type { OwnerFontOverrides } from "../../../../../../packages/site-contracts/src/fontSlots.ts";
import { CONFLICT_MESSAGE, type Workspace } from "./useWorkspace";
import { GroupLabel, PanelNote, parts } from "./parts";

/*
 * #4453 — Design mode. Every pick shows on the page at once (the colours are
 * posted into the live draft) and is saved to the draft a moment later as one
 * undoable change; there is no Save button. A hard-to-read pair gets a
 * one-tap fix here, and until it is fixed Publish says so.
 */
type Look = { design: string; tokens: OwnerTokenOverrides; fonts: OwnerFontOverrides };
/** "As designed" and "not set" are the same choice; key order never matters. */
const tidy = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(tidy);
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => [key, tidy(entry)] as const)
    .filter(([, entry]) => entry !== undefined && entry !== null && entry !== "design" && !(typeof entry === "object" && !Array.isArray(entry) && Object.keys(entry as object).length === 0))
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
};
export const sameLook = (a: unknown, b: unknown): boolean => JSON.stringify(tidy(a)) === JSON.stringify(tidy(b));
const same = sameLook;

/** The part of the look that travels as `tokens` (colours and heading case). */
export function colourTokens(tokens: OwnerTokenOverrides): OwnerTokenOverrides {
  const { radius: _radius, button_shape: _shape, motion: _motion, ...rest } = tokens;
  return rest;
}

export const ARI_MOOD_REQUEST = "Make it feel more premium, keep it fun";

export function DesignPanel({ ws, onAskAri }: { ws: Workspace; onAskAri: (request: string) => void }): React.ReactElement {
  const ctx = useWebsite();
  const { brandId, setTokenDeclarations, setDesignDirty } = ctx;
  const client = useQueryClient();
  const look = useBrandSiteLook(brandId, ws.siteId);
  const stored = look.data;
  const storedLook: Look | null = useMemo(() => (stored
    ? { design: (designFor(stored.design) ?? DESIGNS.atelier).key, tokens: safeTokenOverrides(stored.tokens), fonts: safeFontOverrides(stored.fonts) }
    : null), [stored]);
  const [draft, setDraft] = useState<Look | null>(null);
  const [saving, setSaving] = useState(false);
  const current = draft ?? storedLook;
  const readOnly = ws.readOnly;
  const blocked = ws.readOnlyReason;

  const design: DesignDefinition = designFor(current?.design) ?? DESIGNS.atelier;
  const resolved = useMemo(() => resolveTokens(design.tokens, current?.tokens ?? {}), [current?.tokens, design]);
  const dirty = draft !== null && storedLook !== null && !same(draft, storedLook);

  // The page shows the pick at once; the save follows.
  useEffect(() => {
    setTokenDeclarations(dirty ? tokenCssDeclarations(resolved) : null);
    setDesignDirty(false);
  }, [dirty, resolved, setDesignDirty, setTokenDeclarations]);
  useEffect(() => () => setTokenDeclarations(null), [setTokenDeclarations]);

  // Something else changed the look (Undo, Ari, a teammate): follow it unless the owner is mid-change.
  useEffect(() => {
    if (draft !== null && storedLook !== null && same(draft, storedLook)) setDraft(null);
  }, [draft, storedLook]);

  const latest = useRef({ draft, storedLook, ws, label: "the design" });
  latest.current = { ...latest.current, draft, storedLook, ws };
  const busy = useRef(false);
  const lastSent = useRef<string | null>(null);
  const save = useCallback(async () => {
    const { draft: want, storedLook: have, ws: workspace, label } = latest.current;
    // The same look is never sent twice in a row: a save that changed nothing
    // on the server must not start a loop.
    const wanted = JSON.stringify(tidy(want));
    if (busy.current || !want || !have || same(want, have) || lastSent.current === wanted) return;
    lastSent.current = wanted;
    const revision = workspace.workspace?.look_revision ?? (typeof stored?.revision === "string" ? stored.revision : null);
    if (!revision) return;
    busy.current = true;
    setSaving(true);
    try {
      const result = await setSiteLook(workspace.siteId, {
        expectedRevision: revision,
        ...(want.design !== have.design ? { design: want.design } : {}),
        // As built: the owner's colours replace the stored ones whole, and
        // corners, button shape and movement travel beside them.
        tokens: colourTokens(want.tokens),
        fonts: want.fonts,
        radius: want.tokens.radius ?? "design",
        buttonShape: want.tokens.button_shape ?? "design",
        motion: want.tokens.motion ?? "design",
      }, null);
      client.setQueryData<SiteWorkspace>(brandSiteKeys.siteData(workspace.siteId, "workspace"), (value) => (value ? { ...value, look_revision: result.look_revision } : value));
      workspace.afterChange({ look: true });
      void label;
    } catch (error) {
      // Put the panel back to what is saved: a refused look never lingers on screen.
      setDraft(null);
      workspace.afterChange({ look: true });
      workspace.notify(error instanceof BrandSiteContentConflict
        ? { message: CONFLICT_MESSAGE, kind: "warn" }
        : { message: error instanceof BrandSitesError ? error.message : "Your design change didn’t save. Check your connection and try again.", kind: "error" });
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, [client, stored?.revision]);

  // Autosave: a moment after the last pick; a pick made mid-save is saved next.
  useEffect(() => {
    if (!dirty || saving) return undefined;
    const timer = setTimeout(() => { void save(); }, AUTOSAVE_IDLE_MS);
    return () => clearTimeout(timer);
  }, [dirty, draft, save, saving, storedLook]);

  const change = (next: Partial<Look>, what: string) => {
    if (!current) return;
    if (blocked) {
      ws.notify({ message: blocked, kind: "info" });
      return;
    }
    latest.current.label = changeLabel.look(what);
    setDraft({ ...current, ...next });
  };

  if (look.isLoading) {
    return <View style={parts.panelPad} role="status" accessibilityLabel="Loading your website design" testID="design-loading"><Skeleton height={72} /><Skeleton height={180} /><Skeleton height={220} /></View>;
  }
  if (look.isError || !current) {
    return (
      <View style={parts.panelPad}>
        <Banner tone="err" icon="alert" title="Your website design couldn’t be loaded" body={look.error instanceof BrandSitesError ? look.error.message : "Check your connection and try again."} testID="design-error">
          <WButton label="Try again" size="sm" onPress={() => { void look.refetch(); }} testID="design-retry" />
        </Banner>
      </View>
    );
  }

  const moods = moodsFor(design);
  const mood: MoodKey | null = activeMood(design, current.tokens);
  const issues = drawnContrastIssues(design, current.tokens);
  const fixed = issues.length ? fixDrawnContrast(design, current.tokens) : null;
  const chooseDesign = (key: string) => {
    if (key === design.key || !designFor(key)) return;
    // A new design brings its own colours and fonts; words, photos and pages stay.
    change({ design: key, tokens: restoreColours(current.tokens), fonts: {} }, "the design");
  };

  return (
    <View style={parts.panelPad} testID="design-panel">
      <WButton label={`Ask Ari: “${ARI_MOOD_REQUEST}”`} icon="spark" onPress={() => onAskAri(ARI_MOOD_REQUEST)} testID="design-ask-ari" />

      <View>
        <GroupLabel>Mood</GroupLabel>
        <View style={styles.moods} role="radiogroup" accessibilityRole="radiogroup" accessibilityLabel="Mood">
          {moods.map((entry) => {
            const on = mood === entry.key;
            return (
              <Pressable
                key={entry.key}
                onPress={() => change({ tokens: applyMood(design, current.tokens, entry.key) }, `the mood to ${entry.label}`)}
                role="radio"
                accessibilityRole="radio"
                aria-checked={on}
                accessibilityState={{ checked: on, disabled: readOnly }}
                accessibilityLabel={`${entry.label}. ${entry.describes}`}
                testID={`mood-${entry.key}`}
                style={[styles.mood, on ? styles.moodOn : null]}
              >
                <View style={styles.moodSwatch}>
                  {entry.swatches.map((hex, index) => <View key={`${index}-${hex}`} style={[styles.moodBand, { backgroundColor: hex }]} />)}
                </View>
                <Text style={styles.moodLabel} numberOfLines={1}>{entry.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {issues.length > 0 ? (
        <Banner tone="warn" icon="alert" title={issues[0]!.sentence} body={issues.length > 1 ? `And ${issues.length - 1} more. You can’t publish until text is readable.` : "You can’t publish until this is readable."} testID="contrast-guard">
          {fixed
            ? <WButton label="Fix it" variant="primary" size="sm" onPress={() => change({ tokens: fixed }, "hard-to-read colours")} testID="contrast-fix" />
            : <Text style={parts.small}>No close shade is readable here. Pick a different colour below.</Text>}
        </Banner>
      ) : null}

      <DesignCard design={design} onChoose={chooseDesign} disabled={readOnly} hint="Switching keeps all your words, photos and pages. Colours and fonts change to the new style’s. Undo puts it back." />
      <CoverCard disabled={readOnly} />
      <ColoursCard design={design} resolved={resolved} tokens={current.tokens} disabled={readOnly} guard onTokens={(tokens) => change({ tokens }, "a colour")} />
      <FontsCard design={design} fonts={current.fonts} disabled={readOnly} onFonts={(fonts) => change({ fonts }, "a font")} />
      <Card testID="design-shape">
        <CardTitle>Shape and movement</CardTitle>
        <ShapeRow label="Corners" field="radius" options={[["design", "As designed"], ["sharp", "Sharp"], ["soft", "Soft"], ["round", "Round"]]} tokens={current.tokens} onTokens={(tokens) => change({ tokens }, "the corners")} disabled={readOnly} />
        <ShapeRow label="Buttons" field="button_shape" options={[["design", "As designed"], ["pill", "Pill"], ["rounded", "Rounded"], ["square", "Square"]]} tokens={current.tokens} onTokens={(tokens) => change({ tokens }, "the button shape")} disabled={readOnly} />
        <ShapeRow label="Movement" field="motion" options={[["design", "As designed"], ["calm", "Calm"], ["lively", "Lively"], ["none", "None"]]} tokens={current.tokens} onTokens={(tokens) => change({ tokens }, "the movement")} disabled={readOnly} />
        <ShapeRow label="Headings" field="heading_case" options={[["design", "As designed"], ["uppercase", "Capitals"], ["none", "As written"]]} tokens={current.tokens} onTokens={(tokens) => change({ tokens }, "the heading style")} disabled={readOnly} />
        <Text style={styles.help}>Visitors whose device asks for less motion always get none.</Text>
      </Card>
      <PanelNote testID="design-autosave-note">
        {saving ? "Saving to your draft…" : "Your page changes as you pick. Words, photos and pages stay. Undo puts any choice back."}
      </PanelNote>
    </View>
  );
}

const styles = StyleSheet.create({
  moods: { flexDirection: "row", gap: space[2], marginTop: 6 },
  mood: { flex: 1, minWidth: 0, minHeight: 84, gap: 6, padding: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: ui.border2, backgroundColor: ui.card },
  moodOn: { borderColor: ui.t1, borderWidth: 2, padding: 7 },
  moodSwatch: { height: 36, borderRadius: radius.xs, overflow: "hidden", flexDirection: "row", borderWidth: 1, borderColor: color.line },
  moodBand: { flex: 1 },
  moodLabel: { fontSize: 13, fontWeight: "600", color: ui.t1 },
  help: { fontSize: 12, lineHeight: 16, color: ui.t3, marginTop: space[2] },
});
