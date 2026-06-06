export const getCoverPickerFileInfoAsync = async (
  uri: string,
): Promise<{ exists: boolean; size?: number; uri?: string }> => {
  const FileSystem = await import("expo-file-system/legacy");
  return FileSystem.getInfoAsync(uri);
};
