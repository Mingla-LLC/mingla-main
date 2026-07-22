export const readAsStringBase64Async = async (_uri: string): Promise<string> => {
  throw new Error("Native file reads are unavailable on web.");
};

export const getFileInfoAsync = async (
  _uri: string,
): Promise<{ exists?: boolean; size?: unknown }> => ({ exists: false });

// Signature mirrors platformFileSystem.native.ts so the platform-split module
// contract agrees under tsc (which resolves this web variant). The args are
// intentionally ignored — web never runs the native multipart task; it uses the
// TUS/XHR path in the processing service. Underscore-prefixed = deliberate no-op.
export const createMultipartUploadTask = async (
  _url: string,
  _fileUri: string,
  _options: {
    fieldName: string;
    httpMethod: string;
    mimeType: string;
    parameters: Record<string, string>;
  },
  _onProgress: (event: {
    totalBytesSent: number;
    totalBytesExpectedToSend: number;
  }) => void,
): Promise<{
  uploadAsync: () => Promise<unknown>;
  cancelAsync?: () => Promise<void>;
}> => ({
  uploadAsync: async () => {
    throw new Error("Native multipart upload tasks are unavailable on web.");
  },
});

// META-ORCH-1270 — web never uses the native binary task; the Bunny TUS PATCH
// on web is driven by XHR in the processing service. This stub keeps the module
// shape symmetric so imports resolve on web.
export const createBinaryUploadTask = async (): Promise<{
  uploadAsync: () => Promise<unknown>;
  cancelAsync?: () => Promise<void>;
}> => ({
  uploadAsync: async () => {
    throw new Error("Native binary upload tasks are unavailable on web.");
  },
});
