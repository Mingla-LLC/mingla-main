import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "../../components/ui/Button";
import { GlassCard } from "../../components/ui/GlassCard";
import {
  accent,
  androidOpaque,
  canvas,
  glass,
  radius,
  semantic,
  spacing,
  text,
  typography,
} from "../../constants/designSystem";
import { CONTACT_IMPORT_ATTESTATION_VERSION } from "../../constants/contactImportAttestation";
import {
  ContactImportError,
  getContactImportStatus,
  type ContactImportFile,
  type ContactImportInspection,
  type ContactImportMapping,
  type ContactImportPreview,
  type ContactImportResult,
  type ContactImportTarget,
} from "../../services/contactImportService";
import { useContactImport } from "../../hooks/useContactImport";
import { randomId } from "../../utils/randomId";
import { pickContactImportFile } from "./contactImportFilePicker";
import { ContactImportOutcomeGrid } from "./ContactImportOutcomeGrid";
import { captureContactImport } from "./contactImportAnalytics";
import { useShareNetworkState } from "../../components/ui/useShareNetworkState";
import { useNavigation } from "expo-router";
type Step =
  "file" | "columns" | "preview" | "permission" | "importing" | "result";
const targets: ContactImportTarget[] = [
  "ignore",
  "full_name",
  "first_name",
  "last_name",
  "email",
  "phone",
];
const labels: Record<ContactImportTarget, string> = {
  ignore: "Ignore",
  full_name: "Full name",
  first_name: "First name",
  last_name: "Last name",
  email: "Email",
  phone: "Phone",
};
const errorCopy = (e: unknown): string =>
  e instanceof ContactImportError
    ? `${e.message}${e.requestId ? ` Request ID: ${e.requestId}` : ""}`
    : "We couldn't finish the import. Try again.";
export function ContactImportFlow({
  brandId,
  onViewBook,
  onReview,
  context = "book",
  onCompleted,
}: {
  brandId: string;
  onViewBook: () => void;
  onReview?: () => void;
  context?: "book" | "manual_group";
  onCompleted?: (result: ContactImportResult) => void;
}): React.ReactElement {
  const api = useContactImport();
  const navigation = useNavigation();
  const sanctionedExitRef = useRef(false);
  const [step, setStep] = useState<Step>("file"),
    [file, setFile] = useState<ContactImportFile | null>(null),
    [inspection, setInspection] = useState<ContactImportInspection | null>(
      null,
    ),
    [mapping, setMapping] = useState<ContactImportMapping>({}),
    [preview, setPreview] = useState<ContactImportPreview | null>(null),
    [result, setResult] = useState<ContactImportResult | null>(null),
    [idempotencyKey, setIdempotencyKey] = useState<string | null>(null),
    [accepted, setAccepted] = useState(false),
    [error, setError] = useState<string | null>(null),
    [, setClock] = useState(0);
  const online = useShareNetworkState();
  useEffect(() => captureContactImport("contact_import_opened"), []);
  useEffect(() => {
    setAccepted(false);
    setFile(null);
    setInspection(null);
    setMapping({});
    setPreview(null);
    setResult(null);
    setIdempotencyKey(null);
    setError(null);
    setStep("file");
    sanctionedExitRef.current = false;
  }, [brandId]);
  useEffect(() => {
    if (!preview) return;
    const delay = Math.max(0, Date.parse(preview.expiresAt) - Date.now());
    const timer = setTimeout(() => setClock((value) => value + 1), delay + 25);
    return () => clearTimeout(timer);
  }, [preview]);
  useEffect(() => {
    if (step !== "importing" || !preview || !online) return;
    let stopped = false;
    const poll = async () => {
      try {
        const recovered = await getContactImportStatus(
          brandId,
          preview.batchId,
        );
        if (stopped) return;
        if (recovered.state === "completed") {
          setResult(recovered);
          setStep("result");
          setError(null);
          onCompleted?.(recovered);
        } else if (recovered.state === "failed") {
          setStep("permission");
          setError("We couldn't confirm the result yet. Try again.");
        }
      } catch {
        if (!stopped) setError("Checking import status…");
      }
    };
    void poll();
    const timer = setInterval(poll, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [brandId, online, onCompleted, preview, step]);
  useEffect(() => {
    if (Platform.OS !== "web" || step !== "importing") return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "Your import is still running.";
    };
    globalThis.addEventListener?.("beforeunload", guard);
    return () => globalThis.removeEventListener?.("beforeunload", guard);
  }, [step]);
  useEffect(() => {
    if (Platform.OS === "web" || step !== "importing") return;
    const unsubscribe = navigation.addListener(
      "beforeRemove" as never,
      (raw: unknown) => {
        if (sanctionedExitRef.current) {
          sanctionedExitRef.current = false;
          return;
        }
        const event = raw as {
          preventDefault: () => void;
          data: { action: unknown };
        };
        event.preventDefault();
        Alert.alert(
          "Your import is still running",
          "You can leave and check its status later.",
          [
            { text: "Keep waiting", style: "cancel" },
            {
              text: "Leave",
              onPress: () => {
                sanctionedExitRef.current = true;
                navigation.dispatch(event.data.action as never);
              },
            },
          ],
        );
      },
    );
    return unsubscribe;
  }, [navigation, step]);
  const mappingValid = useMemo(() => {
    const v = Object.values(mapping).filter((x) => x !== "ignore");
    return (
      (v.includes("email") || v.includes("phone")) &&
      new Set(v).size === v.length &&
      !(
        v.includes("full_name") &&
        (v.includes("first_name") || v.includes("last_name"))
      )
    );
  }, [mapping]);
  const previewExpired = preview
    ? Date.parse(preview.expiresAt) <= Date.now()
    : false;
  const choose = async () => {
    try {
      const selected = await pickContactImportFile();
      if (!selected) return;
      setFile(selected);
      setInspection(null);
      setPreview(null);
      setAccepted(false);
      setIdempotencyKey(null);
      setError(null);
      captureContactImport("file_selected", {
        size_bucket: selected.size > 1_000_000 ? "large" : "small",
      });
    } catch (e) {
      setError(errorCopy(e));
    }
  };
  const inspect = async () => {
    if (!file) return;
    setError(null);
    try {
      const x = await api.inspect.mutateAsync({ brandId, file });
      setInspection(x);
      setMapping(x.suggestedMapping);
      setStep("columns");
      captureContactImport("mapping_viewed", {
        provider: x.file.detectedProvider,
        row_count: x.file.rowCount,
      });
    } catch (e) {
      if (
        e instanceof ContactImportError &&
        ["PREVIEW_STALE_OR_TAMPERED", "INSPECTION_STALE_OR_TAMPERED"].includes(
          e.code,
        )
      ) {
        setAccepted(false);
        setError(
          "This preview is out of date. Check the file again before importing.",
        );
      } else setError(errorCopy(e));
    }
  };
  const makePreview = async () => {
    if (!file || !inspection || !mappingValid) return;
    setError(null);
    try {
      const p = await api.preview.mutateAsync({
        brandId,
        file,
        inspection,
        mapping,
      });
      setPreview(p);
      setAccepted(false);
      setStep("preview");
      captureContactImport("preview_succeeded", {
        row_count: p.counts.rowCount,
        provider: p.file.detectedProvider,
      });
    } catch (e) {
      setError(errorCopy(e));
      captureContactImport("preview_failed", {
        code: e instanceof ContactImportError ? e.code : "unknown",
      });
    }
  };
  const execute = async () => {
    if (!preview || !accepted) return;
    setStep("importing");
    captureContactImport("execute_started");
    const key = idempotencyKey ?? randomId();
    setIdempotencyKey(key);
    try {
      const r = await api.execute.mutateAsync({
        brandId,
        preview,
        mapping,
        idempotencyKey: key,
      });
      setResult(r);
      setStep("result");
      onCompleted?.(r);
      captureContactImport("execute_completed", {
        row_count: r.counts.rowCount,
        context,
      });
      captureContactImport("result_viewed");
    } catch (e) {
      if (e instanceof ContactImportError && e.code === "FORBIDDEN") {
        setError("Your access changed. Ask a brand owner for permission.");
        setAccepted(false);
        setStep("permission");
      } else {
        setError("Checking import status…");
        try {
          const recovered = await getContactImportStatus(
            brandId,
            preview.batchId,
          );
          if (recovered.state === "completed") {
            setResult(recovered);
            setStep("result");
            onCompleted?.(recovered);
          } else if (recovered.state === "failed") {
            setError("We couldn't confirm the result yet. Try again.");
            setStep("permission");
          } else {
            setStep("importing");
          }
        } catch {
          setError("We couldn't confirm the result yet. Try again.");
          setStep("permission");
        }
      }
      captureContactImport("execute_failed", {
        code: e instanceof ContactImportError ? e.code : "unknown",
      });
    }
  };
  const reset = () => {
    setStep("file");
    setFile(null);
    setInspection(null);
    setPreview(null);
    setResult(null);
    setAccepted(false);
    setIdempotencyKey(null);
    setError(null);
  };
  const loadMoreResults = async () => {
    if (!result || result.resultRows.length >= result.resultPage.total) return;
    try {
      const next = await getContactImportStatus(
        brandId,
        result.batchId,
        result.resultPage.page + 1,
        result.resultPage.pageSize,
      );
      setResult({
        ...next,
        resultRows: [...result.resultRows, ...next.resultRows].filter(
          (row, index, all) =>
            all.findIndex(
              (candidate) => candidate.rowNumber === row.rowNumber,
            ) === index,
        ),
      });
    } catch (e) {
      setError(errorCopy(e));
    }
  };
  if (step === "columns" && inspection)
    return (
      <View style={s.host}>
        <Text accessibilityRole="header" style={s.h2}>
          Map columns
        </Text>
        <Text style={s.body}>
          {inspection.file.detectedProvider === "generic"
            ? "Choose what each column means."
            : `${inspection.file.detectedProvider === "eventbrite" ? "Eventbrite" : "Mailchimp"} columns detected`}
        </Text>
        <FlatList
          data={inspection.file.headers}
          keyExtractor={(h) => h}
          initialNumToRender={14}
          renderItem={({ item, index }) => (
            <View style={s.mapRow}>
              <View style={s.grow}>
                <Text style={s.mapHeader}>{item}</Text>
                <Text style={s.sample}>
                  {inspection.samples[index]?.values
                    .filter(Boolean)
                    .join(" · ") || "No sample"}
                </Text>
              </View>
              <View style={s.targetWrap}>
                {targets.map((t) => (
                  <Pressable
                    key={t}
                    accessibilityRole="button"
                    accessibilityLabel={`${item} maps to ${labels[t]}`}
                    onPress={() => setMapping((m) => ({ ...m, [item]: t }))}
                    style={[s.choice, mapping[item] === t && s.choiceActive]}
                  >
                    <Text
                      style={[
                        s.choiceText,
                        mapping[item] === t && s.choiceActiveText,
                      ]}
                    >
                      {labels[t]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          ListFooterComponent={
            <View style={s.footer}>
              {!mappingValid && (
                <Text accessibilityLiveRegion="polite" style={s.err}>
                  Choose an email or phone column. Use each field once, and use
                  Full name or First/Last—not both.
                </Text>
              )}
              <Button
                label="Continue"
                size="lg"
                fullWidth
                disabled={!mappingValid || api.preview.isPending}
                loading={api.preview.isPending}
                onPress={makePreview}
              />
              {error && <Text style={s.err}>{error}</Text>}
            </View>
          }
        />
      </View>
    );
  if ((step === "preview" || step === "permission") && preview)
    return (
      <FlatList
        style={s.host}
        data={preview.rows}
        keyExtractor={(r) => String(r.rowNumber)}
        ListHeaderComponent={
          <View style={s.section}>
            <Text accessibilityRole="header" style={s.h2}>
              Preview
            </Text>
            <Text style={s.body}>Nothing is added until you confirm.</Text>
            <Text style={s.sample}>
              Showing all {preview.rows.length} preview rows.
            </Text>
            <ContactImportOutcomeGrid counts={preview.counts} />
            <GlassCard variant="elevated" style={s.attestation}>
              <Text style={s.eyebrow}>PERMISSION TO CONTACT</Text>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: accepted }}
                accessibilityLabel={preview.attestation.text}
                onPress={() => {
                  setAccepted((v) => !v);
                  captureContactImport("attestation_checked");
                }}
                style={s.checkRow}
              >
                <View style={[s.box, accepted && s.boxOn]}>
                  {accepted && <Text style={s.check}>✓</Text>}
                </View>
                <Text style={s.legal}>{preview.attestation.text}</Text>
              </Pressable>
            </GlassCard>
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.row}>
            <Text style={s.body}>
              Row {item.rowNumber} · {item.outcome}
            </Text>
            <Text style={s.sample}>
              {item.reasonCode ??
                [
                  item.emailSuppressed && "Email suppressed",
                  item.smsSuppressed && "Text suppressed",
                ]
                  .filter(Boolean)
                  .join(" · ")}
            </Text>
          </View>
        )}
        ListFooterComponent={
          <View style={s.footer}>
            <Button
              label={`Confirm and import ${preview.counts.rowCount} contacts`}
              size="lg"
              fullWidth
              accentColor={accent.warm}
              disabled={
                !online ||
                previewExpired ||
                !accepted ||
                preview.attestation.version !==
                  CONTACT_IMPORT_ATTESTATION_VERSION
              }
              onPress={execute}
            />
            {!online && (
              <Text style={s.err}>You’re offline. Reconnect to continue.</Text>
            )}
            {previewExpired && (
              <Text style={s.err}>
                This preview is out of date. Check the file again before
                importing.
              </Text>
            )}
            {error && <Text style={s.err}>{error}</Text>}
          </View>
        }
      />
    );
  if (step === "importing")
    return (
      <View style={s.center}>
        <Text accessibilityRole="header" style={s.h2}>
          Importing…
        </Text>
        <Text style={s.body}>You can leave and check its status later.</Text>
        <Text style={s.sample}>Your import is still running.</Text>
        <Button label="Importing…" loading disabled onPress={() => undefined} />
      </View>
    );
  if (step === "result" && result)
    return (
      <FlatList
        style={s.host}
        data={result.resultRows}
        keyExtractor={(row) => String(row.rowNumber)}
        renderItem={({ item }) => (
          <View style={s.row}>
            <Text style={s.body}>
              Row {item.rowNumber} · {item.outcome}
            </Text>
            {!!item.reasonCode && (
              <Text style={s.sample}>{item.reasonCode}</Text>
            )}
          </View>
        )}
        ListHeaderComponent={
          <View style={s.section}>
            <Text accessibilityRole="header" style={s.h2}>
              Import complete
            </Text>
            <ContactImportOutcomeGrid counts={result.counts} />
            <Text style={s.sample}>
              Showing {result.resultRows.length} of {result.resultPage.total}{" "}
              result rows.
            </Text>
            {result.counts.reviewCount > 0 &&
              (onReview ? (
                <Button
                  label="Review conflicts"
                  variant="ghost"
                  onPress={onReview}
                />
              ) : (
                <Text style={s.body}>Conflict review is coming next</Text>
              ))}
            <Button
              label="Import another CSV"
              variant="ghost"
              onPress={reset}
            />
            {result.resultRows.length < result.resultPage.total && (
              <Button
                label="Load more"
                variant="ghost"
                onPress={loadMoreResults}
              />
            )}
            {error && <Text style={s.err}>{error}</Text>}
            <Button
              label="View Your Book"
              size="lg"
              fullWidth
              onPress={onViewBook}
            />
          </View>
        }
      />
    );
  return (
    <View style={s.section}>
      <Text accessibilityRole="header" style={s.h2}>
        {context === "manual_group" ? "Upload contacts" : "Import contacts"}
      </Text>
      <Text style={s.body}>
        {context === "manual_group"
          ? "Everyone uploaded is saved to Your Book first."
          : "Upload a CSV with a name, email, or phone column."}
      </Text>
      <GlassCard variant="base" style={s.fileCard}>
        <Text style={s.h3}>{file?.name ?? "Choose CSV"}</Text>
        <Text style={s.sample}>
          {file ? `${Math.ceil(file.size / 1024)} KB` : "Up to 10,000 rows."}
        </Text>
        <Button
          label={file ? "Change file" : "Choose CSV"}
          variant="ghost"
          onPress={choose}
        />
        {error && (
          <Text accessibilityLiveRegion="assertive" style={s.err}>
            {error}
          </Text>
        )}
      </GlassCard>
      {file && (
        <Button
          label="Continue"
          size="lg"
          fullWidth
          loading={api.inspect.isPending}
          disabled={api.inspect.isPending}
          onPress={inspect}
        />
      )}{" "}
      {api.inspect.isPending && (
        <Text style={s.body}>Reading your columns…</Text>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  host: { flex: 1, backgroundColor: canvas.discover },
  section: {
    padding: spacing.md,
    gap: spacing.md,
    maxWidth: 960,
    width: "100%",
    alignSelf: "center",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    backgroundColor: canvas.discover,
    padding: spacing.lg,
  },
  h2: { ...typography.h1, color: text.primary },
  h3: { ...typography.h3, color: text.primary },
  body: { ...typography.body, color: text.secondary },
  eyebrow: { ...typography.labelCap, color: text.tertiary },
  fileCard: {
    minHeight: 176,
    padding: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    overflow: "hidden",
    ...(Platform.OS === "android"
      ? {
          backgroundColor: androidOpaque.rowFill,
          borderColor: androidOpaque.rowBorder,
          elevation: 0,
        }
      : null),
  },
  mapRow: {
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
    gap: spacing.sm,
  },
  grow: { flex: 1 },
  mapHeader: { ...typography.body, color: text.primary, fontWeight: "600" },
  sample: { ...typography.bodySm, color: text.tertiary },
  targetWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  choice: {
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  choiceActive: { backgroundColor: accent.tint, borderColor: accent.border },
  choiceText: { ...typography.bodySm, color: text.secondary },
  choiceActiveText: { color: text.primary, fontWeight: "600" },
  footer: { padding: spacing.md, gap: spacing.sm },
  err: { ...typography.bodySm, color: semantic.error },
  attestation: { padding: spacing.md, gap: spacing.sm },
  checkRow: {
    minHeight: 44,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  box: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: glass.border.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  boxOn: { backgroundColor: accent.warm, borderColor: accent.warm },
  check: { color: canvas.depth, fontWeight: "700" },
  legal: { ...typography.body, color: text.primary, flex: 1 },
  row: {
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
  },
});
