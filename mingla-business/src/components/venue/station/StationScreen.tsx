/**
 * #4490 spec 08 O3 — a kitchen or bar screen (`/venue/[venueId]/station/[station]`).
 * Start service first (station choice, test sound, test ticket; the tap that
 * unlocks sound on web), then the board.
 *
 * Sound (spec 08 §3 O3; stationModel.shouldChime): while any ticket is New the
 * chime plays once at once, then every 20 s until every New ticket is accepted.
 * Mute 15 min / 1 hour lives in memory only, so it ends by itself and never
 * survives a reload or restart. Web plays through one HTMLAudioElement; a page
 * reloaded after Start (the address keeps `started=1`) is muted by the browser
 * until a tap, so it says "Tap to turn sound on" (T17). iOS/Android play
 * through expo-audio with silent-mode playback on this screen only; a binary
 * without the module (an older store build given this code over the air)
 * says "Sound needs the latest app" and tickets still flash (stationSound.ts).
 *
 * The screen stays awake while the board is open (useScreenAwake, no
 * brightness change). In the background the order push is the alert.
 * Gate and rights are the server's (stations on + kitchen rights); a refusal
 * shows its own words with a way back.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { color, space, type } from "../../../constants/designSystem";
import { useFloorLayout } from "../../../hooks/useFloorLayout";
import { useReduceMotion } from "../../../hooks/useMotionPreferences";
import { useScreenAwake } from "../../../hooks/useScreenAwake";
import { useStationActions, useStationBoard } from "../../../hooks/useStationBoard";
import { StationError, type StationTicketAction } from "../../../services/venueStationService";
import { openFloorPdf } from "../../../utils/floorPdf";
import { ScrollView } from "../../../wrappers/SmartScrollView";
import { Button } from "../../ui/Button";
import { CenteredState } from "../../ui/CenteredState";
import { Sheet } from "../../ui/Sheet";
import { Spinner } from "../../ui/Spinner";
import { Toast } from "../../ui/Toast";
import { StationBoard, type StationBanner } from "./StationBoard";
import { StationStart } from "./StationStart";
import { StationSoldOutBody } from "./StationSoldOut";
import { STOCK_COPY, stockErrorCopy } from "../stock/stockCopy";
import { setStationSoldOut, StockError } from "../../../services/venueStockService";
import { STATION_COPY, stationErrorCopy } from "./stationCopy";
import {
  ageSeconds,
  clockOffsetMs,
  isMuted,
  muteUntil,
  oldestNew,
  ringingKeys,
  shouldChime,
  ticketKey,
  venueTime,
  type StationChoice,
  type StationColumn,
  type StationMuteMinutes,
  type StationTicket,
} from "./stationModel";
import { createStationSoundPlayer, type StationSoundSupport } from "./stationSound";

type ToastState = { kind: "success" | "error" | "info"; message: string } | null;

export interface StationScreenProps {
  venueId: string;
  initialStation: StationChoice;
  /** The address says Start service was tapped (a reload keeps the board). */
  startedOnLoad: boolean;
}

export function StationScreen({ venueId, initialStation, startedOnLoad }: StationScreenProps): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { boardColumns } = useFloorLayout();
  const reduceMotion = useReduceMotion();
  const [choice, setChoice] = useState<StationChoice>(initialStation);
  const [started, setStarted] = useState(startedOnLoad);
  const [tab, setTab] = useState<StationColumn>("new");
  const [now, setNow] = useState(() => Date.now());
  const [mutedUntil, setMutedUntil] = useState<number | null>(null);
  const [muteOpen, setMuteOpen] = useState(false);
  // #4490 O5 part C (T15): "Mark sold out", and the "{item} is sold out" banner with Undo.
  const [soldOutOpen, setSoldOutOpen] = useState(false);
  const [soldOutDone, setSoldOutDone] = useState<{ menuItemId: string; name: string } | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [printingKey, setPrintingKey] = useState<string | null>(null);
  const [pdfFailed, setPdfFailed] = useState<StationTicket | "test" | null>(null);
  const [soundBusy, setSoundBusy] = useState(false);

  const player = useMemo(() => createStationSoundPlayer(), []);
  const [support, setSupport] = useState<StationSoundSupport>(() => player.support());
  useEffect(() => () => player.dispose(), [player]);

  const { query, connection } = useStationBoard(venueId, choice);
  const actions = useStationActions(venueId, choice);
  const board = query.data ?? null;

  useScreenAwake(started, { tag: "station-board" });

  // One clock for the age timers, the flash and the chime.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const offset = useMemo(
    () => (board !== null ? clockOffsetMs(board.serverNow, query.dataUpdatedAt || Date.now()) : 0),
    [board, query.dataUpdatedAt],
  );

  // The chime.
  const heard = useRef<Set<string>>(new Set());
  const lastChimeAt = useRef<number | null>(null);
  const ringing = useMemo(() => (board === null ? [] : ringingKeys(board.tickets)), [board]);
  useEffect(() => {
    if (!started || support !== "ready") return;
    const input = { ringing, heard: heard.current, lastChimeAt: lastChimeAt.current, now, mutedUntil };
    if (!shouldChime(input)) {
      if (ringing.length === 0) lastChimeAt.current = null;
      return;
    }
    lastChimeAt.current = now;
    heard.current = new Set([...heard.current, ...ringing]);
    void player.play().then((played) => {
      if (!played) setSupport(player.support());
    });
  }, [mutedUntil, now, player, ringing, started, support]);
  // A mute that has run out is gone (never carried past its time).
  useEffect(() => {
    if (mutedUntil !== null && !isMuted(mutedUntil, now)) setMutedUntil(null);
  }, [mutedUntil, now]);

  const unlock = useCallback(async (): Promise<StationSoundSupport> => {
    const next = await player.unlock();
    setSupport(next);
    return next;
  }, [player]);

  const fail = (error: unknown): void => {
    const code = error instanceof StationError ? error.code : "station_failed";
    setToast({ kind: "error", message: stationErrorCopy(code) });
  };

  const runTicket = async (t: StationTicket, action: StationTicketAction): Promise<void> => {
    setBusyKey(ticketKey(t));
    try {
      const result = await actions.ticket.mutateAsync({ action, orderId: t.orderId, station: t.station });
      if (result.already && action === "station_accept") {
        setToast({ kind: "info", message: STATION_COPY.alreadyAccepted(result.alreadyBy) });
      }
    } catch (error) {
      fail(error);
    } finally {
      setBusyKey(null);
    }
  };

  const itemReady = async (t: StationTicket, itemId: string): Promise<void> => {
    setBusyKey(ticketKey(t));
    try {
      await actions.item.mutateAsync({ orderItemId: itemId });
    } catch (error) {
      fail(error);
    } finally {
      setBusyKey(null);
    }
  };

  const printTicket = async (t: StationTicket | "test"): Promise<void> => {
    const key = t === "test" ? "test" : ticketKey(t);
    setPrintingKey(key);
    setPdfFailed(null);
    try {
      await openFloorPdf(
        t === "test"
          ? { kind: "test_ticket", venueId, station: choice }
          : { kind: "kitchen_ticket", venueId, orderId: t.orderId, station: t.station },
      );
      if (t !== "test") void query.refetch();
    } catch (error) {
      const code = error instanceof StationError ? error.code : "floor_pdf_failed";
      if (code === "floor_pdf_failed" || code === "network" || code === "station_failed") setPdfFailed(t);
      else fail(error);
    } finally {
      setPrintingKey(null);
    }
  };

  const chooseStation = (next: StationChoice): void => {
    setChoice(next);
    heard.current = new Set();
    lastChimeAt.current = null;
    if (started) router.setParams({ station: next, started: "1" } as never);
  };

  const start = async (): Promise<void> => {
    await unlock();
    setStarted(true);
    router.setParams({ station: choice, started: "1" } as never);
  };

  const testSound = async (): Promise<void> => {
    setSoundBusy(true);
    try {
      const state = await unlock();
      if (state === "unsupported") setToast({ kind: "info", message: STATION_COPY.needsAppTitle });
      else if (await player.play()) setToast({ kind: "success", message: STATION_COPY.testSoundPlayed });
      else setToast({ kind: "error", message: STATION_COPY.soundBlocked });
    } finally {
      setSoundBusy(false);
    }
  };

  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(`/venue/${venueId}` as never);
  };

  const muted = isMuted(mutedUntil, now);
  const mutedTime = mutedUntil !== null ? venueTime(mutedUntil, board?.timezone ?? null) : null;
  const firstNew = board !== null ? oldestNew(board.tickets) : null;
  const undoSoldOut = async (): Promise<void> => {
    const done = soldOutDone;
    if (done === null) return;
    try {
      await setStationSoldOut(venueId, done.menuItemId, false);
      setSoldOutDone(null);
    } catch (err) {
      setToast({ kind: "error", message: stockErrorCopy(err instanceof StockError ? err.code : "stock_failed") });
    }
  };
  const banner: StationBanner | null = soldOutDone !== null
    ? {
      tone: "info",
      title: STOCK_COPY.boardDoneTitle(soldOutDone.name),
      body: STOCK_COPY.boardDoneBody,
      action: { label: STOCK_COPY.undo, onPress: () => void undoSoldOut() },
      testID: "station-banner-sold-out",
    }
    : pdfFailed !== null
    ? {
      tone: "danger",
      title: STATION_COPY.pdfFailed,
      action: { label: STATION_COPY.tryAgain, onPress: () => void printTicket(pdfFailed) },
      testID: "station-banner-pdf",
    }
    : started && support === "locked"
    ? {
      tone: "warning",
      title: STATION_COPY.soundLockedTitle,
      body: STATION_COPY.soundLockedBody,
      action: { label: STATION_COPY.turnSoundOn, onPress: () => void unlock() },
      testID: "station-banner-sound-locked",
    }
    : support === "unsupported"
    ? { tone: "warning", title: STATION_COPY.needsAppTitle, body: STATION_COPY.needsAppBody, testID: "station-banner-needs-app" }
    : muted
    ? {
      tone: "warning",
      title: STATION_COPY.soundOffUntil(mutedTime ?? "--"),
      body: STATION_COPY.soundOffBody,
      action: { label: STATION_COPY.turnSoundOn, onPress: () => setMutedUntil(null) },
      testID: "station-banner-muted",
    }
    : connection === "reconnecting"
    ? { tone: "warning", title: STATION_COPY.reconnectingTitle, body: STATION_COPY.reconnectingBody, testID: "station-banner-reconnecting" }
    : firstNew !== null
    ? { tone: "info", title: STATION_COPY.newOrder(firstNew.destination), body: STATION_COPY.newOrderBody, testID: "station-banner-new" }
    : null;

  let body: React.ReactElement;
  if (query.isPending) {
    body = (
      <CenteredState fill title={STATION_COPY.loading} icon={<Spinner />} testID="station-loading" />
    );
  } else if (query.isError || board === null) {
    const code = query.error instanceof StationError ? query.error.code : "network";
    const gate = code === "stations_not_enabled";
    const rights = code === "not_authorized";
    body = (
      <CenteredState
        fill
        tone={gate || rights ? "default" : "error"}
        title={gate ? STATION_COPY.offTitle : rights ? STATION_COPY.noAccessTitle : STATION_COPY.loadFailedTitle}
        body={gate ? STATION_COPY.offBody : rights ? STATION_COPY.noAccessBody : STATION_COPY.loadFailedBody}
        testID="station-error"
      >
        {!gate && !rights ? (
          <Button label={STATION_COPY.tryAgain} variant="primary" size="md" onPress={() => void query.refetch()} />
        ) : null}
        <Button label={STATION_COPY.back} variant="secondary" size="md" onPress={close} />
      </CenteredState>
    );
  } else if (!started) {
    body = (
      <ScrollView contentContainerStyle={styles.startScroll}>
        <StationStart
          venueName={board.venueName}
          choice={choice}
          onChoose={chooseStation}
          noStationItems={board.noStationItems}
          defaultStation={board.defaultStation}
          soundBusy={soundBusy}
          printing={printingKey === "test"}
          onTestSound={() => void testSound()}
          onTestTicket={() => void printTicket("test")}
          onStart={() => void start()}
        />
      </ScrollView>
    );
  } else {
    body = (
      <StationBoard
        board={board}
        choice={choice}
        onChoose={chooseStation}
        columns={boardColumns}
        tab={tab}
        onTab={setTab}
        connection={connection}
        banner={banner}
        muteLabel={muted && mutedTime !== null ? STATION_COPY.soundOffUntil(mutedTime) : STATION_COPY.mute}
        onMute={() => (muted ? setMutedUntil(null) : setMuteOpen(true))}
        onSoldOut={() => setSoldOutOpen(true)}
        ageOf={(t) => ageSeconds(t.sentAt, now, offset)}
        ringOn={reduceMotion || Math.floor(now / 1000) % 2 === 0}
        busyKey={busyKey}
        printingKey={printingKey}
        onAccept={(t) => void runTicket(t, "station_accept")}
        onItemReady={(t, itemId) => void itemReady(t, itemId)}
        onReady={(t) => void runTicket(t, "ticket_ready")}
        onPickedUp={(t) => void runTicket(t, "picked_up")}
        onRecall={(t) => void runTicket(t, "recall")}
        onPrint={(t) => void printTicket(t)}
        onClose={close}
        showKeepOpen={!boardColumns || support !== "ready"}
      />
    );
  }

  const mute = (minutes: StationMuteMinutes): void => {
    setMutedUntil(muteUntil(Date.now(), minutes));
    setMuteOpen(false);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]} testID="station-screen">
      {body}
      <Sheet visible={muteOpen} onClose={() => setMuteOpen(false)} testID="station-mute-sheet">
        <MuteSheetBody onMute={mute} onClose={() => setMuteOpen(false)} />
      </Sheet>
      <Sheet visible={soldOutOpen} onClose={() => setSoldOutOpen(false)} testID="station-sold-out-sheet">
        {soldOutOpen ? (
          <StationSoldOutBody
            venueId={venueId}
            station={choice}
            timeOf={(iso) => venueTime(Date.parse(iso), board?.timezone ?? null) ?? "--"}
            onClose={() => setSoldOutOpen(false)}
            onMarked={(item) => {
              setSoldOutOpen(false);
              setSoldOutDone(item);
            }}
          />
        ) : null}
      </Sheet>
      <Toast visible={toast !== null} kind={toast?.kind ?? "info"} message={toast?.message ?? ""}
        onDismiss={() => setToast(null)} testID="station-toast" />
    </View>
  );
}

function MuteSheetBody({ onMute, onClose }: { onMute: (m: StationMuteMinutes) => void; onClose: () => void }): React.ReactElement {
  return (
    <View style={styles.sheet}>
      <View style={styles.sheetHead}>
        <View style={styles.sheetTitle}>
          <Text style={styles.h2} accessibilityRole="header">{STATION_COPY.muteTitle}</Text>
          <Text style={styles.muted}>{STATION_COPY.muteBody}</Text>
        </View>
        <Button label={STATION_COPY.close} variant="ghost" size="sm" onPress={onClose} />
      </View>
      <Button label={STATION_COPY.mute15} variant="secondary" size="lg" fullWidth onPress={() => onMute(15)}
        testID="station-mute-15" />
      <Button label={STATION_COPY.mute60} variant="secondary" size="lg" fullWidth onPress={() => onMute(60)}
        testID="station-mute-60" />
      <Text style={styles.muted}>{STATION_COPY.muteFoot}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas },
  startScroll: { flexGrow: 1 },
  sheet: { gap: space[3], paddingHorizontal: space[4], paddingBottom: space[6] },
  sheetHead: { flexDirection: "row", alignItems: "flex-start", gap: space[2] },
  sheetTitle: { flex: 1, gap: space[1] },
  h2: { ...type.h2, color: color.text1 },
  muted: { ...type.small, color: color.text2 },
});
