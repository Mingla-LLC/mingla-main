/**
 * #4541 R2.1–R2.5 — the Explorer form screen, the same for every way in
 * (links, cards, pushes, the purchase hand-off, Blast). Design v10 A.
 *
 * Who the answer belongs to (R2.2) is decided by the route alone: a personal
 * link's person (even when another account is signed in), a held item checked
 * by the server as the caller's own, the caller at an event, or an Unknown
 * Blast reply. Typed names, emails and phones never identify anyone.
 *
 * Every state in R2.3 renders with testID `form-screen-<state>`. Unsent typing
 * is kept on this phone (brandFormDraft.ts, R2.9). The personal link token is
 * never logged and never sent to analytics.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import {
  answerDisplayText,
  BrandFormRenderer,
  BrandHeader,
  brandHeaderFromServer,
  missingRequiredIds,
  visibleAnswers,
  visibleQuestions,
  type BrandAnswers,
  type BrandFormDefinitionShape,
} from "@mingla/form-rendering";

import { useAppStore } from "../../store/appStore";
import {
  pendingFormFor,
  useFormScreenRead,
  useMyPendingForms,
  useSubmitBrandForm,
} from "../../hooks/useBrandForm";
import type { BrandFormError, FormScreenRead } from "../../services/brandFormService";
import { postHogService } from "../../services/postHogService";
import { signOutWithPrivateCleanup } from "../../utils/authCleanup";
import {
  eventIsOver,
  formIdentityPath,
  remapAnswersById,
  readErrorState,
  splitIdentity,
  submitErrorOutcome,
  type FormRouteParams,
  type FormScreenState,
} from "./formRoute";
import {
  formDraftKey,
  formDraftScope,
  readFormDraft,
  removeFormDraft,
  writeFormDraft,
} from "./brandFormDraft";
import { setPendingFormRoute } from "./formsStartup";
import { FormChoiceSheet } from "./FormChoiceSheet";
import { FORM_DARK, useFormPrimitives } from "./useFormPrimitives";

type InlineLine = "offline" | "rate" | "openLimit" | "botCheck" | "tooLarge";
/** "auto": view an existing answer, else fill. */
type Mode = "auto" | "view" | "edit" | "saved";

export interface BrandFormScreenProps {
  params: FormRouteParams | null;
  /** The route this screen was opened at (held for sign-in, token removed). */
  routePath: string;
}

const hasTyping = (answers: BrandAnswers): boolean =>
  Object.values(answers).some((v) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim().length > 0));

/** The whole-screen state from the read, the mode and the route. Pure; exported for tests. */
export function screenStateOf(input: {
  params: FormRouteParams | null;
  signedIn: boolean;
  loading: boolean;
  errorCode: string | null;
  read: FormScreenRead | undefined;
  eventStatus: string | null;
  mode: Mode;
}): FormScreenState {
  const { params } = input;
  if (params === null) return "notfound";
  const path = formIdentityPath(params, input.signedIn);
  if (path === "sign_in") return "signin";
  if (input.errorCode !== null && input.read === undefined) return readErrorState(input.errorCode);
  if (input.loading || input.read === undefined) return "load";
  const read = input.read;
  if (read.state === "code_required") return "signin";
  if (eventIsOver(input.eventStatus)) return "ended";
  if (input.mode === "saved") return "saved";
  if (read.form.status === "closed") return "closed";
  if (read.form.definition === null) return "notfound";
  if (path === "blast_unknown") return "unknown";
  if (input.mode === "edit") return "edit";
  if (read.response !== null) return "view";
  return "fill";
}

export function BrandFormScreen({ params, routePath }: BrandFormScreenProps): React.ReactElement {
  const { t, i18n } = useTranslation("forms");
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const primitives = useFormPrimitives();
  const user = useAppStore((s) => s.user);
  const profile = useAppStore((s) => s.profile);
  const signedIn = user !== null;
  const read = useFormScreenRead(params, signedIn);
  const pending = useMyPendingForms();
  const data = read.data;
  const errorCode = read.error !== null && read.error !== undefined
    ? ((read.error as { code?: unknown }).code as string | undefined) ?? "server_error"
    : null;

  const pendingRow = useMemo(() => {
    if (params === null) return null;
    const rows = pending.data;
    if (params.as !== null && params.sid !== null) return pendingFormFor(rows, params.as, params.sid, params.eventId);
    return (rows ?? []).find((r) => r.formId === params.formId && r.eventId === (params.eventId ?? data?.eventId)) ?? null;
  }, [params, pending.data, data?.eventId]);

  const [mode, setMode] = useState<Mode>("auto");
  const [answers, setAnswers] = useState<BrandAnswers>({});
  const [banner, setBanner] = useState<"err" | "changed" | "stale" | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [inline, setInline] = useState<InlineLine | null>(null);
  const [screenOverride, setScreenOverride] = useState<FormScreenState | null>(null);
  const [linkSheet, setLinkSheet] = useState(false);
  const [leaveSheet, setLeaveSheet] = useState(false);
  const dirtyRef = useRef(false);
  const leavingRef = useRef(false);
  const pendingLeave = useRef<(() => void) | null>(null);
  const linkSheetShown = useRef(false);
  const hydratedFor = useRef<string | null>(null);

  const draftKey = useMemo(() => params === null ? null : formDraftKey(params.formId, formDraftScope({
    eventId: params.eventId,
    campaignId: params.campaignId,
    as: params.as,
    sid: params.sid,
    token: params.token,
  })), [params]);

  const brandName = useMemo(() => {
    const raw = data?.brand?.displayName ?? pendingRow?.brand?.displayName;
    return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : t("theHost");
  }, [data?.brand, pendingRow?.brand, t]);
  const eventTitle = pendingRow?.eventTitle ?? t("thisEvent");
  const identity = splitIdentity(data?.identity ?? null);

  const state = screenOverride ?? screenStateOf({
    params,
    signedIn,
    loading: read.isPending,
    errorCode,
    read: data,
    eventStatus: pendingRow?.eventStatus ?? null,
    mode,
  });

  // The answers to start from: a draft (14 days) over the saved answer.
  useEffect(() => {
    if (data === undefined || draftKey === null) return;
    const marker = `${draftKey}:${data.form.versionId ?? ""}:${data.response?.id ?? ""}`;
    if (hydratedFor.current === marker) return;
    hydratedFor.current = marker;
    const saved = data.response?.answers ?? {};
    let live = true;
    void readFormDraft(draftKey).then((draft) => {
      if (!live) return;
      if (draft !== null && hasTyping(draft.answers)) {
        setAnswers(remapAnswersById(draft.answers, data.form.definition));
        dirtyRef.current = true;
        if (data.response !== null) setMode("edit");
      } else {
        setAnswers(remapAnswersById(saved, data.form.definition));
      }
    });
    return () => {
      live = false;
    };
  }, [data, draftKey]);

  // Closed, ended and missing forms drop their draft (R2.9).
  useEffect(() => {
    if (draftKey !== null && (state === "closed" || state === "ended" || state === "notfound")) {
      void removeFormDraft(draftKey);
      dirtyRef.current = false;
    }
  }, [state, draftKey]);

  // R2.3: a personal link opened while another account is signed in.
  useEffect(() => {
    if (
      params?.token && signedIn && identity !== null && !linkSheetShown.current &&
      (state === "fill" || state === "view")
    ) {
      linkSheetShown.current = true;
      setLinkSheet(true);
    }
  }, [params?.token, signedIn, identity, state]);

  useEffect(() => {
    if (state === "load") return;
    postHogService.capture("brand_form_screen_state", { from: params?.from ?? "link", state });
  }, [state, params?.from]);

  // Draft writes, debounced 500 ms, only while answering.
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onAnswersChange = useCallback((next: BrandAnswers) => {
    setAnswers(next);
    dirtyRef.current = true;
    setInline(null);
    if (draftKey === null) return;
    if (draftTimer.current !== null) clearTimeout(draftTimer.current);
    const versionId = data?.form.versionId ?? null;
    draftTimer.current = setTimeout(() => {
      void writeFormDraft(draftKey, versionId, next);
    }, 500);
  }, [draftKey, data?.form.versionId]);
  useEffect(() => () => {
    if (draftTimer.current !== null) clearTimeout(draftTimer.current);
  }, []);

  const definition = (data?.form.definition ?? null) as BrandFormDefinitionShape | null;
  const missing = definition === null ? [] : missingRequiredIds(definition, answers);

  const leave = useCallback(() => {
    leavingRef.current = true;
    if (router.canGoBack()) router.back();
    else router.replace("/" as never);
  }, [router]);

  // Back with unsent typing asks first (left-edge swipe, Android back, the
  // header button: all remove this screen).
  useEffect(() => {
    const nav = navigation as unknown as {
      addListener?: (e: "beforeRemove", cb: (ev: { preventDefault: () => void; data: { action: unknown } }) => void) => () => void;
      dispatch?: (action: unknown) => void;
    };
    if (typeof nav.addListener !== "function") return undefined;
    return nav.addListener("beforeRemove", (ev) => {
      const answering = state === "fill" || state === "edit" || state === "err" || state === "changed" || state === "unknown";
      if (leavingRef.current || !dirtyRef.current || !answering) return;
      ev.preventDefault();
      pendingLeave.current = () => nav.dispatch?.(ev.data.action);
      setLeaveSheet(true);
    });
  }, [navigation, state]);

  const onBack = useCallback(() => {
    const answering = state === "fill" || state === "edit" || state === "err" || state === "changed" || state === "unknown";
    if (dirtyRef.current && answering) {
      pendingLeave.current = leave;
      setLeaveSheet(true);
      return;
    }
    leave();
  }, [state, leave]);

  const submit = useSubmitBrandForm((error: BrandFormError) => {
    const outcome = submitErrorOutcome(error.code);
    if (outcome.kind === "inline") {
      setInline(outcome.line);
      return;
    }
    if (outcome.state === "err") {
      const rows = Array.isArray(error.detail?.errors) ? error.detail?.errors as { questionId?: unknown; code?: unknown }[] : [];
      const next: Record<string, string> = {};
      for (const row of rows) {
        if (typeof row.questionId !== "string") continue;
        next[row.questionId] = row.code === "required" ? t("fieldRequired")
          : row.code === "option" ? t("fieldOption")
          : row.code === "too_long" ? t("fieldTooLong")
          : t("fieldType");
      }
      setFieldErrors(next);
      setBanner("err");
      return;
    }
    if (outcome.state === "changed") {
      setBanner("changed");
      void read.refetch().then((r) => {
        if (r.data !== undefined) setAnswers((prev) => remapAnswersById(prev, r.data?.form.definition ?? null));
      });
      return;
    }
    if (outcome.state === "stale") {
      setBanner("stale");
      return;
    }
    setScreenOverride(outcome.state);
  });

  const send = useCallback(() => {
    if (params === null || data === undefined || submit.isPending || missing.length > 0) return;
    const defn = data.form.definition as BrandFormDefinitionShape;
    setInline(null);
    setBanner(null);
    setFieldErrors({});
    submit.mutate({
      formId: params.formId,
      versionId: data.form.versionId,
      eventId: params.eventId ?? data.eventId,
      answers: visibleAnswers(defn, answers),
      expectedEditCount: mode === "edit" ? data.response?.editCount ?? null : null,
      token: params.token,
      // A personal link names its own person: never a held item beside it.
      rsvpId: params.token === null && params.as === "rsvp" ? params.sid : null,
      rsvpGuestId: params.token === null && params.as === "rsvp_guest" ? params.sid : null,
      orderId: params.token === null && params.as === "order" ? params.sid : null,
      ...(params.campaignId !== null && params.eventId === null
        ? { campaignId: params.campaignId, ...(signedIn ? {} : { botTicket: data.botTicket, website: "" }) }
        : {}),
    }, {
      onSuccess: () => {
        dirtyRef.current = false;
        if (draftKey !== null) void removeFormDraft(draftKey);
        setMode("saved");
      },
    });
  }, [params, data, submit, missing.length, answers, mode, signedIn, draftKey]);

  const goSignIn = useCallback(() => {
    void setPendingFormRoute(routePath).then(() => {
      leavingRef.current = true;
      router.replace("/" as never);
    });
  }, [routePath, router]);

  const reloadStale = useCallback(() => {
    Alert.alert(t("staleConfirmTitle"), t("staleConfirmBody"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("reload"),
        onPress: () => {
          if (draftKey !== null) void removeFormDraft(draftKey);
          dirtyRef.current = false;
          hydratedFor.current = null;
          setBanner(null);
          setMode("view");
          void read.refetch();
        },
      },
    ]);
  }, [t, draftKey, read]);

  const signOutForLink = useCallback(() => {
    Alert.alert(t("signOutConfirmTitle"), t("signOutConfirmBody"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("signOut"),
        style: "destructive",
        onPress: () => {
          setLinkSheet(false);
          void signOutWithPrivateCleanup("brand-form-link-other-person", user?.id ?? null).then(async ({ error }) => {
            if (error !== null) {
              console.warn("[forms] sign out for link failed", error.name);
              return;
            }
            await setPendingFormRoute(routePath);
            leavingRef.current = true;
            router.replace("/" as never);
          });
        },
      },
    ]);
  }, [t, user?.id, routePath, router]);

  // ----- render pieces --------------------------------------------------

  const header = (
    <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("back")}
        onPress={onBack}
        hitSlop={8}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        testID="form-screen-back"
      >
        <Text style={styles.backText}>‹</Text>
      </Pressable>
    </View>
  );

  const brandHeader = data !== undefined ? (
    <BrandHeader brand={brandHeaderFromServer(data.brand)} primitives={primitives} />
  ) : null;

  const message = (
    testState: FormScreenState,
    title: string,
    body: string | null,
    actions: { label: string; onPress: () => void; primary?: boolean }[],
    extra?: React.ReactNode,
  ): React.ReactElement => (
    <View style={styles.message} testID={`form-screen-${testState}`}>
      <Text accessibilityRole="header" style={styles.messageTitle}>{title}</Text>
      {body !== null ? <Text style={styles.messageBody}>{body}</Text> : null}
      {extra}
      {actions.map((a) => (
        <Pressable
          key={a.label}
          accessibilityRole="button"
          onPress={a.onPress}
          style={({ pressed }) => [a.primary === false ? styles.secondary : styles.primary, pressed && styles.pressed]}
        >
          <Text style={a.primary === false ? styles.secondaryText : styles.primaryText}>{a.label}</Text>
        </Pressable>
      ))}
    </View>
  );

  const goTickets = (): void => {
    leavingRef.current = true;
    router.replace("/purchases" as never);
  };

  const answerRows = (source: FormScreenRead["response"]): React.ReactElement | null => {
    if (source === null) return null;
    const def = (source.definition ?? data?.form.definition ?? null) as BrandFormDefinitionShape | null;
    if (def === null) return null;
    return (
      <View style={styles.answers}>
        {visibleQuestions(def, source.answers as BrandAnswers).map((q) => (
          <View key={q.id} style={styles.answerRow}>
            <Text style={styles.answerLabel}>{q.label}</Text>
            <Text style={styles.answerValue} selectable>
              {answerDisplayText(q, (source.answers as BrandAnswers)[q.id]) ?? t("notAnswered")}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  const inlineText = inline === null ? null
    : inline === "offline" ? t("offline")
    : inline === "rate" ? t("rateLimited")
    : inline === "openLimit" ? t("openReplyLimit")
    : inline === "botCheck" ? t("botCheckFailed")
    : t("tooLarge");

  let body: React.ReactElement;
  switch (state) {
    case "load":
      body = (
        <View style={styles.message} testID="form-screen-load">
          <View style={styles.skeleton} />
          <ActivityIndicator color={FORM_DARK.text2} />
          <Text style={styles.messageBody}>{t("loading")}</Text>
        </View>
      );
      break;
    case "signin":
      body = message("signin", t("signInTitle"), t("signInBody", { brand: brandName }), [
        { label: t("signIn"), onPress: goSignIn },
        { label: t("createAccount"), onPress: goSignIn, primary: false },
      ], <Text style={styles.messageBody}>{t("signInLinkHint")}</Text>);
      break;
    case "closed":
      body = message("closed", t("closedTitle"), data?.response ? t("closedLast") : null, [
        { label: t("backToTicket"), onPress: leave },
      ], answerRows(data?.response ?? null));
      break;
    case "ended":
      body = message("ended", pendingRow?.eventStatus === "cancelled" ? t("cancelledTitle") : t("endedTitle"), t("endedBody"), [
        { label: t("back"), onPress: leave },
      ], answerRows(data?.response ?? null));
      break;
    case "notfound":
      body = message("notfound", t("notFoundTitle"), t("notFoundBody"), [{ label: t("goToTickets"), onPress: goTickets }]);
      break;
    case "replaced":
      body = message("replaced", t("replacedTitle"), t("replacedBody", { brand: brandName }), [{ label: t("signIn"), onPress: goSignIn }]);
      break;
    case "notholder":
      body = message("notholder", t("notHolderTitle", { event: eventTitle }), t("notHolderBody"), [
        { label: t("goToTickets"), onPress: goTickets },
      ]);
      break;
    case "paused":
      body = message("paused", t("pausedTitle"), t("pausedBody"), [{
        label: t("tryAgain"),
        onPress: () => {
          setScreenOverride(null);
          void read.refetch();
        },
      }]);
      break;
    case "loadfail":
      body = message("loadfail", t("loadFailTitle"), t("loadFailBody"), [{ label: t("tryAgain"), onPress: () => void read.refetch() }]);
      break;
    case "saved":
      body = message("saved", t("savedTitle"), t("savedBody", { brand: brandName }), [
        { label: t("done"), onPress: leave },
        ...(data?.editable === false ? [] : [{
          label: t("seeMyAnswers"),
          onPress: () => {
            hydratedFor.current = null;
            setMode("view");
            void read.refetch();
          },
          primary: false,
        }]),
      ]);
      break;
    case "view":
      body = (
        <View style={styles.message} testID="form-screen-view">
          <Text accessibilityRole="header" style={styles.messageTitle}>{t("viewTitle")}</Text>
          {data?.response?.updatedAt ? (
            <Text style={styles.messageBody}>
              {t("answeredOn", { date: new Date(data.response.updatedAt).toLocaleDateString(i18n.language) })}
            </Text>
          ) : null}
          {data?.response?.isCurrentVersion === false ? <Text style={styles.messageBody}>{t("earlierVersion")}</Text> : null}
          {answerRows(data?.response ?? null)}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setAnswers(remapAnswersById(data?.response?.answers ?? {}, data?.form.definition ?? null));
              setMode("edit");
            }}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            testID="form-screen-edit-answers"
          >
            <Text style={styles.primaryText}>{t("editAnswers")}</Text>
          </Pressable>
        </View>
      );
      break;
    default: {
      // fill · edit · err · changed · stale · unknown (and send while saving)
      const sending = submit.isPending;
      const testState: FormScreenState = sending ? "send"
        : banner === "err" ? "err"
        : banner === "changed" ? "changed"
        : banner === "stale" ? "stale"
        : state;
      const plusOne = params?.as === "rsvp_guest";
      const me = splitIdentity(
        [profile?.first_name, profile?.last_name].filter((p) => typeof p === "string" && p.length > 0).join(" ") || null,
      );
      body = (
        <View style={styles.fill} testID={`form-screen-${testState}`}>
          {data?.form.definition?.title || data?.form.name ? (
            <Text accessibilityRole="header" style={styles.formTitle}>{data?.form.definition?.title || data?.form.name}</Text>
          ) : null}
          {data?.form.definition?.intro ? <Text style={styles.intro}>{data.form.definition.intro}</Text> : null}
          {params?.token && identity !== null ? (
            <View style={styles.whoRow}>
              <Text style={styles.whoText}>{t("answeringAs", identity)}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setLinkSheet(true)}
                style={styles.notYou}
                testID="form-screen-not-you"
              >
                <Text style={styles.linkText}>{t("notYou")}</Text>
              </Pressable>
            </View>
          ) : null}
          {plusOne ? (
            <View style={styles.note} testID="form-screen-plusone">
              <Text style={styles.noteTitle}>
                {me !== null ? t("plusOneHeader", me) : t("plusOneHeaderNoName")}
              </Text>
              <Text style={styles.noteBody}>{t("plusOneBodyNoName")}</Text>
            </View>
          ) : null}
          {state === "unknown" ? (
            <View style={styles.note}>
              <Text style={styles.noteBody}>{t("unknownNote", { brand: brandName })}</Text>
              <Pressable accessibilityRole="button" onPress={goSignIn} style={styles.notYou}>
                <Text style={styles.linkText}>{t("signInInstead")}</Text>
              </Pressable>
            </View>
          ) : null}
          {banner === "err" ? (
            <Text accessibilityRole="alert" style={styles.banner}>{t("errBanner")}</Text>
          ) : null}
          {banner === "changed" ? (
            <View accessibilityRole="alert" style={styles.note}>
              <Text style={styles.noteTitle}>{t("changedTitle")}</Text>
              <Text style={styles.noteBody}>{t("changedBody")}</Text>
            </View>
          ) : null}
          {banner === "stale" ? (
            <View accessibilityRole="alert" style={styles.note}>
              <Text style={styles.noteTitle}>{t("staleTitle")}</Text>
              <Pressable accessibilityRole="button" onPress={reloadStale} style={styles.notYou}>
                <Text style={styles.linkText}>{t("reload")}</Text>
              </Pressable>
            </View>
          ) : null}
          {definition !== null ? (
            <BrandFormRenderer
              definition={definition}
              answers={answers}
              onAnswersChange={onAnswersChange}
              primitives={primitives}
              doorFullAnswers={data?.form.doorFullAnswers === true}
              validationErrors={fieldErrors}
              disabled={sending}
            />
          ) : null}
        </View>
      );
    }
  }

  const answering = state === "fill" || state === "edit" || state === "unknown";
  const dock = answering ? (
    <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {inlineText !== null ? (
        <Pressable accessibilityRole="button" onPress={send} testID="form-screen-inline">
          <Text accessibilityRole="alert" style={styles.inline}>{inlineText}</Text>
          {inline === "offline" ? <Text style={styles.dockHelper}>{t("offlineKept")}</Text> : null}
        </Pressable>
      ) : missing.length > 0 ? (
        <Text style={styles.dockHelper}>{t("needsAnswers")}</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: missing.length > 0 || submit.isPending, busy: submit.isPending }}
        disabled={missing.length > 0 || submit.isPending}
        onPress={send}
        style={({ pressed }) => [
          styles.primary,
          (missing.length > 0 || submit.isPending) && styles.primaryOff,
          pressed && styles.pressed,
        ]}
        testID="form-screen-send"
      >
        <Text style={styles.primaryText}>
          {submit.isPending ? t("sending") : state === "edit" ? t("saveChanges") : t("send")}
        </Text>
      </Pressable>
    </View>
  ) : null;

  return (
    <View style={styles.host}>
      {header}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {brandHeader}
          {body}
        </ScrollView>
        {dock}
      </KeyboardAvoidingView>
      <FormChoiceSheet
        visible={linkSheet}
        title={t("linkSheetTitle")}
        body={t("linkSheetBody", identity ?? { first: "", initial: "" })}
        primaryLabel={t("linkSheetSignIn")}
        secondaryLabel={t("linkSheetKeepGoing", identity ?? { first: "", initial: "" })}
        onPrimary={signOutForLink}
        onSecondary={() => setLinkSheet(false)}
        onClose={() => setLinkSheet(false)}
        testID="form-link-sheet"
      />
      <FormChoiceSheet
        visible={leaveSheet}
        title={t("leaveTitle")}
        body={t("leaveBody")}
        primaryLabel={t("keepAnswering")}
        secondaryLabel={t("leave")}
        onPrimary={() => setLeaveSheet(false)}
        onSecondary={() => {
          setLeaveSheet(false);
          leavingRef.current = true;
          const go = pendingLeave.current ?? leave;
          pendingLeave.current = null;
          go();
        }}
        onClose={() => setLeaveSheet(false)}
        testID="form-leave-sheet"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: FORM_DARK.page },
  flex: { flex: 1 },
  topBar: { paddingHorizontal: 12, paddingBottom: 4 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  backText: { color: FORM_DARK.text1, fontSize: 32, lineHeight: 34 },
  content: { paddingHorizontal: 18, paddingBottom: 32, gap: 16 },
  message: { gap: 12, paddingTop: 8 },
  messageTitle: { color: FORM_DARK.text1, fontSize: 22, lineHeight: 28, fontWeight: "700", textAlign: "left" },
  messageBody: { color: FORM_DARK.text2, fontSize: 15, lineHeight: 22, textAlign: "left" },
  skeleton: { height: 56, borderRadius: 12, backgroundColor: FORM_DARK.panelStrong },
  fill: { gap: 14 },
  formTitle: { color: FORM_DARK.text1, fontSize: 22, lineHeight: 28, fontWeight: "700", textAlign: "left" },
  intro: { color: FORM_DARK.text2, fontSize: 15, lineHeight: 22, textAlign: "left" },
  whoRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  whoText: { color: FORM_DARK.text2, fontSize: 14, lineHeight: 20 },
  notYou: { minHeight: 44, minWidth: 44, justifyContent: "center", paddingHorizontal: 4 },
  linkText: { color: FORM_DARK.text1, fontSize: 14, fontWeight: "700", textDecorationLine: "underline" },
  note: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: FORM_DARK.line,
    backgroundColor: FORM_DARK.panel,
    padding: 14,
    gap: 4,
  },
  noteTitle: { color: FORM_DARK.text1, fontSize: 15, lineHeight: 21, fontWeight: "700", textAlign: "left" },
  noteBody: { color: FORM_DARK.text2, fontSize: 14, lineHeight: 20, textAlign: "left" },
  banner: {
    color: FORM_DARK.text1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: FORM_DARK.danger,
    padding: 12,
  },
  answers: { gap: 12, paddingVertical: 4 },
  answerRow: { gap: 2 },
  answerLabel: { color: FORM_DARK.text3, fontSize: 13, lineHeight: 18 },
  answerValue: { color: FORM_DARK.text1, fontSize: 15, lineHeight: 22 },
  dock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: FORM_DARK.line,
    backgroundColor: FORM_DARK.panel,
    paddingHorizontal: 18,
    paddingTop: 12,
    gap: 8,
  },
  dockHelper: { color: FORM_DARK.text3, fontSize: 13, lineHeight: 18, textAlign: "center" },
  inline: { color: FORM_DARK.text1, fontSize: 14, lineHeight: 20, fontWeight: "600", textAlign: "center" },
  primary: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: FORM_DARK.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  primaryOff: { opacity: 0.45 },
  primaryText: { color: "#ffffff", fontSize: 16, fontWeight: "700" },
  secondary: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: FORM_DARK.line,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  secondaryText: { color: FORM_DARK.text1, fontSize: 16, fontWeight: "600" },
  pressed: { opacity: 0.7 },
});

export default BrandFormScreen;
