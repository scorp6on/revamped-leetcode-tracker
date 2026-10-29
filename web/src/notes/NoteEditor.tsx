import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type Dispatch, type SetStateAction } from "react";
import { MAX_NOTES_LENGTH } from "../../../api/src/review/types";
import { cn } from "../lib/utils";
import { bulletList, code, imageMarkdown, insertBlock, replaceToken, uploadingToken, wrap, type Edit } from "./edits";
import { shrinkToJpeg, uploadImage } from "./image";
import { Markdown } from "./Markdown";

const BulletIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4.5" cy="6" r="1" />
    <circle cx="4.5" cy="12" r="1" />
    <circle cx="4.5" cy="18" r="1" />
  </svg>
);
const CodeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />
  </svg>
);
const ImageIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="2" />
    <path d="m21 16-5-5L5 20" />
  </svg>
);

const tab = (active: boolean) =>
  cn(
    "h-9 rounded-md px-3 text-[13px] font-medium cursor-pointer",
    active ? "border bg-background text-foreground" : "text-muted-foreground hover:text-foreground",
  );
const tool = "flex h-9 w-11 items-center justify-center rounded-md hover:bg-background cursor-pointer";

const imagesIn = (files: FileList | null | undefined) => [...(files ?? [])].filter((f) => f.type.startsWith("image/"));

// One note section (#51): Write / Preview, a Markdown toolbar, and images by button, paste or drop.
export function NoteEditor({
  id,
  label,
  hint,
  value,
  setValue,
  onUploadingChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  setValue: Dispatch<SetStateAction<string>>;
  onUploadingChange: (count: number) => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string>();

  useEffect(() => onUploadingChange(uploading), [uploading, onUploadingChange]);

  // Applies a toolbar edit to the current selection, then puts the selection back.
  const apply = (fn: (e: Edit) => Edit) => {
    const el = box.current;
    const result = fn({ text: value, start: el?.selectionStart ?? value.length, end: el?.selectionEnd ?? value.length });
    setValue(result.text);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(result.start, result.end);
    });
  };

  const addImages = (files: File[]) => {
    if (!files.length) return;
    setError(undefined);
    // One placeholder per image, all inserted in one edit, each swapped for its link when done.
    const tokens = files.map(() => uploadingToken(crypto.randomUUID().slice(0, 8)));
    apply((e) => insertBlock(e, tokens.join("\n")));
    setUploading((n) => n + files.length);
    files.forEach((file, i) => {
      const token = tokens[i];
      shrinkToJpeg(file)
        .then(uploadImage)
        .then((path) => setValue((v) => replaceToken(v, token, imageMarkdown(path))))
        .catch((err: Error) => {
          setValue((v) => replaceToken(v, token, ""));
          setError(err.message);
        })
        .finally(() => setUploading((n) => n - 1));
    });
  };

  const onPaste = (e: ClipboardEvent) => {
    const files = imagesIn(e.clipboardData.files);
    if (!files.length) return; // plain text pastes as usual
    e.preventDefault();
    addImages(files);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    setPreview(false);
    addImages(imagesIn(e.dataTransfer.files));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <span className="text-[13px] text-muted-foreground">{hint} · optional</span>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn("overflow-hidden rounded-[10px] border", dragging && "border-dashed border-muted-foreground")}
      >
        <div className="flex flex-wrap items-center gap-1 border-b bg-subtle px-2 py-1">
          <div role="group" aria-label={`${label} view`} className="flex gap-1">
            <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)} className={tab(!preview)}>
              Write
            </button>
            <button type="button" aria-pressed={preview} onClick={() => setPreview(true)} className={tab(preview)}>
              Preview
            </button>
          </div>
          {!preview && (
            <>
              <span aria-hidden="true" className="mx-1.5 hidden h-5 w-px bg-border sm:block" />
              {/* On a phone the tools wrap onto their own row. */}
              <div role="toolbar" aria-label={`${label} formatting`} className="flex flex-wrap gap-0.5 max-sm:basis-full">
                <button type="button" aria-label="Bold" className={cn(tool, "font-bold")} onClick={() => apply((e) => wrap(e, "**"))}>
                  B
                </button>
                <button type="button" aria-label="Italic" className={cn(tool, "font-serif italic")} onClick={() => apply((e) => wrap(e, "_"))}>
                  I
                </button>
                <button type="button" aria-label="Bulleted list" className={tool} onClick={() => apply(bulletList)}>
                  <BulletIcon />
                </button>
                <button type="button" aria-label="Code" className={tool} onClick={() => apply(code)}>
                  <CodeIcon />
                </button>
                <button type="button" aria-label="Add image" className={tool} onClick={() => picker.current?.click()}>
                  <ImageIcon />
                </button>
              </div>
            </>
          )}
        </div>

        {preview ? (
          <div className="min-h-[96px] px-4 py-3.5">
            {value.trim() ? <Markdown text={value} /> : <p className="text-muted-foreground">Nothing to preview yet.</p>}
          </div>
        ) : dragging ? (
          <div className="flex h-24 items-center justify-center text-[13px] text-muted-foreground">Drop image to add it</div>
        ) : (
          <textarea
            ref={box}
            id={id}
            rows={4}
            value={value}
            maxLength={MAX_NOTES_LENGTH}
            onChange={(e) => setValue(e.target.value)}
            onPaste={onPaste}
            className="block w-full resize-y bg-background px-4 py-3.5 font-mono text-base leading-relaxed outline-none sm:text-[13px]"
          />
        )}
      </div>

      <input
        ref={picker}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          addImages(imagesIn(e.target.files));
          e.target.value = ""; // so picking the same file again still fires
        }}
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Markdown · paste or drop images</span>
        <span className="font-mono">
          {value.length.toLocaleString()} / {MAX_NOTES_LENGTH.toLocaleString()}
        </span>
        {uploading > 0 && (
          <span role="status">
            Uploading {uploading} image{uploading === 1 ? "" : "s"}…
          </span>
        )}
        {error && (
          <span role="alert" className="text-foreground">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
