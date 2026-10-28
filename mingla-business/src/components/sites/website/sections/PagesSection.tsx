import React, { useMemo, useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useWebsite } from "../WebsiteContext";
import { Body, Card, CardTitle, Chip, Hint, ListBox, MiniButton, Row, RowText, SectionHead, Toggle, WButton, ui } from "../ui";
import { WebsiteIcon } from "../WebsiteIcon";
import {
  BrandSiteContentConflict,
  useMinglaOfferings,
  useSetSiteMenu,
  useSitePages,
  type SitePageRow,
} from "../../../../sites/contentApi";
import { BrandSitesError } from "../../../../services/brandSitesService";
import { useComposeBrandSiteFromPlan, useSaveBrandSitePlan } from "../../../../sites/planApi";
import { PLAN_OFFERING_OPTIONS } from "../../../../../../packages/site-contracts/src/sitePlan.ts";

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
  const readOnly = lock.heldByOther;
  const focusAfterMove = useRef<string | null>(null);

  const rows = pages.data?.pages ?? [];
  const menuIds = useMemo(() => rows.filter((row) => row.in_menu && !row.in_group && row.path !== "").map((row) => row.id), [rows]);

  const upcoming = (kind: string) => (offerings.data ?? []).filter((row) => row.kind === kind && !row.ended).length;

  const sourceLine = (row: SitePageRow): string => {
    if (row.path === "") return "Page";
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
            <WButton label="Add a page" icon="plus" onPress={() => setAdding(true)} disabled={readOnly} testID="pages-add" />
          </>
        )}
      />
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

const styles = StyleSheet.create({
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
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", marginTop: 16 },
});
