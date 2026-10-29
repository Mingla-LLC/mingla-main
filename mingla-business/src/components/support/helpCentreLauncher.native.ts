import * as WebBrowser from "expo-web-browser";

export async function openHelpCentre(url: string): Promise<void> {
  await WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
  });
}
