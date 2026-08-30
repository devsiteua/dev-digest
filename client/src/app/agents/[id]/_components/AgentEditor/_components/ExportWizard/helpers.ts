import type { CiFile } from "@devdigest/shared";
import { ApiError } from "../../../../../../../lib/api";
import { BUNDLE_ERROR_CODES, RUNNER_DIR, WORKFLOW_PATH } from "./constants";

/** `owner/name` — the only shape the export route accepts. */
export function isValidRepo(repo: string): boolean {
  return /^[^/\s]+\/[^/\s]+$/.test(repo.trim());
}

/**
 * A runner file is listed, never shown. The engine sends it with an empty
 * `contents` and a byte count precisely so the bundle never crosses the API.
 */
export function isRunnerFile(file: CiFile): boolean {
  return file.path.startsWith(`${RUNNER_DIR}/`);
}

/** The file Preview opens on: the workflow, else the first generated file. */
export function defaultPreviewPath(files: readonly CiFile[]): string | null {
  return (files.find((f) => f.path === WORKFLOW_PATH) ?? files[0])?.path ?? null;
}

/**
 * Whether a failure is "this machine has no runner build" rather than
 * "GitHub said no". The two need different instructions, and only the engine
 * knows which one happened — it says so in the error code.
 */
export function isBundleError(err: unknown): boolean {
  return err instanceof ApiError && BUNDLE_ERROR_CODES.includes(err.code ?? "");
}

/** The engine's own sentence, shown under ours so the cause is not lost. */
export function errorReason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
