export async function openHelpCentre(url: string): Promise<void> {
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) throw new Error("help_centre_window_blocked");
}
