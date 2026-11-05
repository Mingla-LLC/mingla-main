/**
 * #4271: Stripe Terminal's library declares minSdk 26; the app's manifest merge
 * fails below that. The real merge proof lives in the issue evidence; this pins
 * that the plugin stays wired into the app config and writes the property.
 */
const { ensureMinSdkProperty } = require("../../../plugins/withAndroidMinSdk26");

const property = (key: string, value: string) => ({ type: "property", key, value });

describe("#4271 Android minSdk for Stripe Terminal", () => {
  test("adds android.minSdkVersion=26 when the property is absent", () => {
    const out = ensureMinSdkProperty([property("android.useAndroidX", "true")]);
    expect(out).toContainEqual(property("android.minSdkVersion", "26"));
  });

  test("raises a lower value and keeps a higher one", () => {
    expect(ensureMinSdkProperty([property("android.minSdkVersion", "24")])).toEqual([
      property("android.minSdkVersion", "26"),
    ]);
    expect(ensureMinSdkProperty([property("android.minSdkVersion", "28")])).toEqual([
      property("android.minSdkVersion", "28"),
    ]);
  });

  test("the business app config applies the plugin", () => {
    const appConfig = require("../../../app.config.js") as (context: {
      config: Record<string, unknown>;
    }) => { plugins: unknown[] };
    const { plugins } = appConfig({ config: { plugins: [], extra: {} } });
    expect(plugins).toContain("./plugins/withAndroidMinSdk26");
  });
});
