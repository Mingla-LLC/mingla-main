import {
  rememberViewerObjectUrl,
  revokeViewerObjectUrls,
  revokeViewerObjectUrlsOutsideWindow,
} from "../BrandGroupFilePreviewModal";

jest.mock("../../media/MediaViewer", () => ({ MediaViewer: () => null }));
jest.mock("../../../services/brandGroupFilesService", () => ({ brandGroupFilePreviewRequest: jest.fn() }));
jest.mock("react-native", () => ({ Platform: { OS: "web" } }));

const items = Array.from({ length: 7 }, (_, index) => ({ fileId: String(index) }));

describe("#3988 authenticated web blob lifecycle", () => {
  it("revokes outside active plus or minus one immediately after a jump", () => {
    const urls = new Map<string, string>();
    const revokeObjectURL = jest.fn();
    const revoker = { revokeObjectURL };
    rememberViewerObjectUrl(urls, "0", "blob:0", revoker);
    rememberViewerObjectUrl(urls, "1", "blob:1", revoker);
    rememberViewerObjectUrl(urls, "2", "blob:2", revoker);
    rememberViewerObjectUrl(urls, "5", "blob:5", revoker);

    revokeViewerObjectUrlsOutsideWindow(urls, items, 5, revoker);

    expect([...urls.keys()]).toEqual(["5"]);
    expect(new Set(revokeObjectURL.mock.calls.map(([url]) => url))).toEqual(new Set(["blob:0", "blob:1", "blob:2"]));
  });

  it("retains only neighbouring blobs and revokes every remaining URL on close", () => {
    const urls = new Map<string, string>();
    const revokeObjectURL = jest.fn();
    const revoker = { revokeObjectURL };
    rememberViewerObjectUrl(urls, "0", "blob:0", revoker);
    rememberViewerObjectUrl(urls, "1", "blob:1", revoker);
    rememberViewerObjectUrl(urls, "2", "blob:2", revoker);
    rememberViewerObjectUrl(urls, "3", "blob:3", revoker);
    revokeViewerObjectUrlsOutsideWindow(urls, items, 2, revoker);
    expect([...urls.keys()]).toEqual(["1", "2", "3"]);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:0");

    revokeViewerObjectUrls(urls, revoker);
    expect(urls.size).toBe(0);
    expect(new Set(revokeObjectURL.mock.calls.map(([url]) => url))).toEqual(new Set(["blob:0", "blob:1", "blob:2", "blob:3"]));
  });
});
