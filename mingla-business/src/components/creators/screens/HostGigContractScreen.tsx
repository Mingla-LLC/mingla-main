/**
 * #3872 — host contract (approved P-review / P-shoot / M-hostcontract /
 * M-review / G-change / D-dispute / P-rate). A step bar, the one thing that
 * needs the host now (shoot time, script, video, posts, counter-offer,
 * dispute, rating), then fee and terms, posts and the timeline in host words.
 * Round 2 (approved M-contract): ONE status card (title, pill, step bar, next
 * line, Rate button when done), a short deal list whose Fee reads money_state
 * (On the way · Ready · Paid), posts, and Activity folded behind Show with
 * events only — never the button names.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { Button } from "../../../components/ui/Button";
import { DateField } from "../../../components/ui/DateField";
import { Icon } from "../../../components/ui/Icon";
import { Input } from "../../../components/ui/Input";
import { ProgramSheet } from "../../../components/programs/ProgramSheet";
import { TimeField } from "../../../components/programs/TimeField";
import {
  agreedVideoDue,
  agreedVideoDueWords,
  dueChangeInitial,
  dueChangeLocalErrors,
  dueChangePayload,
  dueChangeServerErrors,
  proposalChangeWords,
  type DueChangeErrors,
} from "../../../components/programs/dueChange";
import { FullScreenVideoViewer } from "../../../components/ui/FullScreenVideoViewer";
import {
  HireSheet,
  type HireSheetMode,
} from "../../../components/gigs/HireSheet";
import {
  Card,
  Checkbox,
  Chip,
  FieldError,
  ListGroup,
  ListRow,
  Muted,
  ProgramLoading,
  ProgramScreen,
  SectionLabel,
  SheetBody,
  StatusTag,
  StepBar,
  SummaryLine,
  programStyles,
} from "../../../components/programs/ProgramKit";
import { useProgramParams } from "../../../components/programs/useProgramParams";
import { useRefreshOnFocus } from "../../../components/programs/useScreenLifecycle";
import {
  playbackNotice,
  visibleNotice,
  type ContractNotice,
} from "../../../components/programs/screenLifecycle";
import {
  DISPUTE_REASONS,
  FIX_CATEGORIES,
  RATING_TAGS,
  SHOOT_TIMES,
  activityEvents,
  contractFeeWords,
  contractMoneyState,
  contractStatusCard,
  fixCategoryWords,
  fixesLeft,
  latestScript,
  postCheckWords,
  scriptChecks,
  sectionLabel,
  sectionLines,
  shootInstant,
  contractNoticeKey,
  shootWindowWords,
  workspaceShootWindow,
} from "../../../components/programs/contractCopy";
import {
  creatorGigsService,
  approvedDeliveryDownload,
  deliveryPlaybackStatus,
  openCounter,
  pendingTopup,
  type GigWorkspace,
} from "../../../services/creatorGigsService";
import {
  HOST_CONTRACT_STEPS,
  actorWords,
  dueIn,
  formatName,
  hostContractStep,
  platformLabel,
  programErrorMessage,
  programMoney,
  shortDate,
  shortDateTime,
  toIsoDay,
} from "../../../utils/creatorProgramFormat";
import {
  accent,
  radius,
  spacing,
  text as textTokens,
} from "../../../constants/designSystem";

type SheetKind =
  | null
  | "script_change"
  | "fix"
  | "suggest_time"
  | "dispute"
  | "change_dates"
  | "terms"
  | "rate";

const STEP_CAPTION: Record<number, string> = {
  1: "Offer",
  2: "Shoot",
  3: "Script",
  4: "Video",
  5: "Posts",
  6: "Paid",
};

export default function HostGigContract(): React.ReactElement {
  const router = useRouter();
  const { brandId, params } = useProgramParams("contractId");
  const contractId = params.contractId ?? "";
  const [workspace, setWorkspace] = useState<GigWorkspace | null>(null);
  const [creatorName, setCreatorName] = useState("Creator");
  const [paymentPending, setPaymentPending] = useState(false);
  const [gigIdForRetry, setGigIdForRetry] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A success notice is stamped with the contract snapshot it was shown for
  // (state, terms version and open requests) and disappears once any of them
  // moves on, so "Request sent" never outlives the answer.
  const [noticeRecord, setNoticeRecord] = useState<ContractNotice | null>(null);
  const loadedState = useRef("");
  const setNotice = useCallback((text: string | null) => {
    setNoticeRecord(text ? { text, state: loadedState.current } : null);
  }, []);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [note, setNote] = useState("");
  const [fixPicks, setFixPicks] = useState<string[]>([]);
  const [checklist, setChecklist] = useState([false, false, false]);
  const [suggestDay, setSuggestDay] = useState("");
  const [suggestHour, setSuggestHour] = useState<number | null>(null);
  const [disputeReason, setDisputeReason] = useState<string>(
    "technical_fixes_exhausted",
  );
  const [refundPercent, setRefundPercent] = useState("50");
  const [dueDay, setDueDay] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [dueErrors, setDueErrors] = useState<DueChangeErrors>({});
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [topup, setTopup] = useState<HireSheetMode | null>(null);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [downloadAvailableUntil, setDownloadAvailableUntil] = useState<
    string | null
  >(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const [next, home] = await Promise.all([
        creatorGigsService.workspace(contractId),
        brandId
          ? creatorGigsService.hostHome(brandId).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (!next) throw new Error("contract_not_found");
      loadedState.current = contractNoticeKey(next);
      setWorkspace(next);
      const summary = home?.contracts.find((row) => row.id === contractId);
      if (summary) {
        setCreatorName(summary.creator);
        setPaymentPending(summary.payment_pending);
        setGigIdForRetry(summary.gig_id || null);
      }
    } catch (refreshError) {
      setLoadError(
        programErrorMessage(
          refreshError,
          "We couldn't load this gig. Pull to try again.",
        ),
      );
    }
  }, [brandId, contractId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // The creator acts on their side: refetch on refocus and when the app
  // returns to the foreground, not only on pull-to-refresh.
  useRefreshOnFocus(refresh);
  const contractState = workspace?.contract.state ?? "";
  useEffect(() => {
    setChecklist([false, false, false]);
  }, [contractState]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      if (
        result &&
        typeof result === "object" &&
        (result as { ok?: unknown }).ok === false
      ) {
        throw new Error(
          String((result as { error?: unknown }).error ?? "update_failed"),
        );
      }
      setSheet(null);
      setNote("");
      await refresh();
      setNotice(done);
    } catch (runError) {
      setError(
        programErrorMessage(runError, "That didn't go through. Try again."),
      );
    } finally {
      setBusy(false);
    }
  };

  const state = workspace?.contract.state ?? "";
  const notice = visibleNotice(noticeRecord, contractNoticeKey(workspace));
  const step = hostContractStep(state);
  const deadline = workspace?.contract.state_deadline_at ?? null;
  const script = workspace ? latestScript(workspace) : null;
  const checks = scriptChecks(script);
  const delivery = workspace?.deliveries.length
    ? [...workspace.deliveries].sort((a, b) => b.round - a.round)[0]
    : null;
  const deliveryMediaJobId = delivery?.media_job_id ?? null;
  const approvedDeliveryState =
    Boolean(delivery) &&
    ["approved", "auto_approved"].includes(delivery?.decision ?? "") &&
    [
      "approved",
      "posting",
      "posts_failed",
      "posts_submitted",
      "posts_verified",
      "released",
      "day30",
      "completed",
      "disputed",
      "resolved_release",
      "resolved_partial",
      "resolved_refund",
    ].includes(state);
  const perpetualRightsActive = workspace?.rights?.status === "active";

  useEffect(() => {
    let active = true;
    if (!approvedDeliveryState || !deliveryMediaJobId) {
      setDownloadAvailableUntil(null);
      return () => {
        active = false;
      };
    }
    void deliveryPlaybackStatus(deliveryMediaJobId)
      .then(({ availableUntil }) => {
        if (active) setDownloadAvailableUntil(availableUntil);
      })
      .catch(() => {
        if (active) setDownloadAvailableUntil(null);
      });
    return () => {
      active = false;
    };
  }, [approvedDeliveryState, deliveryMediaJobId, state]);

  const saveApprovedMaster = async () => {
    if (!delivery) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const grant = await approvedDeliveryDownload(delivery.media_job_id);
      setDownloadAvailableUntil(grant.availableUntil);
      if (Platform.OS === "web") {
        const response = await fetch(grant.url);
        if (!response.ok) throw new Error("approved_master_download_failed");
        const objectUrl = URL.createObjectURL(await response.blob());
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = grant.filename;
        anchor.rel = "noopener";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      } else {
        // Keep native filesystem support out of the eager Host web bundle.
        // It is needed only after the Host explicitly taps Download master.
        const FileSystem = await import("expo-file-system/legacy");
        const cacheUri = `${FileSystem.cacheDirectory ?? ""}${grant.filename}`;
        const downloaded = await FileSystem.downloadAsync(grant.url, cacheUri);
        try {
          if (Platform.OS === "ios") {
              // SHARE-NON-CONTENT:file-export
            await Share.share({ url: downloaded.uri, title: grant.filename });
          } else {
            const permission =
              await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
            if (!permission.granted) {
              setNotice("Nothing was saved. Tap again whenever you're ready.");
              return;
            }
            const destination =
              await FileSystem.StorageAccessFramework.createFileAsync(
                permission.directoryUri,
                grant.filename,
                "video/mp4",
              );
            const contents = await FileSystem.readAsStringAsync(downloaded.uri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            await FileSystem.writeAsStringAsync(destination, contents, {
              encoding: FileSystem.EncodingType.Base64,
            });
          }
        } finally {
          await FileSystem.deleteAsync(downloaded.uri, {
            idempotent: true,
          });
        }
      }
      setNotice(
        "Approved master saved. Creator payout is not affected by this download.",
      );
    } catch {
      setError(
        "We couldn't save the approved video. Nothing expired—try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const left = fixesLeft(workspace?.contract.fix_rounds_used);
  const terms = workspace?.terms ?? [];
  const currentTerms = terms.length ? terms[terms.length - 1] : null;
  const counter = workspace ? openCounter(workspace) : null;
  const owedTopup = workspace ? pendingTopup(workspace) : null;
  const openOffer =
    workspace?.dispute?.offers.find((offer) => offer.status === "open") ?? null;
  const hostRated = (workspace?.ratings ?? []).some(
    (rating) => rating.rated_by === "host",
  );
  const plan = workspace?.shoot_plan ?? null;
  const gig = workspace?.gig;
  const shootWindow = workspaceShootWindow(gig);
  // The agreed due: the current terms version (an accepted change moves it).
  const agreedDue = agreedVideoDue({
    terms: workspace?.terms,
    currentVersion: workspace?.contract.current_terms_version,
    gig,
  });
  const sendDueChange = async () => {
    const local = dueChangeLocalErrors(dueDay, dueTime);
    setDueErrors(local);
    if (local.day || local.time) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = (await creatorGigsService.proposeChange(
        contractId,
        dueChangePayload(dueDay, dueTime),
        "dates",
        note.trim(),
      )) as { ok?: unknown; error?: unknown } | null;
      if (result && result.ok === false) {
        setDueErrors(dueChangeServerErrors(String(result.error ?? "")));
        return;
      }
      setSheet(null);
      setNote("");
      await refresh();
      setNotice("Request sent. The creator has 48 hours to answer.");
    } catch (sendError) {
      const code =
        sendError && typeof sendError === "object" && "message" in sendError
          ? String((sendError as { message?: unknown }).message ?? "")
          : "";
      const mapped = dueChangeServerErrors(code);
      setDueErrors(
        mapped.form === "That didn't go through. Try again."
          ? {
              form: programErrorMessage(
                sendError,
                "That didn't go through. Try again.",
              ),
            }
          : mapped,
      );
    } finally {
      setBusy(false);
    }
  };
  const caption = useMemo(() => {
    const autoWords =
      state === "script_sent"
        ? "approves itself"
        : state === "delivered"
          ? "approves itself"
          : state === "offered"
            ? "creator answers"
            : null;
    return [
      `Step ${step} of 6 · ${STEP_CAPTION[step]}`,
      autoWords && deadline ? `${autoWords} ${dueIn(deadline)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }, [state, step, deadline]);
  const moneyState = contractMoneyState(
    (workspace as { money_state?: unknown } | null)?.money_state,
  );
  const [showActivity, setShowActivity] = useState(false);
  const activity = workspace ? activityEvents(workspace.events) : [];
  const deliveryUrl = delivery
    ? typeof delivery.playback_url === "string"
      ? delivery.playback_url
      : delivery.playback &&
          typeof (delivery.playback as { url?: unknown }).url === "string"
        ? (delivery.playback as { url: string }).url
        : null
    : null;

  const respondCounter = async (accept: boolean) => {
    if (!counter) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await creatorGigsService.counterRespond(
        counter.id,
        accept,
      );
      if (!result.ok) throw new Error(result.error ?? "update_failed");
      if (
        accept &&
        result.requires_topup &&
        typeof result.terms_version === "number"
      ) {
        setTopup({
          kind: "topup",
          contractId,
          termsVersion: result.terms_version,
          topupMinor: result.topup_minor ?? 0,
        });
      }
      await refresh();
      if (
        accept &&
        result.requires_topup &&
        typeof result.terms_version === "number"
      ) {
        // The top-up sheet carries on from here.
      } else if (accept && result.refund_minor && currentTerms) {
        setNotice(
          `New fee agreed. We'll refund ${programMoney(result.refund_minor, currentTerms.currency)} to you.`,
        );
      } else {
        setNotice(accept ? "New fee agreed." : "You kept the original fee.");
      }
    } catch (counterError) {
      setError(
        programErrorMessage(
          counterError,
          "We couldn't answer the counter-offer. Try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const refundBps = Math.round(Number(refundPercent) * 100);
  const validRefund =
    Number.isFinite(refundBps) && refundBps >= 0 && refundBps <= 10000;
  const canChangeTerms = [
    "offered",
    "accepted",
    "shoot_planned",
    "script_drafting",
    "script_sent",
  ].includes(state);
  const canDispute = ["fix_requested", "posting", "posts_failed"].includes(
    state,
  );
  const openChange =
    workspace?.proposals.find(
      (proposal) =>
        proposal.status === "open" &&
        typeof proposal.changes?.fee_minor !== "number",
    ) ?? null;

  return (
    <ProgramScreen
      title={workspace ? `${creatorName} · ${gig?.title_public ?? ""}` : "Gig"}
      fallback={`/brand/${brandId}/creators`}
      refreshing={false}
      onRefresh={() => void refresh()}
      overlay={
        <>
          {topup && workspace ? (
            <HireSheet
              visible
              onClose={() => setTopup(null)}
              mode={topup}
              creatorName={creatorName}
              currency={currentTerms?.currency ?? "USD"}
              onPaid={() => {
                setTopup(null);
                void refresh().then(() =>
                  setNotice("Paid. The new fee is held by Mingla."),
                );
              }}
            />
          ) : null}
          <FullScreenVideoViewer
            uri={videoUri}
            title={`${creatorName}'s video`}
            onClose={() => setVideoUri(null)}
          />
          <ProgramSheet
            visible={sheet !== null}
            onClose={() => setSheet(null)}
            snapPoint="full"
          >
            {sheet === "script_change" ? (
              <SheetBody title="Ask for a change">
                <Muted>{`Say exactly what to change. You can ask ${left === 1 ? "once more" : "twice"}; then the script is final.`}</Muted>
                <Input
                  value={note}
                  onChangeText={setNote}
                  multiline
                  placeholder="e.g. Mention the rooftop opens at 6 PM"
                  accessibilityLabel="What to change in the script"
                />
                <FieldError message={error} />
                <Button
                  fullWidth
                  label="Send change request"
                  loading={busy}
                  disabled={note.trim().length < 5}
                  onPress={() =>
                    void run(
                      () =>
                        creatorGigsService.transition(
                          contractId,
                          state,
                          "request_script_changes",
                          { note: note.trim() },
                        ),
                      "Change requested. The creator will send a new version.",
                    )
                  }
                />
              </SheetBody>
            ) : null}
            {sheet === "fix" ? (
              <SheetBody title="Request a fix">
                <Muted>
                  Fixes are for technical problems only. Taste alone isn’t a
                  reason for a fix.
                </Muted>
                {FIX_CATEGORIES.map(([key, label]) => (
                  <Checkbox
                    key={key}
                    label={label}
                    checked={fixPicks.includes(key)}
                    onToggle={() =>
                      setFixPicks((current) =>
                        current.includes(key)
                          ? current.filter((item) => item !== key)
                          : [...current, key],
                      )
                    }
                  />
                ))}
                <Input
                  value={note}
                  onChangeText={setNote}
                  multiline
                  placeholder="What exactly needs fixing"
                  accessibilityLabel="What needs fixing"
                />
                <FieldError message={error} />
                <Button
                  fullWidth
                  label={`Request fix (${left} left)`}
                  loading={busy}
                  disabled={fixPicks.length === 0 || !delivery}
                  onPress={() => {
                    if (delivery)
                      void run(
                        () =>
                          creatorGigsService.decideDelivery(
                            delivery.id,
                            "fix_requested",
                            fixPicks,
                            note.trim(),
                          ),
                        "Fix requested. The creator has the details.",
                      );
                  }}
                />
              </SheetBody>
            ) : null}
            {sheet === "suggest_time" ? (
              <SheetBody title="Suggest another time">
                <DateField
                  label="Day"
                  value={suggestDay}
                  onChangeValue={setSuggestDay}
                  accessibilityLabel="Shoot day"
                  min={shootWindow?.start ?? toIsoDay(new Date())}
                  max={shootWindow?.end ?? undefined}
                  placeholder="Choose a day"
                />
                <View style={styles.chips}>
                  {SHOOT_TIMES.map(([hour, label]) => (
                    <Chip
                      key={hour}
                      label={label}
                      selected={suggestHour === hour}
                      onPress={() => setSuggestHour(hour)}
                    />
                  ))}
                </View>
                <Input
                  value={note}
                  onChangeText={setNote}
                  multiline
                  placeholder="Arrival note (optional)"
                  accessibilityLabel="Arrival note"
                />
                <FieldError message={error} />
                <Button
                  fullWidth
                  label="Send suggestion"
                  loading={busy}
                  disabled={!suggestDay || suggestHour === null}
                  onPress={() => {
                    if (suggestHour !== null)
                      void run(
                        () =>
                          creatorGigsService.planShoot(
                            contractId,
                            shootInstant(suggestDay, suggestHour),
                            note.trim(),
                            false,
                          ),
                        "Suggestion sent.",
                      );
                  }}
                />
              </SheetBody>
            ) : null}
            {sheet === "dispute" ? (
              <SheetBody title="Open a dispute">
                <Muted>
                  Mingla holds the money while you and the creator settle. If
                  you can’t agree, Mingla decides.
                </Muted>
                {DISPUTE_REASONS.map(([key, label]) => (
                  <Chip
                    key={key}
                    label={label}
                    selected={disputeReason === key}
                    onPress={() => setDisputeReason(key)}
                  />
                ))}
                <Input
                  value={note}
                  onChangeText={setNote}
                  multiline
                  placeholder="What happened (at least 10 characters)"
                  accessibilityLabel="What happened"
                />
                <FieldError message={error} />
                <Button
                  fullWidth
                  variant="destructive"
                  label="Open dispute"
                  loading={busy}
                  disabled={note.trim().length < 10}
                  onPress={() =>
                    void run(
                      () =>
                        creatorGigsService.openDispute(
                          contractId,
                          disputeReason,
                          note.trim(),
                        ),
                      "Dispute opened. Make a settlement offer to resolve it quickly.",
                    )
                  }
                />
              </SheetBody>
            ) : null}
            {sheet === "change_dates" ? (
              <SheetBody title="Change the video-due date">
                <Muted>{`Agreed now: ${agreedVideoDueWords(agreedDue)}. The fee can't change here.`}</Muted>
                <View style={styles.pair}>
                  <View style={styles.pairDate}>
                    <DateField
                      label="New date"
                      value={dueDay}
                      onChangeValue={(value) => {
                        setDueDay(value);
                        setDueErrors({});
                      }}
                      accessibilityLabel="New video-due date"
                      min={toIsoDay(new Date())}
                      placeholder="Choose"
                      hasError={Boolean(dueErrors.day)}
                    />
                  </View>
                  <TimeField
                    label="Time"
                    value={dueTime}
                    onChangeValue={(value) => {
                      setDueTime(value);
                      setDueErrors({});
                    }}
                    accessibilityLabel="New video-due time"
                    hasError={Boolean(dueErrors.day || dueErrors.time)}
                  />
                </View>
                <FieldError message={dueErrors.day ?? dueErrors.time ?? null} />
                <Input
                  value={note}
                  onChangeText={setNote}
                  multiline
                  placeholder="Why it needs to change"
                  accessibilityLabel="Why the date needs to change"
                />
                <FieldError message={dueErrors.form ?? null} />
                <Button
                  fullWidth
                  label="Ask the creator"
                  loading={busy}
                  disabled={!dueDay || !dueTime}
                  onPress={() => void sendDueChange()}
                />
              </SheetBody>
            ) : null}
            {sheet === "rate" ? (
              <SheetBody title={`How was working with ${creatorName}?`}>
                <View style={styles.stars}>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <Pressable
                      key={value}
                      onPress={() => setStars(value)}
                      accessibilityRole="button"
                      accessibilityLabel={`${value} star${value === 1 ? "" : "s"}`}
                      accessibilityState={{ selected: stars >= value }}
                      hitSlop={6}
                    >
                      <Icon
                        name="star"
                        size={30}
                        color={
                          stars >= value ? accent.warm : textTokens.quaternary
                        }
                      />
                    </Pressable>
                  ))}
                </View>
                <View style={styles.chips}>
                  {RATING_TAGS.map((tag) => (
                    <Chip
                      key={tag}
                      label={tag}
                      selected={tags.includes(tag)}
                      onPress={() =>
                        setTags((current) =>
                          current.includes(tag)
                            ? current.filter((item) => item !== tag)
                            : [...current, tag],
                        )
                      }
                    />
                  ))}
                </View>
                <Input
                  value={note}
                  onChangeText={setNote}
                  multiline
                  placeholder="Anything else (optional)"
                  accessibilityLabel="Rating note"
                />
                <Muted>
                  Ratings show to the creator after you’ve both rated.
                </Muted>
                <Button
                  label="Send rating"
                  loading={busy}
                  disabled={stars === 0}
                  onPress={() =>
                    void run(
                      () =>
                        creatorGigsService.rate(
                          contractId,
                          stars,
                          tags,
                          note.trim(),
                        ),
                      "Thanks. Your rating is in.",
                    )
                  }
                />
              </SheetBody>
            ) : null}
            {sheet === "terms" ? (
              <SheetBody title="Terms history">
                <ListGroup>
                  {terms.map((term) => (
                    <ListRow
                      key={term.version}
                      title={`Version ${term.version}`}
                      subtitle={
                        typeof term.created_at === "string"
                          ? shortDate(term.created_at)
                          : null
                      }
                      right={programMoney(term.fee_minor, term.currency)}
                      chevron={false}
                    />
                  ))}
                </ListGroup>
              </SheetBody>
            ) : null}
          </ProgramSheet>
        </>
      }
    >
      {!workspace && !loadError ? <ProgramLoading /> : null}
      {loadError ? (
        <Card>
          <Text style={programStyles.body}>{loadError}</Text>
          <Button
            variant="secondary"
            label="Try again"
            onPress={() => void refresh()}
          />
        </Card>
      ) : null}
      {workspace ? (
        <>
          {(() => {
            const card = contractStatusCard({
              state,
              moneyState,
              creatorName,
              hostRated,
              stepCaption: caption,
            });
            return (
              <Card>
                <View style={styles.rowBetween}>
                  <Text style={styles.statusTitle} numberOfLines={2}>
                    {card.title}
                  </Text>
                  <StatusTag label={card.pill} tone={card.tone} />
                </View>
                <StepBar steps={HOST_CONTRACT_STEPS} current={step} />
                <Muted>{card.line}</Muted>
                {card.canRate ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    leadingIcon="star"
                    label={`Rate ${creatorName}`}
                    onPress={() => {
                      setNote("");
                      setSheet("rate");
                    }}
                  />
                ) : null}
              </Card>
            );
          })()}
          {notice ? (
            <Text style={styles.notice} accessibilityLiveRegion="polite">
              {notice}
            </Text>
          ) : null}
          {sheet === null ? <FieldError message={error} /> : null}

          {paymentPending ? (
            <Card>
              <Text style={programStyles.title}>Payment not completed</Text>
              <Muted>{`${creatorName} hasn't received this offer because the payment didn't go through. Nothing was charged.`}</Muted>
              <Button
                label="Retry payment"
                onPress={() =>
                  router.push(
                    (gigIdForRetry
                      ? `/brand/${brandId}/creators/${gigIdForRetry}/interest`
                      : `/brand/${brandId}/creators`) as never,
                  )
                }
              />
            </Card>
          ) : null}

          {owedTopup && currentTerms && !topup ? (
            <Card>
              <Text style={programStyles.title}>Pay the difference</Text>
              <Muted>{`You accepted ${creatorName}'s new fee. Pay ${programMoney(owedTopup.topupMinor, currentTerms.currency)} so the work can start.`}</Muted>
              <Button
                label={`Pay ${programMoney(owedTopup.topupMinor, currentTerms.currency)}`}
                onPress={() =>
                  setTopup({
                    kind: "topup",
                    contractId,
                    termsVersion: owedTopup.termsVersion,
                    topupMinor: owedTopup.topupMinor,
                  })
                }
              />
            </Card>
          ) : null}

          {/* Counter-offer from the creator */}
          {counter && currentTerms ? (
            <Card>
              <Text
                style={programStyles.title}
              >{`${creatorName} asked for ${programMoney(counter.fee_minor, currentTerms.currency)}`}</Text>
              <Muted>{`Your offer was ${programMoney(currentTerms.fee_minor, currentTerms.currency)}.${counter.fee_minor > currentTerms.fee_minor ? " If you accept, you pay the difference plus the booking fee on it." : " If you accept, we refund the difference."}`}</Muted>
              {counter.note ? (
                <Text style={styles.quote}>{`"${counter.note}"`}</Text>
              ) : null}
              <View style={programStyles.footerRow}>
                <Button
                  variant="secondary"
                  label="Keep my offer"
                  loading={busy}
                  style={programStyles.grow}
                  onPress={() => void respondCounter(false)}
                />
                <Button
                  label={`Accept ${programMoney(counter.fee_minor, currentTerms.currency)}`}
                  loading={busy}
                  style={programStyles.grow}
                  onPress={() => void respondCounter(true)}
                />
              </View>
            </Card>
          ) : null}

          {state === "offered" && !counter && !paymentPending ? (
            <Card>
              <Text
                style={programStyles.title}
              >{`Waiting for ${creatorName}`}</Text>
              <Muted>{`They have until ${deadline ? shortDateTime(deadline) : "48 hours after your offer"} to answer. If they decline or don't answer, you get a full refund automatically.`}</Muted>
              <Button
                variant="secondary"
                label="Cancel offer and refund"
                loading={busy}
                onPress={() =>
                  void run(
                    () =>
                      creatorGigsService.refund(
                        contractId,
                        "host_before_accept",
                      ),
                    "Offer cancelled. Your refund has started.",
                  )
                }
              />
            </Card>
          ) : null}

          {state === "accepted" || state === "shoot_planned" ? (
            <Card>
              <Text style={programStyles.title}>
                {plan
                  ? plan.confirmed_at
                    ? "Shoot time agreed"
                    : plan.proposed_by === "creator"
                      ? `${creatorName} wants to film`
                      : "Waiting for the creator to confirm"
                  : `Waiting for ${creatorName} to suggest a time`}
              </Text>
              {plan ? (
                <>
                  <SummaryLine
                    label="When"
                    value={shortDateTime(plan.shoot_at)}
                  />
                  {plan.arrival_note ? (
                    <SummaryLine label="Note" value={plan.arrival_note} />
                  ) : null}
                </>
              ) : (
                <Muted>{shootWindowWords(shootWindow)}</Muted>
              )}
              {plan && !plan.confirmed_at && plan.proposed_by === "creator" ? (
                <>
                  <Checkbox
                    label="Guests on camera must agree; we'll put up a sign"
                    checked={checklist[0]}
                    onToggle={() => setChecklist((c) => [!c[0], c[1], c[2]])}
                  />
                  <Checkbox
                    label="Only music we have rights to (or the creator adds licensed audio)"
                    checked={checklist[1]}
                    onToggle={() => setChecklist((c) => [c[0], !c[1], c[2]])}
                  />
                  <View style={programStyles.footerRow}>
                    <Button
                      variant="secondary"
                      label="Suggest another time"
                      style={programStyles.grow}
                      onPress={() => {
                        setNote("");
                        setSheet("suggest_time");
                      }}
                    />
                    <Button
                      label="Approve"
                      loading={busy}
                      style={programStyles.grow}
                      disabled={!checklist[0] || !checklist[1]}
                      onPress={() =>
                        void run(
                          () =>
                            creatorGigsService.planShoot(
                              contractId,
                              plan.shoot_at,
                              plan.arrival_note ?? "",
                              true,
                            ),
                          "Shoot time approved.",
                        )
                      }
                    />
                  </View>
                </>
              ) : !plan ? (
                <Button
                  variant="secondary"
                  label="Suggest a time"
                  onPress={() => {
                    setNote("");
                    setSheet("suggest_time");
                  }}
                />
              ) : plan.confirmed_at && state === "shoot_planned" ? (
                <Button
                  variant="secondary"
                  label="Ask for the script now"
                  loading={busy}
                  onPress={() =>
                    void run(
                      () =>
                        creatorGigsService.transition(
                          contractId,
                          state,
                          "start_script",
                        ),
                      "The creator can start the script.",
                    )
                  }
                />
              ) : null}
            </Card>
          ) : null}

          {state === "script_drafting" ? (
            <Card>
              <Text
                style={programStyles.title}
              >{`${creatorName} is writing the script`}</Text>
              <Muted>
                You’ll review it before filming. It approves itself 48 hours
                after it arrives.
              </Muted>
            </Card>
          ) : null}

          {script && ["script_sent", "script_locked"].includes(state) ? (
            <Card>
              <Text
                style={programStyles.title}
              >{`Script v${script.version}${script.locked_at ? " · approved" : ""}`}</Text>
              {(script.body?.sections ?? []).map((section, index) => (
                <View key={index} style={styles.section}>
                  <Text style={styles.sectionLabel}>
                    {sectionLabel(section, index)}
                  </Text>
                  {sectionLines(section).map((line) => (
                    <Text key={line.text} style={programStyles.body}>
                      {line.label ? `${line.label}: ${line.text}` : line.text}
                    </Text>
                  ))}
                </View>
              ))}
              <View style={styles.checkRow}>
                <Icon
                  name={checks.disclosure ? "check" : "flag"}
                  size={14}
                  color={checks.disclosure ? accent.warm : textTokens.tertiary}
                />
                <Text style={programStyles.small}>
                  {[
                    checks.disclosure
                      ? "Disclosure included"
                      : "No #ad disclosure found",
                    checks.seconds
                      ? `${checks.seconds}s · ${formatName(gig?.format_key)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
              {state === "script_sent" ? (
                <View style={programStyles.footerRow}>
                  <Button
                    variant="secondary"
                    label="Ask for a change"
                    style={programStyles.grow}
                    disabled={left === 0}
                    onPress={() => {
                      setNote("");
                      setSheet("script_change");
                    }}
                  />
                  <Button
                    label="Approve script"
                    loading={busy}
                    style={programStyles.grow}
                    onPress={() =>
                      void run(
                        () =>
                          creatorGigsService.transition(
                            contractId,
                            state,
                            "lock_script",
                          ),
                        "Script approved. The creator can film.",
                      )
                    }
                  />
                </View>
              ) : (
                <Muted>{`${creatorName} is filming from this script.`}</Muted>
              )}
              {state === "script_sent" && left === 0 ? (
                <Muted>
                  You’ve used both change requests. Approve the script or let it
                  approve itself.
                </Muted>
              ) : null}
            </Card>
          ) : null}

          {state === "delivered" && delivery ? (
            <Card>
              <View style={styles.rowBetween}>
                <Text style={programStyles.title}>Review the video</Text>
                <StatusTag
                  label={`${left} fix${left === 1 ? "" : "es"} left`}
                  tone="waiting"
                />
              </View>
              <Pressable
                onPress={() => {
                  if (deliveryUrl) {
                    setVideoUri(deliveryUrl);
                    return;
                  }
                  setNotice(null);
                  void deliveryPlaybackStatus(delivery.media_job_id)
                    .then(({ status, url }) => {
                      if (url) setVideoUri(url);
                      else setNotice(playbackNotice(status, url));
                    })
                    .catch(() =>
                      setError("We couldn't load the video. Try again."),
                    );
                }}
                accessibilityRole="button"
                accessibilityLabel={`Play ${creatorName}'s video`}
                style={styles.player}
              >
                <Icon name="play" size={32} color={textTokens.primary} />
                <Text style={styles.playerCaption}>
                  {`Version ${delivery.round + 1} · tap to play`}
                </Text>
              </Pressable>
              <Checkbox
                label="Matches the approved script"
                checked={checklist[0]}
                onToggle={() => setChecklist((c) => [!c[0], c[1], c[2]])}
              />
              <Checkbox
                label="Shows #ad and @usemingla"
                checked={checklist[1]}
                onToggle={() => setChecklist((c) => [c[0], !c[1], c[2]])}
              />
              <Checkbox
                label="Vertical, the agreed length"
                checked={checklist[2]}
                onToggle={() => setChecklist((c) => [c[0], c[1], !c[2]])}
              />
              <Muted>{`Fix requests are for technical problems only (sound, picture, captions). It approves itself ${deadline ? dueIn(deadline) : "after 3 days"}.`}</Muted>
              <View style={programStyles.footerRow}>
                <Button
                  variant="secondary"
                  label="Request a fix"
                  style={programStyles.grow}
                  disabled={left === 0}
                  onPress={() => {
                    setNote("");
                    setFixPicks([]);
                    setSheet("fix");
                  }}
                />
                <Button
                  label="Approve video"
                  loading={busy}
                  style={programStyles.grow}
                  onPress={() =>
                    void run(
                      () =>
                        creatorGigsService.decideDelivery(
                          delivery.id,
                          "approved",
                        ),
                      "Video approved. The creator can post it.",
                    )
                  }
                />
              </View>
            </Card>
          ) : null}

          {state === "fix_requested" && delivery ? (
            <Card>
              <Text style={programStyles.title}>Waiting for the fix</Text>
              <Muted>
                {[
                  (delivery.fix_categories ?? [])
                    .map(fixCategoryWords)
                    .join(", "),
                  delivery.fix_note,
                ]
                  .filter(Boolean)
                  .join(" · ") || "The creator has your fix request."}
              </Muted>
            </Card>
          ) : null}

          {approvedDeliveryState && delivery ? (
            <Card>
              <Text style={programStyles.title}>Approved master</Text>
              <Muted>
                {perpetualRightsActive && downloadAvailableUntil
                  ? `Available until at least ${shortDateTime(downloadAvailableUntil)}. Mingla may extend this while posting, payout or a dispute is still open.`
                  : perpetualRightsActive
                    ? "Your perpetual licence is active. The approved master remains available for authorised marketing use."
                    : "You can review the approved video now. Download unlocks only after the full Creator fee is released."}
              </Muted>
              {perpetualRightsActive ? (
                <Button
                  label={
                    Platform.OS === "web"
                      ? "Download approved master"
                      : "Save approved master"
                  }
                  loading={busy}
                  onPress={() => void saveApprovedMaster()}
                />
              ) : null}
              <Muted>
                {perpetualRightsActive
                  ? "Downloading never holds Creator payout. Your licence covers organic and paid marketing; Creator-account whitelisting still needs platform permission."
                  : "The licence is not active before full fee release."}
              </Muted>
            </Card>
          ) : null}

          {["approved", "posting", "posts_failed"].includes(state) ? (
            <Card>
              <Text style={programStyles.title}>Waiting for posts</Text>
              <Muted>{`The creator posts by ${shortDate(String(gig?.post_by ?? ""))} and adds the links here. Mingla checks them automatically.`}</Muted>
            </Card>
          ) : null}

          {state === "posts_submitted" ? (
            <Card>
              <Text style={programStyles.title}>Checking posts</Text>
              <Muted>
                Mingla checks each post automatically. Confirm only if you can
                see them live; silence counts as a pass after 48 hours.
              </Muted>
              <Button
                label="Confirm posts are live"
                loading={busy}
                onPress={() =>
                  void run(
                    () =>
                      creatorGigsService.transition(
                        contractId,
                        state,
                        "host_confirm",
                      ),
                    "Posts confirmed.",
                  )
                }
              />
            </Card>
          ) : null}

          {state === "posts_verified" ? (
            <Card>
              <Text style={programStyles.title}>Posts verified</Text>
              <Muted>Mingla pays the creator within 48 hours.</Muted>
            </Card>
          ) : null}
          {state === "disputed" && workspace.dispute ? (
            <Card>
              <Text style={programStyles.title}>In dispute</Text>
              <Muted>{workspace.dispute.statement}</Muted>
              {openOffer ? (
                <View style={styles.offer}>
                  <Text
                    style={programStyles.title}
                  >{`${(openOffer.refund_bps / 100).toFixed(0)}% refund to you`}</Text>
                  <Muted>
                    {openOffer.offered_by === "host"
                      ? "Your offer is waiting for the creator."
                      : "The creator made this offer and keeps the remainder of the contract fee."}
                  </Muted>
                  {openOffer.note ? (
                    <Text style={styles.quote}>{openOffer.note}</Text>
                  ) : null}
                  {openOffer.offered_by === "creator" ? (
                    <View style={programStyles.footerRow}>
                      <Button
                        variant="secondary"
                        label="Decline"
                        loading={busy}
                        style={programStyles.grow}
                        onPress={() =>
                          void run(
                            () =>
                              creatorGigsService.respondToDisputeOffer(
                                openOffer.id,
                                false,
                              ),
                            "Offer declined. You can make a counteroffer.",
                          )
                        }
                      />
                      <Button
                        label="Accept settlement"
                        loading={busy}
                        style={programStyles.grow}
                        onPress={() =>
                          void run(
                            () =>
                              creatorGigsService.respondToDisputeOffer(
                                openOffer.id,
                                true,
                              ),
                            "Settlement accepted. Payment processing has started.",
                          )
                        }
                      />
                    </View>
                  ) : null}
                </View>
              ) : (
                <Muted>
                  No open offer. Propose how much of the fee should come back to
                  you.
                </Muted>
              )}
              <Input
                value={refundPercent}
                onChangeText={(value) =>
                  setRefundPercent(value.replace(/[^0-9]/g, ""))
                }
                variant="number"
                placeholder="Refund to you, 0–100%"
                accessibilityLabel="Refund to you, percent"
              />
              <Input
                value={note}
                onChangeText={setNote}
                multiline
                placeholder="Note (optional)"
                accessibilityLabel="Settlement note"
              />
              <Button
                variant="secondary"
                label={
                  openOffer?.offered_by === "creator"
                    ? "Make counteroffer"
                    : "Propose settlement"
                }
                loading={busy}
                disabled={!validRefund}
                onPress={() =>
                  void run(
                    () =>
                      creatorGigsService.offerDispute(
                        workspace.dispute!.id,
                        refundBps,
                        note.trim(),
                      ),
                    "Offer sent. The creator can accept or decline.",
                  )
                }
              />
            </Card>
          ) : null}

          {[
            "declined",
            "expired",
            "cancelled",
            "resolved_refund",
            "resolved_partial",
            "resolved_release",
          ].includes(state) ? (
            <Muted>
              {state === "declined" ||
              state === "expired" ||
              state === "cancelled"
                ? "Your payment is refunded automatically."
                : "This gig is settled."}
            </Muted>
          ) : null}

          <SectionLabel>Deal</SectionLabel>
          <ListGroup>
            {currentTerms ? (
              <ListRow
                title="Fee"
                right={contractFeeWords(
                  currentTerms.fee_minor,
                  currentTerms.currency,
                  moneyState,
                )}
                chevron={false}
              />
            ) : null}
            {currentTerms ? (
              <ListRow
                title="Terms"
                right={`Version ${currentTerms.version}`}
                onPress={() => setSheet("terms")}
              />
            ) : null}
            {workspace.rights ? (
              <ListRow
                title="Marketing rights"
                subtitle={
                  workspace.rights.model === "creator_v1_perpetual"
                    ? "You and Mingla · organic and paid marketing · edits allowed"
                    : `${workspace.rights.usage_days ?? "Original"}-day legacy licence`
                }
                right={
                  workspace.rights.status === "active"
                    ? "Active forever"
                    : workspace.rights.status === "not_granted"
                      ? "Not granted"
                      : workspace.rights.status === "legacy"
                        ? "Legacy"
                        : "After full fee release"
                }
                chevron={false}
              />
            ) : null}
            {gig ? (
              <ListRow
                title="Video needed by"
                right={agreedVideoDueWords(agreedDue)}
                chevron={false}
              />
            ) : null}
            {gig?.brief_private ? (
              <ListRow
                title="Private brief"
                subtitle={String(gig.brief_private)}
                chevron={false}
              />
            ) : null}
          </ListGroup>
          {openChange ? (
            <Card>
              <Text style={programStyles.title}>
                {openChange.proposed_by === "creator"
                  ? `${creatorName} asked to change the terms`
                  : "Your change request"}
              </Text>
              <Muted>{proposalChangeWords(openChange.changes)}</Muted>
              {openChange.note ? (
                <Text style={styles.quote}>{openChange.note}</Text>
              ) : null}
              {openChange.proposed_by === "creator" ? (
                <View style={programStyles.footerRow}>
                  <Button
                    variant="secondary"
                    label="Keep current terms"
                    loading={busy}
                    style={programStyles.grow}
                    onPress={() =>
                      void run(
                        () =>
                          creatorGigsService.respondToChange(
                            openChange.id,
                            false,
                          ),
                        "The current terms stay.",
                      )
                    }
                  />
                  <Button
                    label="Accept change"
                    loading={busy}
                    style={programStyles.grow}
                    onPress={() =>
                      void run(
                        () =>
                          creatorGigsService.respondToChange(
                            openChange.id,
                            true,
                          ),
                        "Change accepted. New terms are in effect.",
                      )
                    }
                  />
                </View>
              ) : (
                <Muted>{`Waiting for the creator until ${shortDateTime(openChange.expires_at)}.`}</Muted>
              )}
            </Card>
          ) : null}
          <View style={programStyles.actions}>
            {canChangeTerms && !openChange ? (
              <Button
                size="sm"
                variant="ghost"
                label="Change the video-due date"
                onPress={() => {
                  setNote("");
                  const initial = dueChangeInitial(agreedDue);
                  setDueDay(initial.day);
                  setDueTime(initial.time);
                  setDueErrors({});
                  setSheet("change_dates");
                }}
              />
            ) : null}
            {[
              "accepted",
              "shoot_planned",
              "script_drafting",
              "script_sent",
            ].includes(state) ? (
              <Button
                size="sm"
                variant="ghost"
                label="Cancel gig and refund"
                loading={busy}
                onPress={() =>
                  void run(
                    () =>
                      creatorGigsService.refund(
                        contractId,
                        "host_after_accept_before_lock",
                      ),
                    "Gig cancelled. Your eligible refund has started. Provider fees follow the payment provider’s refund rules.",
                  )
                }
              />
            ) : null}
            {canDispute ? (
              <Button
                size="sm"
                variant="ghost"
                label="Open a dispute"
                onPress={() => {
                  setNote("");
                  setSheet("dispute");
                }}
              />
            ) : null}
          </View>

          {workspace.posts.length > 0 ? (
            <>
              <SectionLabel>Posts</SectionLabel>
              <ListGroup>
                {workspace.posts.map((post) => (
                  <ListRow
                    key={post.id}
                    title={platformLabel(post.platform)}
                    subtitle={post.url}
                    right={postCheckWords(post.check_status)}
                    chevron={false}
                  />
                ))}
              </ListGroup>
            </>
          ) : null}

          {activity.length > 0 ? (
            <Pressable
              onPress={() => setShowActivity((value) => !value)}
              accessibilityRole="button"
              accessibilityLabel={
                showActivity ? "Hide activity" : "Show activity"
              }
              style={styles.activityToggle}
            >
              <Text style={styles.activityLabel}>
                {`Activity · ${activity.length} update${activity.length === 1 ? "" : "s"}`}
              </Text>
              <Text style={styles.activityAction}>
                {showActivity ? "Hide" : "Show"}
              </Text>
            </Pressable>
          ) : null}
          {showActivity ? (
            <ListGroup>
              {activity.map((event) => (
                <ListRow
                  key={event.id}
                  compact
                  title={event.words}
                  subtitle={`${actorWords(event.actor)} · ${shortDateTime(event.at)}`}
                  chevron={false}
                />
              ))}
            </ListGroup>
          ) : null}
        </>
      ) : null}
    </ProgramScreen>
  );
}

const styles = StyleSheet.create({
  statusTitle: {
    color: textTokens.primary,
    fontSize: 16,
    fontWeight: "800",
    flexShrink: 1,
  },
  activityToggle: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 44,
  },
  activityLabel: { color: textTokens.secondary, fontSize: 13 },
  activityAction: { color: accent.warm, fontSize: 13, fontWeight: "700" },
  notice: { color: accent.warm, fontWeight: "700", fontSize: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  section: { gap: 2, paddingVertical: spacing.xs },
  sectionLabel: {
    color: textTokens.tertiary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  checkRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  // Centred at the card's content width, 9:16 like the video itself. The old
  // 9:13 box with a max height shrank its width and sat left with a gap.
  player: {
    alignSelf: "stretch",
    width: "100%",
    aspectRatio: 9 / 16,
    borderRadius: radius.lg,
    backgroundColor: "#5b3a22",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  playerCaption: { color: textTokens.primary, fontSize: 13, fontWeight: "600" },
  stars: { flexDirection: "row", gap: spacing.sm },
  offer: {
    gap: spacing.xs,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: accent.border,
    borderRadius: radius.md,
  },
  pair: { flexDirection: "row", gap: spacing.sm },
  pairDate: { flex: 1.4 },
  quote: {
    color: textTokens.secondary,
    fontStyle: "italic",
    fontSize: 14,
    lineHeight: 20,
  },
});
