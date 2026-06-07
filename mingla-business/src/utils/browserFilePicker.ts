export type BrowserFilePickerErrorCode =
  | "unavailable"
  | "unsupported_type"
  | "file_too_large"
  | "empty_file"
  | "read_failed";

export class BrowserFilePickerError extends Error {
  code: BrowserFilePickerErrorCode;

  constructor(code: BrowserFilePickerErrorCode, message: string) {
    super(message);
    this.name = "BrowserFilePickerError";
    this.code = code;
  }
}

export type BrowserPickedFile = {
  uri: string;
  file: File;
  name: string;
  mimeType: string | null;
  size: number;
  objectUrl: string | null;
};

export type BrowserFileValidation = {
  accept?: string;
  maxBytes?: number;
  allowEmpty?: boolean;
};

export type BrowserFilePickerOptions = BrowserFileValidation & {
  multiple?: boolean;
  capture?: "user" | "environment" | boolean;
  maxFiles?: number;
  validate?: boolean;
};

export type BrowserFilePickerResult = {
  canceled: boolean;
  files: BrowserPickedFile[];
};

const getDocument = (): Document | null =>
  typeof document === "undefined" ? null : document;

export const isBrowserFilePickerAvailable = (): boolean =>
  getDocument() !== null && typeof FileReader !== "undefined";

const normalizeMime = (mime: string): string => mime.trim().toLowerCase();

const extensionFromName = (name: string): string => {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match === null ? "" : `.${match[1]}`;
};

export const browserFileMatchesAccept = (file: File, accept = ""): boolean => {
  const tokens = accept
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return true;
  const mime = normalizeMime(file.type ?? "");
  const extension = extensionFromName(file.name ?? "");
  return tokens.some((token) => {
    if (token.startsWith(".")) return token === extension;
    if (token.endsWith("/*")) {
      const family = token.slice(0, token.length - 1);
      return mime.startsWith(family);
    }
    return mime === token;
  });
};

export const validateBrowserFile = (
  file: File,
  options: BrowserFileValidation = {},
): void => {
  if (!options.allowEmpty && file.size <= 0) {
    throw new BrowserFilePickerError("empty_file", "Choose a non-empty file.");
  }
  if (options.accept !== undefined && !browserFileMatchesAccept(file, options.accept)) {
    throw new BrowserFilePickerError("unsupported_type", "Choose a supported file type.");
  }
  if (options.maxBytes !== undefined && file.size > options.maxBytes) {
    throw new BrowserFilePickerError("file_too_large", "Choose a smaller file.");
  }
};

export const browserFileToPickedFile = (
  file: File,
  options: BrowserFileValidation = {},
): BrowserPickedFile => {
  validateBrowserFile(file, options);
  const objectUrl =
    typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
      ? URL.createObjectURL(file)
      : null;
  return {
    file,
    mimeType: file.type || null,
    name: file.name || "upload",
    objectUrl,
    size: file.size,
    uri: objectUrl ?? "",
  };
};

export const revokeBrowserPickedFiles = (
  files: readonly Pick<BrowserPickedFile, "objectUrl">[],
): void => {
  if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  files.forEach((file) => {
    if (file.objectUrl !== null) URL.revokeObjectURL(file.objectUrl);
  });
};

export const readBrowserFileAsBase64 = async (file: File): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = (): void => {
        const result = reader.result;
        if (typeof result !== "string") {
          reject(new BrowserFilePickerError("read_failed", "Couldn't read that file."));
          return;
        }
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = (): void => {
        reject(
          new BrowserFilePickerError(
            "read_failed",
            reader.error?.message ?? "Couldn't read that file.",
          ),
        );
      };
      reader.readAsDataURL(file);
    } catch (error) {
      reject(
        error instanceof BrowserFilePickerError
          ? error
          : new BrowserFilePickerError("read_failed", "Couldn't read that file."),
      );
    }
  });

export const pickBrowserFiles = async (
  options: BrowserFilePickerOptions,
): Promise<BrowserFilePickerResult> => {
  const doc = getDocument();
  if (doc === null) {
    throw new BrowserFilePickerError(
      "unavailable",
      "Browser file picking is unavailable here.",
    );
  }

  return new Promise<BrowserFilePickerResult>((resolve, reject) => {
    const input = doc.createElement("input");
    input.type = "file";
    input.style.display = "none";
    input.accept = options.accept ?? "";
    input.multiple = options.multiple === true;
    if (options.capture !== undefined) {
      input.setAttribute("capture", String(options.capture));
    }

    const cleanup = (): void => {
      input.onchange = null;
      input.remove();
    };

    input.onchange = (): void => {
      try {
        const files = Array.from(input.files ?? []);
        cleanup();
        if (files.length === 0) {
          resolve({ canceled: true, files: [] });
          return;
        }
        const limited =
          options.maxFiles !== undefined ? files.slice(0, options.maxFiles) : files;
        resolve({
          canceled: false,
          files: limited.map((file) =>
            browserFileToPickedFile(file, options.validate === false ? {} : options),
          ),
        });
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    doc.body.appendChild(input);
    input.click();
  });
};
