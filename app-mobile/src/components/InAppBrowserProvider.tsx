/**
 * Issue #4261 amendment 1 (6.4) — every link opens inside Mingla.
 *
 * `InAppBrowserProvider` holds the one in-app browser for the tree under it
 * (one shared, bottom-anchored `InAppBrowserModal`, orch-1149). Surfaces call
 * `useOpenInMingla()`:
 *   - `open(url, title?)`: a web page opens in the in-app browser; a document
 *     goes to `openDocument`; `tel:` / `mailto:` / `sms:` go to the system;
 *     anything else (javascript:, data:, intent:, maps:, geo:, mingla://) is
 *     refused with a toast.
 *   - `openDocument(url)`: the in-app overlay browser (Android's WebView cannot
 *     render a PDF). No `Linking.openURL` fallback: that sent people out of
 *     Mingla.
 *
 * The nearest provider wins. A surface that lives in its own RN `Modal` wraps
 * its content in its own provider so the browser presents inside that window
 * (iOS cannot present a sibling Modal over an open Modal).
 *
 * This file is the only place allowed to call `Linking.openURL` for a link and
 * `openBrowserAsync` for a document (gate I-4261-LINKS-OPEN-IN-MINGLA, Wave E).
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";
import i18n from "../i18n";
import InAppBrowserModal from "./InAppBrowserModal";
import { toastManager } from "./ui/Toast";
import { classifyLink } from "../utils/inAppLink";

export interface OpenInMingla {
  open: (url: string, title?: string) => void;
  openDocument: (url: string) => void;
}

const InAppBrowserContext = createContext<OpenInMingla | null>(null);

function linkFailed(error: unknown, url: string): void {
  console.warn("[InAppBrowserProvider] could not open link", url, error);
  toastManager.error(i18n.t("common:link_open_failed"));
}

function openDocumentInOverlay(url: string): void {
  WebBrowser.openBrowserAsync(url, {
    showTitle: true,
    toolbarColor: "#eb7825",
    enableBarCollapsing: false,
  }).catch((error: unknown) => linkFailed(error, url));
}

export function InAppBrowserProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [page, setPage] = useState<{ url: string; title: string } | null>(null);

  const openDocument = useCallback((url: string) => {
    const link = classifyLink(url);
    if (link.kind !== "web" && link.kind !== "document") {
      linkFailed(new Error("not a web document"), url);
      return;
    }
    openDocumentInOverlay(link.url);
  }, []);

  const open = useCallback((url: string, title?: string) => {
    const link = classifyLink(url);
    switch (link.kind) {
      case "web":
        setPage({ url: link.url, title: title?.trim() || link.url });
        return;
      case "document":
        openDocumentInOverlay(link.url);
        return;
      case "system":
        Linking.openURL(link.url).catch((error: unknown) => linkFailed(error, link.url));
        return;
      case "invalid":
        linkFailed(new Error("unsupported link"), url);
        return;
      default: {
        const exhaustive: never = link;
        return exhaustive;
      }
    }
  }, []);

  const value = useMemo<OpenInMingla>(() => ({ open, openDocument }), [open, openDocument]);

  return (
    <InAppBrowserContext.Provider value={value}>
      {children}
      <InAppBrowserModal
        visible={page !== null}
        url={page?.url ?? ""}
        title={page?.title ?? ""}
        onClose={() => setPage(null)}
      />
    </InAppBrowserContext.Provider>
  );
}

/** Without a provider: a dev error and a toast, never Safari / Chrome. */
const MISSING_PROVIDER: OpenInMingla = {
  open: (url) => {
    if (__DEV__) console.error("[useOpenInMingla] no InAppBrowserProvider above this component");
    linkFailed(new Error("no InAppBrowserProvider"), url);
  },
  openDocument: (url) => {
    if (__DEV__) console.error("[useOpenInMingla] no InAppBrowserProvider above this component");
    linkFailed(new Error("no InAppBrowserProvider"), url);
  },
};

export function useOpenInMingla(): OpenInMingla {
  return useContext(InAppBrowserContext) ?? MISSING_PROVIDER;
}
