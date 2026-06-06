export const readAsStringBase64Async = async (_uri: string): Promise<string> => {
  throw new Error("Native file reads are unavailable on web.");
};

export const getFileInfoAsync = async (
  _uri: string,
): Promise<{ exists?: boolean; size?: unknown }> => ({ exists: false });

export const createMultipartUploadTask = async (): Promise<{
  uploadAsync: () => Promise<unknown>;
  cancelAsync?: () => Promise<void>;
}> => ({
  uploadAsync: async () => {
    throw new Error("Native multipart upload tasks are unavailable on web.");
  },
});
