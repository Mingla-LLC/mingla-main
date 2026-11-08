/**
 * #4304 — media speed (D), web. The browser build does not make a local
 * poster; a just-sent video keeps the play-icon tile until the server
 * thumbnail is ready. The native file makes one with expo-video.
 */
export async function generateBrandGroupVideoPoster(_uri: string): Promise<object | null> {
  return null;
}
