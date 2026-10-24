import fs from "node:fs";
import path from "node:path";

const mediaDir = path.resolve(__dirname, "..");
const viewer = fs.readFileSync(path.join(mediaDir, "MediaViewer.tsx"), "utf8");
const shell = fs.readFileSync(path.join(mediaDir, "MediaViewerShell.tsx"), "utf8");
const preview = fs.readFileSync(path.resolve(mediaDir, "../messages/BrandGroupFilePreviewModal.tsx"), "utf8");

describe("#3988 media viewer component matrix", () => {
  it("owns web and native paging with exactly one active video player", () => {
    expect(viewer).toContain('Platform.OS === "web"');
    expect(viewer).toContain("horizontal");
    expect(viewer).toContain("pagingEnabled");
    expect(viewer).toContain("active={item.fileId === current.fileId}");
    expect((viewer.match(/<ActiveVideo/g) ?? []).length).toBe(1);
  });

  it("owns Escape, native back, safe-area geometry and focus restoration", () => {
    expect(shell).toContain("mediaViewerKeyAction");
    expect(shell).toContain("onRequestClose");
    expect(shell).toContain("useSafeAreaInsets");
    expect(shell).toContain("opener?.focus?.()");
    expect(shell).toContain("fontScale");
  });

  it("keeps every viewer action at least 44pt and lets bars grow", () => {
    expect(viewer).toMatch(/circle:\s*\{ width: 44, height: 44/);
    expect(viewer).toMatch(/action:\s*\{ minHeight: 44/);
    expect(viewer).toMatch(/arrow:\s*\{ width: 44, height: 44/);
    expect(viewer).toMatch(/stripItem:\s*\{ width: 44, minHeight: 44/);
    expect(viewer).toMatch(/topRow:\s*\{ minHeight: 56/);
    expect(viewer).toMatch(/bottom:\s*\{ minHeight: 72/);
    expect(viewer).not.toMatch(/topRow:\s*\{ height:/);
    expect(viewer).not.toMatch(/bottom:\s*\{ height:/);
  });

  it("wires authenticated browser download, iOS share and Android save", () => {
    expect(viewer).toContain('document.createElement("a")');
    expect(viewer).toContain("Share.share");
    expect(viewer).toContain("StorageAccessFramework.requestDirectoryPermissionsAsync");
    expect(preview).toContain("brandGroupFilePreviewRequest(fileId)");
    expect(preview).toContain("revokeViewerObjectUrlsOutsideWindow");
  });
});
