export const getCoverPickerFileInfoAsync = async (
  uri: string,
): Promise<{ exists: boolean; size?: number; uri?: string }> => ({
  exists: false,
  uri,
});
