import * as DocumentPicker from "expo-document-picker";
import type { ContactImportFile } from "../../services/contactImportService";
export async function pickContactImportFile(): Promise<ContactImportFile | null> {
  const r = await DocumentPicker.getDocumentAsync({
    type: ["text/csv", "text/comma-separated-values", "application/csv"],
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (r.canceled || !r.assets[0]) return null;
  const f = r.assets[0];
  return {
    uri: f.uri,
    name: f.name,
    mimeType: f.mimeType ?? null,
    size: f.size ?? 0,
  };
}
