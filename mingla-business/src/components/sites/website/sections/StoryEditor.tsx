import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useWebsite } from "../WebsiteContext";
import { Card, CardTitle, Field, Hint, SectionHead, Segmented, Skeleton, Toggle, WButton, ui } from "../ui";
import { PhotoSlot } from "../PhotoField";
import {
  BrandSiteContentConflict,
  useContentEntry,
  useContentRowActions,
  useSaveContentEntry,
  useStoryCategories,
  type PictureRef,
  type StoryDetail,
} from "../../../../sites/contentApi";
import type { RichTextDoc } from "../../../../../../packages/site-contracts/src/richText.ts";
import { ConflictBanner, DeleteEntry, EditorCrumb, RichTextEditor, saveErrorMessage, useEditorChrome } from "./EditorKit";

type Form = {
  title: string;
  category: string | null;
  date: string;
  featured: PictureRef | null;
  excerpt: string;
  content: RichTextDoc | null;
  enabled: boolean;
};

const today = () => new Date().toISOString().slice(0, 10);

function formOf(entry: StoryDetail): Form {
  return {
    title: entry.title,
    category: entry.category,
    date: entry.published_at ?? today(),
    featured: entry.featured_image,
    excerpt: entry.excerpt ?? "",
    content: entry.content,
    enabled: entry.enabled,
  };
}

export function storyWrite(form: Form): Record<string, unknown> {
  return {
    title: form.title,
    category: form.category,
    published_at: /^\d{4}-\d{2}-\d{2}$/.test(form.date) ? form.date : today(),
    featured_image: form.featured?.id ?? null,
    excerpt: form.excerpt || null,
    content: form.content,
    enabled: form.enabled,
  };
}

/** #2829 W9r (DESIGN_SPEC §1.6 Story editor). */
export function StoryEditor({ entryId }: { entryId: string | "new" }): React.ReactElement {
  const ctx = useWebsite();
  const { controller, phone, headingRef, lock, toast } = ctx;
  const isNew = entryId === "new";
  const entry = useContentEntry<StoryDetail>(controller.siteId, "stories", isNew ? null : entryId);
  const categories = useStoryCategories(controller.siteId);
  const save = useSaveContentEntry(controller.siteId, "stories");
  const remove = useContentRowActions(controller.siteId, "stories").remove;
  const [form, setForm] = useState<Form | null>(isNew ? { title: "", category: null, date: today(), featured: null, excerpt: "", content: null, enabled: false } : null);
  const [conflict, setConflict] = useState<BrandSiteContentConflict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readOnly = lock.heldByOther;

  useEffect(() => {
    if (!isNew && entry.data && form === null) setForm(formOf(entry.data));
  }, [entry.data, form, isNew]);

  const doSave = (revision?: string) => {
    if (!form) return;
    if (!form.title.trim()) {
      setError("Add a title first.");
      return;
    }
    if (form.enabled && !form.content) {
      toast("Write the story before showing it on your website.", "warn");
      return;
    }
    setError(null);
    save.mutate({ id: isNew ? null : entryId, revision: isNew ? null : revision ?? entry.data?.revision ?? null, data: storyWrite(form) }, {
      onSuccess: () => {
        setConflict(null);
        toast("Saved to your draft", "success");
        ctx.go({ kind: "section", section: "stories" });
      },
      onError: (failure) => {
        if (failure instanceof BrandSiteContentConflict) setConflict(failure);
        else toast(saveErrorMessage(failure), "error");
      },
    });
  };
  useEditorChrome({ isNew, saving: save.isPending, disabled: readOnly || form === null, onSave: () => doSave(), onCancel: () => ctx.go({ kind: "section", section: "stories" }) });

  if (!isNew && entry.isLoading) return <View role="status" accessibilityLabel="Loading this story"><Skeleton height={32} width="40%" style={{ marginBottom: 16 }} /><Skeleton height={300} /></View>;
  if (!isNew && (entry.isError || !form)) {
    return (
      <Card>
        <CardTitle>This story couldn&apos;t be loaded</CardTitle>
        <Hint>{saveErrorMessage(entry.error)}</Hint>
        <WButton label="Back to Stories" size="sm" onPress={() => ctx.go({ kind: "section", section: "stories" })} style={{ alignSelf: "flex-start", marginTop: 12 }} />
      </Card>
    );
  }
  const f = form!;
  const set = (patch: Partial<Form>) => setForm({ ...f, ...patch });
  const rows = categories.data?.categories ?? [];
  return (
    <View testID="story-editor">
      <EditorCrumb section="stories" label="Stories" current={isNew ? "New story" : f.title || "Story"} />
      {conflict ? (
        <ConflictBanner
          conflict={conflict}
          onViewTheirs={() => { setConflict(null); void entry.refetch().then((result) => { if (result.data) setForm(formOf(result.data)); }); }}
          onKeepMine={() => doSave(conflict.latest.revision ?? undefined)}
        />
      ) : null}
      <SectionHead ref={headingRef} phone={phone} title={isNew ? "New story" : "Edit story"} subtitle="Changes save to your draft."
        right={!isNew ? <WButton label="Preview" icon="eye" size="sm" onPress={ctx.openFullScreenPreview} /> : null} />
      <Card>
        <Field label="Title" max={160} value={f.title} error={error} editable={!readOnly} onChangeText={(title) => set({ title })} testID="story-title" />
        <View style={phone ? null : styles.grid2}>
          <View style={phone ? null : styles.cell}>
            <Text style={styles.label}>Category</Text>
            {rows.length ? (
              <Segmented label="Category" compact options={[{ value: "", label: "None" }, ...rows.map((row) => ({ value: row.id, label: row.title }))]}
                value={f.category ?? ""} onChange={(value) => set({ category: value || null })} disabled={readOnly} testIDPrefix="story-category-pick" />
            ) : <Hint>No categories yet. Add them with Manage categories on the Stories list.</Hint>}
          </View>
          <View style={phone ? null : styles.cell}>
            {Platform.OS === "web" ? (
              <View>
                <Text style={styles.label}>Date</Text>
                {React.createElement("input", {
                  type: "date",
                  value: f.date,
                  disabled: readOnly,
                  "aria-label": "Date",
                  "data-testid": "story-date",
                  onChange: (event: { target: { value: string } }) => set({ date: event.target.value }),
                  style: { minHeight: 44, borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.96)", padding: "0 12px", fontSize: 14, colorScheme: "dark" },
                })}
              </View>
            ) : (
              <Field label="Date" value={f.date} placeholder="YYYY-MM-DD" editable={!readOnly} onChangeText={(date) => set({ date })} />
            )}
          </View>
        </View>
        <Text style={styles.label}>Main picture</Text>
        <PhotoSlot label="Main picture" value={f.featured} onChange={(featured) => set({ featured })} disabled={readOnly} minHeight={140} testID="story-main-photo" />
        <Field label="Short summary" max={400} multiline value={f.excerpt} help="Shown on the Stories page and in search results." editable={!readOnly} onChangeText={(excerpt) => set({ excerpt })} testID="story-excerpt" />
      </Card>
      <Card>
        <CardTitle>Story</CardTitle>
        <RichTextEditor value={f.content} onChange={(content) => set({ content })} label="Story text" disabled={readOnly} />
      </Card>
      <Card>
        <View style={styles.toggleRow}>
          <View style={styles.grow}><CardTitle>Show on website</CardTitle><Hint>Off keeps it as a draft only your team sees.</Hint></View>
          <Toggle value={f.enabled} onChange={(enabled) => set({ enabled })} label="Show on website" disabled={readOnly} testID="story-enabled" />
        </View>
      </Card>
      {!isNew && entry.data ? (
        <DeleteEntry label="Delete story" deleting={remove.isPending} disabled={readOnly}
          onDelete={() => remove.mutate({ id: entryId, revision: entry.data!.revision }, {
            onSuccess: () => { toast("Deleted from your draft", "success"); ctx.go({ kind: "section", section: "stories" }); },
            onError: (failure) => toast(saveErrorMessage(failure), "error"),
          })} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  grid2: { flexDirection: "row", flexWrap: "wrap", columnGap: 12 },
  cell: { flexGrow: 1, flexBasis: 220 },
  label: { fontSize: 13, fontWeight: "600", color: ui.t2, marginTop: 14, marginBottom: 6 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
});
