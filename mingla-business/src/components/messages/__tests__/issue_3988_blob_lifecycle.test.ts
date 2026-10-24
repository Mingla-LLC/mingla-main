jest.mock("../../media/MediaViewer", () => ({ MediaViewer: () => null }));
jest.mock("../../../services/brandGroupFilesService", () => ({ brandGroupFilePreviewRequest: jest.fn() }));
jest.mock("react-native", () => ({ Platform: { OS: "web" } }));

import { rememberViewerObjectUrl, revokeViewerObjectUrls } from "../BrandGroupFilePreviewModal";

describe("#3988 authenticated web blob lifecycle", () => {
  it("keeps no more than the active item and two neighbours", () => {
    const urls = new Map<string, string>();
    const revokeObjectURL = jest.fn();
    const revoker = { revokeObjectURL };
    rememberViewerObjectUrl(urls, "0", "blob:0", revoker);
    rememberViewerObjectUrl(urls, "1", "blob:1", revoker);
    rememberViewerObjectUrl(urls, "2", "blob:2", revoker);
    rememberViewerObjectUrl(urls, "3", "blob:3", revoker);
    expect([...urls.values()]).toEqual(["blob:1", "blob:2", "blob:3"]);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:0");
  });

  it("refreshes recency and revokes every remaining URL on close", () => {
    const urls = new Map<string, string>();
    const revokeObjectURL = jest.fn();
    const revoker = { revokeObjectURL };
    rememberViewerObjectUrl(urls, "0", "blob:0", revoker);
    rememberViewerObjectUrl(urls, "1", "blob:1", revoker);
    rememberViewerObjectUrl(urls, "2", "blob:2", revoker);
    rememberViewerObjectUrl(urls, "0", "blob:0", revoker);
    rememberViewerObjectUrl(urls, "3", "blob:3", revoker);
    expect([...urls.keys()]).toEqual(["2", "0", "3"]);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:1");

    revokeViewerObjectUrls(urls, revoker);
    expect(urls.size).toBe(0);
    expect(new Set(revokeObjectURL.mock.calls.map(([url]) => url))).toEqual(new Set(["blob:0", "blob:1", "blob:2", "blob:3"]));
  });
});
