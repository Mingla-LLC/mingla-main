import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Banner, Body, Card, CardTitle, Field, Hint, ListBox, MiniButton, Row, RowText, Skeleton, Toggle, WButton, ui } from "../website/ui";
import { useBrandSitePlan, useSaveBrandSitePlan, useSetupContent, useSaveSetupContent, useAddPastTrip, type SetupContentItem } from "../../../sites/planApi";
import { BrandSitesError } from "../../../services/brandSitesService";
import {
  PAST_TRIP_FIELDS,
  STAGED_FIELDS,
  answersPatch,
  cleanValues,
  defaultTimezone,
  pastTripProblems,
  stagedProblems,
  stagedTitle,
  type FormField,
  type StagedKind,
} from "../../../sites/proofForms";
import {
  PROOF_LIMITS,
  proofAsksProcessSteps,
  type FaqItem,
  type PlanPartKey,
  type ProcessStep,
  type QuickFacts,
  type ValuePoint,
} from "../../../../../packages/site-contracts/src/sitePlan.ts";

/*
 * #4453 (spec v1 §3, spec v2 §6.7) — setup part "What guests say and where
 * you've been". Optional and skippable; every answer is the owner's own
 * words, saved verbatim. Reviews need the "This is a real review from a real
 * guest" tick (brand admins and owners only); past trips become real ended
 * Mingla trips. Forms open inline in the step (no sheet), each with its own
 * Cancel, so nothing is left half-open.
 */

type Notice = { kind: "info" | "error"; message: string } | null;

const errorText = (error: unknown, fallback: string) => (error instanceof BrandSitesError ? error.message : fallback);
const today = () => new Date().toISOString().slice(0, 10);

function FormFields({ fields, values, problems, onChange, disabled, testPrefix }: {
  fields: readonly FormField[];
  values: Record<string, string>;
  problems: Record<string, string>;
  onChange: (key: string, value: string) => void;
  disabled: boolean;
  testPrefix: string;
}): React.ReactElement {
  return (
    <View style={styles.gap}>
      {fields.map((field) => (
        <Field
          key={field.key}
          label={field.label}
          max={field.max}
          multiline={field.multiline}
          placeholder={field.placeholder}
          help={field.help ?? null}
          error={problems[field.key] ?? null}
          value={values[field.key] ?? ""}
          editable={!disabled}
          onChangeText={(value) => onChange(field.key, value)}
          testID={`${testPrefix}-${field.key}`}
        />
      ))}
    </View>
  );
}

const KIND_COPY: Record<StagedKind, { title: string; hint: string; add: string; limit: number }> = {
  review: { title: "Reviews from guests", hint: "Have guests sent you reviews? Paste each one exactly as they wrote it.", add: "Add a review", limit: PROOF_LIMITS.reviews },
  destination: { title: "Places you take people", hint: "Each place gets its own page once you add a picture in Website.", add: "Add a place", limit: PROOF_LIMITS.destinations },
  story: { title: "Stories", hint: "Trip write-ups you'd like on your site, in your words.", add: "Add a story", limit: PROOF_LIMITS.stories },
};

function StagedSection({ brandId, kind, items, canConfirm, readOnly }: {
  brandId: string;
  kind: StagedKind;
  items: SetupContentItem[];
  canConfirm: boolean;
  readOnly: boolean;
}): React.ReactElement {
  const save = useSaveSetupContent(brandId);
  const [editing, setEditing] = useState<SetupContentItem | "new" | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const copy = KIND_COPY[kind];
  // Reviews are confirmed by brand admins and owners only (Core checks rank 50).
  const locked = readOnly || (kind === "review" && !canConfirm);

  const open = (item: SetupContentItem | "new") => {
    setEditing(item);
    setValues(item === "new" ? {} : { ...item.payload });
    setConfirmed(item !== "new" && item.confirmedReal);
    setProblems({});
    setNotice(null);
  };
  const close = () => { setEditing(null); setProblems({}); };

  const onSave = () => {
    const found = stagedProblems(kind, values, confirmed);
    setProblems(found);
    if (Object.keys(found).length) return;
    save.mutate(
      {
        kind,
        id: editing === "new" || editing === null ? null : editing.id,
        payload: cleanValues(STAGED_FIELDS[kind], values),
        confirmedReal: kind === "review" ? confirmed : false,
        updatedAt: editing === "new" || editing === null ? null : editing.updatedAt,
      },
      {
        onSuccess: () => { close(); setNotice({ kind: "info", message: "Saved." }); },
        onError: (error) => setNotice({ kind: "error", message: errorText(error, "That didn't save. Try again.") }),
      },
    );
  };

  const onDelete = (item: SetupContentItem) => {
    save.mutate(
      { kind, id: item.id, updatedAt: item.updatedAt, delete: true },
      { onError: (error) => setNotice({ kind: "error", message: errorText(error, "That wasn't removed. Try again.") }) },
    );
  };

  return (
    <Card testID={`proof-${kind}`}>
      <CardTitle>{copy.title}</CardTitle>
      <Hint>{copy.hint}</Hint>
      {kind === "review" && !canConfirm ? <Hint>Only a brand admin or the owner can add reviews, because they confirm each one is real.</Hint> : null}
      {items.length ? (
        <ListBox style={styles.list}>
          {items.map((item) => {
            const line = stagedTitle(kind, item.payload);
            return (
              <Row key={item.id} testID={`proof-${kind}-row`}>
                <RowText title={line.title} lines={[line.line]} />
                {!locked && !item.materialized ? (
                  <View style={styles.rowActions}>
                    <MiniButton icon="edit" label={`Edit ${line.title}`} onPress={() => open(item)} disabled={save.isPending} />
                    <MiniButton icon="trash" label={`Remove ${line.title}`} onPress={() => onDelete(item)} disabled={save.isPending} />
                  </View>
                ) : null}
              </Row>
            );
          })}
        </ListBox>
      ) : null}
      {editing ? (
        <View style={styles.form} testID={`proof-${kind}-form`}>
          <FormFields fields={STAGED_FIELDS[kind]} values={values} problems={problems} onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))} disabled={save.isPending} testPrefix={`proof-${kind}`} />
          {kind === "review" ? (
            <View style={styles.tickRow}>
              <Toggle value={confirmed} onChange={setConfirmed} label="This is a real review from a real guest" disabled={save.isPending} testID="proof-review-confirm" />
              <Body style={styles.tickLabel}>This is a real review from a real guest</Body>
            </View>
          ) : null}
          {problems.confirmed ? <Text style={styles.error} role="alert">{problems.confirmed}</Text> : null}
          <View style={styles.row}>
            <WButton label={save.isPending ? "Saving…" : "Save"} variant="primary" disabled={save.isPending} onPress={onSave} testID={`proof-${kind}-save`} />
            <WButton label="Cancel" variant="ghost" disabled={save.isPending} onPress={close} testID={`proof-${kind}-cancel`} />
          </View>
        </View>
      ) : !locked && items.length < copy.limit ? (
        <View style={styles.row}>
          <WButton label={copy.add} onPress={() => open("new")} testID={`proof-${kind}-add`} />
        </View>
      ) : null}
      {notice ? <Banner tone={notice.kind === "error" ? "err" : "ok"} icon={notice.kind === "error" ? "alert" : "check"} title={notice.message} alert={notice.kind === "error"} /> : null}
    </Card>
  );
}

/** Q2 — also used by Website → Past trips ("Add a trip you ran before Mingla"). */
export function PastTripForm({ brandId, onDone, onCancel }: { brandId: string; onDone: () => void; onCancel: () => void }): React.ReactElement {
  const add = useAddPastTrip(brandId);
  const [values, setValues] = useState<Record<string, string>>({});
  const [timezone, setTimezone] = useState(defaultTimezone());
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const onSave = () => {
    const found = pastTripProblems(values, today());
    if (!timezone.trim()) found.timezone = "Add the trip's time zone.";
    setProblems(found);
    if (Object.keys(found).length) return;
    const clean = cleanValues(PAST_TRIP_FIELDS, values);
    add.mutate(
      { title: clean.title!, where: clean.where!, startDate: clean.start_date!, endDate: clean.end_date!, timezone: timezone.trim(), description: clean.description ?? null },
      { onSuccess: onDone, onError: (e) => setError(errorText(e, "That trip didn't save. Try again.")) },
    );
  };
  return (
    <View style={styles.form} testID="proof-past-trip-form">
      <FormFields fields={PAST_TRIP_FIELDS} values={values} problems={problems} onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))} disabled={add.isPending} testPrefix="proof-past-trip" />
      <Field label="Time zone" max={64} value={timezone} onChangeText={setTimezone} error={problems.timezone ?? null} help="Where the trip ran, like Europe/Lisbon." editable={!add.isPending} testID="proof-past-trip-timezone" />
      {error ? <Banner tone="err" icon="alert" title={error} alert /> : null}
      <View style={styles.row}>
        <WButton label={add.isPending ? "Saving…" : "Add trip"} variant="primary" disabled={add.isPending} onPress={onSave} testID="proof-past-trip-save" />
        <WButton label="Cancel" variant="ghost" disabled={add.isPending} onPress={onCancel} testID="proof-past-trip-cancel" />
      </View>
    </View>
  );
}

function RowsEditor<T extends Record<string, string | undefined>>({ title, hint, rows, max, fields, onChange, disabled, testPrefix, addLabel }: {
  title: string;
  hint: string;
  rows: T[];
  max: number;
  fields: readonly FormField[];
  onChange: (rows: T[]) => void;
  disabled: boolean;
  testPrefix: string;
  addLabel: string;
}): React.ReactElement {
  return (
    <Card testID={testPrefix}>
      <CardTitle>{title}</CardTitle>
      <Hint>{hint}</Hint>
      {rows.map((row, index) => (
        <View key={index} style={styles.form}>
          <FormFields
            fields={fields}
            values={row as Record<string, string>}
            problems={{}}
            onChange={(key, value) => onChange(rows.map((entry, i) => (i === index ? { ...entry, [key]: value } : entry)))}
            disabled={disabled}
            testPrefix={`${testPrefix}-${index}`}
          />
          <View style={styles.row}>
            <MiniButton icon="trash" label={`Remove ${title} ${index + 1}`} onPress={() => onChange(rows.filter((_, i) => i !== index))} disabled={disabled} />
          </View>
        </View>
      ))}
      {rows.length < max && !disabled ? (
        <View style={styles.row}>
          <WButton label={addLabel} onPress={() => onChange([...rows, {} as T])} testID={`${testPrefix}-add`} />
        </View>
      ) : null}
    </Card>
  );
}

export function ProofPart({ brandId, readOnly = false, onDone }: {
  brandId: string;
  readOnly?: boolean;
  onDone: (next: PlanPartKey) => void;
}): React.ReactElement {
  const router = useRouter();
  const plan = useBrandSitePlan(brandId);
  const content = useSetupContent(brandId);
  const savePlan = useSaveBrandSitePlan(brandId);
  const [addingTrip, setAddingTrip] = useState(false);
  const [valuePoints, setValuePoints] = useState<ValuePoint[] | null>(null);
  const [faq, setFaq] = useState<FaqItem[] | null>(null);
  const [steps, setSteps] = useState<ProcessStep[] | null>(null);
  const [facts, setFacts] = useState<QuickFacts | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const offerings = plan.data?.plan?.offeringsSelected ?? plan.data?.prefillOfferings ?? [];
  const asksSteps = proofAsksProcessSteps(offerings);
  const canManage = plan.data?.canManage === true && !readOnly;

  useEffect(() => {
    if (!plan.data || valuePoints !== null) return;
    const saved = plan.data.plan;
    setValuePoints(saved?.valuePoints ?? []);
    setFaq(saved?.faq ?? []);
    setSteps(saved?.processSteps ?? []);
    setFacts(saved?.quickFacts ?? { facts: [], use_in_ticker: false, ticker: [] });
  }, [plan.data, valuePoints]);

  const byKind = useMemo(() => {
    const items = content.data?.items ?? [];
    return {
      review: items.filter((item) => item.kind === "review"),
      destination: items.filter((item) => item.kind === "destination"),
      story: items.filter((item) => item.kind === "story"),
    };
  }, [content.data]);

  const onSaveAnswers = useCallback(() => {
    if (!plan.data || !valuePoints || !faq || !steps || !facts) return;
    setNotice(null);
    const { patch, problem } = answersPatch({ valuePoints, faq, processSteps: asksSteps ? steps : null, quickFacts: facts });
    if (problem) {
      setNotice({ kind: "error", message: problem });
      return;
    }
    savePlan.mutate(
      { revision: plan.data.plan?.revision ?? 0, patch },
      {
        onSuccess: () => setNotice({ kind: "info", message: "Your answers are saved." }),
        onError: (error) => setNotice({ kind: "error", message: errorText(error, "Your answers didn't save. Try again.") }),
      },
    );
  }, [plan.data, valuePoints, faq, steps, facts, asksSteps, savePlan]);

  const onSkip = useCallback(() => {
    if (!plan.data?.plan) return;
    savePlan.mutate(
      { revision: plan.data.plan.revision, patch: { skipped_parts: [...new Set([...plan.data.plan.skippedParts, "proof"])] } },
      {
        onSuccess: () => onDone("approve"),
        onError: (error) => setNotice({ kind: "error", message: errorText(error, "That didn't save. Try again.") }),
      },
    );
  }, [plan.data, savePlan, onDone]);

  if (plan.isLoading || content.isLoading || (plan.isSuccess && valuePoints === null)) {
    return (
      <View style={styles.gap} testID="proof-loading">
        <Skeleton height={28} width="60%" />
        <Skeleton height={120} />
        <Skeleton height={120} />
      </View>
    );
  }
  if (plan.isError || content.isError) {
    return (
      <View style={styles.gap}>
        <Banner tone="err" icon="alert" title="This part could not be loaded." body="Check your connection and try again." alert />
        <View style={styles.row}>
          <WButton label="Try again" onPress={() => { void plan.refetch(); void content.refetch(); }} testID="proof-retry" />
        </View>
      </View>
    );
  }

  // After Build, Website is the one home for reviews, places and stories.
  if (content.data?.hasSite) {
    const counts = plan.data?.proofCounts;
    return (
      <View style={styles.gap} testID="proof-after-build">
        <CardTitle>What guests say and where you&apos;ve been</CardTitle>
        <Hint>
          {`${counts?.reviews ?? 0} reviews, ${counts?.destinations ?? 0} places, ${counts?.stories ?? 0} stories and ${counts?.pastTrips ?? 0} past trips from setup are in your website.`}
        </Hint>
        <View style={styles.row}>
          <WButton label="Add more in Website" variant="primary" onPress={() => router.push(`/brand/${brandId}/website` as never)} testID="proof-open-website" />
          <WButton label="Next" variant="ghost" onPress={() => onDone("approve")} testID="proof-next" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.gap} testID="proof-part">
      <CardTitle>What guests say and where you&apos;ve been</CardTitle>
      <Hint>Optional. Answer any of these, in your own words, or skip for now. Nothing here appears on your site until you review your pages.</Hint>

      <StagedSection brandId={brandId} kind="review" items={byKind.review} canConfirm={content.data?.canConfirmReviews === true} readOnly={readOnly} />

      <Card testID="proof-past-trips">
        <CardTitle>Trips you ran before Mingla</CardTitle>
        <Hint>Each one becomes an ended trip on your Mingla page and your site. It can never be booked.</Hint>
        {content.data?.pastTrips.length ? (
          <ListBox style={styles.list}>
            {content.data.pastTrips.map((trip) => (
              <Row key={trip.eventId} testID="proof-past-trip-row"><RowText title={trip.title} /></Row>
            ))}
          </ListBox>
        ) : null}
        {addingTrip ? (
          <PastTripForm brandId={brandId} onDone={() => setAddingTrip(false)} onCancel={() => setAddingTrip(false)} />
        ) : canManage && (content.data?.pastTrips.length ?? 0) < PROOF_LIMITS.past_trips ? (
          <View style={styles.row}>
            <WButton label="Add a past trip" onPress={() => setAddingTrip(true)} testID="proof-past-trip-add" />
          </View>
        ) : null}
      </Card>

      <StagedSection brandId={brandId} kind="destination" items={byKind.destination} canConfirm readOnly={readOnly} />
      <StagedSection brandId={brandId} kind="story" items={byKind.story} canConfirm readOnly={readOnly} />

      <RowsEditor<ValuePoint>
        title="What makes you different"
        hint="Two to four points, each a title and one sentence."
        rows={valuePoints ?? []}
        max={PROOF_LIMITS.value_points.max}
        fields={[
          { key: "title", label: "Title", max: PROOF_LIMITS.value_points.title, required: true },
          { key: "sentence", label: "One sentence", max: PROOF_LIMITS.value_points.sentence, required: true, multiline: true },
        ]}
        onChange={setValuePoints}
        disabled={!canManage || savePlan.isPending}
        testPrefix="proof-points"
        addLabel="Add a point"
      />
      <RowsEditor<FaqItem>
        title="Questions people often ask you"
        hint="Up to 12, each with your answer."
        rows={faq ?? []}
        max={PROOF_LIMITS.faq.max}
        fields={[
          { key: "question", label: "Question", max: PROOF_LIMITS.faq.question, required: true },
          { key: "answer", label: "Your answer", max: PROOF_LIMITS.faq.answer, required: true, multiline: true },
        ]}
        onChange={setFaq}
        disabled={!canManage || savePlan.isPending}
        testPrefix="proof-faq"
        addLabel="Add a question"
      />
      {asksSteps ? (
        <RowsEditor<ProcessStep>
          title="How a visit works"
          hint="Three to five steps, in order."
          rows={steps ?? []}
          max={PROOF_LIMITS.process_steps.max}
          fields={[
            { key: "title", label: "Step", max: PROOF_LIMITS.process_steps.title, required: true },
            { key: "text", label: "What happens", max: PROOF_LIMITS.process_steps.text, required: true, multiline: true },
            { key: "time", label: "Time (optional)", max: PROOF_LIMITS.process_steps.time, required: false, placeholder: "10 min" },
          ]}
          onChange={setSteps}
          disabled={!canManage || savePlan.isPending}
          testPrefix="proof-steps"
          addLabel="Add a step"
        />
      ) : null}
      <RowsEditor<{ big: string; small: string }>
        title="Quick facts"
        hint="Up to three, like “90°C” and “Our sauna”."
        rows={facts?.facts ?? []}
        max={PROOF_LIMITS.quick_facts.max}
        fields={[
          { key: "big", label: "Big line", max: PROOF_LIMITS.quick_facts.big, required: true },
          { key: "small", label: "Small line", max: PROOF_LIMITS.quick_facts.small, required: true },
        ]}
        onChange={(rows) => setFacts((prev) => ({ ...(prev ?? { use_in_ticker: false, ticker: [] }), facts: rows }))}
        disabled={!canManage || savePlan.isPending}
        testPrefix="proof-facts"
        addLabel="Add a fact"
      />
      <Card testID="proof-ticker">
        <View style={styles.tickRow}>
          <Toggle value={facts?.use_in_ticker === true} onChange={(value) => setFacts((prev) => ({ ...(prev ?? { facts: [], ticker: [] }), use_in_ticker: value }))} label="Use these in the ticker" disabled={!canManage} testID="proof-ticker-toggle" />
          <Body style={styles.tickLabel}>Use these in the ticker</Body>
        </View>
        <Field
          label="Ticker phrases (one per line, optional)"
          multiline
          max={PROOF_LIMITS.quick_facts.ticker * (PROOF_LIMITS.quick_facts.phrase + 1)}
          value={(facts?.ticker ?? []).join("\n")}
          editable={canManage}
          onChangeText={(value) => setFacts((prev) => ({ ...(prev ?? { facts: [], use_in_ticker: false }), ticker: value.split("\n").slice(0, PROOF_LIMITS.quick_facts.ticker) }))}
          testID="proof-ticker-phrases"
        />
      </Card>

      {notice ? <Banner tone={notice.kind === "error" ? "err" : "ok"} icon={notice.kind === "error" ? "alert" : "check"} title={notice.message} alert={notice.kind === "error"} /> : null}
      <View style={styles.row}>
        <WButton label={savePlan.isPending ? "Saving…" : "Save answers"} variant="primary" disabled={!canManage || savePlan.isPending} onPress={onSaveAnswers} testID="proof-save" />
        <WButton label="Next" disabled={savePlan.isPending} onPress={() => onDone("approve")} testID="proof-next" />
        <WButton label="Skip for now" variant="ghost" disabled={!canManage || savePlan.isPending} onPress={onSkip} testID="proof-skip" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 16 },
  form: { gap: 12, paddingTop: 8, paddingBottom: 4 },
  list: { marginTop: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 4 },
  rowActions: { flexDirection: "row", gap: 8 },
  tickRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
  tickLabel: { flex: 1, color: ui.t1 },
  error: { color: ui.err, fontSize: 13 },
});
