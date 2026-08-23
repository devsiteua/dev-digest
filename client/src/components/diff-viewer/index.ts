/* diff-viewer — unified-diff viewer with optional inline GitHub comments.
   Public surface: the DiffViewer component + the DiffCommentApi contract. */
export { DiffViewer } from "./DiffViewer";
// FileCard is public because the Smart Diff renders the same card under its own
// group headers — a second card would be a second way for a diff line to look.
export { FileCard } from "./FileCard";
export type { FileCardProps } from "./FileCard/FileCard";
export type { DiffCommentApi } from "./comments";
