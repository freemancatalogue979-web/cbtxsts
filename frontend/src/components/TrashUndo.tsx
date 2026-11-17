import { Trash2, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, RESTORED_EVENT, TRASH_EVENT } from "../lib/api";

const SHOW_MS = 8000;

/** "Moved to Trash · Undo" after any delete. Undo restores straight away and
 *  remounts the open page so the item reappears where it was. */
export function TrashUndo() {
  const [ids, setIds] = useState<number[] | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [message, setMessage] = useState("");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onTrash = (event: Event) => {
      const detail = (event as CustomEvent<{ ids: number[] }>).detail;
      if (!detail?.ids?.length) return;
      setIds(detail.ids);
      setState("idle");
      setMessage("");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setIds(null), SHOW_MS);
    };
    window.addEventListener(TRASH_EVENT, onTrash);
    return () => { window.removeEventListener(TRASH_EVENT, onTrash); window.clearTimeout(timer.current); };
  }, []);

  if (!ids) return null;

  async function undo() {
    if (!ids) return;
    window.clearTimeout(timer.current);
    setState("busy");
    try {
      // Restore newest first so children come back after their parents' trash entries.
      for (const id of [...ids].reverse()) await api.post(`/trash/${id}/restore`);
      setIds(null);
      window.dispatchEvent(new Event(RESTORED_EVENT));
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Couldn't undo. It's still in Trash.");
    }
  }

  return (
    <div className="app-status fixed inset-x-0 z-[71] flex justify-center px-3 pointer-events-none" role="status" aria-live="polite">
      <div className="pointer-events-auto flex flex-wrap items-center gap-2.5 rounded-xl border border-edge-2 bg-panel/95 backdrop-blur-xl px-3.5 py-2.5 shadow-2xl max-w-[min(100%,34rem)]">
        <Trash2 size={15} className="text-crim shrink-0" />
        <span className="text-[12px] font-bold">
          {state === "error" ? message : ids.length > 1 ? `${ids.length} things moved to Trash` : "Moved to Trash"}
        </span>
        {state !== "error" && (
          <button type="button" className="btn-primary !py-1 !px-2.5 !text-[11px]" onClick={undo} disabled={state === "busy"}>
            <Undo2 size={12} /> {state === "busy" ? "Undoing…" : "Undo"}
          </button>
        )}
        <a href="#/trash" className="text-[11px] font-bold text-mute hover:text-text underline-offset-2 hover:underline"
          onClick={() => setIds(null)}>Open Trash</a>
        <button type="button" className="text-faint hover:text-text p-0.5" aria-label="Dismiss" onClick={() => setIds(null)}>
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
