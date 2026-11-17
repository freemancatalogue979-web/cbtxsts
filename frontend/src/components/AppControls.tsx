import { useState, useSyncExternalStore } from "react";
import { Download, PlusSquare, RefreshCw, Share, WifiOff } from "lucide-react";
import { applyUpdate, getPwaState, promptInstall, subscribePwa } from "../lib/pwa";
import { Modal } from "./ui";

export function usePwa() {
  return useSyncExternalStore(subscribePwa, getPwaState, getPwaState);
}

/** "Install app" — the browser's own install dialog where supported, step-by-step
 *  Add to Home Screen instructions on iPhone/iPad. Hidden once installed. */
export function InstallAppButton({ variant = "icon" }: { variant?: "icon" | "full" }) {
  const pwa = usePwa();
  const [help, setHelp] = useState(false);
  if (pwa.standalone || (!pwa.canInstall && !pwa.iosHint)) return null;
  const onClick = () => { if (pwa.canInstall) void promptInstall(); else setHelp(true); };
  return (
    <>
      {variant === "icon" ? (
        <button type="button" onClick={onClick} className="text-faint hover:text-crim transition-colors p-1" title="Install the 9 Clover app" aria-label="Install the 9 Clover app">
          <Download size={15} />
        </button>
      ) : (
        <button type="button" onClick={onClick} className="btn-ghost w-full justify-center">
          <Download size={15} /> Install the app
        </button>
      )}
      {help && (
        <Modal title="Install 9 Clover" onClose={() => setHelp(false)}>
          <div className="flex items-center gap-3 mb-4">
            <img src="/brand/icon-192.png" alt="" width={56} height={56} className="rounded-[14px] shadow-lg" />
            <p className="text-[12.5px] text-mute leading-relaxed">Put the hub on your home screen. It opens full screen like any other app, starts instantly and still opens without signal.</p>
          </div>
          <ol className="space-y-3 text-[13px]">
            <li className="flex items-center gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-crim/15 text-crim"><Share size={16} /></span>Tap <b>Share</b> in the browser bar.</li>
            <li className="flex items-center gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-crim/15 text-crim"><PlusSquare size={16} /></span>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>
          </ol>
          <button type="button" className="btn-primary w-full justify-center mt-5" onClick={() => setHelp(false)}>Got it</button>
        </Modal>
      )}
    </>
  );
}

/** Bottom toasts: a new version is ready, or the device is offline. Sits above
 *  the mobile quick bar and the iPhone home indicator. */
export function AppStatus() {
  const pwa = usePwa();
  if (!pwa.updateReady && pwa.online) return null;
  return (
    <div className="app-status fixed inset-x-0 z-[70] flex flex-col items-center gap-2 px-3 pointer-events-none" role="status" aria-live="polite">
      {pwa.updateReady && (
        <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-crim/40 bg-panel/95 backdrop-blur-xl px-3.5 py-2.5 shadow-2xl">
          <RefreshCw size={15} className="text-crim shrink-0" />
          <span className="text-[12px] font-bold">A new version of the hub is ready</span>
          <button type="button" className="btn-primary !py-1 !px-2.5 !text-[11px]" onClick={applyUpdate}>Reload</button>
        </div>
      )}
      {!pwa.online && (
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-amber/40 bg-panel/95 backdrop-blur-xl px-3 py-1.5 shadow-xl text-[11px] font-bold text-amber">
          <WifiOff size={13} /> Offline — saved app shown, changes need a connection
        </div>
      )}
    </div>
  );
}
