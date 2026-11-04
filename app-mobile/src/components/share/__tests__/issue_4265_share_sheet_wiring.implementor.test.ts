// @ts-nocheck — Deno-runtime source-contract suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4265 — the Explorer share sheet opens at once and scrolls smoothly.
// The list rules are driven behaviourally in
// issue_4265_share_recipients_model.implementor.happy.test.ts; this suite pins
// the wiring so a revert of any call site fails CI:
//   * people and chats are a virtualised BottomSheetFlatList (never `.map` in a
//     ScrollView) with a stable key, fixed-row layout and memoised rows;
//   * the BaseBottomSheet sticky-footer path renders that list as a DIRECT child
//     (no View wrapper — ORCH-1043);
//   * filtering is memoised on the deferred search value; parsing/indexing is the
//     React Query `select`, so typing never re-runs it;
//   * recipients come from React Query under the per-user key factory (cached
//     first, refreshed on open), placeholders only through the list phase;
//   * the open path awaits nothing; prepare results wait for the open animation;
//     NetInfo and AppState are only watched while the sheet is open;
//   * avatars and the poster use expo-image with a memory+disk cache;
//   * dev timing uses the [4265-DIAG] marker behind __DEV__.
//
// FAILS-ON-REVERT: restoring `visibleRecipients.map(`, `scrollMode="scroll"`,
// `useNetInfo()`, RN `Image`, `useState<ContentShareRecipient[]>` for the list,
// or a `<View style={styles.stickyBody}>` around the FlatList fails here.

const root = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const provider = stripComments(await read("src/components/share/UnifiedShareProvider.tsx"));
const sheet = stripComments(await read("src/components/ui/BaseBottomSheet.tsx"));

Deno.test("recipients are a virtualised list with memoised rows", () => {
  assert(/scrollMode="flatlist"/.test(provider), "the sheet uses the FlatList body");
  assert(!/scrollMode="scroll"/.test(provider), "no ScrollView body");
  assert(!/Recipients\.map\(|recipients\.map\(\(recipient\) => \{|visibleRecipients\.map\(/.test(provider), "rows are never rendered with .map");
  assert(/data: listData/.test(provider) && /renderItem: renderRecipient/.test(provider), "rows come from data + renderItem");
  assert(/keyExtractor: shareRecipientKeyExtractor/.test(provider), "stable keyExtractor (recipient key)");
  assert(/getItemLayout: fixedRows \? getItemLayout : undefined/.test(provider), "fixed 60pt layout at standard text sizes");
  assert(/initialNumToRender: \d+/.test(provider) && /windowSize: \d+/.test(provider), "bounded render window");
  assert(/const RecipientRow = memo\(function RecipientRow/.test(provider), "rows are React.memo");
  assert(/const toggleRecipient = useCallback\([\s\S]*?\}, \[\]\);/.test(provider), "the row callback is stable for the provider's life");
  assert(/ListHeaderComponent: listHeader/.test(provider) && /const listHeader = useMemo\(/.test(provider), "preview + share buttons + search are a memoised list header");
});

Deno.test("BaseBottomSheet renders the sticky-footer FlatList as a direct child", () => {
  const sticky = sheet.slice(sheet.indexOf("const stickyBody ="), sheet.indexOf("const footerNode"));
  assert(/scrollMode === 'flatlist' \? \(\s*<BottomSheetFlatList/.test(sticky), "sticky path has a FlatList branch");
  assert(!/<View[^>]*>\s*<BottomSheetFlatList/.test(sticky), "no View wraps the FlatList (viewport would collapse)");
  assert(/styles\.stickyBody,/.test(sticky), "the list claims flex:1 between header and footer");
});

Deno.test("filtering is memoised on the deferred search; parsing is the query select", () => {
  assert(/const deferredSearch = useDeferredValue\(search\)/.test(provider), "search is deferred");
  assert(/useMemo\(\(\) => filterShareRecipients\(recipients, normalizedSearch\), \[normalizedSearch, recipients\]\)/.test(provider), "filter memoised on list + deferred query");
  assert(/select: indexShareRecipients/.test(provider), "indexing runs once per fetch as the React Query select");
  assert(!/toLocaleLowerCase\(\)\.includes\(/.test(provider), "no per-row lowercasing in render");
});

Deno.test("recipients live in React Query: per-user key, cached first, refreshed on open", () => {
  assert(/useQuery\(\{\s*queryKey: recipientsKey,/.test(provider), "useQuery reads the list");
  assert(/contentShareRecipientKeys\.list\(/.test(provider), "key comes from the factory");
  assert(/enabled: false/.test(provider), "nothing fetches at app start");
  assert(/queryClient\.fetchQuery\(\{ queryKey: recipientsKeyRef\.current/.test(provider), "open refreshes in the background");
  assert(!/useState<ContentShareRecipient\[\]>/.test(provider), "no second, local copy of the list");
  assert(/shareRecipientListPhase\(\{/.test(provider) && /listPhase === 'placeholder'\) return <RecipientPlaceholders/.test(provider), "placeholders only through the list phase");
  assert(/queryClient\.setQueryData<ContentShareRecipient\[\]>\(recipientsKeyRef\.current/.test(provider), "unavailable chats are removed from the cached list");
});

Deno.test("open path: nothing awaited; results wait for the animation; watchers only while open", () => {
  const open = provider.slice(provider.indexOf("const openContentShare = useCallback"), provider.indexOf("useEffect(() => { registerContentShareHandler"));
  assert(!/await /.test(open), "the open handler awaits nothing");
  assert(open.indexOf("setVisible(true)") < open.indexOf("loadShare(nextInput, token)"), "visible before any load");
  assert(/runAfterOpen\(\(\) => \{\s*if \(generation\.current === token\) \{\s*setPrepared\(value\)/.test(provider), "prepare result is applied after the open settles");
  assert(/onChange=\{handleSheetChange\}/.test(provider) && /flushAfterOpen\(\);/.test(provider), "the settle callback flushes queued results");
  assert(/setTimeout\(flushAfterOpen, OPEN_SETTLE_FALLBACK_MS\)/.test(provider), "a fallback flush if the settle callback never comes");
  assert(!/useNetInfo\(/.test(provider), "no root-level useNetInfo");
  assert(/if \(!visible\) return undefined;\s*return NetInfo\.addEventListener\(/.test(provider), "NetInfo only while open");
  assert(/if \(!visible\) return undefined;\s*const subscription = AppState\.addEventListener/.test(provider), "AppState only while open");
});

Deno.test("expo-image with a memory+disk cache for avatars and the poster", () => {
  assert(/import \{ Image as ExpoImage \} from 'expo-image';/.test(provider), "expo-image import");
  assert(!/\bImage,|, Image\b/.test(provider.slice(0, provider.indexOf("from 'react-native'"))), "no React Native Image");
  const images = provider.match(/<ExpoImage[^>]*>/g) ?? [];
  assert(images.length >= 2, "avatar and poster both use expo-image");
  for (const tag of images) {
    assert(/cachePolicy="memory-disk"/.test(tag), `cached: ${tag}`);
    assert(/recyclingKey=/.test(tag), `recycling key: ${tag}`);
  }
});

Deno.test("dev timing is behind __DEV__ with the [4265-DIAG] marker", async () => {
  const perf = stripComments(await read("src/components/share/shareSheetPerf.ts"));
  assert(/const MARKER = '\[4265-DIAG\]'/.test(perf), "marker");
  const exported = perf.match(/export function \w+\([^)]*\)[^{]*\{\s*if \(!__DEV__\) return;/g) ?? [];
  assert(exported.length === (perf.match(/export function /g) ?? []).length, "every entry point is a no-op in release");
  assert(/beginShareSheetOpen\(\);/.test(provider) && /markShareRecipientsRendered\(/.test(provider) && /onScrollBeginDrag: beginShareSheetScroll/.test(provider), "open, recipients and scroll are measured");
});
