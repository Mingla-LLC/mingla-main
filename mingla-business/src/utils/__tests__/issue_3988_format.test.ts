import { formatFileSize, formatMediaDuration } from "../formatMediaDuration";

describe("#3988 media metadata formatting", () => {
  it("formats known durations and withholds invalid durations", () => {
    expect(formatMediaDuration(0)).toBe("0:00");
    expect(formatMediaDuration(65_000)).toBe("1:05");
    expect(formatMediaDuration(3_665_000)).toBe("1:01:05");
    expect(formatMediaDuration(null)).toBeNull();
    expect(formatMediaDuration(-1)).toBeNull();
  });

  it("formats byte sizes through the locale-owned units", () => {
    const translate = jest.fn((key: "format.kb" | "format.mb", { n }: { n: string | number }) => `${key}:${n}`);
    expect(formatFileSize(512, translate)).toBe("format.kb:1");
    expect(formatFileSize(1_572_864, translate)).toBe("format.mb:1.5");
    expect(translate).toHaveBeenCalledWith("format.mb", { n: "1.5" });
  });
});
