import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileText,
  Film,
  FolderOpen,
  Globe2,
  Link2,
  Lock,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  Send,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { ArchiveCommentT, ArchiveFolderT, ArchiveItemT, ArchiveLocker, MemberBrief, User } from "../lib/types";
import { fmtStamp, navigate } from "../lib/util";
import { AvatarImg } from "../components/Avatar";
import { Empty, ErrorNote, Field, Modal, PageTitle, Spinner } from "../components/ui";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const KIND_ICON: Record<string, typeof FileText> = {
  note: FileText, video: Film, link: Link2, file: Paperclip,
};
const KIND_LABEL: Record<string, string> = {
  note: "Note", video: "Video", link: "Link", file: "File",
};

function ytEmbed(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{5,})/);
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null;
}

const fmtSize = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

function VisibilityChip({ item }: { item: ArchiveItemT }) {
  if (item.visibility === "private") {
    return (
      <span className="chip text-crim border-crim/50 bg-crim-dim/40 inline-flex items-center gap-1">
        <Lock size={10} /> PRIVATE
      </span>
    );
  }
  return (
    <span className="chip text-sky border-sky/40 bg-sky/10 inline-flex items-center gap-1">
      <Globe2 size={10} /> PUBLIC
    </span>
  );
}

// ---------------------------------------------------------------------------
// page entry — grid of lockers, or one locker when /archive/{id}
// ---------------------------------------------------------------------------
export function ArchivePage({ me, parts }: { me: User; parts: string[] }) {
  const folderId = parts[0] && /^\d+$/.test(parts[0]) ? Number(parts[0]) : null;
  return folderId ? <LockerView me={me} folderId={folderId} /> : <LockerGrid me={me} />;
}

// ---------------------------------------------------------------------------
// locker grid
// ---------------------------------------------------------------------------
function LockerGrid({ me }: { me: User }) {
  const [data, setData] = useState<{ folders: ArchiveFolderT[]; mine_folder_id: number | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () =>
    api.get<{ folders: ArchiveFolderT[]; mine_folder_id: number | null }>("/archive/folders")
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : "Load failed"));
  useEffect(() => { load(); }, []);

  if (!data) return <Spinner label="Opening the archive" />;

  return (
    <div>
      <PageTitle
        title="Archive"
        sub="Team lockers — theory, documents, vods and secret drops. One locker per player."
        right={
          data.mine_folder_id === null ? (
            <button className="btn-primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> Create my locker
            </button>
          ) : (
            <button className="btn-primary" onClick={() => navigate("archive", data.mine_folder_id!)}>
              <FolderOpen size={14} /> My locker
            </button>
          )
        }
      />
      <ErrorNote error={err} />
      {data.folders.length === 0 ? (
        <Empty title="No lockers yet" hint="Be the first — create your locker and start dropping theory, files and vods." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.folders.map((f) => (
            <button
              key={f.id}
              onClick={() => navigate("archive", f.id)}
              className="card p-4 text-left hover:border-edge-2 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <AvatarImg user={{ name: f.owner?.name || "?", ign: f.owner?.ign || "", avatar: f.owner?.avatar ?? null }} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-[14px] truncate">{f.name}</span>
                    {f.mine && <span className="chip text-leaf border-leaf/40 bg-leaf-dim/50">YOU</span>}
                  </div>
                  <div className="text-[11.5px] text-mute truncate">
                    {f.owner?.ign || f.owner?.name || "Unknown"}
                    {f.owner?.main_role ? ` · ${f.owner.main_role}` : ""}
                  </div>
                </div>
                {f.tag && <span className="chip text-amber border-amber/40 bg-amber/10 shrink-0">{f.tag}</span>}
              </div>
              <div className="mt-3 pt-3 border-t border-edge/60 flex items-center gap-3 text-[11px] text-faint">
                <span className="font-semibold text-mute">
                  {f.item_count} {f.item_count === 1 ? "drop" : "drops"}
                </span>
                {f.private_count ? (
                  <span className="inline-flex items-center gap-1 text-crim">
                    <Lock size={10} /> {f.private_count} private
                  </span>
                ) : null}
                <span className="ml-auto tabular-nums">updated {fmtStamp(f.updated_at)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
      {creating && (
        <LockerForm
          me={me}
          onClose={() => setCreating(false)}
          onSaved={(f) => { setCreating(false); load(); navigate("archive", f.id); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// locker create / rename
// ---------------------------------------------------------------------------
function LockerForm({ me, initial, onClose, onSaved }: {
  me: User;
  initial?: ArchiveFolderT;
  onClose: () => void;
  onSaved: (f: ArchiveFolderT) => void;
}) {
  const [name, setName] = useState(initial?.name ?? `${me.ign || me.name}'s Locker`);
  const [tag, setTag] = useState(initial?.tag ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const f = initial
        ? await api.patch<ArchiveFolderT>(`/archive/folders/${initial.id}`, { name, tag })
        : await api.post<ArchiveFolderT>("/archive/folders", { name, tag });
      onSaved(f);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
      setBusy(false);
    }
  }

  return (
    <Modal title={initial ? "Rename locker" : "Create my locker"} onClose={onClose}>
      <form onSubmit={save} className="space-y-3.5">
        <Field label="Locker name">
          <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Field>
        <Field label="Tag (optional)" hint="e.g. THEORY, SECRETS, VODS — shows as a chip on your locker card.">
          <input className="input" value={tag} maxLength={40} onChange={(e) => setTag(e.target.value.toUpperCase())} placeholder="THEORY" />
        </Field>
        <p className="text-[11.5px] text-faint leading-snug">
          One locker per player. Items inside can be public (whole squad) or private
          (only you + the members you pick — even admins can't see private drops).
        </p>
        <ErrorNote error={err} />
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !name.trim()}>
            {busy ? "Saving…" : initial ? "Save" : "Create locker"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// single locker view
// ---------------------------------------------------------------------------
const FILTERS: { id: string; label: string }[] = [
  { id: "", label: "All" },
  { id: "note", label: "Notes" },
  { id: "video", label: "Videos" },
  { id: "link", label: "Links" },
  { id: "file", label: "Files" },
];

function LockerView({ me, folderId }: { me: User; folderId: number }) {
  const [locker, setLocker] = useState<ArchiveLocker | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ArchiveItemT | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [confirmDrop, setConfirmDrop] = useState(false);

  const load = () =>
    api.get<ArchiveLocker>(`/archive/folders/${folderId}`)
      .then(setLocker)
      .catch((e) => setErr(e instanceof Error ? e.message : "Load failed"));
  useEffect(() => { setLocker(null); setOpen(null); load(); }, [folderId]);

  const openItem = useMemo(
    () => locker?.items.find((i) => i.id === open) ?? null,
    [locker, open],
  );

  if (err && !locker) {
    return (
      <div>
        <button className="btn-ghost mb-4" onClick={() => navigate("archive")}><ArrowLeft size={14} /> Archive</button>
        <ErrorNote error={err} />
      </div>
    );
  }
  if (!locker) return <Spinner label="Opening locker" />;

  const counts: Record<string, number> = {};
  for (const it of locker.items) counts[it.kind] = (counts[it.kind] ?? 0) + 1;
  const items = filter ? locker.items.filter((i) => i.kind === filter) : locker.items;
  const isMine = locker.mine;

  async function deleteLocker() {
    if (!locker) return;
    try {
      await api.del(`/archive/folders/${locker.id}`);
      navigate("archive");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Delete failed");
      setConfirmDrop(false);
    }
  }

  return (
    <div>
      <button className="btn-ghost mb-4" onClick={() => navigate("archive")}><ArrowLeft size={14} /> All lockers</button>

      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <AvatarImg user={{ name: locker.owner?.name || "?", ign: locker.owner?.ign || "", avatar: locker.owner?.avatar ?? null }} size={48} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base font-extrabold tracking-wide">{locker.name}</h1>
              {locker.tag && <span className="chip text-amber border-amber/40 bg-amber/10">{locker.tag}</span>}
              {isMine && <span className="chip text-leaf border-leaf/40 bg-leaf-dim/50">YOURS</span>}
            </div>
            <div className="text-[12px] text-mute mt-0.5">
              {locker.owner?.ign || locker.owner?.name} · {locker.item_count} {locker.item_count === 1 ? "drop" : "drops"}
              {locker.private_count ? ` · ${locker.private_count} private` : ""}
            </div>
            <div className="text-[10.5px] text-faint mt-0.5 tabular-nums">
              created {fmtStamp(locker.created_at)} · updated {fmtStamp(locker.updated_at)}
            </div>
          </div>
          {isMine && (
            <div className="flex gap-2 flex-wrap">
              <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={14} /> Add drop</button>
              <button className="btn-ghost !px-2.5" title="Rename locker" onClick={() => setRenaming(true)}><Pencil size={14} /></button>
              {confirmDrop ? (
                <button className="btn-ghost !px-2.5 !border-crim/60 !text-crim" onClick={deleteLocker}>
                  Sure?
                </button>
              ) : (
                <button className="btn-ghost !px-2.5" title="Delete locker"
                  onClick={() => { setConfirmDrop(true); setTimeout(() => setConfirmDrop(false), 2600); }}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {locker.items.length > 0 && (
        <div className="flex gap-1.5 mb-4 flex-wrap">
          {FILTERS.map((f) => {
            const n = f.id ? (counts[f.id] ?? 0) : locker.items.length;
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`chip !py-1.5 !px-3 transition-colors ${active ? "text-text border-crim/60 bg-crim-dim/40" : "text-mute hover:text-text"}`}
              >
                {f.label} <span className="text-faint ml-0.5">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      <ErrorNote error={err} />

      {items.length === 0 ? (
        <Empty
          title={locker.items.length === 0 ? "Nothing dropped here yet" : `No ${KIND_LABEL[filter].toLowerCase()}s here`}
          hint={isMine ? "Hit Add drop — a note, a YouTube vod, a link or a file." : "The visible drops will show up here."}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((it) => {
            const Icon = KIND_ICON[it.kind] ?? FileText;
            return (
              <button key={it.id} onClick={() => setOpen(it.id)} className="card p-3.5 text-left hover:border-edge-2 transition-colors">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-raised border border-edge">
                    <Icon size={12.5} className="text-crim" />
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-faint">{KIND_LABEL[it.kind]}</span>
                  <span className="ml-auto"><VisibilityChip item={it} /></span>
                </div>
                {it.file?.kind === "image" && (
                  <img src={it.file.url} alt="" className="w-full h-32 object-cover rounded border border-edge mb-2 bg-raised" draggable={false} />
                )}
                <div className="font-bold text-[13.5px] leading-snug line-clamp-2">{it.title}</div>
                {it.body && <div className="text-[12px] text-mute mt-1 line-clamp-2">{it.body}</div>}
                {!it.body && it.kind !== "note" && it.kind !== "file" && (
                  <div className="text-[11px] text-faint mt-1 truncate">{it.url}</div>
                )}
                {it.file && it.file.kind !== "image" && (
                  <div className="text-[11px] text-faint mt-1 truncate">{it.file.name} · {fmtSize(it.file.size)}</div>
                )}
                <div className="mt-2.5 pt-2 border-t border-edge/60 flex items-center gap-3 text-[10.5px] text-faint">
                  <span className="inline-flex items-center gap-1"><MessageSquare size={10.5} /> {it.comments}</span>
                  <span className="ml-auto tabular-nums">{fmtStamp(it.created_at)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {adding && (
        <ItemEditor me={me} folderId={locker.id} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />
      )}
      {editing && (
        <ItemEditor me={me} folderId={locker.id} initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
      {renaming && (
        <LockerForm me={me} initial={locker} onClose={() => setRenaming(false)}
          onSaved={() => { setRenaming(false); load(); }} />
      )}
      {openItem && (
        <ItemModal me={me} item={openItem} ownerIgn={locker.owner?.ign || locker.owner?.name || ""}
          onClose={() => setOpen(null)}
          onChanged={load}
          onEdit={() => { setOpen(null); setEditing(openItem); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// item detail — media, description, comments
// ---------------------------------------------------------------------------
function ItemModal({ me, item, ownerIgn, onClose, onChanged, onEdit }: {
  me: User;
  item: ArchiveItemT;
  ownerIgn: string;
  onClose: () => void;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const [comments, setComments] = useState<ArchiveCommentT[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const load = () => api.get<ArchiveCommentT[]>(`/archive/items/${item.id}/comments`)
    .then(setComments).catch(() => setComments([]));
  useEffect(() => { setComments(null); load(); }, [item.id]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/archive/items/${item.id}/comments`, { body: draft.trim() });
      setDraft("");
      load();
      onChanged();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  async function delItem() {
    try {
      await api.del(`/archive/items/${item.id}`);
      onChanged();
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Delete failed");
      setConfirmDel(false);
    }
  }

  async function delComment(id: number) {
    try {
      await api.del(`/archive/comments/${id}`);
      load();
      onChanged();
    } catch { /* ignore */ }
  }

  const yt = item.kind === "video" ? ytEmbed(item.url) : null;

  return (
    <Modal title={item.title} onClose={onClose} wide>
      <div className="space-y-3.5">
        <div className="flex items-center gap-2 flex-wrap text-[10.5px] text-faint">
          <span className="chip text-mute border-edge-2">{KIND_LABEL[item.kind]}</span>
          <VisibilityChip item={item} />
          {item.visibility === "private" && item.mine && item.shared.length > 0 && (
            <span className="text-crim/90">
              shared with {item.shared.map((s) => s.ign || s.name).join(", ")}
            </span>
          )}
          <span className="ml-auto tabular-nums">
            {ownerIgn} · {fmtStamp(item.created_at)}
            {item.updated_at !== item.created_at && ` (edited ${fmtStamp(item.updated_at)})`}
          </span>
        </div>

        {/* media */}
        {yt ? (
          <div className="rounded overflow-hidden border border-edge bg-black">
            <div className="aspect-video">
              <iframe src={yt} title={item.title} className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen />
            </div>
          </div>
        ) : item.kind === "video" || item.kind === "link" ? (
          <a href={item.url} target="_blank" rel="noreferrer" className="btn-ghost w-full !normal-case">
            <ExternalLink size={14} /> <span className="truncate">{item.url}</span>
          </a>
        ) : null}

        {item.file && (
          <FileViewer file={item.file} />
        )}

        {item.body && (
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-text/90">{item.body}</p>
        )}

        {/* owner actions */}
        {item.mine && (
          <div className="flex gap-2 pt-1">
            <button className="btn-ghost !py-1.5" onClick={onEdit}><Pencil size={12} /> Edit / sharing</button>
            {confirmDel ? (
              <button className="btn-ghost !py-1.5 !border-crim/60 !text-crim" onClick={delItem}>Really delete?</button>
            ) : (
              <button className="btn-ghost !py-1.5" onClick={() => { setConfirmDel(true); setTimeout(() => setConfirmDel(false), 2600); }}>
                <Trash2 size={12} /> Delete
              </button>
            )}
          </div>
        )}
        <ErrorNote error={err} />

        {/* comments */}
        <div className="pt-3 border-t border-edge">
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-mute mb-2.5">
            Replies {comments ? `(${comments.length})` : ""}
          </div>
          {comments === null ? (
            <Spinner label="Loading replies" />
          ) : (
            <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
              {comments.length === 0 && <div className="text-[12px] text-faint">No replies yet — start the discussion.</div>}
              {comments.map((c) => (
                <div key={c.id} className="flex gap-2">
                  <AvatarImg user={{ name: c.author?.name || "?", ign: c.author?.ign || "", avatar: c.author?.avatar ?? null }} size={24} />
                  <div className="flex-1 min-w-0 rounded-lg border border-edge/70 bg-raised/40 px-2.5 py-1.5">
                    <div className="flex items-center gap-2 text-[10.5px]">
                      <span className="font-bold text-text/90">{c.author?.ign || c.author?.name || "?"}</span>
                      <span className="text-faint tabular-nums">{fmtStamp(c.created_at)}</span>
                      {(c.author?.id === me.id || item.mine) && (
                        <button className="ml-auto text-faint hover:text-crim" title="Delete reply"
                          onClick={() => delComment(c.id)}><Trash2 size={10.5} /></button>
                      )}
                    </div>
                    <div className="text-[12.5px] leading-snug whitespace-pre-wrap mt-0.5">{c.body}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={send} className="flex gap-2 mt-2.5">
            <input
              className="input !py-2 flex-1 text-[12.5px]"
              value={draft}
              maxLength={2000}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={item.visibility === "private" ? "Only people who can see this drop can reply…" : "Reply — everyone can see this…"}
            />
            <button className="btn-primary !py-2" disabled={busy || !draft.trim()} aria-label="Send reply">
              <Send size={13} />
            </button>
          </form>
        </div>
      </div>
    </Modal>
  );
}

function FileViewer({ file }: { file: NonNullable<ArchiveItemT["file"]> }) {
  if (file.kind === "image") {
    return (
      <a href={file.url} target="_blank" rel="noreferrer">
        <img src={file.url} alt={file.name} className="w-full max-h-80 object-contain rounded border border-edge bg-black/40" />
      </a>
    );
  }
  if (file.kind === "video") {
    return <video src={file.url} controls className="w-full max-h-80 rounded border border-edge bg-black" />;
  }
  if (file.kind === "audio") {
    return (
      <div className="rounded border border-edge bg-raised/50 p-3">
        <audio src={file.url} controls className="w-full" />
      </div>
    );
  }
  if (file.kind === "pdf") {
    return <iframe src={file.url} title={file.name} className="w-full h-[55vh] rounded border border-edge bg-white" />;
  }
  return (
    <a href={file.url} className="flex items-center gap-2.5 rounded-lg border border-edge bg-raised/50 px-3 py-2.5 hover:border-edge-2 transition-colors">
      <span className="inline-flex items-center justify-center w-8 h-8 rounded bg-crim-dim border border-crim/40">
        <Paperclip size={14} className="text-crim" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-bold truncate">{file.name}</span>
        <span className="block text-[10.5px] text-faint">{fmtSize(file.size)}</span>
      </span>
      <Download size={14} className="text-mute shrink-0" />
    </a>
  );
}

// ---------------------------------------------------------------------------
// add / edit drop
// ---------------------------------------------------------------------------
const ADD_KINDS: { id: ArchiveItemT["kind"]; label: string; icon: typeof FileText; hint: string }[] = [
  { id: "note", label: "Note", icon: FileText, hint: "Theory, plans, reads — plain text." },
  { id: "video", label: "Video", icon: Film, hint: "YouTube link plays right inside the app." },
  { id: "link", label: "Link", icon: Link2, hint: "Any useful URL — docs, articles, references." },
  { id: "file", label: "File", icon: Paperclip, hint: "Images, video, audio, PDF, docs, text, zip (max 60 MB)." },
];

function ItemEditor({ me, folderId, initial, onClose, onSaved }: {
  me: User;
  folderId: number;
  initial?: ArchiveItemT;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<ArchiveItemT["kind"]>(initial?.kind ?? "note");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [visibility, setVisibility] = useState<"public" | "private">(initial?.visibility ?? "public");
  const [sharedIds, setSharedIds] = useState<number[]>(initial?.shared.map((s) => s.id) ?? []);
  const [members, setMembers] = useState<MemberBrief[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const edit = Boolean(initial);

  useEffect(() => {
    if (visibility === "private" && members === null) {
      api.get<MemberBrief[]>("/archive/members")
        .then((m) => setMembers(m.filter((x) => x.id !== me.id)))
        .catch(() => setMembers([]));
    }
  }, [visibility, members, me.id]);

  const activeKind = ADD_KINDS.find((k) => k.id === kind)!;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      if (edit && initial) {
        await api.patch(`/archive/items/${initial.id}`, {
          title, url: kind === "note" || kind === "file" ? "" : url,
          body, visibility,
          shared: visibility === "private" ? sharedIds : [],
        });
      } else {
        const form = new FormData();
        form.append("title", title);
        form.append("kind", kind);
        form.append("url", url);
        form.append("body", body);
        form.append("visibility", visibility);
        form.append("shared", JSON.stringify(visibility === "private" ? sharedIds : []));
        if (kind === "file" && file) form.append("file", file);
        await api.upload(`/archive/folders/${folderId}/items`, form);
      }
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
      setBusy(false);
    }
  }

  return (
    <Modal title={edit ? `Edit drop — ${KIND_LABEL[kind]}` : "Add drop"} onClose={onClose}>
      <form onSubmit={save} className="space-y-3.5">
        {!edit && (
          <div className="grid grid-cols-4 gap-1.5">
            {ADD_KINDS.map((k) => {
              const Icon = k.icon;
              const active = kind === k.id;
              return (
                <button
                  type="button"
                  key={k.id}
                  onClick={() => setKind(k.id)}
                  className={`rounded-lg border px-2 py-2 flex flex-col items-center gap-1 transition-colors ${
                    active ? "border-crim/60 bg-crim-dim/40 text-text" : "border-edge bg-raised/40 text-mute hover:text-text"
                  }`}
                >
                  <Icon size={15} className={active ? "text-crim" : "text-faint"} />
                  <span className="text-[10px] font-bold uppercase tracking-wider">{k.label}</span>
                </button>
              );
            })}
          </div>
        )}

        <Field label="Title">
          <input className="input" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)}
            placeholder={kind === "video" ? "e.g. MPL S16 — how they break EXP lane" : "What's this drop?"} required autoFocus />
        </Field>

        {(kind === "link" || kind === "video") && (
          <Field label={kind === "video" ? "YouTube / video link" : "URL"} hint={kind === "video" ? activeKind.hint : undefined}>
            <input className="input" value={url} maxLength={600} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=…" required={!edit} />
          </Field>
        )}

        {kind === "file" && !edit && (
          <Field label="File" hint={activeKind.hint}>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept="image/*,video/*,audio/*,.pdf,.txt,.md,.csv,.zip,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button type="button" className="btn-ghost w-full" onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> {file ? `${file.name} (${fmtSize(file.size)})` : "Pick a file from device"}
            </button>
          </Field>
        )}

        <Field label={kind === "note" ? "Body" : "Notes (optional)"}>
          <textarea
            className="input min-h-24"
            value={body}
            maxLength={20000}
            onChange={(e) => setBody(e.target.value)}
            required={kind === "note"}
            placeholder={kind === "note" ? "Write the theory, the read, the plan…" : "Context for this drop…"}
          />
        </Field>

        <div>
          <span className="label block mb-1.5">Who can see it</span>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setVisibility("public")}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                visibility === "public" ? "border-sky/50 bg-sky/10" : "border-edge bg-raised/40 hover:border-edge-2"
              }`}
            >
              <div className="flex items-center gap-1.5 text-[12px] font-bold">
                <Globe2 size={13} className="text-sky" /> Public
              </div>
              <div className="text-[10.5px] text-faint mt-0.5">Whole squad — view + replies</div>
            </button>
            <button
              type="button"
              onClick={() => setVisibility("private")}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                visibility === "private" ? "border-crim/60 bg-crim-dim/40" : "border-edge bg-raised/40 hover:border-edge-2"
              }`}
            >
              <div className="flex items-center gap-1.5 text-[12px] font-bold">
                <Lock size={13} className="text-crim" /> Private
              </div>
              <div className="text-[10.5px] text-faint mt-0.5">Only you + picked members (admins can't see it)</div>
            </button>
          </div>

          {visibility === "private" && (
            <div className="mt-2 rounded-lg border border-edge bg-raised/40 p-2.5">
              <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-mute mb-2">
                Also allow {sharedIds.length > 0 && <span className="text-crim">({sharedIds.length})</span>}
              </div>
              {members === null ? (
                <Spinner label="Loading squad" />
              ) : members.length === 0 ? (
                <div className="text-[11.5px] text-faint">Just you for now.</div>
              ) : (
                <div className="grid grid-cols-2 gap-1 max-h-36 overflow-y-auto pr-1">
                  {members.map((m) => {
                    const on = sharedIds.includes(m.id);
                    return (
                      <button
                        type="button"
                        key={m.id}
                        onClick={() => setSharedIds((ids) => on ? ids.filter((i) => i !== m.id) : [...ids, m.id])}
                        className={`flex items-center gap-1.5 rounded border px-1.5 py-1 transition-colors ${
                          on ? "border-crim/60 bg-crim-dim/40" : "border-edge/70 hover:border-edge-2"
                        }`}
                      >
                        <AvatarImg user={{ name: m.name, ign: m.ign, avatar: m.avatar }} size={18} />
                        <span className={`text-[11px] font-semibold truncate ${on ? "text-text" : "text-mute"}`}>
                          {m.ign || m.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <ErrorNote error={err} />
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={busy || !title.trim()
              || (kind === "note" && !body.trim())
              || ((kind === "link" || kind === "video") && !url.trim() && !edit)
              || (kind === "file" && !file && !edit)}
          >
            {busy ? "Saving…" : edit ? "Save changes" : "Drop it"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
