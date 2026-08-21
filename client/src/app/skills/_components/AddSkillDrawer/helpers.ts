import type { ImportPayload } from "../../../../lib/hooks/skills";
import { MAX_ZIP_BYTES } from "./constants";

/** True when the file name looks like a zip archive rather than markdown. */
export function isArchive(filename: string): boolean {
  return /\.zip$/i.test(filename);
}

/** Bytes → base64, chunked so a large archive cannot blow the argument limit. */
export function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export class ArchiveTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super("archive too large");
    this.name = "ArchiveTooLargeError";
  }
}

/**
 * Read a picked file into the JSON payload the preview endpoint expects.
 *
 * Markdown is sent as text and an archive as base64 — the browser has to read the
 * file anyway to show a preview, so there is no reason to add multipart handling
 * on the server for it.
 */
export async function fileToPayload(file: File): Promise<ImportPayload> {
  if (isArchive(file.name)) {
    if (file.size > MAX_ZIP_BYTES) throw new ArchiveTooLargeError(file.size);
    return {
      kind: "zip",
      filename: file.name,
      content_base64: bytesToBase64(await file.arrayBuffer()),
    };
  }
  return { kind: "markdown", filename: file.name, content: await file.text() };
}
