/**
 * ORCH-0864 [Marketing Composer V2] Stage F.6 — ComposerV2Editor (layout rework).
 *
 * Stage F.5 (pell pivot) shipped a flex-column where ComposerV2Editor took
 * the middle region and embedded the InsertionBar at its bottom. Live device
 * showed the bar competing with the Send-now/Schedule/Compliance/Footer
 * stack — visible overlap. Stage F.6 splits responsibility:
 *
 *   - ComposerV2Editor: ONLY the editor canvas (subject + tooltip + body).
 *     Forward-refs an imperative handle so the parent can drive inserts.
 *   - compose.tsx: mounts InsertionBar + TemplatePreviewDrawer, calls into
 *     this editor via the imperative handle.
 *
 * This makes the layout robust:
 *   - compose.tsx pins InsertionBar above Footer (no more flex-area fight)
 *   - Editor body has a clear visible boundary so the operator can see it
 *   - When/Compliance stay scrollable in the middle
 *
 * Public surface (forwardRef handle):
 *   - insertEvent(event): inserts an event chip at the cursor
 *   - insertPersonalization(token): inserts a personalization chip at cursor
 *   - applyTemplateReplace(template): full body+subject replace
 *   - applyTemplateAtCursor(template): inserts template body at cursor
 */

import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
// #2262 — this file imports NO scroll container. The horizontal subject-token
// rail moved to `SubjectTokenRail.tsx`, which has no TextInput, so `orch-0892`
// pattern 4 fires on neither file and the composer carries no keyboard-plumbing
// exemption of any kind. Pattern 1 (`Keyboard.addListener`) is likewise left
// with no cover here: the F.9e block is deleted, and the #2262 gate's rule R4
// forbids one in this file outright, marker or no marker.
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from "react-native";
import {
  RichEditor,
  actions,
  type RichEditorFormatState,
  type RichEditorHandle,
} from "./richEditor";

import {
  accent,
  composerSheetMinHeight,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import {
  bodyHtmlToTenTapDoc,
  docToHtml,
  htmlToTokenString,
  type PersonalizationToken,
} from "../../../services/marketing/tenTapTokenBridge";
import type { EventCardOption } from "../../../services/marketing/brandEvents";
import type { MarketingTemplateRow } from "../../../types/marketing";
import {
  COMPOSER_CHIP_CSS,
  COMPOSER_CHIP_X_HANDLER_JS,
  COMPOSER_SELECTION_TRACKER_JS,
  eventChipHtml,
  personalizationChipHtml,
} from "./composerChipHtml";
import { InsertionBar } from "./InsertionBar";
import { SubjectTokenRail } from "./SubjectTokenRail";
import type { InsertionBarState } from "./InsertionBarState";
import { PERSONALIZATION_OPTIONS } from "./InsertionBarState";
import { TemplatePreviewDrawer } from "./TemplatePreviewDrawer";
import type { PreviewVariables } from "../../../services/marketing/marketingRenderingService";
import { useResponsiveLayout } from "../../../hooks/useResponsiveLayout";
// Stage F.9: SelectionFormattingTooltip removed — its B/I/Link pills
// merged into InsertionBar (now mounted inside this editor between the
// subject row and the body card per operator F.9 directive).

const DIVIDER_HTML =
  '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.18);margin:12px 0;" />';

/**
 * Normalizes a user-typed URL: trims, prepends `https://` if no scheme,
 * preserves explicit `http://` / `mailto:`. Returns empty string for
 * empty input (caller treats as a no-op).
 */
const normalizeUrl = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

export interface ComposerV2EditorHandle {
  insertEvent: (event: EventCardOption) => void;
  insertPersonalization: (token: PersonalizationToken) => void;
  applyTemplateReplace: (template: MarketingTemplateRow) => void;
  applyTemplateAtCursor: (template: MarketingTemplateRow) => void;
  /** Stage F.9 — merged-toolbar formatting commands. */
  toggleBold: () => void;
  toggleItalic: () => void;
  toggleUnderline: () => void;
  toggleLink: () => void;
  /**
   * ORCH-0891 M3 — toggles the right-rail TemplatePreviewDrawer so the
   * ⌘D keyboard shortcut can drive it from compose.tsx without owning
   * the drawer state itself.
   */
  toggleTemplateDrawer: () => void;
}

export interface ComposerV2EditorProps {
  initialBodyHtml: string;
  subject: string;
  onSubjectChange: (next: string) => void;
  onBodyChange: (bodyHtml: string) => void;
  editable: boolean;
  /** F.9: merged-toolbar payload — sits between subject row and body. */
  brandEvents: EventCardOption[];
  templates: MarketingTemplateRow[];
  previewVariables: PreviewVariables;
  brandName: string | null;
  currentDraftIsDirty: boolean;
  onErrorToast: (msg: string) => void;
}

export const ComposerV2Editor = forwardRef<ComposerV2EditorHandle, ComposerV2EditorProps>(
  function ComposerV2Editor(props, ref): React.ReactElement {
    const {
      initialBodyHtml,
      subject,
      onSubjectChange,
      onBodyChange,
      editable,
      brandEvents,
      templates,
      previewVariables,
      brandName,
      currentDraftIsDirty,
      onErrorToast,
    } = props;

    const richEditorRef = useRef<RichEditorHandle>(null);
    const { isWideDesktop } = useResponsiveLayout();

    // #2262: no chrome constant here. `CHROME_CONTENT_PX = 376` was short by
    // the route TopBar (64pt) + 12pt on EVERY device, so the column overflowed
    // by a device-INDEPENDENT 76pt before anyone typed a character — there was
    // no device on which this screen fit.
    //
    // #2262: no `PHONE_WEB_BODY_MIN_PX = 360`, and no `Math.round(windowHeight
    // * 0.6)`. A fraction of the viewport is still a guess, and it made the BOX
    // bigger while doing nothing at all for the editable node inside it.
    //
    // #2262: no `Math.max(120, …)` floor. That clamp is what stopped the body
    // shrinking far enough for the keyboard — it bound by 191pt on an iPhone
    // SE3 and by 96pt on a 17 Pro, putting the action row 225pt / 130pt behind
    // the keyboard with no scroll to recover it.
    //
    // #2262: no `Keyboard.addListener`, and no `+42` Done-bar constant. The
    // keyboard is ridden by `SmartKeyboardAvoidingView` in `compose.tsx`, whose
    // `keyboardVerticalOffset` reads `DONE_BAR_OCCUPIED + MIN_VISIBLE_CLEARANCE`
    // from the one derived source. The bespoke listener was also permanently
    // dead on web (RN-web's `Keyboard` is a no-op stub), so this file's only
    // keyboard compensation never ran on two of its four surfaces.
    //
    // Flexbox performs every one of those subtractions now.

    /**
     * THE ONE MEASURED NUMBER ON THIS SCREEN — and it is measured, never
     * estimated.
     *
     * pell's WebView genuinely cannot live on `flex: 1` (it collapses to zero
     * height — a documented, widely-reported gotcha), so the native body needs
     * a real pixel height. `onLayout` on the body region supplies one that
     * actually exists.
     *
     * P3, THE BLAST-RADIUS-ZERO PROPERTY. `measuredBodyPx` may be read ONLY by
     * pell's `initialHeight` and `style.height`. It is never added to,
     * subtracted from, compared against, or used to size any ancestor, sibling,
     * or the commit bar. A WRONG MEASUREMENT CAN THEREFORE ONLY MIS-SIZE THE
     * EDITOR'S WEBVIEW — it is structurally incapable of moving the action row,
     * because nothing above or beside it reads the value. That is the property
     * that makes keeping a number here safe, and it is asserted by gate rule R6
     * and by the T1-b render proof, not left to review.
     */
    const [measuredBodyPx, setMeasuredBodyPx] = useState<number | null>(null);
    /**
     * `initialHeight` is FROZEN at the first measurement. pell reads it once for
     * the WebView's initial style; handing it a changing value on every resize
     * risks a remount, and a pell remount CLOBBERS THE OPERATOR'S IN-PROGRESS
     * DRAFT. Under no circumstances may the live value become a React `key` on
     * `RichEditor` or any ancestor.
     */
    const firstMeasuredBodyPxRef = useRef<number | null>(null);
    const handleBodyLayout = useCallback((e: LayoutChangeEvent): void => {
      const next = Math.round(e.nativeEvent.layout.height);
      if (next <= 0) return; // never publish a zero
      if (firstMeasuredBodyPxRef.current === null) {
        firstMeasuredBodyPxRef.current = next;
      }
      setMeasuredBodyPx((prev) => (prev === next ? prev : next));
    }, []);

    /**
     * #2262 10.10 — live mark state, WEB ONLY. `null` on native, where
     * `COMPOSER_SELECTION_TRACKER_JS` saves the selection inside the pell
     * WebView's own `window` and posts nothing back: there is no message
     * channel, so an active affordance there could never fire.
     */
    const [formatState, setFormatState] = useState<RichEditorFormatState | null>(
      null,
    );
    const handleFormatStateChange = useCallback(
      (next: RichEditorFormatState): void => {
        setFormatState((prev) =>
          prev !== null &&
          prev.bold === next.bold &&
          prev.italic === next.italic &&
          prev.underline === next.underline &&
          prev.link === next.link
            ? prev
            : next,
        );
      },
      [],
    );

    // Initial HTML rendered into the editor once at mount. Subsequent body_html
    // changes from the parent are NOT pushed back into the editor (would
    // clobber in-progress edits) — only template-apply via the imperative
    // handle's setContentHTML changes content after init.
    const initialContentHtml = useMemo(
      () => docToHtml(bodyHtmlToTenTapDoc(initialBodyHtml)),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    const handleEditorInitialized = useCallback((): void => {
      const css = COMPOSER_CHIP_CSS.replace(/`/g, "\\`");
      richEditorRef.current?.commandDOM(
        `var s=document.createElement('style');s.innerHTML=\`${css}\`;document.head.appendChild(s);`,
      );
      richEditorRef.current?.commandDOM(COMPOSER_CHIP_X_HANDLER_JS);
      // Saves contenteditable selection on every selectionchange so the
      // toolbar's focus-then-exec JS can restore it before execCommand,
      // and binds Cmd/Ctrl+U → execCommand('underline') (not native on
      // iOS WKWebView). See COMPOSER_SELECTION_TRACKER_JS docs.
      richEditorRef.current?.commandDOM(COMPOSER_SELECTION_TRACKER_JS);
    }, []);

    const handleBodyHtmlChange = useCallback(
      (html: string): void => {
        onBodyChange(htmlToTokenString(html));
      },
      [onBodyChange],
    );

    // ORCH-0891 M3 — drawer state must be declared BEFORE the imperative
    // handle so `toggleTemplateDrawer` can call `setShowTemplateDrawer`.
    // F.9 InsertionBar local state moved here for the same reason.
    const [barState, setBarState] = useState<InsertionBarState>("closed");
    const [showTemplateDrawer, setShowTemplateDrawer] = useState(false);

    // ─── Imperative handle: parent drives inserts + formatting ────────────
    useImperativeHandle(
      ref,
      () => ({
        insertEvent: (event: EventCardOption): void => {
          richEditorRef.current?.insertHTML(
            eventChipHtml({
              eventId: event.id,
              title: event.title,
              dateLabel: event.date_label,
              ctaLabel: "tickets",
              coverUrl: event.cover_image_url,
            }),
          );
        },
        insertPersonalization: (token: PersonalizationToken): void => {
          richEditorRef.current?.insertHTML(personalizationChipHtml({ token }));
        },
        applyTemplateReplace: (template: MarketingTemplateRow): void => {
          onSubjectChange(template.subject_template ?? "");
          const html = docToHtml(bodyHtmlToTenTapDoc(template.body_template));
          richEditorRef.current?.setContentHTML(html);
          onBodyChange(template.body_template);
        },
        applyTemplateAtCursor: (template: MarketingTemplateRow): void => {
          const html = docToHtml(bodyHtmlToTenTapDoc(template.body_template));
          richEditorRef.current?.insertHTML(html);
        },
        // Stage F.9 merged-toolbar formatting commands.
        // Route through sendAction so BOTH platforms work:
        //   - pell (iOS/Android): sendAction posts a message to the
        //     WebView; pell's bridge runs focusCurrent() then exec(cmd)
        //     when name === 'result' (editor.js:697-702).
        //   - Tiptap (web): the web RichEditor shim maps sendAction
        //     'bold' / 'italic' / 'underline' onto
        //     editor.chain().focus().toggleX().run() (richEditor.tsx).
        // The previous commandDOM-based path silently no-op'd on web
        // because the web shim's commandDOM is intentionally a no-op
        // (richEditor.tsx:312-314 — Tiptap doesn't have an iframe to
        // inject JS into).
        toggleBold: (): void => {
          richEditorRef.current?.sendAction(actions.setBold, "result");
        },
        toggleItalic: (): void => {
          richEditorRef.current?.sendAction(actions.setItalic, "result");
        },
        toggleUnderline: (): void => {
          richEditorRef.current?.sendAction(actions.setUnderline, "result");
        },
        toggleLink: (): void => {
          setLinkPromptValue("");
          setLinkPromptVisible(true);
        },
        toggleTemplateDrawer: (): void => {
          setShowTemplateDrawer((prev) => !prev);
        },
      }),
      [onBodyChange, onSubjectChange],
    );

    // ─── Subject mini-personalize (SPEC §4.11 Option A — unchanged) ──────
    const [subjectPersonalizeOpen, setSubjectPersonalizeOpen] = useState(false);
    const [subjectSelectionStart, setSubjectSelectionStart] = useState(0);
    const [subjectSelectionEnd, setSubjectSelectionEnd] = useState(0);

    const onSubjectSelectionChange = useCallback(
      (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>): void => {
        setSubjectSelectionStart(e.nativeEvent.selection.start);
        setSubjectSelectionEnd(e.nativeEvent.selection.end);
      },
      [],
    );

    const handleSubjectInsertToken = useCallback(
      (token: PersonalizationToken): void => {
        const raw = `{${token}}`;
        const start = Math.max(0, Math.min(subjectSelectionStart, subject.length));
        const end = Math.max(start, Math.min(subjectSelectionEnd, subject.length));
        const next = subject.slice(0, start) + raw + subject.slice(end);
        onSubjectChange(next);
        setSubjectPersonalizeOpen(false);
      },
      [subject, subjectSelectionStart, subjectSelectionEnd, onSubjectChange],
    );

    const subjectTokens = useMemo(() => PERSONALIZATION_OPTIONS, []);

    // F.9: InsertionBar local state — declared above the imperative
    // handle now (ORCH-0891 M3) so toggleTemplateDrawer can reach
    // setShowTemplateDrawer.

    const handleInsertEventLocal = useCallback(
      (event: EventCardOption): void => {
        richEditorRef.current?.insertHTML(
          eventChipHtml({
            eventId: event.id,
            title: event.title,
            dateLabel: event.date_label,
            ctaLabel: "tickets",
            coverUrl: event.cover_image_url,
          }),
        );
      },
      [],
    );

    const handleInsertPersonalizationLocal = useCallback(
      (token: PersonalizationToken): void => {
        richEditorRef.current?.insertHTML(personalizationChipHtml({ token }));
      },
      [],
    );

    // Link prompt — cross-platform Modal (replaces iOS Alert.prompt and
    // the Android "coming soon" alert). Same UX on both platforms.
    const [linkPromptVisible, setLinkPromptVisible] = useState(false);
    const [linkPromptValue, setLinkPromptValue] = useState("");

    const handleToggleBoldLocal = useCallback((): void => {
      richEditorRef.current?.sendAction(actions.setBold, "result");
    }, []);

    const handleToggleItalicLocal = useCallback((): void => {
      richEditorRef.current?.sendAction(actions.setItalic, "result");
    }, []);

    const handleToggleUnderlineLocal = useCallback((): void => {
      richEditorRef.current?.sendAction(actions.setUnderline, "result");
    }, []);

    const handleToggleLinkLocal = useCallback((): void => {
      setLinkPromptValue("");
      setLinkPromptVisible(true);
    }, []);

    const handleLinkPromptCancel = useCallback((): void => {
      setLinkPromptVisible(false);
    }, []);

    const handleLinkPromptSubmit = useCallback((): void => {
      const url = normalizeUrl(linkPromptValue);
      setLinkPromptVisible(false);
      if (url.length === 0) return;
      // insertLink is implemented on BOTH platforms:
      //   - pell (iOS/Android): wraps current selection in <a href>
      //   - Tiptap (web): inserts <a> at cursor with URL text if no
      //     selection, else wraps selection (richEditor.tsx insertLink).
      richEditorRef.current?.insertLink(url, url);
    }, [linkPromptValue]);

    const handleInsertDividerLocal = useCallback((): void => {
      richEditorRef.current?.insertHTML(DIVIDER_HTML);
    }, []);

    const handleApplyTemplateReplaceLocal = useCallback(
      (template: MarketingTemplateRow): void => {
        onSubjectChange(template.subject_template ?? "");
        const html = docToHtml(bodyHtmlToTenTapDoc(template.body_template));
        richEditorRef.current?.setContentHTML(html);
        onBodyChange(template.body_template);
      },
      [onBodyChange, onSubjectChange],
    );

    const handleApplyTemplateAtCursorLocal = useCallback(
      (template: MarketingTemplateRow): void => {
        const html = docToHtml(bodyHtmlToTenTapDoc(template.body_template));
        richEditorRef.current?.insertHTML(html);
      },
      [],
    );

    return (
      /**
       * #2262 — ONE SHEET.
       *
       * Before: a subject `Input` in its own 48pt bordered box, an optional
       * token scroller, an `InsertionBar` pill row with its own borders, and a
       * body box with its own border and fill — FOUR separately-bordered
       * objects stacked with 4-8pt gaps. That is a settings form, not a
       * composer, and the 16pt of naked canvas between two bordered objects is
       * most of what "doesn't sit flush" was describing.
       *
       * Now: subject, body and toolbar live inside a single surface. The
       * toolbar is not their peer — it is the sheet's own chrome. The sheet is
       * `flex: 1` and is the ONLY thing that absorbs height change: the
       * keyboard, the insert panels, the token rail and Dynamic Type all come
       * out of the body, never out of the commit bar.
       */
      <View
        style={[styles.sheet, isWideDesktop ? styles.desktopSheet : null]}
        testID="composer-v2-sheet"
      >
        {/* SUBJECT. Deliberately NOT the `Input` primitive: `Input` brings a
            border, a fill and its own radius, and inside the sheet all three
            are wrong — every real composer's subject line is borderless. 44pt,
            not `Input`'s 48. `typography.bodyLg` because the subject IS the
            headline and should not be the same size as the body.

            No `lineHeight` reaches the TextInput: iOS treats TextInput
            lineHeight as line-box height and drifts the baseline downward,
            clipping descenders. That was the F.9k reason for adopting `Input`
            in the first place, and it is preserved here by spreading only the
            metrics we want. */}
        <View style={styles.subjectRow}>
          <TextInput
            value={subject}
            onChangeText={onSubjectChange}
            onSelectionChange={onSubjectSelectionChange}
            editable={editable}
            placeholder="Subject line"
            placeholderTextColor={textTokens.tertiary}
            selectionColor={accent.warm}
            style={styles.subjectInput}
            accessibilityLabel="Email subject"
            testID="composer-v2-subject"
            numberOfLines={1}
          />
          <Pressable
            onPress={() => setSubjectPersonalizeOpen((v) => !v)}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel="Insert personalization into subject"
            accessibilityState={{ expanded: subjectPersonalizeOpen }}
            style={({ pressed }) => [
              styles.subjectPersonalize,
              subjectPersonalizeOpen ? styles.subjectPersonalizeActive : null,
              pressed ? styles.subjectPersonalizePressed : null,
            ]}
            testID="composer-v2-subject-personalize"
          >
            <Text
              style={[
                styles.subjectPersonalizeText,
                subjectPersonalizeOpen
                  ? styles.subjectPersonalizeTextActive
                  : null,
              ]}
            >
              {"{ }"}
            </Text>
          </Pressable>
        </View>
        <View style={styles.sheetRule} />

        {subjectPersonalizeOpen ? (
          <SubjectTokenRail
            tokens={subjectTokens}
            onInsert={handleSubjectInsertToken}
          />
        ) : null}

        {/* BODY. `flex: 1, minHeight: 0` — it claims whatever the sheet has
            left after the subject row, the rule, the token rail and the
            toolbar foot, WHATEVER THOSE HAPPEN TO MEASURE. That is why moving
            the toolbar to the foot and taking the subject from 48 to 44 cost
            the height model nothing: `onLayout` runs after all of it.

            F.9n stands: a plain <View>, never a Pressable. A Pressable claimed
            the iOS gesture responder BEFORE the WKWebView, so native taps never
            reached the contenteditable and the system keyboard never engaged.

            `overflow` is deliberately absent here — F.9n's tap history makes
            `overflow:hidden` on this node a known hazard on native. The clip
            lives on the flex region in `compose.tsx` instead. */}
        <View
          style={styles.bodyHost}
          onLayout={handleBodyLayout}
          testID="composer-v2-body-host"
          accessibilityLabel="Tap to start writing"
        >
          {/* C-1 — NO GUESSED NUMBER EVER REACHES PELL. `RichEditor` does not
              mount until the first `onLayout`. There is no default, no fallback
              constant, no `?? 240`. It costs exactly one frame. */}
          {measuredBodyPx === null ? null : (
            <RichEditor
              ref={richEditorRef}
              initialContentHTML={initialContentHtml}
              editorInitializedCallback={handleEditorInitialized}
              onChange={handleBodyHtmlChange}
              onFormatStateChange={handleFormatStateChange}
              placeholder="Write to your people…"
              useContainer={false}
              // NATIVE ONLY. pell's WebView collapses to 0 under `flex:1`
              // (documented gotcha) and genuinely needs a pixel height.
              // Web/Tiptap is flex-bounded by CSS and takes neither prop.
              initialHeight={
                Platform.OS === "web"
                  ? undefined
                  : (firstMeasuredBodyPxRef.current ?? measuredBodyPx)
              }
              style={
                Platform.OS === "web" ? undefined : { height: measuredBodyPx }
              }
              editorStyle={{
                backgroundColor: "transparent",
                color: textTokens.primary,
                placeholderColor: textTokens.tertiary,
                contentCSSText:
                  "font-size: 15px; line-height: 1.55; padding: 8px 16px; min-height: 100%;",
              }}
              disabled={!editable}
            />
          )}
        </View>

        {/* TOOLBAR at the sheet FOOT — the sheet's own chrome, not a peer of
            the subject and body. It carries its own hairline separator above
            it, and its panels open UPWARD into the body's space, so the body
            shrinks and the commit bar never moves. */}
        <InsertionBar
          state={barState}
          onStateChange={setBarState}
          events={brandEvents}
          formatState={formatState ?? undefined}
          onInsertEvent={handleInsertEventLocal}
          onInsertPersonalization={handleInsertPersonalizationLocal}
          onOpenLink={handleToggleLinkLocal}
          onInsertDivider={handleInsertDividerLocal}
          onInsertImage={() =>
            onErrorToast("Image insertion coming in a future update.")
          }
          onOpenTemplateDrawer={() => setShowTemplateDrawer(true)}
          onToggleBold={handleToggleBoldLocal}
          onToggleItalic={handleToggleItalicLocal}
          onToggleUnderline={handleToggleUnderlineLocal}
          onToggleLink={handleToggleLinkLocal}
        />

        {/* F.9: TemplatePreviewDrawer mounted inside the editor so the
            InsertionBar overflow → "From template…" trigger and the
            Apply Replace / Apply at Cursor callbacks all live in one
            scope. */}
        <TemplatePreviewDrawer
          visible={showTemplateDrawer}
          onClose={() => setShowTemplateDrawer(false)}
          templates={templates}
          previewVariables={previewVariables}
          brandName={brandName}
          currentDraftIsDirty={currentDraftIsDirty}
          onApplyReplace={handleApplyTemplateReplaceLocal}
          onApplyAtCursor={handleApplyTemplateAtCursorLocal}
        />

        {/* Cross-platform link prompt. Replaces iOS Alert.prompt (which
            doesn't exist on Android). Same UX on both platforms; URL is
            normalized with https:// prefix if no scheme present. */}
        <Modal
          visible={linkPromptVisible}
          transparent
          animationType="fade"
          onRequestClose={handleLinkPromptCancel}
        >
          <Pressable
            style={styles.linkPromptBackdrop}
            onPress={handleLinkPromptCancel}
            accessibilityLabel="Dismiss link prompt"
          >
            {/* orch-strict-grep-allow pressable-no-label — tap-trap card: absorbs taps so they don't bubble to the backdrop dismiss handler. Not user-actionable; inner controls (TextInput, buttons) carry their own labels. */}
            <Pressable style={styles.linkPromptCard} onPress={() => undefined}>
              <Text style={styles.linkPromptTitle}>Insert link</Text>
              <Text style={styles.linkPromptBody}>
                Paste the URL the selected text should link to.
              </Text>
              <TextInput
                value={linkPromptValue}
                onChangeText={setLinkPromptValue}
                placeholder="https://example.com"
                placeholderTextColor="rgba(255, 255, 255, 0.42)"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="done"
                onSubmitEditing={handleLinkPromptSubmit}
                autoFocus
                style={styles.linkPromptInput}
                accessibilityLabel="Link URL"
                testID="composer-v2-link-prompt-input"
              />
              <View style={styles.linkPromptActions}>
                <Pressable
                  onPress={handleLinkPromptCancel}
                  style={({ pressed }) => [
                    styles.linkPromptButton,
                    pressed ? styles.linkPromptButtonPressed : null,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel link insertion"
                >
                  <Text style={styles.linkPromptButtonLabel}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleLinkPromptSubmit}
                  style={({ pressed }) => [
                    styles.linkPromptButton,
                    styles.linkPromptButtonPrimary,
                    pressed ? styles.linkPromptButtonPressed : null,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Insert link"
                  testID="composer-v2-link-prompt-submit"
                >
                  <Text
                    style={[
                      styles.linkPromptButtonLabel,
                      styles.linkPromptButtonLabelPrimary,
                    ]}
                  >
                    Insert
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

      </View>
    );
  },
);
ComposerV2Editor.displayName = "ComposerV2Editor";

const styles = StyleSheet.create({
  /**
   * THE SHEET. `flex: 1, minHeight: composerSheetMinHeight` — it claims the
   * space its parent gives it and is the one element that absorbs every height
   * change on the screen.
   *
   * `composerSheetMinHeight` (240) is a FLOOR ON A FLEXED CHILD, which is a
   * different object from the `Math.max(120, rawBodyHeight)` this issue
   * deletes: that was the last clamp in a chain that began by subtracting 376
   * from the viewport, and it is what stopped the body shrinking for the
   * keyboard. This participates in no subtraction and reads no viewport. When
   * the available space drops below it, the sheet overflows the flex region and
   * is CLIPPED there (Band B carries `overflow:'hidden'`); the commit bar is
   * untouched. Gate rule R10 fails the build if the identifier ever appears
   * anywhere but as a `minHeight:` value.
   *
   * `radius.lg` on ALL surfaces — native carried NO radius at all, so a square
   * bordered box sat over fully-round pills, which is the harshest geometry
   * pairing available.
   *
   * `rgba(255,255,255,0.03)` is deliberately NOT promoted to a token: it has
   * exactly one consumer, and promoting one-consumer values is how token sets
   * rot. Composites to #131519 — text.primary reads 16.93:1, text.tertiary
   * 5.65:1. At the old 0.06 the sheet composited to #1c1e21 and read as a CARD
   * SITTING ON the canvas; at 0.03 it reads as lit paper, which is what a
   * writing surface should be.
   */
  sheet: {
    flex: 1,
    minHeight: composerSheetMinHeight,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    // The scrim owns the gap to the commit bar; a margin here would double it.
    marginBottom: 0,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    overflow: "hidden",
  },
  desktopSheet: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  /** Full-bleed hairline. ONE rule, not a box. */
  sheetRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: glass.border.profileBase,
  },
  subjectRow: {
    height: 44,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  subjectInput: {
    flex: 1,
    minWidth: 0,
    // `typography.bodyLg` WITHOUT its lineHeight — see the render comment.
    fontSize: 18,
    fontWeight: "500",
    color: textTokens.primary,
    paddingVertical: 0,
  },
  subjectPersonalize: {
    height: 36,
    width: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  subjectPersonalizeActive: {
    backgroundColor: accent.tint,
  },
  subjectPersonalizePressed: {
    opacity: 0.7,
  },
  subjectPersonalizeText: {
    ...typography.monoMd,
    color: textTokens.secondary,
  },
  subjectPersonalizeTextActive: {
    color: accent.warm,
  },
  /**
   * THE BODY REGION — and the ONLY `onLayout` on this screen.
   *
   * `flex: 1, minHeight: 0` (I-AXIS-SCOPED-FLEX: every flexed axis carries an
   * explicit zero bound). No `height` key: `{ height: bodyHeight }` here is
   * exactly what this issue deletes. No border and no fill either — the sheet
   * owns the one visible boundary.
   */
  bodyHost: {
    flex: 1,
    minHeight: 0,
  },

  // F.10: Preview modal chrome — dark canvas behind the sheet, light
  // header strip with title + Done button. EmailPreviewPane fills the rest.
  previewModal: {
    flex: 1,
    backgroundColor: "#F5F5F7",
  },
  previewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ECECEE",
  },
  previewTitle: {
    ...typography.bodyLg,
    color: "#0F1115",
    fontWeight: "700",
  },
  previewDone: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  previewDonePressed: {
    opacity: 0.6,
  },
  previewDoneLabel: {
    ...typography.body,
    color: "#F47C20",
    fontWeight: "700",
  },

  // Link prompt modal — dark glass card centered over a dim backdrop.
  linkPromptBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.62)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  linkPromptCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    backgroundColor: "rgba(20, 22, 28, 0.98)",
    padding: spacing.lg,
    gap: spacing.sm,
  },
  linkPromptTitle: {
    ...typography.bodyLg,
    color: textTokens.primary,
    fontWeight: "700",
  },
  linkPromptBody: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  linkPromptInput: {
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    backgroundColor: glass.tint.profileBase,
    color: textTokens.primary,
    fontSize: 15,
    marginTop: spacing.xs,
  },
  linkPromptActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  linkPromptButton: {
    minHeight: 44,
    minWidth: 88,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
    backgroundColor: glass.tint.badge.idle,
  },
  linkPromptButtonPrimary: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  linkPromptButtonPressed: {
    opacity: 0.7,
  },
  linkPromptButtonLabel: {
    ...typography.buttonMd,
    color: textTokens.secondary,
  },
  linkPromptButtonLabelPrimary: {
    color: textTokens.primary,
  },
});
