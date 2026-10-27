import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useWebsite } from "../WebsiteContext";
import { Card, CardTitle, Field, Hint, SectionHead, Skeleton, Toggle, WButton, ui } from "../ui";
import { WebsiteIcon } from "../WebsiteIcon";
import {
  BrandSiteContentConflict,
  confirmReview,
  setContentVisibility,
  useContentEntry,
  useContentRowActions,
  useSaveContentEntry,
  type ReviewDetail,
} from "../../../../sites/contentApi";
import { REVIEW_CONFIRM_ADMIN_ONLY, REVIEW_CONFIRM_HELP, REVIEW_CONFIRM_TEXT } from "../../../../sites/websiteCopy";
import { ConflictBanner, DeleteEntry, EditorCrumb, OfferingPicker, saveErrorMessage, useEditorChrome } from "./EditorKit";
import { useQueryClient } from "@tanstack/react-query";
import { brandSiteKeys } from "../../../../sites/brandSiteKeys";

type Form = {
  quote: string;
  reviewer: string;
  date: string;
  trip: string | null;
  source: string;
  confirmed: boolean;
  enabled: boolean;
};

const today = () => new Date().toISOString().slice(0, 10);

function formOf(entry: ReviewDetail): Form {
  return {
    quote: entry.quote,
    reviewer: entry.reviewer,
    date: entry.review_date ?? today(),
    trip: entry.related_offering,
    source: entry.source_note ?? "",
    confirmed: entry.confirmed,
    enabled: entry.enabled,
  };
}

/**
 * #2829 W9r (DESIGN_SPEC §1.6 Review editor, §37 answer 2) — reviews word
 * for word. Only brand admins and owners confirm a review is real (Core
 * checks rank 50); everyone else sees the box disabled with why, and can ask
 * an admin. An unconfirmed review can't be shown; unconfirming hides it.
 */
export function ReviewEditor({ entryId }: { entryId: string | "new" }): React.ReactElement {
  const ctx = useWebsite();
  const { controller, phone, headingRef, lock, toast } = ctx;
  const queryClient = useQueryClient();
  const isNew = entryId === "new";
  const entry = useContentEntry<ReviewDetail>(controller.siteId, "testimonials", isNew ? null : entryId);
  const save = useSaveContentEntry(controller.siteId, "testimonials");
  const remove = useContentRowActions(controller.siteId, "testimonials").remove;
  const [form, setForm] = useState<Form | null>(isNew ? { quote: "", reviewer: "", date: today(), trip: null, source: "", confirmed: false, enabled: false } : null);
  const [conflict, setConflict] = useState<BrandSiteContentConflict | null>(null);
  const [errors, setErrors] = useState<{ quote?: string; reviewer?: string; source?: string }>({});
  const [busy, setBusy] = useState(false);
  // Core's answer for this member (rank 50 confirms), never a local rank copy.
  const canConfirm = controller.capabilities.canPublish;
  const readOnly = lock.heldByOther;

  useEffect(() => {
    if (!isNew && entry.data && form === null) setForm(formOf(entry.data));
  }, [entry.data, form, isNew]);

  const doSave = async (revision?: string) => {
    if (!form || !controller.siteId) return;
    const problems = {
      ...(form.quote.trim() ? {} : { quote: "Paste the review text first." }),
      ...(form.reviewer.trim() ? {} : { reviewer: "Add the reviewer's name, exactly as shown where they left it." }),
      ...(form.source.trim() ? {} : { source: "Say where this review comes from (for your records)." }),
    };
    setErrors(problems);
    if (Object.keys(problems).length) return;
    setBusy(true);
    try {
      const wasConfirmed = entry.data?.confirmed === true;
      const saved = await save.mutateAsync({
        id: isNew ? null : entryId,
        revision: isNew ? null : revision ?? entry.data?.revision ?? null,
        data: {
          quote: form.quote,
          reviewer: form.reviewer,
          review_date: form.date,
          related_offering: form.trip,
          source_note: form.source,
          // Showing waits for the confirmation below (Studio refuses it before).
          ...(form.enabled && !wasConfirmed ? {} : { enabled: form.enabled }),
        },
      });
      let current = saved.revision;
      if (canConfirm && form.confirmed !== wasConfirmed) {
        current = (await confirmReview({ siteId: controller.siteId, id: saved.id, revision: current, confirmed: form.confirmed })).entry.revision;
      }
      if (form.enabled && form.confirmed && !(wasConfirmed && entry.data?.enabled)) {
        await setContentVisibility({ siteId: controller.siteId, collection: "testimonials", id: saved.id, revision: current, enabled: true });
      }
      void queryClient.invalidateQueries({ queryKey: brandSiteKeys.content(controller.siteId, "testimonials") });
      setConflict(null);
      toast("Saved to your draft", "success");
      ctx.go({ kind: "section", section: "reviews" });
    } catch (failure) {
      if (failure instanceof BrandSiteContentConflict) setConflict(failure);
      else toast(saveErrorMessage(failure), "error");
    } finally {
      setBusy(false);
    }
  };
  useEditorChrome({ isNew, saving: busy, disabled: readOnly || form === null, onSave: () => { void doSave(); }, onCancel: () => ctx.go({ kind: "section", section: "reviews" }) });

  if (!isNew && entry.isLoading) return <View role="status" accessibilityLabel="Loading this review"><Skeleton height={32} width="40%" style={{ marginBottom: 16 }} /><Skeleton height={300} /></View>;
  if (!isNew && (entry.isError || !form)) {
    return (
      <Card>
        <CardTitle>This review couldn&apos;t be loaded</CardTitle>
        <Hint>{saveErrorMessage(entry.error)}</Hint>
        <WButton label="Back to Reviews" size="sm" onPress={() => ctx.go({ kind: "section", section: "reviews" })} style={{ alignSelf: "flex-start", marginTop: 12 }} />
      </Card>
    );
  }
  const f = form!;
  const set = (patch: Partial<Form>) => setForm({ ...f, ...patch });
  const title = isNew ? "Add a review" : `Review by ${f.reviewer || "a traveller"}`;
  return (
    <View testID="review-editor">
      <EditorCrumb section="reviews" label="Reviews" current={isNew ? "New review" : title} />
      {conflict ? (
        <ConflictBanner conflict={conflict}
          onViewTheirs={() => { setConflict(null); void entry.refetch().then((result) => { if (result.data) setForm(formOf(result.data)); }); }}
          onKeepMine={() => { void doSave(conflict.latest.revision ?? undefined); }} />
      ) : null}
      <SectionHead ref={headingRef} phone={phone} title={title} subtitle="Copy it exactly as the traveller wrote it, typos included. Don't shorten it or join two reviews." />
      <Card>
        <Field label="Review, word for word" max={1200} multiline value={f.quote} error={errors.quote} editable={!readOnly} onChangeText={(quote) => set({ quote })} style={styles.quote} testID="review-quote" />
        <View style={phone ? null : styles.grid2}>
          <View style={phone ? null : styles.cell}>
            <Field label="Reviewer" max={80} value={f.reviewer} error={errors.reviewer} help="Exactly as shown where they left it." editable={!readOnly} onChangeText={(reviewer) => set({ reviewer })} testID="review-reviewer" />
          </View>
          <View style={phone ? null : styles.cell}>
            {Platform.OS === "web" ? (
              <View>
                <Text style={styles.label}>Date written</Text>
                {React.createElement("input", {
                  type: "date", value: f.date, disabled: readOnly, "aria-label": "Date written", "data-testid": "review-date",
                  onChange: (event: { target: { value: string } }) => set({ date: event.target.value }),
                  style: { minHeight: 44, borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.96)", padding: "0 12px", fontSize: 14, colorScheme: "dark" },
                })}
              </View>
            ) : <Field label="Date written" value={f.date} placeholder="YYYY-MM-DD" editable={!readOnly} onChangeText={(date) => set({ date })} />}
          </View>
        </View>
        <Text style={styles.label}>Trip</Text>
        <OfferingPicker selected={f.trip ? [f.trip] : []} onChange={(ids) => set({ trip: ids[ids.length - 1] ?? null })} disabled={readOnly} single />
        <Hint>Past trips are listed from your Mingla trips.</Hint>
        <Field label="Where this review comes from" countLabel="private" max={500} value={f.source} error={errors.source} help="For your records only. Never shown on the website." editable={!readOnly} onChangeText={(source) => set({ source })} testID="review-source" />
      </Card>
      <Card tone={f.confirmed ? undefined : "warn"} testID="review-confirm-card">
        <Pressable
          onPress={canConfirm && !readOnly ? () => set({ confirmed: !f.confirmed, ...(f.confirmed ? { enabled: false } : {}) }) : undefined}
          disabled={!canConfirm || readOnly}
          role="checkbox"
          accessibilityRole="checkbox"
          aria-checked={f.confirmed}
          accessibilityState={{ checked: f.confirmed, disabled: !canConfirm || readOnly }}
          accessibilityLabel={REVIEW_CONFIRM_TEXT}
          accessibilityHint={canConfirm ? REVIEW_CONFIRM_HELP : REVIEW_CONFIRM_ADMIN_ONLY}
          style={styles.confirmRow}
          testID="review-confirm"
        >
          <View style={[styles.checkbox, f.confirmed ? styles.checkboxOn : null, !canConfirm ? styles.checkboxDisabled : null]}>
            {f.confirmed ? <WebsiteIcon name="check" size={14} color="#140a03" /> : null}
          </View>
          <View style={styles.grow}>
            <Text style={styles.confirmText}>{REVIEW_CONFIRM_TEXT}</Text>
            <Hint style={styles.confirmHelp}>{canConfirm ? REVIEW_CONFIRM_HELP : REVIEW_CONFIRM_ADMIN_ONLY}</Hint>
          </View>
        </Pressable>
        {!canConfirm ? (
          <View style={styles.ask}><WButton label="Ask an admin" icon="msg" size="sm" onPress={() => ctx.askAdmin("confirm_review")} loading={ctx.asking} testID="review-ask-admin" /></View>
        ) : null}
      </Card>
      <Card>
        <View style={styles.toggleRow}>
          <View style={styles.grow}>
            <CardTitle>Show on website</CardTitle>
            <Hint>{f.confirmed ? "Shows on your home page and Reviews band." : "Confirm the review first."}</Hint>
          </View>
          <Toggle value={f.enabled && f.confirmed} onChange={(enabled) => set({ enabled })} label="Show on website" disabled={!f.confirmed || readOnly} testID="review-enabled" />
        </View>
      </Card>
      {!isNew && entry.data ? (
        <DeleteEntry label="Delete review" deleting={remove.isPending} disabled={readOnly}
          onDelete={() => remove.mutate({ id: entryId, revision: entry.data!.revision }, {
            onSuccess: () => { toast("Deleted from your draft", "success"); ctx.go({ kind: "section", section: "reviews" }); },
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
  quote: { minHeight: 110 },
  confirmRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, minHeight: 44 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: "rgba(255,255,255,0.34)", alignItems: "center", justifyContent: "center", marginTop: 2 },
  checkboxOn: { backgroundColor: ui.accent, borderColor: ui.accent },
  checkboxDisabled: { opacity: 0.5 },
  confirmText: { fontSize: 14, fontWeight: "700", color: ui.t1 },
  confirmHelp: { marginTop: 2 },
  ask: { marginTop: 10, flexDirection: "row" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
});
