/** "Install app" card: only shown when this phone can add Quiz Arena to its home screen. */
import {Download, Share} from 'lucide-react';
import {useState} from 'react';
import {useInstallPrompt} from '../lib/pwa';
import {Button} from './ui';

export default function InstallApp() {
  const {canInstall, iosHint, install} = useInstallPrompt();
  const [busy, setBusy] = useState(false);
  if (!canInstall && !iosHint) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-nova-400/20 bg-nova-500/[0.07] px-4 py-3.5 sm:rounded-3xl sm:px-5">
      <img src="/brand/icon-192.png" alt="" className="size-11 shrink-0 rounded-xl" width={44} height={44} />
      <div className="min-w-0 flex-1">
        <p className="text-[0.86rem] font-black text-mist-50">Install Quiz Arena</p>
        <p className="text-[0.74rem] font-semibold leading-snug text-mist-400">
          {canInstall
            ? 'Opens from your home screen, loads faster and keeps working on a weak network.'
            : 'On iPhone: tap Share, then “Add to Home Screen”.'}
        </p>
      </div>
      {canInstall ? (
        <Button
          size="sm"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await install();
            } finally {
              setBusy(false);
            }
          }}
          icon={<Download className="size-3.5" />}
        >
          Install
        </Button>
      ) : (
        <Share className="size-5 shrink-0 text-nova-200" aria-hidden />
      )}
    </div>
  );
}
