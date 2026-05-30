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
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from "react-native";
import { RichEditor, actions, type RichEditorHandle } from "./richEditor";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import { Input } from "../../ui/Input";
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

    // Stage F.7b: compute a concrete numeric height for pell's WebView.
    // Pell's WebView with `flex:1` collapses to 0 height inside a flex
    // parent on iOS — well-known pell gotcha. The fix is an explicit
    // pixel height. We subtract estimated chrome (header + who + subject +
    // tooltip + when + compliance + bar + footer + safe area) from
    // window height. The arithmetic is approximate but errs toward the
    // body being TALL (clamps to a 220pt minimum so it's always
    // usable on small screens like SE).
    const { height: windowHeight } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    // F.9e: track keyboard height so the body shrinks when the keyboard
    // appears — keeps the footer (Send now / Review) ALWAYS visible
    // above the keyboard instead of hidden behind it. KAV's padding
    // approach didn't work because the body has a fixed numeric height
    // (which it needs for pell-on-iOS tap reliability); explicit
    // shrink-on-keyboard is the workaround.
    const [keyboardHeight, setKeyboardHeight] = useState(0);
    useEffect(() => {
      const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
      const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
      const show = Keyboard.addListener(showEvt, (e) => {
        setKeyboardHeight(e.endCoordinates.height);
      });
      const hide = Keyboard.addListener(hideEvt, () => {
        setKeyboardHeight(0);
      });
      return () => {
        show.remove();
        hide.remove();
      };
    }, []);

    // F.9f: 376 (was 344). Operator wants body shorter + more bottom
    // breathing room. Footer paddingBottom grew +8pt (md → lg), and
    // we tack on another 24pt of intentional body-shrink so the card
    // stops touching the home-indicator area visually. Body now claims
    // ~400pt on iPhone Pro (was ~432pt) — still very usable.
    const CHROME_CONTENT_PX = 376;
    const rawBodyHeight =
      windowHeight - insets.top - insets.bottom - CHROME_CONTENT_PX - keyboardHeight;
    const bodyHeight = isWideDesktop
      ? Math.max(400, Math.min(rawBodyHeight - 44, 700))
      : Math.max(
          120, // F.9e: keyboard-up minimum (small but still usable to see what
          //         was just typed). When keyboard's closed, body is ~432pt.
          rawBodyHeight,
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
      <View style={styles.host}>
        {/* Subject row + mini-personalize.
            F.9k: subject input swapped to canonical `Input` primitive from
            the design system (src/components/ui/Input.tsx). The bespoke
            TextInput was spreading `typography.body` which injected a
            `lineHeight` value; iOS treats TextInput lineHeight as
            line-box height and drifts the baseline downward, clipping
            descenders (the "bar cutting off text" the operator kept
            seeing). The canonical Input deliberately omits lineHeight
            and centers via container `alignItems:'center'` +
            `paddingVertical:0` neutralisation — exactly the fix needed.
            Fixed 48pt height; placeholder/typed text both centered. */}
        <View style={styles.subjectRow}>
          <View style={styles.subjectInputWrap}>
            <Input
              value={subject}
              onChangeText={onSubjectChange}
              onSelectionChange={onSubjectSelectionChange}
              disabled={!editable}
              placeholder="Subject"
              accessibilityLabel="Email subject"
              testID="composer-v2-subject"
            />
          </View>
          <Pressable
            onPress={() => setSubjectPersonalizeOpen((v) => !v)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Insert personalization token into subject"
            accessibilityState={{ expanded: subjectPersonalizeOpen }}
            style={({ pressed }) => [
              styles.subjectPersonalize,
              isWideDesktop ? styles.desktopSubjectPersonalize : null,
              subjectPersonalizeOpen ? styles.subjectPersonalizeActive : null,
              isWideDesktop && subjectPersonalizeOpen
                ? styles.desktopSubjectPersonalizeActive
                : null,
              pressed ? styles.subjectPersonalizePressed : null,
            ]}
            testID="composer-v2-subject-personalize"
          >
            <Text style={styles.subjectPersonalizeText}>{"{ }"}</Text>
          </Pressable>
        </View>

        {subjectPersonalizeOpen ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.subjectTokenRow}
            accessibilityLabel="Subject personalization tokens"
          >
            {subjectTokens.map((opt) => (
              <Pressable
                key={opt.token}
                onPress={() => handleSubjectInsertToken(opt.token)}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel={`Insert ${opt.label} into subject`}
                style={({ pressed }) => [
                  styles.subjectTokenChip,
                  pressed ? styles.subjectTokenChipPressed : null,
                ]}
                testID={`composer-v2-subject-token-${opt.token}`}
              >
                <Text style={styles.subjectTokenChipText}>{opt.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {/* F.9 merged toolbar — sits between subject and body.
            6 pills (B / I / Link | + Event / { } Personalize / ⋮)
            + inline panels (events scroller, personalize grid, overflow). */}
        <InsertionBar
          state={barState}
          onStateChange={setBarState}
          events={brandEvents}
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

        {/* F.9n DEFINITIVE TAP FIX (replaces F.9):
            The prior F.9 wrapped the RichEditor in a <Pressable onPress=
            {focusContentEditor}>. The Pressable claimed the iOS gesture
            responder BEFORE the WKWebView, so native taps never reached
            the contenteditable — meaning iOS's first-responder + system
            keyboard never engaged. The programmatic focusContentEditor()
            posted a focus message into pell, but WKWebView's keyboard
            display path is unreliable when focus did not originate from
            a real touch on the WebView itself.

            The original justification for the Pressable (overflow:hidden
            + borderRadius eating taps) was already moot: both styles had
            already been dropped from bodyHost in the same stage. So the
            Pressable was solving a problem that no longer exists.

            F.9n: replace the Pressable with a plain <View>. Tap goes
            directly to WKWebView. WKWebView focuses the contenteditable
            natively. iOS keyboard appears. No bridge involvement. */}
        <View
          style={[
            styles.bodyHost,
            isWideDesktop ? styles.desktopBodyHost : null,
            { height: bodyHeight },
          ]}
          testID="composer-v2-body-host"
          accessibilityLabel="Tap to start writing"
        >
          <RichEditor
            ref={richEditorRef}
            initialContentHTML={initialContentHtml}
            editorInitializedCallback={handleEditorInitialized}
            onChange={handleBodyHtmlChange}
            placeholder="Write your message…"
            useContainer={false}
            initialHeight={bodyHeight}
            style={{ height: bodyHeight }}
            editorStyle={{
              backgroundColor: "transparent",
              color: textTokens.primary,
              placeholderColor: "rgba(255, 255, 255, 0.62)",
              contentCSSText:
                "font-size: 15px; line-height: 1.55; padding: 12px; min-height: 100%;",
            }}
            disabled={!editable}
          />
        </View>

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
  // Stage F.7b: editor canvas no longer claims flex:1 — the body has
  // an explicit numeric height computed from windowHeight, so the
  // editor's overall height is the sum of its children (subject row +
  // tooltip + bodyHost). This sizes correctly in any parent layout.
  host: {
    backgroundColor: "transparent",
  },
  subjectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  // F.9k: wrapper so the canonical Input (fixed 48pt height + own border)
  // flexes alongside the personalize chip.
  subjectInputWrap: {
    flex: 1,
  },
  subjectPersonalize: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
    backgroundColor: glass.tint.badge.idle,
  },
  subjectPersonalizeActive: {
    backgroundColor: glass.tint.profileElevated,
  },
  desktopSubjectPersonalize: {
    backgroundColor: "transparent",
    borderColor: "rgba(255, 255, 255, 0.13)",
  },
  desktopSubjectPersonalizeActive: {
    backgroundColor: "transparent",
    borderColor: accent.border,
  },
  subjectPersonalizePressed: {
    opacity: 0.7,
  },
  subjectPersonalizeText: {
    ...typography.monoMd,
    color: textTokens.secondary,
  },
  subjectTokenRow: {
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  subjectTokenChip: {
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  subjectTokenChipPressed: {
    opacity: 0.7,
  },
  subjectTokenChipText: {
    ...typography.monoMd,
    color: textTokens.primary,
  },
  // Body region — clearly visible card on the dark canvas. flex:1 so it
  // claims all remaining height in the editor's host. Background uses
  // glass.tint.profileElevated (~6% white) for a noticeable boundary;
  // border is the profileElevated stroke for a defined edge.
  bodyHost: {
    // F.9 tap-fix + F.9b even rhythm.
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    marginBottom: 0, // footer provides the bottom gap; no double margin
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    backgroundColor: glass.tint.profileElevated,
  },
  desktopBodyHost: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    borderColor: "rgba(255, 255, 255, 0.11)",
    backgroundColor: "rgba(8, 9, 12, 0.52)",
    overflow: "hidden",
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
