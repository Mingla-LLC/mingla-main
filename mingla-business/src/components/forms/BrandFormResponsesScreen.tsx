/**
 * #4514 — Promote › Forms › one form: Responses.
 *
 * Tabs: Summary (a bar per option for choice questions, the latest answers
 * for the rest), Responses (each with its form version, "Answered an earlier
 * version"), and Not answered. Marketing managers and up read; Export needs
 * an event manager or above (contract correction C5) and is hidden below it.
 *
 * Ask / Remind and "Ask guests to answer" belong to a later wave; this screen
 * draws no control for them.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { color, radius, space, type } from "../../constants/designSystem";
import {
  useBrandFormDetail,
  useBrandFormResponses,
  useCloseBrandForm,
  useReopenBrandForm,
} from "../../hooks/useBrandForms";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import type { BrandFormResponseRow } from "../../services/brandFormsService";
import { exportFormAnswers } from "../../services/brandFormsExportService";
import { answerText, subjectName, summarize, summaryDefinition } from "../../utils/brandFormResponses";
import { canAttachGuestQuestions, type GuestQuestionsPageKind } from "../../utils/guestQuestionsModel";
import { MIN_RANK } from "../../utils/permissionGates";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { EmptyState } from "../ui/EmptyState";
import { GlassCard } from "../ui/GlassCard";
import { IconChrome } from "../ui/IconChrome";
import { Chip, Pill } from "../ui/Pill";
import { Sheet } from "../ui/Sheet";
import { SheetScrollLayout } from "../ui/SheetScrollLayout";
import { Tabs } from "../ui/Tabs";
import { FORMS_COPY, modeLabel } from "./brandFormsCopy";
import { FormsNotice } from "./FormsNotice";
import { GuestQuestionsSheet } from "./GuestQuestionsSheet";
import { errorSentence, useFormsToast } from "./useFormsToast";

type RTab = "summary" | "responses" | "not_answered";

const formatWhen = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

const SummaryCard: React.FC<{
  summary: ReturnType<typeof summarize>[number];
}> = ({ summary }) => (
  <GlassCard variant="base" radius="lg" padding={space[4]} testID={`brand-form-summary-${summary.question.id}`}>
    <Text style={styles.qNumber}>{`Q${summary.number}${summary.conditionNote !== null ? ` · ${summary.conditionNote}` : ""}`}</Text>
    <Text style={styles.qLabel}>{summary.question.label}</Text>
    {summary.bars.length > 0 ? (
      <View style={styles.bars}>
        {summary.bars.map((bar) => (
          <View key={bar.optionId} style={styles.bar}>
            <View style={styles.barHead}>
              <Text style={styles.barLabel} numberOfLines={1}>
                {bar.label}
              </Text>
              <Text style={styles.barCount}>{bar.count}</Text>
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${Math.round(bar.share * 100)}%` }]} />
            </View>
          </View>
        ))}
        <Text style={styles.qMeta}>{FORMS_COPY.answeredCount(summary.answeredTotal)}</Text>
      </View>
    ) : (
      <View style={styles.bars}>
        {summary.samples.length === 0 ? <Text style={styles.qMeta}>{FORMS_COPY.noAnswersYet}</Text> : null}
        {summary.samples.map((sample, i) => (
          <View key={`${sample.name}-${i}`}>
            <Text style={styles.sample}>{`“${sample.text}”`}</Text>
            <Text style={styles.qMeta}>{sample.name}</Text>
          </View>
        ))}
        {summary.sampleCount > 0 ? <Text style={styles.qMeta}>{FORMS_COPY.answersCount(summary.sampleCount)}</Text> : null}
      </View>
    )}
  </GlassCard>
);

export const BrandFormResponsesScreen: React.FC = () => {
  const router = useRouter();
  const params = useLocalSearchParams<{ formId?: string; eventId?: string; tab?: string }>();
  const formId = typeof params.formId === "string" ? params.formId : null;
  const detail = useBrandFormDetail(formId);
  const role = useCurrentBrandRole(detail.data?.form.brandId ?? null);
  const close = useCloseBrandForm();
  const reopen = useReopenBrandForm();
  const { show, toast } = useFormsToast();

  const attachments = useMemo(() => detail.data?.attachments ?? [], [detail.data]);
  const paramEvent = typeof params.eventId === "string" ? params.eventId : null;
  const [pickedEvent, setPickedEvent] = useState<string | null | undefined>(undefined);
  const eventId =
    pickedEvent !== undefined
      ? pickedEvent
      : paramEvent !== null
        ? paramEvent
        : attachments.length === 1
          ? attachments[0]?.eventId ?? null
          : null;
  const attachment = attachments.find((a) => a.eventId === eventId) ?? null;

  const initialTab: RTab =
    params.tab === "not_answered" ? "not_answered" : params.tab === "responses" ? "responses" : "summary";
  const [tab, setTab] = useState<RTab>(initialTab);
  const [drawer, setDrawer] = useState<BrandFormResponseRow | null>(null);
  const [exporting, setExporting] = useState<boolean>(false);
  const [confirmClose, setConfirmClose] = useState<boolean>(false);
  const [changeOpen, setChangeOpen] = useState<boolean>(false);

  const responses = useBrandFormResponses({ formId, eventId, filter: "all" });
  const page = responses.data;
  const canExport = role.rank >= MIN_RANK.EXPORT_FORM_RESPONSES && eventId !== null;
  const canRead = role.isLoading || role.rank >= MIN_RANK.READ_FORM_RESPONSES;
  // "Change or remove" is the attach sheet: event manager and up, for one page.
  const canChange = canAttachGuestQuestions(role.rank) && attachment !== null;
  const attachKind: GuestQuestionsPageKind =
    attachment?.eventType === "rsvp"
      ? "rsvp"
      : attachment?.eventType === "trip"
        ? "trip"
        : attachment?.eventType === "experience"
          ? "experience"
          : "event";

  const definition = useMemo(() => (page !== undefined ? summaryDefinition(page) : null), [page]);
  const summaries = useMemo(
    () => (page !== undefined && definition !== null ? summarize(definition, page.counts, page.rows) : []),
    [page, definition],
  );

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/marketing/forms" as never);
  }, [router]);

  // C5: event manager and up export this page's answers through the answers-only
  // feed (the roster export needs brand_admin and is not widened).
  const handleExport = useCallback((): void => {
    if (formId === null || eventId === null || detail.data === undefined || exporting) return;
    setExporting(true);
    exportFormAnswers({ formId, formName: detail.data.form.name, eventId })
      .then((method) => {
        if (method !== "dismissed") show("success", FORMS_COPY.exportedToast);
      })
      .catch((error: unknown) => show("error", errorSentence(error, FORMS_COPY.exportFailed)))
      .finally(() => setExporting(false));
  }, [formId, eventId, detail.data, exporting, show]);

  const handleClose = useCallback((): void => {
    if (formId === null) return;
    close.mutate(formId, {
      onSuccess: () => {
        setConfirmClose(false);
        show("success", FORMS_COPY.closedToast);
      },
      onError: (error) => {
        setConfirmClose(false);
        show("error", errorSentence(error, "Couldn't close the form. Try again."));
      },
    });
  }, [formId, close, show]);

  const handleReopen = useCallback((): void => {
    if (formId === null) return;
    reopen.mutate(formId, {
      onSuccess: () => show("success", FORMS_COPY.reopenedToast),
      onError: (error) => show("error", errorSentence(error, "Couldn't reopen the form. Try again.")),
    });
  }, [formId, reopen, show]);

  let content: React.ReactElement;
  if (formId === null || (detail.isLoading && detail.data === undefined)) {
    content = (
      <View style={styles.center} testID="brand-form-responses-loading">
        <ActivityIndicator size="small" color={color.text2} />
      </View>
    );
  } else if (detail.isError && detail.data === undefined) {
    content = (
      <EmptyState
        illustration="list"
        title={FORMS_COPY.loadFailedTitle}
        description={errorSentence(detail.error, FORMS_COPY.listLoadFailedBody)}
        cta={{ label: FORMS_COPY.tryAgain, onPress: () => void detail.refetch(), variant: "secondary" }}
      />
    );
  } else if (!canRead) {
    content = (
      <EmptyState
        illustration="list"
        title="Answers are for marketing managers and above"
        description="Ask a brand admin to change your role."
      />
    );
  } else if (detail.data === undefined) {
    content = <View style={styles.center} />;
  } else {
    const form = detail.data.form;
    const live = form.status === "live";
    const closed = form.status === "closed";
    const rows = page?.rows ?? [];
    const notAnswered = page?.notAnswered ?? [];
    const when = attachment !== null ? modeLabel(attachment.mode, attachment.eventType === "rsvp") : null;

    let tabBody: React.ReactElement;
    if (responses.isLoading && page === undefined) {
      tabBody = (
        <View style={styles.center} testID="brand-form-responses-rows-loading">
          <ActivityIndicator size="small" color={color.text2} />
        </View>
      );
    } else if (responses.isError || page === undefined) {
      tabBody = (
        <EmptyState
          illustration="list"
          title="Couldn't load the answers"
          description={errorSentence(responses.error, FORMS_COPY.listLoadFailedBody)}
          cta={{ label: FORMS_COPY.tryAgain, onPress: () => void responses.refetch(), variant: "secondary" }}
          testID="brand-form-responses-error"
        />
      );
    } else if (tab === "summary") {
      tabBody =
        summaries.length === 0 ? (
          <EmptyState illustration="list" title={FORMS_COPY.noAnswersYet} description={FORMS_COPY.noAnswersBody} />
        ) : (
          <View style={styles.summaryGrid} testID="brand-form-summary">
            {summaries.map((s) => (
              <SummaryCard key={s.question.id} summary={s} />
            ))}
          </View>
        );
    } else if (tab === "responses") {
      tabBody =
        rows.length === 0 ? (
          <EmptyState illustration="list" title={FORMS_COPY.noAnswersYet} description={FORMS_COPY.noAnswersBody} />
        ) : (
          <GlassCard variant="base" radius="lg" padding={space[2]}>
            {rows.map((row) => (
              <Pressable
                key={row.responseId}
                onPress={() => setDrawer(row)}
                accessibilityRole="button"
                accessibilityLabel={`${subjectName(row)}, answered ${formatWhen(row.updatedAt)}${row.earlierVersion ? ", answered an earlier version" : ""}`}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                testID={`brand-form-response-${row.responseId}`}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowName}>{subjectName(row)}</Text>
                  <Text style={styles.rowSub}>
                    {`Answered ${formatWhen(row.updatedAt)}${row.earlierVersion ? ` · ${FORMS_COPY.answeredEarlier}` : ""}`}
                  </Text>
                </View>
                {row.viaLink ? <Chip label={FORMS_COPY.viaLink} /> : null}
                {!row.verified ? <Chip label="Unverified" /> : null}
              </Pressable>
            ))}
          </GlassCard>
        );
    } else if (eventId === null) {
      tabBody = <Text style={styles.hint}>{FORMS_COPY.notAnsweredNeedsPage}</Text>;
    } else {
      tabBody =
        notAnswered.length === 0 ? (
          <EmptyState illustration="check" title={FORMS_COPY.allAnsweredTitle} description={FORMS_COPY.allAnsweredBody} />
        ) : (
          <View style={styles.summaryGrid}>
            <Text style={styles.hint}>{FORMS_COPY.notAnsweredHeadline(notAnswered.length)}</Text>
            <GlassCard variant="base" radius="lg" padding={space[2]}>
              {notAnswered.map((n) => (
                <View key={`${n.kind}-${n.id}`} style={styles.row} testID={`brand-form-not-answered-${n.id}`}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowName}>{n.name !== null && n.name.trim().length > 0 ? n.name : "Guest"}</Text>
                  </View>
                  {n.addedByHost ? <Chip label={FORMS_COPY.addedByYou} /> : null}
                  <Chip label={FORMS_COPY.notAnsweredChip} />
                </View>
              ))}
            </GlassCard>
          </View>
        );
    }

    content = (
      <>
        <View style={styles.head}>
          <IconChrome icon="arrowL" size={36} onPress={handleBack} accessibilityLabel="Back to forms" />
          <Text style={styles.title} numberOfLines={2} accessibilityRole="header">
            {`${form.name} · ${FORMS_COPY.responsesTitle}`}
          </Text>
        </View>
        <View style={styles.statusRow}>
          <Pill variant={live ? "live" : closed ? "muted" : "draft"}>
            {live ? FORMS_COPY.statusLive : closed ? FORMS_COPY.statusClosed : FORMS_COPY.statusDraft}
          </Pill>
          <Text style={styles.version}>
            {[
              detail.data.version !== null ? FORMS_COPY.version(detail.data.version) : null,
              attachment !== null && attachment.eventName !== null ? `on ${attachment.eventName}` : null,
              when,
            ]
              .filter((x): x is string => x !== null)
              .join(" · ")}
          </Text>
        </View>
        <View style={styles.actions}>
          {canExport ? (
            <Button
              label={exporting ? FORMS_COPY.exporting : FORMS_COPY.exportCsv}
              variant="secondary"
              size="sm"
              leadingIcon="download"
              loading={exporting}
              disabled={exporting}
              onPress={handleExport}
              testID="brand-form-export"
            />
          ) : null}
          {canChange ? (
            <Button
              label={FORMS_COPY.changeOrRemove}
              variant="secondary"
              size="sm"
              onPress={() => setChangeOpen(true)}
              testID="brand-form-change-or-remove"
            />
          ) : null}
          {live ? (
            <Button label={FORMS_COPY.closeForm} variant="secondary" size="sm" disabled={close.isPending} onPress={() => setConfirmClose(true)} testID="brand-form-close" />
          ) : null}
          {closed ? (
            <Button label={FORMS_COPY.reopen} variant="primary" size="sm" loading={reopen.isPending} disabled={reopen.isPending} onPress={handleReopen} testID="brand-form-reopen" />
          ) : null}
        </View>
        {closed ? <FormsNotice tone="info" title={FORMS_COPY.closedBanner} /> : null}
        {attachments.length > 1 ? (
          <View style={styles.chips} accessibilityRole="radiogroup" testID="brand-form-page-chips">
            <Chip label={FORMS_COPY.allPages} selected={eventId === null} onPress={() => setPickedEvent(null)} />
            {attachments.map((a) => (
              <Chip
                key={a.id}
                label={a.eventName ?? "A page"}
                selected={eventId === a.eventId}
                onPress={() => setPickedEvent(a.eventId)}
              />
            ))}
          </View>
        ) : null}
        <Tabs<RTab>
          items={[
            { key: "summary", label: FORMS_COPY.tabSummary },
            { key: "responses", label: FORMS_COPY.tabResponses(page?.total ?? 0) },
            { key: "not_answered", label: FORMS_COPY.tabNotAnswered(notAnswered.length) },
          ]}
          value={tab}
          onChange={setTab}
          testID="brand-form-responses-tabs"
        />
        {tabBody}
      </>
    );
  }

  const drawerDefinition = drawer !== null && page !== undefined ? page.versions[drawer.versionId]?.definition ?? null : null;

  return (
    <View style={styles.host}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {content}
      </ScrollView>

      <Sheet visible={drawer !== null} onClose={() => setDrawer(null)} snapPoint="half">
        <SheetScrollLayout
          testID="brand-form-answers-sheet"
          footer={<Button label="Done" variant="secondary" size="md" fullWidth onPress={() => setDrawer(null)} testID="brand-form-answers-done" />}
        >
          {drawer !== null ? (
            <>
              <Text style={styles.sheetTitle} accessibilityRole="header">
                {subjectName(drawer)}
              </Text>
              <Text style={styles.rowSub}>
                {`${FORMS_COPY.version(drawer.version)} · Answered ${formatWhen(drawer.updatedAt)}${drawer.earlierVersion ? ` · ${FORMS_COPY.answeredEarlier}` : ""}`}
              </Text>
              {(drawerDefinition?.questions ?? [])
                .slice()
                .sort((a, b) => a.position - b.position)
                .map((q) => {
                  const text = answerText(q, drawer.answers[q.id]).trim();
                  return (
                    <View key={q.id} style={styles.answerBlock}>
                      <Text style={styles.qMeta}>{q.label}</Text>
                      <Text style={styles.answerText}>{text.length > 0 ? text : "Not answered"}</Text>
                    </View>
                  );
                })}
            </>
          ) : null}
        </SheetScrollLayout>
      </Sheet>

      {changeOpen && attachment !== null && detail.data !== undefined ? (
        <GuestQuestionsSheet
          visible
          onClose={() => setChangeOpen(false)}
          brandId={detail.data.form.brandId}
          eventId={attachment.eventId}
          kind={attachKind}
          current={{ attachment, form: detail.data.form }}
          onRemoved={() => setPickedEvent(null)}
        />
      ) : null}

      <ConfirmDialog
        visible={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={handleClose}
        title={FORMS_COPY.closeConfirmTitle}
        description={FORMS_COPY.closeConfirmBody}
        confirmLabel={FORMS_COPY.closeForm}
        cancelLabel={FORMS_COPY.keepOpen}
        confirmLoading={close.isPending}
        testID="brand-form-close-dialog"
      />
      {toast}
    </View>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1 },
  scroll: { paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: 140, gap: space[3] },
  center: { paddingVertical: space[8], alignItems: "center" },
  head: { flexDirection: "row", alignItems: "center", gap: space[2] },
  title: { ...type.title, color: color.text1, flex: 1, minWidth: 0 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" },
  version: { ...type.caption, color: color.text3, flexShrink: 1 },
  actions: { flexDirection: "row", gap: space[2], flexWrap: "wrap" },
  chips: { flexDirection: "row", gap: space[1], flexWrap: "wrap" },
  summaryGrid: { gap: space[3] },
  qNumber: { ...type.caption, color: color.text3 },
  qLabel: { ...type.row, color: color.text1, marginTop: space[1] },
  qMeta: { ...type.caption, color: color.text3 },
  bars: { gap: space[2], marginTop: space[3] },
  bar: { gap: 4 },
  barHead: { flexDirection: "row", justifyContent: "space-between", gap: space[2] },
  barLabel: { ...type.small, color: color.text2, flex: 1 },
  barCount: { ...type.small, color: color.text1, fontWeight: "700" },
  barTrack: { height: 8, borderRadius: radius.full, backgroundColor: color.fill.inset, overflow: "hidden" },
  barFill: { height: 8, borderRadius: radius.full, backgroundColor: color.accent },
  sample: { ...type.small, color: color.text2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingVertical: space[3],
    paddingHorizontal: space[2],
    minHeight: 56,
  },
  rowPressed: { opacity: 0.7 },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { ...type.row, color: color.text1 },
  rowSub: { ...type.caption, color: color.text3 },
  hint: { ...type.small, color: color.text2 },
  sheetTitle: { ...type.title, color: color.text1 },
  answerBlock: { marginTop: space[4], gap: 2 },
  answerText: { ...type.body, color: color.text1 },
});
