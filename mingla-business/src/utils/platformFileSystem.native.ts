export const readAsStringBase64Async = async (uri: string): Promise<string> => {
  const FileSystem = await import("expo-file-system/legacy");
  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
};

export const getFileInfoAsync = async (
  uri: string,
): Promise<{ exists?: boolean; size?: unknown }> => {
  const FileSystem = await import("expo-file-system/legacy");
  return FileSystem.getInfoAsync(uri);
};

export const createMultipartUploadTask = async (
  url: string,
  fileUri: string,
  options: {
    fieldName: string;
    httpMethod: string;
    mimeType: string;
    parameters: Record<string, string>;
  },
  onProgress: (event: {
    totalBytesSent: number;
    totalBytesExpectedToSend: number;
  }) => void,
): Promise<{ uploadAsync: () => Promise<unknown>; cancelAsync?: () => Promise<void> }> => {
  const FileSystem = await import("expo-file-system/legacy");
  return FileSystem.createUploadTask(
    url,
    fileUri,
    {
      ...options,
      sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    },
    onProgress,
  );
};
