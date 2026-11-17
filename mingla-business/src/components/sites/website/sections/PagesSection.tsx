import React, { useMemo, useRef, useState } from "react";
import { DraftReviewCard } from "./DraftReviewCard";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useWebsite } from "../WebsiteContext";
import { Body, Card, CardTitle, Chip, Field, Hint, ListBox, MiniButton, Row, RowText, SectionHead, Toggle, WButton, ui } from "../ui";
import { WebsiteIcon } from "../WebsiteIcon";
import {
  BrandSiteContentConflict,
  useAriPageAction,
  useMinglaOfferings,
  useSetSiteMenu,
  useSitePages,
  type SitePageRow,
} from "../../../../sites/contentApi";
import { BrandSitesError } from "../../../../services/brandSitesService";
import { useComposeBrandSiteFromPlan, useSaveBrandSitePlan } from "../../../../sites/planApi";
import { PLAN_OFFERING_OPTIONS } from "../../../../../../packages/site-contracts/src/sitePlan.ts";
import { ARI_PAGE_CHIPS, ARI_PAGE_LIMITS, ariPagePrompt } from "../../../../../../packages/site-contracts/src/ariPage.ts";
import { useAriSeedStore } from "../../../../store/ariSeedStore";

const OFFERING_KIND_WORDS: Record<string, { plural: string; kind: string }> = {
  trips: { plural: "trips", kind: "trip" },
  events: { plural: "events", kind: "event" },
  experiences: { plural: "experiences", kind: "experience" },
};

/**
 * #2829 W9r (DESIGN_SPEC §1.6 Pages) — the order here is the order of the
 * site's menu. Offering pages fill themselves from Mingla; collection pages
 * are managed in Content; every other page opens in the page editor.
 */
export function PagesSection(): React.ReactElement {
  const ctx = useWebsite();
  const { controller, phone, headingRef, lock, toast } = ctx;
  const siteId = controller.siteId;
  const pages = useSitePages(siteId);
  const offerings = useMinglaOfferings(siteId);
  const setMenu = useSetSiteMenu(siteId);
  const [reorder, setReorder] = useState(false);
  const [adding, setAdding] = useState(false);
  const [askingAri, setAskingAri] = useState(false);
  const ariAddPage = ctx.plan?.ariAddPage === true;
  const readOnly = lock.heldByOther;
  const focusAfterMove = useRef<string | null>(null);

  const rows = pages.data?.pages ?? [];
  const menuIds = useMemo(() => rows.filter((row) => row.in_menu && !row.in_group && row.path !== "").map((row) => row.id), [rows]);

  const upcoming = (kind: string) => (offerings.data ?? []).filter((row) => row.kind === kind && !row.ended).length;

  const sourceLine = (row: SitePageRow): string => {
    if (row.path === "") return "Page";
    // #4453 milestone 11 — a page Ari added, hidden until the owner publishes it.
    if (row.origin === "ari" && row.ari_draft) {
      const count = row.review_count ?? 0;
      return `Draft · by Ari · ${count} ${count === 1 ? "section" : "sections"} to review · hidden from visitors`;
    }
    const collection = row.collection_kind ?? row.planned_offering;
    if (collection && OFFERING_KIND_WORDS[collection]) {
      const words = OFFERING_KIND_WORDS[collection]!;
      const count = upcoming(words.kind);
      return count > 0
        ? `From your Mingla ${words.plural} · ${count} upcoming`
        : `From your Mingla ${words.plural} · none yet · empty, so hidden from search until filled`;
    }
    if (row.collection_kind === "destinations") return "Destinations collection";
    if (row.collection_kind === "stories") return "Stories collection";
    if (/(^|\/)contact/.test(row.path ?? "")) return "Page · messages go to Messages › Customer enquiries";
    return row.enabled ? "Page" : "Page · switched off";
  };

  const saveMenu = (next: string[], announce?: string) => {
    if (!pages.data) return;
    setMenu.mutate({ pageIds: next, revision: pages.data.revision }, {
      onSuccess: () => {
        if (announce) toast(announce, "success");
      },
      onError: (error) => toast(error instanceof BrandSiteContentConflict
        ? `${error.latest.updatedByName ?? "Someone"} changed the menu just now. Here is the latest.`
        : error instanceof BrandSitesError ? error.message : "The menu didn’t save. Try again.", "error"),
    });
  };

  const move = (id: string, delta: -1 | 1) => {
    const index = menuIds.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= menuIds.length) return;
    const next = [...menuIds];
    [next[index], next[target]] = [next[target]!, next[index]!];
    focusAfterMove.current = `${id}:${delta}`;
    const row = rows.find((entry) => entry.id === id);
    saveMenu(next, `${row?.title ?? "Page"} moved to position ${target + 2}`);
  };

  const toggleMenu = (row: SitePageRow, on: boolean) => {
    saveMenu(on ? [...menuIds, row.id] : menuIds.filter((id) => id !== row.id));
  };

  const manageTarget = (row: SitePageRow) => (row.collection_kind === "destinations" ? "destinations" : row.collection_kind === "stories" ? "stories" : null);

  const wordmark = pages.data?.wordmark ?? ctx.brandName;
  const menuLabels = menuIds.map((id) => rows.find((row) => row.id === id)?.title ?? "").filter(Boolean);

  return (
    <View testID="website-pages">
      <SectionHead
        ref={headingRef}
        phone={phone}
        title="Pages"
        subtitle="The order here is the order of your menu. Pages for things you offer fill themselves from Mingla."
        right={(
          <>
            {phone ? <WButton label={reorder ? "Done" : "Reorder"} size="sm" onPress={() => setReorder((value) => !value)} testID="pages-reorder" /> : null}
            {ariAddPage ? <WButton label="Add a page with Ari" icon="msg" onPress={() => setAskingAri(true)} disabled={readOnly} testID="pages-add-ari" /> : null}
            <WButton label="Add a page" icon="plus" onPress={() => setAdding(true)} disabled={readOnly} testID="pages-add" />
          </>
        )}
      />
      {/* #4453 — Draft sections and "Looks right". */}
      <DraftReviewCard siteId={siteId} proofEnabled={ctx.plan?.proofEnabled === true} readOnly={readOnly} mode="pages" toast={toast} />
      {pages.isLoading ? <Hint>Loading your pages…</Hint> : pages.isError ? (
        <Card>
          <CardTitle>Your pages couldn&apos;t be loaded</CardTitle>
          <WButton label="Try again" size="sm" onPress={() => { void pages.refetch(); }} />
        </Card>
      ) : (
        <>
          <ScrollView horizontal style={styles.menuPreview} contentContainerStyle={styles.menuPreviewInner} accessibilityLabel="Menu preview" showsHorizontalScrollIndicator={false}>
            <Text style={styles.menuLogo} numberOfLines={1}>{wordmark}</Text>
            {menuLabels.map((label) => <Text key={label} style={styles.menuItem}>{label}</Text>)}
          </ScrollView>
          <Text style={styles.help}>Menu preview at desktop width. On phones it folds into a menu button.</Text>
          <ListBox>
            {rows.map((row) => {
              const isHome = row.path === "";
              const menuIndex = menuIds.indexOf(row.id);
              const showControls = !phone || reorder;
              const target = manageTarget(row);
              return (
                <Row key={row.id} testID={`page-row-${row.path || "home"}`}>
                  {!phone ? <View style={styles.handle}><WebsiteIcon name="drag" size={16} color={ui.t4} /></View> : null}
                  <View style={styles.grow}>
                    <View style={styles.titleRow}>
                      <Text style={styles.title}>{row.title}</Text>
                      {isHome ? <Chip label="Always first" /> : null}
                    </View>
                    <Text style={styles.sub}>{`${sourceLine(row)}${row.in_group ? " · in a drop-down of your menu (arrange it in the page editor)" : ""}`}</Text>
                  </View>
                  {!isHome && showControls && row.in_menu && !row.in_group ? (
                    <View style={styles.minis}>
                      <MiniButton icon="up" label={`Move ${row.title} up`} onPress={() => move(row.id, -1)} disabled={menuIndex <= 0 || readOnly || setMenu.isPending} testID={`page-up-${row.path}`} />
                      <MiniButton icon="down" label={`Move ${row.title} down`} onPress={() => move(row.id, 1)} disabled={menuIndex < 0 || menuIndex >= menuIds.length - 1 || readOnly || setMenu.isPending} testID={`page-down-${row.path}`} />
                    </View>
                  ) : null}
                  {!phone || reorder ? (
                    <View style={styles.menuToggle}>
                      {!phone ? <Hint>In menu</Hint> : null}
                      <Toggle
                        value={isHome || row.in_menu}
                        onChange={(on) => toggleMenu(row, on)}
                        label={`Show ${row.title} in the menu`}
                        disabled={isHome || row.in_group || readOnly || setMenu.isPending}
                        testID={`page-menu-${row.path || "home"}`}
                      />
                    </View>
                  ) : null}
                  {target ? (
                    <WButton label="Manage" size="sm" onPress={() => ctx.go({ kind: "section", section: target })} testID={`page-manage-${row.path}`} />
                  ) : (
                    <WButton label="Edit" size="sm" onPress={() => controller.actions.openStudio(row.id)} loading={controller.isOpeningStudio} testID={`page-edit-${row.path || "home"}`} />
                  )}
                </Row>
              );
            })}
          </ListBox>
          {/* #4453 milestone 11 — Draft pages from Ari: the owner-only questions, Publish this page and Remove. */}
          {rows.filter((row) => row.origin === "ari" && row.ari_draft).map((row) => (
            <AriDraftPageCard key={`ari-${row.id}`} row={row} readOnly={readOnly} />
          ))}
          {pages.data && pages.data.footer_links.length > 0 ? (
            <>
              <Text style={styles.group} role="heading" aria-level={2}>Footer only</Text>
              <ListBox>
                {pages.data.footer_links.map((link) => {
                  const page = rows.find((row) => row.path !== null && link.href.replace(/^\/+/, "") === row.path);
                  return (
                    <Row key={`${link.label}${link.href}`}>
                      <RowText title={link.label} lines={["Linked from every page's footer"]} />
                      <WButton label="Edit" size="sm" onPress={() => controller.actions.openStudio(page?.id ?? null)} />
                    </Row>
                  );
                })}
              </ListBox>
            </>
          ) : null}
          <Text style={styles.help}>&quot;Edit&quot; opens the page editor for that page&apos;s words and photos. Trip and event cards always link to their Mingla pages and checkout.</Text>
        </>
      )}
      <AddPageDialog visible={adding} onClose={() => setAdding(false)} />
      <AskAriForPageSheet visible={askingAri} onClose={() => setAskingAri(false)} />
    </View>
  );
}

function AddPageDialog({ visible, onClose }: { visible: boolean; onClose: () => void }): React.ReactElement {
  const ctx = useWebsite();
  const save = useSaveBrandSitePlan(ctx.brandId);
  const compose = useComposeBrandSiteFromPlan(ctx.brandId);
  const plan = ctx.plan;
  const ticked = new Set(ctx.offerings);
  const options = PLAN_OFFERING_OPTIONS.filter((option) => !option.venue && !ticked.has(option.key));
  const canAdd = plan?.canManage === true;
  const busy = save.isPending || compose.isPending;
  const add = (key: string, label: string) => {
    if (!plan) return;
    save.mutate({ revision: plan.plan?.revision ?? 0, patch: { offerings_selected: [...ticked, key] } }, {
      onSuccess: () => compose.mutate(undefined, {
        onSuccess: () => {
          onClose();
          ctx.toast(`${label} page added. It's hidden from search until your first ${label === "Trips" ? "trip" : label === "Events" ? "event" : "one"}.`, "success");
        },
        onError: (error) => ctx.toast(error instanceof BrandSitesError ? error.message : "The page wasn’t added. Try again.", "error"),
      }),
      onError: (error) => ctx.toast(error instanceof BrandSitesError ? error.message : "The page wasn’t added. Try again.", "error"),
    });
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" role="button">
        <Pressable style={styles.dialog} role="dialog" aria-modal accessibilityLabel="Add a page" onPress={() => undefined}>
          <Text style={styles.dialogTitle} role="heading">Add a page</Text>
          <Body>Pages for things you offer fill themselves from Mingla. Or add a page of your own words.</Body>
          <View style={styles.dialogList}>
            {options.map((option) => (
              <Row key={option.key}>
                <RowText title={option.label} lines={[`From your Mingla ${option.label.toLowerCase()} · shows an honest "nothing on yet" sign-up until your first one`]} />
                {canAdd
                  ? <WButton label={`Add ${option.label} page`} size="sm" onPress={() => add(option.key, option.label)} loading={busy} testID={`add-page-${option.key}`} />
                  : <WButton label="Ask an admin" icon="msg" size="sm" onPress={() => ctx.askAdmin("plan")} loading={ctx.asking} />}
              </Row>
            ))}
            <Row>
              <RowText title="A page of your own words" lines={["Opens the page editor, where you name it and write it"]} />
              <WButton label="Open the page editor" size="sm" onPress={() => { onClose(); ctx.controller.actions.openStudio(); }} testID="add-page-own" />
            </Row>
          </View>
          <View style={styles.dialogActions}>
            <WButton label="Cancel" onPress={onClose} testID="add-page-cancel" />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * #4453 milestone 11 (spec v2.1 §3.5) — "Add a page with Ari": the owner picks
 * a chip or types a topic; Ari opens with the request in the composer, focused.
 * Sending stays the owner's tap. No "Gift ideas" chip (N7).
 */
function AskAriForPageSheet({ visible, onClose }: { visible: boolean; onClose: () => void }): React.ReactElement {
  const ctx = useWebsite();
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const open = (text: string) => {
    useAriSeedStore.getState().setSeed(ariPagePrompt(text));
    setTopic("");
    onClose();
    router.push(`/(tabs)/ari?brandId=${encodeURIComponent(ctx.brandId)}&sitesIntent=edit` as never);
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" role="button">
          <Pressable style={styles.dialog} role="dialog" aria-modal accessibilityLabel="Add a page with Ari" onPress={() => undefined} testID="ari-page-sheet">
            <Text style={styles.dialogTitle} role="heading">Add a page with Ari</Text>
            <Body>Tell Ari what the page is about. Ari shows you a plan first, and the page is added hidden, as a Draft, until you publish it.</Body>
            <View style={styles.chips}>
              {ARI_PAGE_CHIPS.map((chip) => (
                <WButton key={chip} label={chip} size="sm" onPress={() => open(chip)} testID={`ari-page-chip-${chip.toLowerCase().replace(/[^a-z]+/g, "-")}`} />
              ))}
            </View>
            <Field label="Or describe the page" value={topic} onChangeText={setTopic} max={120} placeholder="For example: our tasting menu nights" testID="ari-page-topic" />
            <Text style={styles.help}>Ari won&apos;t guess prices, people or policies. Bookings and payments always go through Mingla.</Text>
            <View style={styles.dialogActions}>
              <WButton label="Cancel" onPress={onClose} testID="ari-page-cancel" />
              <WButton label="Ask Ari" icon="msg" onPress={() => open(topic)} disabled={!topic.trim()} testID="ari-page-ask" />
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** #4453 milestone 11 (spec v2.1 §3.2-§3.3) — one Draft page from Ari: its questions, Publish this page, Remove. */
function AriDraftPageCard({ row, readOnly }: { row: SitePageRow; readOnly: boolean }): React.ReactElement {
  const ctx = useWebsite();
  const action = useAriPageAction(ctx.controller.siteId);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<"publish" | "remove" | null>(null);
  const questions = row.owner_questions ?? [];
  const fail = (error: unknown, fallback: string) => ctx.toast(error instanceof BrandSitesError ? error.message : fallback, "error");
  const save = (key: string) => {
    const answer = (answers[key] ?? "").trim();
    if (!answer) return;
    action.mutate({ kind: "answer", pageId: row.id, questionKey: key, answer }, {
      onSuccess: () => {
        setAnswers((current) => ({ ...current, [key]: "" }));
        ctx.toast("Saved to the Draft page.", "success");
      },
      onError: (error) => fail(error, "Your answer didn’t save. Try again."),
    });
  };
  const confirm = () => {
    if (confirming === "publish") {
      action.mutate({ kind: "accept", pageId: row.id }, {
        onSuccess: () => {
          setConfirming(null);
          ctx.toast(`${row.title} is ready. Publish your website to put it live.`, "success");
          ctx.go({ kind: "section", section: "publish" });
        },
        onError: (error) => fail(error, "The page wasn’t published. Try again."),
      });
    } else if (confirming === "remove") {
      action.mutate({ kind: "remove", pageId: row.id }, {
        onSuccess: () => {
          setConfirming(null);
          ctx.toast(`${row.title} removed.`, "success");
        },
        onError: (error) => fail(error, "The page wasn’t removed. Try again."),
      });
    }
  };
  return (
    <Card>
      <View style={styles.titleRow}>
        <CardTitle>{row.title}</CardTitle>
        <Chip label="Draft · by Ari" />
      </View>
      {row.ari_request ? <Text style={styles.sub}>{`You asked: “${row.ari_request}”`}</Text> : null}
      {questions.length ? (
        <View style={styles.questions} testID={`ari-needs-${row.path}`}>
          <Text style={styles.group} role="heading" aria-level={3}>Ari needs this</Text>
          <Text style={styles.help}>Only you see these questions. Anything you leave blank stays hidden from visitors.</Text>
          {questions.map((question) => (
            <View key={question.key} style={styles.question}>
              <Field
                label={question.question}
                value={answers[question.key] ?? ""}
                onChangeText={(text) => setAnswers((current) => ({ ...current, [question.key]: text }))}
                max={ARI_PAGE_LIMITS.answer}
                placeholder={question.placeholder}
                editable={!readOnly}
                testID={`ari-answer-${question.key}`}
              />
              <WButton label="Save" size="sm" onPress={() => save(question.key)} disabled={readOnly || !(answers[question.key] ?? "").trim()} loading={action.isPending} testID={`ari-answer-save-${question.key}`} />
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.cardActions}>
        <WButton label="Remove" size="sm" onPress={() => setConfirming("remove")} disabled={readOnly} testID={`ari-remove-${row.path}`} />
        <WButton label="Edit" size="sm" onPress={() => ctx.controller.actions.openStudio(row.id)} loading={ctx.controller.isOpeningStudio} />
        <WButton label="Publish this page" size="sm" onPress={() => setConfirming("publish")} disabled={readOnly} testID={`ari-publish-${row.path}`} />
      </View>
      <Modal visible={confirming !== null} transparent animationType="fade" onRequestClose={() => setConfirming(null)}>
        <Pressable style={styles.scrim} onPress={() => setConfirming(null)} accessibilityLabel="Close" role="button">
          <Pressable style={styles.dialog} role="dialog" aria-modal accessibilityLabel={confirming === "remove" ? "Remove this page" : "Publish this page"} onPress={() => undefined} testID="ari-confirm-sheet">
            <Text style={styles.dialogTitle} role="heading">{confirming === "remove" ? `Remove ${row.title}?` : `Publish ${row.title}?`}</Text>
            {confirming === "remove" ? (
              <Body>The Draft page and its menu entry are removed. Your website&apos;s history keeps a copy.</Body>
            ) : (
              <>
                <Body>{`This marks its ${row.review_count ?? 0} ${row.review_count === 1 ? "section" : "sections"} as reviewed and switches the page on. It goes live with your next website publish.`}</Body>
                {questions.length ? <Text style={styles.help}>{`${questions.length} ${questions.length === 1 ? "question" : "questions"} unanswered. Those rows stay hidden.`}</Text> : null}
              </>
            )}
            <View style={styles.dialogActions}>
              <WButton label="Cancel" onPress={() => setConfirming(null)} testID="ari-confirm-cancel" />
              <WButton label={confirming === "remove" ? "Remove" : "Publish this page"} onPress={confirm} loading={action.isPending} testID="ari-confirm-go" />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12, marginBottom: 12 },
  questions: { marginTop: 12, gap: 10 },
  question: { gap: 6 },
  cardActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end", marginTop: 14 },
  grow: { flex: 1, minWidth: 150 },
  handle: { width: 16 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  title: { fontSize: 14, fontWeight: "600", color: ui.t1 },
  sub: { fontSize: 12.5, lineHeight: 17, color: ui.t3 },
  minis: { flexDirection: "row", gap: 4 },
  menuToggle: { flexDirection: "row", alignItems: "center", gap: 8 },
  menuPreview: { borderRadius: 12, backgroundColor: "#ffffff", flexGrow: 0 },
  menuPreviewInner: { flexDirection: "row", alignItems: "center", gap: 18, paddingVertical: 12, paddingHorizontal: 16, minWidth: "100%" },
  menuLogo: { fontSize: 20, color: "#124e70", marginRight: "auto", fontWeight: "700" },
  menuItem: { fontSize: 13, fontWeight: "600", color: "#131c26" },
  help: { fontSize: 12, lineHeight: 16, color: ui.t3, marginTop: 6, marginBottom: 14 },
  group: { fontSize: 15, fontWeight: "600", color: ui.t1, marginTop: 24, marginBottom: 8 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 16 },
  dialog: { width: "100%", maxWidth: 560, backgroundColor: "#16181c", borderWidth: 1, borderColor: ui.border2, borderRadius: 24, padding: 20, ...(Platform.OS === "web" ? { cursor: "default" } : {}) } as object,
  dialogTitle: { fontSize: 18, lineHeight: 24, fontWeight: "700", color: ui.t1, marginBottom: 6 },
  dialogList: { marginTop: 12, borderWidth: 1, borderColor: ui.cardBorder, borderRadius: 16, overflow: "hidden" },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 8, marginTop: 16 },
});
