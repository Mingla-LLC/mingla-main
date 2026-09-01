export type StudioReturnSurface = "web" | "native";

export const STUDIO_NATIVE_RETURN_URL = "mingla-business://website-return";

export function studioReturnSurface(platform: string): StudioReturnSurface {
  return platform === "web" ? "web" : "native";
}

interface StudioHandoffBindings {
  openWeb: (url: string) => Promise<unknown>;
  openNative: (url: string, returnUrl: string) => Promise<unknown>;
}

/** Opens Studio with a fixed native callback; callers cannot supply a redirect. */
export async function openStudioHandoff(
  url: string,
  surface: StudioReturnSurface,
  bindings: StudioHandoffBindings,
): Promise<void> {
  if (surface === "web") {
    await bindings.openWeb(url);
    return;
  }
  await bindings.openNative(url, STUDIO_NATIVE_RETURN_URL);
}
