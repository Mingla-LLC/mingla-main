import { pickBrowserFiles } from "../../utils/browserFilePicker";
import type { ContactImportFile } from "../../services/contactImportService";
export async function pickContactImportFile(): Promise<ContactImportFile | null> {
  const r = await pickBrowserFiles({
    accept: ".csv,text/csv",
    maxBytes: 10 * 1024 * 1024,
    maxFiles: 1,
  });
  if (r.canceled || !r.files[0]) return null;
  const f = r.files[0];
  return {
    uri: f.uri,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size,
    webFile: f.file,
  };
}
