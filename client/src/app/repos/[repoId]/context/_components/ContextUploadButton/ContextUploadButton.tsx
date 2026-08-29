/* The upload control: a hidden file input behind a Button.

   The file is read in the BROWSER with `FileReader` and posted as JSON — there
   is no multipart endpoint, and the JSON body is what lets the server see the
   filename and answer a wrong extension with a 400 rather than discovering it
   mid-stream. `accept` is a convenience, never the check: the server rejects
   the extension itself, because a file picker's filter is trivially bypassed. */
"use client";

import React from "react";
import { Button } from "@devdigest/ui";
import { ACCEPT } from "./constants";

export interface ContextUploadButtonProps {
  label: string;
  busyLabel: string;
  busy: boolean;
  disabled?: boolean;
  onFile: (file: { filename: string; content: string }) => void;
}

export function ContextUploadButton({
  label,
  busyLabel,
  busy,
  disabled,
  onFile,
}: ContextUploadButtonProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset first, so picking the same file twice in a row still fires.
    e.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      onFile({ filename: file.name, content: String(reader.result ?? "") });
    };
    reader.readAsText(file);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={handleChange}
        style={{ display: "none" }}
        data-testid="context-upload-input"
      />
      <Button
        kind="primary"
        size="sm"
        icon="Upload"
        loading={busy}
        disabled={busy || disabled}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? busyLabel : label}
      </Button>
    </>
  );
}
