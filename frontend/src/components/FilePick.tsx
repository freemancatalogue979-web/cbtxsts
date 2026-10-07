import { FileText, Film, ImageIcon, Link2, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../lib/api";
import { ErrorNote } from "./ui";

export type Att = { label: string; url: string; kind: string };

export const ATT_ICON: Record<string, typeof Link2> = {
  image: ImageIcon, video: Film, pdf: FileText, file: FileText, link: Link2,
};

/** Shared device-file picker: uploads to /api/files, removable list, optional web link. */
export function FilePick({ items, onChange, hint }: { items: Att[]; onChange: (a: Att[]) => void; hint?: string }) {
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPick(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setErr(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const saved = await api.upload<Att>("/files", form);
        onChange([...items, saved]);
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <input ref={fileRef} type="file" multiple className="hidden"
        accept="image/*,video/mp4,video/webm,video/quicktime,.pdf,.txt,.md,.csv,.zip"
        onChange={(e) => onPick(e.target.files)} />
      {items.map((a, i) => {
        const Icon = ATT_ICON[a.kind] ?? Link2;
        return (
          <div key={i} className="flex items-center gap-2 rounded-lg border border-edge bg-raised/50 px-2.5 py-1.5">
            <Icon size={13} className="text-crim shrink-0" />
            {a.kind === "image" && <img src={a.url} alt="" className="h-7 w-10 rounded object-cover border border-edge shrink-0" />}
            <span className="text-[12px] font-semibold truncate flex-1">{a.label}</span>
            <button type="button" className="text-faint hover:text-crim shrink-0"
              onClick={() => onChange(items.filter((_, j) => j !== i))} title="Remove"><Trash2 size={12} /></button>
          </div>
        );
      })}
      <button type="button" className="btn-ghost w-full" disabled={uploading} onClick={() => fileRef.current?.click()}>
        <Upload size={14} /> {uploading ? "Uploading…" : "Pick files from device"}
      </button>
      {hint && <div className="text-[10.5px] text-faint leading-snug">{hint}</div>}
      <div className="flex gap-2 items-center">
        <input className="input !py-1.5 flex-1 text-[12px]" value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Link label (optional)" />
        <input className="input !py-1.5 flex-[1.4] text-[12px]" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" />
        <button type="button" className="btn-ghost !py-1.5 !px-3 shrink-0"
          onClick={() => {
            if (!linkUrl.trim()) return;
            onChange([...items, { label: linkLabel.trim() || linkUrl.trim(), url: linkUrl.trim(), kind: "link" }]);
            setLinkLabel(""); setLinkUrl("");
          }}>Add link</button>
      </div>
      <ErrorNote error={err} />
    </div>
  );
}
