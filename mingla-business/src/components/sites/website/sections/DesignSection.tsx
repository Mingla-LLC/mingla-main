import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useWebsite } from "../WebsiteContext";
import { Card, CardTitle, Chip, Hint, Segmented, SectionHead, Skeleton, Toggle, WButton, ui } from "../ui";
import { WebsiteIcon } from "../WebsiteIcon";
import { PhotoChooser } from "../PhotoField";
import { useFontSpecimens } from "../fontPreview";
import { useBrandSiteLook, useSaveBrandSiteLook } from "../../../../hooks/useBrandSite";
import { useBrand, useUpdateBrand } from "../../../../hooks/useBrands";
import { joinBrandDescription } from "../../../../services/brandMapping";
import { useFontSearch, useSetSiteCover, useSiteCover } from "../../../../sites/contentApi";
import { BrandSitesError } from "../../../../services/brandSitesService";
import { brandSiteKeys } from "../../../../sites/brandSiteKeys";
import { useQueryClient } from "@tanstack/react-query";
import {
  DESIGN_KEYS,
  DESIGNS,
  designFontSlots,
  designFor,
  designSwatches,
  type DesignDefinition,
} from "../../../../../../packages/site-contracts/src/designs.ts";
import {
  resolveTokens,
  tokenCssDeclarations,
  type OwnerTokenOverrides,
} from "../../../../../../packages/site-contracts/src/tokens.ts";
import type { OwnerFontOverrides } from "../../../../../../packages/site-contracts/src/fontSlots.ts";
import { readabilityWarnings } from "../../../../../../packages/site-contracts/src/readability.ts";
import { THEME_FONT_SLUGS } from "../../../../../../packages/offering-rendering/designTokens";
import {
  restoreColours,
  safeFontOverrides,
  safeTokenOverrides,
  setSwatch,
  slotFamily,
  swatchHex,
  swatchWarnings,
  type LookFontSlot,
  type LookSwatch,
} from "../../../../sites/siteLook";

/*
 * #2829 W9r (DESIGN_SPEC §3) — "Website design": the design (live
 * thumbnails), the cover, colours grouped by where they show (readability
 * warnings sit under the swatch they concern and never block), fonts drawn
 * in themselves, shape and motion, and "Also use on your Mingla page".
 * Changes are a draft until Save to draft; the preview beside shows them.
 */

type SwatchKey = string;
const keyOf = (swatch: LookSwatch): SwatchKey => (swatch.step === undefined ? swatch.role : `${swatch.role}:${swatch.step}`);

const GROUPS: readonly { name: string; items: readonly { role: string; label: string; where: string }[] }[] = [
  { name: "Backgrounds", items: [
    { role: "canvas", label: "Background", where: "Behind everything" },
    { role: "surface_sunken", label: "Tinted bands", where: "Soft sections between photos" },
    { role: "surface_deep", label: "Dark panels", where: "Reviews band and footer" },
  ] },
  { name: "Text", items: [
    { role: "ink_strong", label: "Headings", where: "Titles and trip names" },
    { role: "ink_body", label: "Text", where: "Paragraphs and details" },
  ] },
  { name: "Accents", items: [
    { role: "accent", label: "Accent", where: "Buttons and highlights" },
    { role: "accent_ink", label: "Text on buttons", where: "Words on accent buttons" },
    { role: "highlight", label: "Second accent", where: "Small labels like Sold out" },
  ] },
];

const SLOT_LABEL: Record<LookFontSlot, string> = { display: "Headings", body: "Body text", accent: "Accent lettering" };
const SPECIMEN: Record<LookFontSlot, string> = {
  display: "Leave with your people",
  body: "Every word on your website, set in this font.",
  accent: "Arrive alone.",
};
const STYLE_FILTERS = [
  { value: "all", label: "All" },
  { value: "sans-serif", label: "Sans" },
  { value: "serif", label: "Serif" },
  { value: "display", label: "Display" },
  { value: "handwriting", label: "Handwriting" },
] as const;

export function themeSlugFor(family: string): string | null {
  const slug = family.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return (THEME_FONT_SLUGS as readonly string[]).includes(slug) ? slug : null;
}

export function DesignSection(): React.ReactElement {
  const ctx = useWebsite();
  const { controller, phone, headingRef, lock, toast, brandId } = ctx;
  const siteId = controller.siteId;
  const look = useBrandSiteLook(brandId, siteId);
  const save = useSaveBrandSiteLook(brandId, siteId);
  const brand = useBrand(brandId);
  const updateBrand = useUpdateBrand();
  const queryClient = useQueryClient();
  const [designKey, setDesignKey] = useState<string | null>(null);
  const [tokens, setTokens] = useState<OwnerTokenOverrides | null>(null);
  const [fonts, setFonts] = useState<OwnerFontOverrides | null>(null);
  const [alsoMingla, setAlsoMingla] = useState(false);
  const readOnly = lock.heldByOther;

  const stored = look.data;
  const storedDesign = designFor(stored?.design) ?? DESIGNS.atelier;
  const design: DesignDefinition = designFor(designKey) ?? storedDesign;
  const currentTokens = tokens ?? safeTokenOverrides(stored?.tokens);
  const currentFonts = fonts ?? safeFontOverrides(stored?.fonts);
  const resolved = useMemo(() => resolveTokens(design.tokens, currentTokens), [design, currentTokens]);
  const dirty = stored !== undefined && (
    (designKey !== null && designKey !== storedDesign.key) ||
    JSON.stringify(currentTokens) !== JSON.stringify(safeTokenOverrides(stored.tokens)) ||
    JSON.stringify(currentFonts) !== JSON.stringify(safeFontOverrides(stored.fonts)) ||
    alsoMingla
  );

  // The rail dot, the preview's "Unsaved" chip, the leave confirm, and the
  // unsaved colours posted into the preview (debounced there).
  const { setDesignDirty, setTokenDeclarations, setStickyBar } = ctx;
  useEffect(() => {
    setDesignDirty(dirty);
    setTokenDeclarations(dirty ? tokenCssDeclarations(resolved) : null);
  }, [dirty, resolved, setDesignDirty, setTokenDeclarations]);
  useEffect(() => () => {
    setDesignDirty(false);
    setTokenDeclarations(null);
    setStickyBar(null);
  }, [setDesignDirty, setStickyBar, setTokenDeclarations]);

  const discard = () => {
    setDesignKey(null);
    setTokens(null);
    setFonts(null);
    setAlsoMingla(false);
  };

  const onSave = () => {
    if (!stored) return;
    const familyOf = (slot: LookFontSlot) => slotFamily(design, currentFonts, slot);
    save.mutate(
      { revision: stored.revision, tokens: currentTokens, fonts: currentFonts, ...(designKey ? { design: designKey } : {}) },
      {
        onSuccess: async () => {
          if (alsoMingla && brand.data && controller.user?.id) {
            const slug = designFontSlots(design).every((slot) => themeSlugFor(familyOf(slot)) !== null) ? themeSlugFor(familyOf("display")) : null;
            const accentHex = swatchHex(resolved, { label: "Accent", role: "accent", step: 400 });
            try {
              await updateBrand.mutateAsync({
                brandId,
                patch: { theme: { ...(brand.data.theme ?? {}), color: accentHex, ...(slug ? { font: slug } : {}) } },
                existingDescription: joinBrandDescription(brand.data.tagline, brand.data.bio),
                accountId: controller.user.id,
              });
            } catch {
              toast("Your website design is saved, but your Mingla page didn’t update. Try again.", "error");
            }
          }
          discard();
          void queryClient.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "preview") });
          void queryClient.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "changes") });
          toast("Saved to your draft. Publish when you're ready.", "success");
        },
        onError: (error) => toast(error instanceof BrandSitesError ? error.message : "Your design couldn’t be saved. Try again.", "error"),
      },
    );
  };
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const discardRef = useRef(discard);
  discardRef.current = discard;
  useEffect(() => {
    setStickyBar(dirty && !readOnly ? {
      text: "Unsaved changes to your design",
      actions: [
        { label: "Discard", variant: "ghost", onPress: () => discardRef.current(), testID: "design-discard" },
        { label: "Save to draft", variant: "primary", onPress: () => saveRef.current(), loading: save.isPending, testID: "design-save" },
      ],
    } : null);
  }, [dirty, readOnly, save.isPending, setStickyBar]);

  if (look.isLoading) {
    return <View role="status" accessibilityLabel="Loading your website design"><Skeleton height={32} width="40%" style={{ marginBottom: 16 }} /><Skeleton height={180} style={{ marginBottom: 16 }} /><Skeleton height={260} /></View>;
  }
  if (look.isError || !stored) {
    return (
      <Card>
        <CardTitle>Your website design couldn&apos;t be loaded</CardTitle>
        <Hint>{look.error instanceof BrandSitesError ? look.error.message : "Check your connection and try again."}</Hint>
        <WButton label="Try again" size="sm" onPress={() => { void look.refetch(); }} style={{ marginTop: 12, alignSelf: "flex-start" }} />
      </Card>
    );
  }

  const chooseDesign = (key: string) => {
    if (key === design.key) return;
    const next = designFor(key);
    if (!next) return;
    setDesignKey(key);
    // Colours and fonts reset to the new design's own (Discard undoes it).
    setTokens(restoreColours(currentTokens));
    setFonts({});
    toast(`Switched to ${next.label}. Save to keep it, or Discard to undo.`);
  };

  return (
    <View testID="website-design">
      <SectionHead ref={headingRef} phone={phone} title="Website design" subtitle="Any colour and any Google font. We point out text that's hard to read, but we never change your choices." />
      <DesignCard design={design} onChoose={chooseDesign} disabled={readOnly} />
      <CoverCard disabled={readOnly} />
      <ColoursCard
        design={design}
        resolved={resolved}
        tokens={currentTokens}
        disabled={readOnly}
        onTokens={setTokens}
      />
      <FontsCard design={design} fonts={currentFonts} disabled={readOnly} onFonts={setFonts} />
      <Card testID="design-shape">
        <CardTitle>Shape and motion</CardTitle>
        <ShapeRow label="Buttons" field="button_shape" options={[["design", "As designed"], ["pill", "Pill"], ["rounded", "Rounded"], ["square", "Square"]]} tokens={currentTokens} onTokens={setTokens} disabled={readOnly} />
        <ShapeRow label="Corners" field="radius" options={[["design", "As designed"], ["sharp", "Sharp"], ["soft", "Soft"], ["round", "Round"]]} tokens={currentTokens} onTokens={setTokens} disabled={readOnly} />
        <ShapeRow label="Movement" field="motion" options={[["design", "As designed"], ["calm", "Calm"], ["lively", "Lively"], ["none", "None"]]} tokens={currentTokens} onTokens={setTokens} disabled={readOnly} />
        <Text style={styles.help}>Visitors whose device asks for less motion always get none.</Text>
      </Card>
      <MinglaPageCard design={design} fonts={currentFonts} value={alsoMingla} onChange={setAlsoMingla} disabled={readOnly} />
    </View>
  );
}

function DesignCard({ design, onChoose, disabled }: { design: DesignDefinition; onChoose: (key: string) => void; disabled: boolean }): React.ReactElement {
  const ctx = useWebsite();
  // Each tile's headline is drawn in that design's own heading font (web).
  const drawable = useFontSpecimens(ctx.controller.siteId, DESIGN_KEYS.map((key) => DESIGNS[key].fonts.display.family));
  return (
    <Card testID="design-designs">
      <CardTitle>Design</CardTitle>
      <Hint style={styles.cardHint}>Switching keeps all your words, photos and pages. Colours and fonts reset to the new design&apos;s, and you can undo before saving.</Hint>
      <View style={styles.tiles} role="radiogroup" accessibilityLabel="Design">
        {DESIGN_KEYS.map((key) => {
          const option = DESIGNS[key];
          const checked = option.key === design.key;
          const colors = option.tokens.colors as unknown as Record<string, unknown>;
          const ramp = colors.accent as { seed?: string; ramp?: Record<number, string> } | undefined;
          const accent = ramp?.ramp?.[400] ?? ramp?.seed ?? String(colors.action ?? "#888888");
          const headlineFont = drawable(option.fonts.display.family);
          return (
            <Pressable
              key={key}
              onPress={disabled ? undefined : () => onChoose(key)}
              role="radio"
              accessibilityRole="radio"
              aria-checked={checked}
              accessibilityState={{ checked, disabled }}
              accessibilityLabel={`${option.label}. ${option.description}`}
              testID={`design-tile-${key}`}
              style={[styles.tile, checked ? styles.tileOn : null]}
            >
              <View style={[styles.tileThumb, { backgroundColor: String(colors.canvas ?? "#ffffff") }]}>
                <View style={[styles.tileBand, { backgroundColor: String(colors.surface_deep ?? "#222222") }]} />
                <Text
                  style={[styles.tileHeadline, {
                    fontFamily: headlineFont ?? option.fonts.display.family,
                    textTransform: option.tokens.heading_case === "uppercase" ? "uppercase" : "none",
                  }]}
                  numberOfLines={2}
                >
                  Leave with your people
                </Text>
                <View style={[styles.tileButton, { backgroundColor: accent, borderRadius: key === "voyage" ? 999 : 2 }]} />
              </View>
              <View style={styles.tileBody}>
                <View style={styles.tileTitleRow}>
                  <Text style={styles.tileName}>{option.label}</Text>
                  {checked ? <Chip label="In use" tone="accent" /> : null}
                </View>
                <Text style={styles.tileDesc}>{option.description}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

function CoverCard({ disabled }: { disabled: boolean }): React.ReactElement {
  const ctx = useWebsite();
  const cover = useSiteCover(ctx.controller.siteId);
  const setCover = useSetSiteCover(ctx.controller.siteId);
  const [choosing, setChoosing] = useState<null | "image" | "video">(null);
  const data = cover.data;
  const apply = (input: { photoMediaId?: string; videoMediaId?: string | null }, done: string) => {
    if (!data?.revision) return;
    setCover.mutate({ revision: data.revision, ...input }, {
      onSuccess: () => ctx.toast(done, "success"),
      onError: (error) => ctx.toast(error instanceof BrandSitesError ? error.message : "Your cover didn’t save. Try again.", "error"),
    });
  };
  const seconds = data?.video?.duration_ms ? Math.round(data.video.duration_ms / 1000) : null;
  return (
    <Card testID="design-cover">
      <CardTitle>Cover</CardTitle>
      <Hint style={styles.cardHint}>The big photo or video at the top of your home page. Videos play muted, on a loop, with a pause button; phones in low-data or reduced-motion mode see a still frame.</Hint>
      {cover.isLoading ? <Skeleton height={140} /> : !data?.available ? (
        <Hint>Your home page has no cover section. Add one in the page editor.</Hint>
      ) : (
        <View style={styles.coverRow}>
          <View style={styles.coverSlot}>
            {data.photo?.thumb_url ? <Image source={{ uri: data.photo.thumb_url }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel="Your cover" /> : null}
            {data.video || data.photo ? (
              <View style={styles.coverChip}>
                <WebsiteIcon name={data.video ? "video" : "image"} size={14} color="#ffffff" />
                <Text style={styles.coverChipText} numberOfLines={1}>{data.video ? `${data.video.name}${seconds ? ` · ${seconds} s` : ""}` : data.photo!.name}</Text>
              </View>
            ) : (
              <><WebsiteIcon name="image" size={24} color={ui.t3} /><Text style={styles.coverEmpty}>No cover · your dark panel colour is used</Text></>
            )}
          </View>
          <View style={styles.coverActions}>
            <WButton label="Choose a photo" icon="image" size="sm" onPress={() => setChoosing("image")} disabled={disabled || setCover.isPending} testID="cover-photo" />
            <WButton label="Choose a video (up to 15 s)" icon="video" size="sm" onPress={() => setChoosing("video")} disabled={disabled || setCover.isPending} testID="cover-video" />
            {data.video ? (
              <WButton label="Remove cover video" variant="ghost" size="sm" onPress={() => apply({ videoMediaId: null }, "Cover video removed from your draft. Your photo shows instead.")} disabled={disabled} loading={setCover.isPending} testID="cover-remove" />
            ) : null}
          </View>
        </View>
      )}
      <PhotoChooser
        visible={choosing !== null}
        kind={choosing ?? "image"}
        onClose={() => setChoosing(null)}
        onPick={(picked) => {
          const kind = choosing;
          setChoosing(null);
          if (kind === "video") apply({ videoMediaId: picked.id }, "Cover video saved to your draft.");
          else apply({ photoMediaId: picked.id }, "Cover photo saved to your draft.");
        }}
      />
    </Card>
  );
}

function ColoursCard({ design, resolved, tokens, disabled, onTokens }: {
  design: DesignDefinition;
  resolved: ReturnType<typeof resolveTokens>;
  tokens: OwnerTokenOverrides;
  disabled: boolean;
  onTokens: (next: OwnerTokenOverrides) => void;
}): React.ReactElement {
  const { toast } = useWebsite();
  const drawn = designSwatches(design);
  const byRole = new Map(drawn.map((swatch) => [swatch.role as string, swatch]));
  const [kept, setKept] = useState<Set<string>>(new Set());
  const placed = swatchWarnings(design, resolved);
  const count = readabilityWarnings(resolved).length;
  return (
    <Card testID="design-colours">
      <View style={styles.cardTitleRow}>
        <CardTitle style={styles.grow}>Colours</CardTitle>
        <Chip label={count ? `${count} hard to read` : "Easy to read"} tone={count ? "warn" : "ok"} testID="colours-readability" />
      </View>
      <Hint>{`Only the colours ${design.label} uses are shown. Tap a swatch to pick, or type a hex code.`}</Hint>
      {GROUPS.map((group) => {
        const items = group.items.filter((item) => byRole.has(item.role));
        if (!items.length) return null;
        return (
          <View key={group.name}>
            <Text style={styles.groupName}>{group.name}</Text>
            {items.map((item) => {
              const swatch = byRole.get(item.role)!;
              const hex = swatchHex(resolved, swatch);
              const warning = placed.get(item.role)?.warning;
              const suggestion = placed.get(item.role)?.suggestion ?? null;
              return (
                <View key={keyOf(swatch)}>
                  <SwatchRow
                    swatch={swatch}
                    label={item.label}
                    where={item.where}
                    hex={hex}
                    disabled={disabled}
                    onSet={(typed) => {
                      const next = setSwatch(tokens, swatch, typed);
                      if (next) onTokens(next);
                      return next !== null;
                    }}
                  />
                  {warning && !kept.has(warning.pair) ? (
                    <View style={styles.warnLine} role="status" testID={`readability-${item.role}`}>
                      <WebsiteIcon name="alert" size={14} color="#fde2a8" />
                      <Text style={styles.warnText}>{`${warning.where} is hard to read (${warning.ratio.toFixed(1)}:1; aim for ${warning.required}:1).`}</Text>
                      {suggestion ? (
                        <>
                          <View style={[styles.warnSwatch, { backgroundColor: suggestion }]} />
                          <WButton label={`Use ${suggestion}`} size="sm" onPress={() => {
                            const next = setSwatch(tokens, swatch, suggestion);
                            if (next) onTokens(next);
                          }} disabled={disabled} testID={`readability-use-${item.role}`} />
                        </>
                      ) : null}
                      <WButton label="Keep mine" variant="ghost" size="sm" onPress={() => {
                        setKept((previous) => new Set([...previous, warning.pair]));
                        toast("Kept as you chose. The warning stays in your publish checks; it never blocks publishing.");
                      }} testID={`readability-keep-${item.role}`} />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        );
      })}
      <WButton label={`Restore ${design.label}'s colours`} variant="ghost" size="sm" onPress={() => onTokens(restoreColours(tokens))} disabled={disabled} style={styles.restore} testID="colours-restore" />
    </Card>
  );
}

function SwatchRow({ swatch, label, where, hex, disabled, onSet }: {
  swatch: LookSwatch;
  label: string;
  where: string;
  hex: string;
  disabled: boolean;
  onSet: (typed: string) => boolean;
}): React.ReactElement {
  const [draft, setDraft] = useState(hex);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  useEffect(() => {
    setDraft(hex);
  }, [hex]);
  // Applies on change when valid, and on blur / Tab / Enter; a value that
  // isn't a colour is kept in the box with the reason (never dropped).
  const commit = () => {
    if (draft.trim().toLowerCase() === hex.toLowerCase()) {
      setError(null);
      return;
    }
    setError(onSet(draft.trim()) ? null : "That isn't a colour code. Try something like #89cff0");
  };
  return (
    <View style={styles.swatchRow}>
      <Pressable
        style={[styles.swatch, { backgroundColor: hex }]}
        onPress={Platform.OS === "web" ? undefined : () => inputRef.current?.focus()}
        accessibilityLabel={`${label} colour picker`}
        role="button"
        disabled={disabled}
      >
        {Platform.OS === "web" ? React.createElement("input", {
          type: "color",
          value: /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : "#000000",
          disabled,
          "aria-label": `${label} colour picker`,
          "data-testid": `swatch-picker-${swatch.role}`,
          onChange: (event: { target: { value: string } }) => {
            setDraft(event.target.value);
            onSet(event.target.value);
          },
          style: { position: "absolute", inset: -6, width: 60, height: 60, opacity: 0, cursor: disabled ? "not-allowed" : "pointer" },
        }) : null}
      </Pressable>
      <View style={styles.grow}>
        <Text style={styles.swatchLabel}>{label}</Text>
        <Hint>{where}</Hint>
        {error ? <Text style={styles.error} role="alert">{error}</Text> : null}
      </View>
      <TextInput
        ref={inputRef}
        value={draft}
        onChangeText={(value) => {
          setDraft(value);
          if (/^#?[0-9a-f]{6}$/i.test(value.trim())) {
            setError(null);
            onSet(value.trim());
          }
        }}
        onBlur={commit}
        onSubmitEditing={commit}
        onEndEditing={commit}
        editable={!disabled}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        maxLength={7}
        accessibilityLabel={`${label} hex code`}
        aria-invalid={error ? true : undefined}
        testID={`swatch-hex-${swatch.role}`}
        style={[styles.hex, error ? styles.hexError : null]}
      />
    </View>
  );
}

function FontsCard({ design, fonts, disabled, onFonts }: {
  design: DesignDefinition;
  fonts: OwnerFontOverrides;
  disabled: boolean;
  onFonts: (next: OwnerFontOverrides) => void;
}): React.ReactElement {
  const ctx = useWebsite();
  const slots = designFontSlots(design) as LookFontSlot[];
  const [open, setOpen] = useState<LookFontSlot | null>(null);
  const families = slots.map((slot) => slotFamily(design, fonts, slot));
  const drawable = useFontSpecimens(ctx.controller.siteId, families);
  return (
    <Card testID="design-fonts">
      <CardTitle>Fonts</CardTitle>
      <Hint>Any Google font. Your website serves fonts itself, so visitors never contact Google.</Hint>
      {slots.map((slot) => {
        const family = slotFamily(design, fonts, slot);
        const isDefault = family === (slot === "accent" ? design.fonts.accent?.family ?? "" : design.fonts[slot].family);
        const alias = drawable(family);
        return (
          <View key={slot} style={styles.fontSlot} testID={`font-slot-${slot}`}>
            <View style={styles.fontSlotRow}>
              <View style={styles.grow}>
                <Text style={styles.fontSlotLabel}>{SLOT_LABEL[slot]}</Text>
                <Text style={[styles.specimen, alias ? { fontFamily: alias } : null]} numberOfLines={1}>{SPECIMEN[slot]}</Text>
                <Hint>{isDefault ? `${family} · ${design.label}'s font` : family}</Hint>
              </View>
              <WButton
                label={open === slot ? "Close" : "Change"}
                size="sm"
                onPress={() => setOpen(open === slot ? null : slot)}
                disabled={disabled}
                accessibilityLabel={`${open === slot ? "Close" : "Change"} the ${SLOT_LABEL[slot].toLowerCase()} font`}
                testID={`font-change-${slot}`}
              />
            </View>
            {open === slot ? (
              <FontPicker
                slot={slot}
                current={family}
                onPick={(picked) => {
                  const next = { ...fonts, [slot]: { family: picked, source: "google" } } as OwnerFontOverrides;
                  onFonts(next);
                  setOpen(null);
                }}
              />
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

function FontPicker({ slot, current, onPick }: { slot: LookFontSlot; current: string; onPick: (family: string) => void }): React.ReactElement {
  const ctx = useWebsite();
  const [query, setQuery] = useState("");
  const [style, setStyle] = useState<(typeof STYLE_FILTERS)[number]["value"]>("all");
  const search = useFontSearch(ctx.controller.siteId, query.trim(), style === "all" ? null : style, true);
  const results = search.data ?? [];
  const drawable = useFontSpecimens(ctx.controller.siteId, results.slice(0, 12).map((font) => font.family));
  return (
    <View style={styles.picker}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search all Google fonts"
        placeholderTextColor={ui.t4}
        accessibilityLabel={`Search Google fonts for ${SLOT_LABEL[slot]}`}
        autoFocus
        style={styles.search}
        testID="font-search"
      />
      <View style={styles.styleChips}>
        <Segmented label="Font style" compact options={STYLE_FILTERS.map((option) => ({ value: option.value, label: option.label }))} value={style} onChange={setStyle} testIDPrefix="font-style" />
      </View>
      {search.isLoading ? <Hint>Searching…</Hint> : search.isError ? <Hint>The font list couldn&apos;t be loaded. Try again.</Hint> : results.length === 0 ? (
        <Text style={styles.help}>{`No Google font called "${query}". Check the spelling, or try a style above.`}</Text>
      ) : (
        <View>
          {results.map((font) => {
            const alias = drawable(font.family);
            const onPage = themeSlugFor(font.family) !== null;
            return (
              <Pressable
                key={font.family}
                onPress={() => onPick(font.family)}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={`Use ${font.family} for ${SLOT_LABEL[slot]}`}
                style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.result, hovered ? styles.resultHover : null]}
                testID={`font-result-${font.family}`}
              >
                <Text style={[styles.resultSpecimen, alias ? { fontFamily: alias } : styles.resultLoading]} numberOfLines={1}>
                  {slot === "accent" ? "Arrive alone." : ctx.brandName}
                </Text>
                <View style={styles.resultMeta}>
                  <Text style={styles.resultName} numberOfLines={1}>{font.family}</Text>
                  <Hint>{`${font.category === "sans-serif" ? "Sans" : font.category[0]!.toUpperCase() + font.category.slice(1)}${onPage ? " · on Mingla page" : ""}`}</Hint>
                </View>
                {font.family === current ? <WebsiteIcon name="check" color={ui.accent} /> : <View style={{ width: 18 }} />}
              </Pressable>
            );
          })}
          <Text style={styles.help}>{`Showing ${results.length} of 1,700+ families. Each row is drawn in its own font.`}</Text>
        </View>
      )}
    </View>
  );
}

function ShapeRow({ label, field, options, tokens, onTokens, disabled }: {
  label: string;
  field: "button_shape" | "radius" | "motion";
  options: readonly [string, string][];
  tokens: OwnerTokenOverrides;
  onTokens: (next: OwnerTokenOverrides) => void;
  disabled: boolean;
}): React.ReactElement {
  return (
    <View style={styles.shapeRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Segmented
        label={label}
        options={options.map(([value, text]) => ({ value, label: text }))}
        value={String(tokens[field] ?? "design")}
        onChange={(value) => onTokens({ ...tokens, [field]: value } as OwnerTokenOverrides)}
        disabled={disabled}
        testIDPrefix={`shape-${field}`}
      />
    </View>
  );
}

function MinglaPageCard({ design, fonts, value, onChange, disabled }: {
  design: DesignDefinition;
  fonts: OwnerFontOverrides;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
}): React.ReactElement {
  const families = (designFontSlots(design) as LookFontSlot[]).map((slot) => slotFamily(design, fonts, slot)).filter(Boolean);
  const notOnPage = families.filter((family) => themeSlugFor(family) === null);
  const copy = notOnPage.length === 0
    ? "Copies your accent colour and fonts to your Mingla brand page, trip pages and checkout, so they match your website."
    : `Copies your accent colour. Your Mingla page offers 14 fonts and ${[...new Set(notOnPage)].join(" and ")} ${notOnPage.length > 1 ? "aren't" : "isn't"} one of them, so it keeps its current font.`;
  return (
    <Card testID="design-mingla-page">
      <View style={styles.cardTitleRow}>
        <View style={styles.grow}>
          <CardTitle>Also use on your Mingla page</CardTitle>
          <Hint>{copy}</Hint>
        </View>
        <Toggle value={value} onChange={onChange} label="Also use on your Mingla page" disabled={disabled} testID="design-also-mingla" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  cardHint: { marginBottom: 12 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: { flexGrow: 1, flexBasis: 150, maxWidth: 220, borderWidth: 1, borderColor: ui.border2, borderRadius: 16, overflow: "hidden", backgroundColor: ui.card },
  tileOn: { borderColor: ui.accent, borderWidth: 2 },
  tileThumb: { height: 96, overflow: "hidden" },
  tileBand: { position: "absolute", left: 0, right: 0, top: 0, bottom: "40%" },
  tileHeadline: { position: "absolute", left: 10, right: 10, top: 14, color: "#ffffff", fontSize: 13, fontWeight: "800" },
  tileButton: { position: "absolute", left: 10, bottom: 8, width: 64, height: 16 },
  tileBody: { padding: 12, gap: 2 },
  tileTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  tileName: { fontSize: 14, fontWeight: "700", color: ui.t1 },
  tileDesc: { fontSize: 12, lineHeight: 16, color: ui.t3 },
  coverRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "stretch" },
  coverSlot: { flex: 1, minWidth: 200, minHeight: 140, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", alignItems: "flex-start", justifyContent: "flex-end", padding: 10, backgroundColor: "rgba(255,255,255,0.02)" },
  coverChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 999, paddingHorizontal: 9, height: 24, maxWidth: "100%" },
  coverChipText: { color: "#ffffff", fontSize: 12, fontWeight: "600" },
  coverEmpty: { color: ui.t3, fontSize: 13 },
  coverActions: { minWidth: 200, gap: 8 },
  groupName: { marginTop: 16, marginBottom: 4, fontSize: 12, fontWeight: "600", color: ui.t3 },
  swatchRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  swatch: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", overflow: "hidden" },
  swatchLabel: { fontSize: 14, fontWeight: "700", color: ui.t1 },
  hex: { width: 112, minHeight: 40, borderRadius: 12, borderWidth: 1, borderColor: ui.border2, backgroundColor: "rgba(255,255,255,0.03)", paddingHorizontal: 10, color: ui.t1, fontSize: 13, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, Menlo, monospace" }) },
  hexError: { borderColor: "#f87171" },
  error: { fontSize: 12, color: ui.err, marginTop: 2 },
  warnLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginLeft: 52, marginTop: 6, marginBottom: 2, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: Platform.OS === "android" ? "#362811" : "rgba(245, 158, 11, 0.18)" },
  warnText: { flex: 1, minWidth: 180, fontSize: 12.5, lineHeight: 17, color: "#fde2a8" },
  warnSwatch: { width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
  restore: { alignSelf: "flex-start", marginTop: 10 },
  fontSlot: { borderWidth: 1, borderColor: ui.cardBorder, borderRadius: 12, padding: 12, marginTop: 10 },
  fontSlotRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  fontSlotLabel: { fontSize: 13, fontWeight: "700", color: ui.t2 },
  specimen: { fontSize: 30, lineHeight: 36, color: ui.t1, marginVertical: 4 },
  picker: { marginTop: 12 },
  search: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: ui.border2, backgroundColor: "rgba(255,255,255,0.03)", paddingHorizontal: 12, color: ui.t1, fontSize: 14 },
  styleChips: { marginVertical: 10 },
  result: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingVertical: 8, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: ui.cardBorder },
  resultHover: { backgroundColor: ui.card2 },
  resultSpecimen: { flex: 1, minWidth: 0, fontSize: 22, color: ui.t1 },
  resultLoading: { opacity: 0.6 },
  resultMeta: { width: 130, alignItems: "flex-end" },
  resultName: { fontSize: 12, color: ui.t2, textAlign: "right" },
  shapeRow: { marginTop: 14 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: ui.t2, marginBottom: 6 },
  help: { fontSize: 12, lineHeight: 16, color: ui.t3, marginTop: 10 },
});

