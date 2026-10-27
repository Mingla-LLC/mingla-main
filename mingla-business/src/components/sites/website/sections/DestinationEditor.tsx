import React, { useEffect, useState } from "react";
import { Image, StyleSheet, Text, TextInput, View } from "react-native";
import { useWebsite } from "../WebsiteContext";
import { Card, CardTitle, Field, Hint, ListBox, MiniButton, Row, SectionHead, Skeleton, Toggle, WButton, ui } from "../ui";
import { WebsiteIcon } from "../WebsiteIcon";
import { PhotoChooser, PhotoSlot } from "../PhotoField";
import {
  BrandSiteContentConflict,
  useContentEntry,
  useContentRowActions,
  useSaveContentEntry,
  useSitePages,
  type DestinationDetail,
  type PictureRef,
} from "../../../../sites/contentApi";
import type { RichTextDoc } from "../../../../../../packages/site-contracts/src/richText.ts";
import { ConflictBanner, DeleteEntry, EditorCrumb, OfferingPicker, RichTextEditor, saveErrorMessage, useEditorChrome } from "./EditorKit";


type Season = { heading: string; body: string; activities: string[]; image: PictureRef | null };
type Form = {
  title: string;
  slug: string;
  country: string;
  tagline: string;
  summary: string;
  featured: PictureRef | null;
  gallery: (PictureRef & { alt: string })[];
  storyHeading: string;
  body: RichTextDoc | null;
  facts: { language: string; currency: string; timezone: string; religion: string };
  seasons: Season[];
  didYouKnow: string[];
  trips: string[];
  enabled: boolean;
  noindex: boolean;
};

const BLANK: Form = {
  title: "", slug: "", country: "", tagline: "", summary: "", featured: null, gallery: [], storyHeading: "", body: null,
  facts: { language: "", currency: "", timezone: "", religion: "" }, seasons: [], didYouKnow: [], trips: [], enabled: false, noindex: false,
};

function formOf(entry: DestinationDetail): Form {
  return {
    title: entry.title,
    slug: entry.slug,
    country: entry.country ?? "",
    tagline: entry.tagline ?? "",
    summary: entry.summary ?? "",
    featured: entry.featured_image,
    gallery: entry.gallery.map((row) => ({ id: row.id, thumb_url: row.thumb_url, alt: row.alt ?? "" })),
    storyHeading: entry.story_heading ?? "",
    body: entry.body,
    facts: {
      language: entry.facts.language ?? "",
      currency: entry.facts.currency ?? "",
      timezone: entry.facts.timezone ?? "",
      religion: entry.facts.religion ?? "",
    },
    seasons: entry.seasons.map((row) => ({ heading: row.heading, body: row.body ?? "", activities: row.activities, image: row.image })),
    didYouKnow: entry.did_you_know,
    trips: entry.related_offerings,
    enabled: entry.enabled,
    noindex: entry.seo.noindex,
  };
}

/** What the app writes (Studio caps and checks every field again). */
export function destinationWrite(form: Form, isNew: boolean): Record<string, unknown> {
  return {
    title: form.title,
    ...(isNew && !form.slug ? {} : { slug: form.slug || null }),
    country: form.country || null,
    tagline: form.tagline || null,
    summary: form.summary || null,
    featured_image: form.featured?.id ?? null,
    gallery: form.gallery.map((row) => ({ media: row.id, alt: row.alt || null })),
    story_heading: form.storyHeading || null,
    body: form.body,
    facts: {
      language: form.facts.language || null,
      currency: form.facts.currency || null,
      timezone: form.facts.timezone || null,
      religion: form.facts.religion || null,
    },
    seasons: form.seasons.filter((row) => row.heading.trim()).map((row) => ({
      heading: row.heading,
      body: row.body || null,
      activities: row.activities.filter((text) => text.trim()),
      image: row.image?.id ?? null,
    })),
    did_you_know: form.didYouKnow.filter((text) => text.trim()),
    related_offerings: form.trips,
    enabled: form.enabled,
    seo: { noindex: form.noindex },
  };
}

const slugOf = (name: string) => name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

/**
 * #2829 W9r (DESIGN_SPEC §1.6 Destination editor) — every field the
 * destination page shows, photos with descriptions, the Mingla trips that go
 * there (dates and spots stay Mingla's), and visibility.
 */
export function DestinationEditor({ entryId }: { entryId: string | "new" }): React.ReactElement {
  const ctx = useWebsite();
  const { controller, phone, headingRef, lock, toast } = ctx;
  const isNew = entryId === "new";
  const entry = useContentEntry<DestinationDetail>(controller.siteId, "destinations", isNew ? null : entryId);
  const save = useSaveContentEntry(controller.siteId, "destinations");
  const remove = useContentRowActions(controller.siteId, "destinations").remove;
  const [form, setForm] = useState<Form | null>(isNew ? BLANK : null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [conflict, setConflict] = useState<BrandSiteContentConflict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pages = useSitePages(controller.siteId);
  const destinationsPath = pages.data?.pages.find((page) => page.collection_kind === "destinations")?.path ?? "destinations";
  const readOnly = lock.heldByOther;

  useEffect(() => {
    if (!isNew && entry.data && form === null) setForm(formOf(entry.data));
  }, [entry.data, form, isNew]);

  const doSave = (revision?: string) => {
    if (!form) return;
    if (!form.title.trim()) {
      setError("Add a name first.");
      return;
    }
    setError(null);
    save.mutate({ id: isNew ? null : entryId, revision: isNew ? null : revision ?? entry.data?.revision ?? null, data: destinationWrite(form, isNew) }, {
      onSuccess: () => {
        setConflict(null);
        toast("Saved to your draft", "success");
        ctx.go({ kind: "section", section: "destinations" });
      },
      onError: (failure) => {
        if (failure instanceof BrandSiteContentConflict) setConflict(failure);
        else toast(saveErrorMessage(failure), "error");
      },
    });
  };
  useEditorChrome({
    isNew,
    saving: save.isPending,
    disabled: readOnly || form === null,
    onSave: () => doSave(),
    onCancel: () => ctx.go({ kind: "section", section: "destinations" }),
  });

  if (!isNew && entry.isLoading) return <View role="status" accessibilityLabel="Loading this destination"><Skeleton height={32} width="40%" style={{ marginBottom: 16 }} /><Skeleton height={300} /></View>;
  if (!isNew && (entry.isError || !form)) {
    return (
      <Card>
        <CardTitle>This destination couldn&apos;t be loaded</CardTitle>
        <Hint>{saveErrorMessage(entry.error)}</Hint>
        <WButton label="Back to Destinations" size="sm" onPress={() => ctx.go({ kind: "section", section: "destinations" })} style={{ alignSelf: "flex-start", marginTop: 12 }} />
      </Card>
    );
  }
  const f = form!;
  const set = (patch: Partial<Form>) => setForm({ ...f, ...patch });
  const base = destinationsPath;
  const missingAlt = f.gallery.filter((row) => !row.alt.trim()).length;
  const title = isNew ? "New destination" : f.title || "Destination";

  return (
    <View testID="destination-editor">
      <EditorCrumb section="destinations" label="Destinations" current={title} />
      {conflict ? (
        <ConflictBanner
          conflict={conflict}
          onViewTheirs={() => {
            setConflict(null);
            void entry.refetch().then((result) => { if (result.data) setForm(formOf(result.data)); });
          }}
          onKeepMine={() => doSave(conflict.latest.revision ?? undefined)}
        />
      ) : null}
      <SectionHead
        ref={headingRef}
        phone={phone}
        title={title}
        subtitle={isNew ? "Fill in what you know. Only a name is needed to save; the page stays hidden until you show it." : "Changes save to your draft. Visitors see them after you publish."}
        right={!isNew ? <WButton label="Preview page" icon="eye" size="sm" onPress={ctx.openFullScreenPreview} /> : null}
      />
      <Card>
        <CardTitle>Basics</CardTitle>
        <Field label="Name" max={120} value={f.title} error={error} editable={!readOnly} testID="destination-name"
          onChangeText={(value) => set({ title: value, ...(isNew && !slugTouched ? { slug: slugOf(value) } : {}) })} />
        <View style={phone ? null : styles.grid2}>
          <View style={phone ? null : styles.cell}><Field label="Country" max={80} value={f.country} editable={!readOnly} onChangeText={(value) => set({ country: value })} testID="destination-country" /></View>
          <View style={phone ? null : styles.cell}>
            <Field label="Page address" value={f.slug} mono editable={!readOnly} autoCapitalize="none" autoCorrect={false}
              help={`/${base}/${f.slug || "…"} · Made from the name. Changing it later keeps the old address working.`}
              onChangeText={(value) => { setSlugTouched(true); set({ slug: value.toLowerCase().replace(/[^a-z0-9-]/g, "") }); }} testID="destination-slug" />
          </View>
        </View>
        <Field label="Short line" max={200} value={f.tagline} editable={!readOnly} onChangeText={(value) => set({ tagline: value })} testID="destination-tagline" />
        <Field label="Summary" max={600} multiline value={f.summary} editable={!readOnly} onChangeText={(value) => set({ summary: value })} testID="destination-summary" />
      </Card>
      <Card>
        <CardTitle>Photos</CardTitle>
        <Text style={styles.label}>Main picture</Text>
        <PhotoSlot label="Main picture" value={f.featured} onChange={(next) => set({ featured: next })} disabled={readOnly} testID="destination-main-photo" />
        <Text style={styles.label}>{`Gallery · ${f.gallery.length}/24`}</Text>
        <GalleryEditor rows={f.gallery} onChange={(gallery) => set({ gallery })} disabled={readOnly} />
        {missingAlt > 0 ? (
          <View style={styles.warnLine} role="status">
            <WebsiteIcon name="alert" size={14} color="#fde2a8" />
            <Text style={styles.warnText}>{`${missingAlt} ${missingAlt === 1 ? "photo needs" : "photos need"} a short description for people using screen readers.`}</Text>
          </View>
        ) : null}
      </Card>
      <Card>
        <CardTitle>Your story</CardTitle>
        <Field label="Heading over your story" max={120} value={f.storyHeading} editable={!readOnly} onChangeText={(value) => set({ storyHeading: value })} />
        <View style={styles.spacer} />
        <RichTextEditor value={f.body} onChange={(body) => set({ body })} label="Your story" disabled={readOnly} />
      </Card>
      <Card>
        <CardTitle>Quick facts</CardTitle>
        <Hint>In your words. Leave any blank and it won&apos;t show.</Hint>
        <View style={phone ? null : styles.grid2}>
          {(["language", "currency", "timezone", "religion"] as const).map((key) => (
            <View key={key} style={phone ? null : styles.cell}>
              <Field label={{ language: "Language", currency: "Currency", timezone: "Time zone", religion: "Religion" }[key]} max={120} value={f.facts[key]} editable={!readOnly}
                onChangeText={(value) => set({ facts: { ...f.facts, [key]: value } })} />
            </View>
          ))}
        </View>
      </Card>
      <Card>
        <CardTitle>When to go</CardTitle>
        <SeasonsEditor seasons={f.seasons} onChange={(seasons) => set({ seasons })} disabled={readOnly} />
        <CardTitle style={styles.subTitle}>Did you know?</CardTitle>
        {f.didYouKnow.map((fact, index) => (
          <View key={index} style={styles.factRow}>
            <TextInput value={fact} onChangeText={(value) => set({ didYouKnow: f.didYouKnow.map((item, i) => (i === index ? value : item)) })} multiline maxLength={400}
              accessibilityLabel={`Fact ${index + 1}`} editable={!readOnly} style={styles.input} />
            <MiniButton icon="trash" label={`Remove fact ${index + 1}`} onPress={() => set({ didYouKnow: f.didYouKnow.filter((_, i) => i !== index) })} disabled={readOnly} />
          </View>
        ))}
        {f.didYouKnow.length < 12 ? <WButton label="Add a fact" icon="plus" variant="ghost" size="sm" onPress={() => set({ didYouKnow: [...f.didYouKnow, ""] })} disabled={readOnly} style={styles.addButton} /> : null}
      </Card>
      <Card>
        <CardTitle>Trips here</CardTitle>
        <Hint>Picked from your Mingla trips. Dates, prices and spots come from the trip and update by themselves.</Hint>
        <OfferingPicker selected={f.trips} onChange={(trips) => set({ trips })} disabled={readOnly} />
      </Card>
      <Card>
        <View style={styles.toggleRow}>
          <View style={styles.grow}><CardTitle>Show on website</CardTitle><Hint>Off keeps it as a private draft.</Hint></View>
          <Toggle value={f.enabled} onChange={(enabled) => set({ enabled })} label="Show on website" disabled={readOnly} testID="destination-enabled" />
        </View>
        <View style={[styles.toggleRow, styles.toggleGap]}>
          <View style={styles.grow}><Text style={styles.toggleLabel}>Hide from search engines</Text></View>
          <Toggle value={f.noindex} onChange={(noindex) => set({ noindex })} label="Hide from search engines" disabled={readOnly} testID="destination-noindex" />
        </View>
      </Card>
      {!isNew && entry.data ? (
        <DeleteEntry
          label="Delete destination"
          deleting={remove.isPending}
          disabled={readOnly}
          onDelete={() => remove.mutate({ id: entryId, revision: entry.data!.revision }, {
            onSuccess: () => { toast("Deleted from your draft", "success"); ctx.go({ kind: "section", section: "destinations" }); },
            onError: (failure) => toast(saveErrorMessage(failure), "error"),
          })}
        />
      ) : null}
      {phone ? null : <View style={{ height: 24 }} />}
    </View>
  );
}

function GalleryEditor({ rows, onChange, disabled }: { rows: (PictureRef & { alt: string })[]; onChange: (rows: (PictureRef & { alt: string })[]) => void; disabled: boolean }): React.ReactElement {
  const [choosing, setChoosing] = useState(false);
  return (
    <View>
      {rows.length ? (
        <ListBox>
          {rows.map((row, index) => (
            <Row key={`${row.id}-${index}`}>
              {row.thumb_url ? <Image source={{ uri: row.thumb_url }} style={styles.thumb} accessibilityLabel={row.alt || `Gallery photo ${index + 1}`} /> : <View style={styles.thumb} />}
              <TextInput value={row.alt} onChangeText={(alt) => onChange(rows.map((item, i) => (i === index ? { ...item, alt } : item)))} maxLength={240}
                placeholder="Describe the photo" placeholderTextColor={ui.t4} accessibilityLabel={`Description of gallery photo ${index + 1}`} editable={!disabled} style={[styles.input, styles.grow]} testID={`gallery-alt-${index}`} />
              <MiniButton icon="up" label={`Move photo ${index + 1} up`} onPress={() => { const next = [...rows]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; onChange(next); }} disabled={disabled || index === 0} />
              <MiniButton icon="trash" label={`Remove photo ${index + 1}`} onPress={() => onChange(rows.filter((_, i) => i !== index))} disabled={disabled} />
            </Row>
          ))}
        </ListBox>
      ) : null}
      {rows.length < 24 ? <WButton label="Add a photo" icon="plus" variant="ghost" size="sm" onPress={() => setChoosing(true)} disabled={disabled} style={styles.addButton} testID="gallery-add" /> : null}
      <PhotoChooser visible={choosing} onClose={() => setChoosing(false)} onPick={(picked) => { setChoosing(false); onChange([...rows, { ...picked, alt: "" }]); }} />
    </View>
  );
}

function SeasonsEditor({ seasons, onChange, disabled }: { seasons: Season[]; onChange: (next: Season[]) => void; disabled: boolean }): React.ReactElement {
  const [open, setOpen] = useState<number | null>(null);
  const update = (index: number, patch: Partial<Season>) => onChange(seasons.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <View>
      {seasons.length ? (
        <ListBox>
          {seasons.map((season, index) => (
            <View key={index}>
              <Row>
                <View style={styles.grow}>
                  <Text style={styles.seasonTitle}>{season.heading || "New season"}</Text>
                  <Text style={styles.sub} numberOfLines={1}>{[season.body.split("\n")[0], season.activities.length ? `${season.activities.length} activities` : null].filter(Boolean).join(" · ")}</Text>
                </View>
                <WButton label={open === index ? "Done" : "Edit"} size="sm" onPress={() => setOpen(open === index ? null : index)} />
                <MiniButton icon="trash" label={`Remove ${season.heading || "season"}`} onPress={() => onChange(seasons.filter((_, i) => i !== index))} disabled={disabled} />
              </Row>
              {open === index ? (
                <View style={styles.seasonBody}>
                  <Field label="Season" max={120} value={season.heading} editable={!disabled} onChangeText={(heading) => update(index, { heading })} />
                  <Field label="What it is like" max={1000} multiline value={season.body} editable={!disabled} onChangeText={(body) => update(index, { body })} />
                  <Field label="Activities (one per line)" multiline value={season.activities.join("\n")} editable={!disabled}
                    onChangeText={(value) => update(index, { activities: value.split("\n").slice(0, 8).map((line) => line.slice(0, 120)) })} />
                  <Text style={styles.label}>Picture</Text>
                  <PhotoSlot label="Season picture" value={season.image} onChange={(image) => update(index, { image })} disabled={disabled} minHeight={90} />
                </View>
              ) : null}
            </View>
          ))}
        </ListBox>
      ) : null}
      {seasons.length < 4 ? (
        <WButton label="Add a season" icon="plus" variant="ghost" size="sm" onPress={() => { onChange([...seasons, { heading: "", body: "", activities: [], image: null }]); setOpen(seasons.length); }} disabled={disabled} style={styles.addButton} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  grid2: { flexDirection: "row", flexWrap: "wrap", columnGap: 12 },
  cell: { flexGrow: 1, flexBasis: 220 },
  label: { fontSize: 13, fontWeight: "600", color: ui.t2, marginTop: 14, marginBottom: 6 },
  warnLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: "rgba(245, 158, 11, 0.18)" },
  warnText: { flex: 1, minWidth: 180, fontSize: 12.5, lineHeight: 17, color: "#fde2a8" },
  spacer: { height: 12 },
  subTitle: { marginTop: 16 },
  factRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  input: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: ui.border2, backgroundColor: "rgba(255,255,255,0.03)", paddingHorizontal: 12, paddingVertical: 8, color: ui.t1, fontSize: 14, flex: 1 },
  addButton: { alignSelf: "flex-start", marginTop: 8 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  toggleGap: { marginTop: 12 },
  toggleLabel: { fontSize: 14, fontWeight: "700", color: ui.t1 },
  thumb: { width: 56, height: 42, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.06)" },
  seasonTitle: { fontSize: 14, fontWeight: "600", color: ui.t1 },
  sub: { fontSize: 12.5, color: ui.t3 },
  seasonBody: { paddingHorizontal: 14, paddingBottom: 14 },
});
