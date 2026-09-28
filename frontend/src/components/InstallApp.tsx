/**
 * "Install app" everywhere it makes sense: landing header, the app top bar,
 * the Menu sheet, Profile, and a dismissible banner.
 *
 * One tap installs where the browser offers its prompt (Chrome, Edge, Samsung
 * Internet, Opera on Android and desktop). Everywhere else the same buttons
 * open short steps for that exact browser (iPhone Safari, Firefox, Opera Mini,
 * or a plain-http link, which no browser can install from).
 */
import {AlertTriangle, CheckCircle2, ChevronDown, Download, EllipsisVertical, ExternalLink, Globe, Loader2, Lock, MonitorDown, Plus, RefreshCw, Share, Smartphone, SquarePlus, X, XCircle} from 'lucide-react';
import {useEffect, useState, type ReactNode} from 'react';
import {
  inAppBrowser,
  inFrame,
  installPlatform,
  openInChromeUrl,
  runInstallChecks,
  useInstallPrompt,
  type InstallCheck,
  type InstallPlatform,
} from '../lib/pwa';
import {useSession} from '../store/session';
import {Button, IconButton, IconOrb, Modal} from './ui';

const DISMISS_KEY = 'arena.install.dismissed';
const DISMISS_DAYS = 7;

/** Tap handler shared by every install entry point. */
function useInstallAction() {
  const state = useInstallPrompt();
  const {toast} = useSession();
  const [helpOpen, setHelpOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!state.canPrompt) {
      setHelpOpen(true);
      return;
    }
    setBusy(true);
    try {
      const accepted = await state.install();
      if (accepted) toast('success', 'Absolute Genesis installed', 'Open it from your home screen or app list.');
    } finally {
      setBusy(false);
    }
  };
  const help = <InstallHelp open={helpOpen} onClose={() => setHelpOpen(false)} />;
  return {...state, run, busy, help};
}

type Variant = 'pill' | 'icon' | 'tile' | 'card';

/** An install entry point. Renders nothing once the app is installed. */
export default function InstallApp({variant = 'card', className = ''}: {variant?: Variant; className?: string}) {
  const action = useInstallAction();
  if (action.installed) return null;

  if (variant === 'icon') {
    return (
      <>
        <IconButton label="Install app" variant="outline" className={className} onClick={action.run}>
          <Download className="size-[17px] text-nova-300" />
        </IconButton>
        {action.help}
      </>
    );
  }

  if (variant === 'pill') {
    return (
      <>
        <Button size="sm" variant="soft" loading={action.busy} onClick={action.run} icon={<Download className="size-3.5" />} className={className}>
          <span className="hidden min-[380px]:inline">Install app</span>
          <span className="min-[380px]:hidden">Install</span>
        </Button>
        {action.help}
      </>
    );
  }

  if (variant === 'tile') {
    return (
      <>
        <button
          type="button"
          onClick={action.run}
          className={`gpress flex min-w-0 flex-col items-center gap-1.5 rounded-2xl border-2 border-nova-400/40 bg-nova-500/12 p-2.5 ${className}`}
        >
          <IconOrb tone="nova" size="sm">
            <Download className="size-4" />
          </IconOrb>
          <span className="w-full truncate text-center text-[0.7rem] font-extrabold text-mist-100">Install app</span>
        </button>
        {action.help}
      </>
    );
  }

  return (
    <>
      <div className={`flex flex-wrap items-center gap-3 rounded-2xl border border-nova-400/20 bg-nova-500/[0.07] px-4 py-3.5 sm:rounded-3xl sm:px-5 ${className}`}>
        <img src="/brand/icon-192.png" alt="" className="size-11 shrink-0 rounded-xl" width={44} height={44} />
        <div className="min-w-0 flex-1">
          <p className="text-[0.86rem] font-black text-mist-50">Install Absolute Genesis</p>
          <p className="text-[0.74rem] font-semibold leading-snug text-mist-400">
            Opens from your home screen like any app, loads faster and keeps working on a weak network.
          </p>
        </div>
        <Button size="sm" loading={action.busy} onClick={action.run} icon={<Download className="size-3.5" />}>
          {action.canPrompt ? 'Install' : 'How to install'}
        </Button>
      </div>
      {action.help}
    </>
  );
}

/**
 * Dismissible install banner. Shown when the browser is ready to install (or
 * on iPhone, where installing is manual), hidden for a week after "Not now".
 */
export function InstallBanner({className = ''}: {className?: string}) {
  const action = useInstallAction();
  const [dismissed, setDismissed] = useState(() => {
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
      return Date.now() - at < DISMISS_DAYS * 86_400_000;
    } catch {
      return false;
    }
  });
  const manual = action.platform === 'ios-safari' || action.platform === 'ios-other';
  if (action.installed || dismissed || (!action.canPrompt && !manual)) return action.help;
  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode: hide for this visit only */
    }
  };
  return (
    <>
      <div
        role="region"
        aria-label="Install Absolute Genesis"
        className={`flex items-center gap-3 rounded-2xl border border-nova-400/25 bg-gradient-to-r from-nova-500/[0.14] to-fuchsia-500/[0.08] p-2.5 pr-2 sm:p-3 ${className}`}
      >
        <img src="/brand/icon-192.png" alt="" className="size-10 shrink-0 rounded-xl" width={40} height={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.82rem] font-black text-mist-50">Get the Absolute Genesis app</p>
          <p className="text-[0.7rem] font-semibold leading-snug text-mist-400">Home-screen icon, full screen, works on weak network.</p>
        </div>
        <Button size="sm" loading={action.busy} onClick={action.run} icon={<Download className="size-3.5" />}>
          Install
        </Button>
        <IconButton label="Not now" size="sm" onClick={close}>
          <X className="size-4 text-mist-400" />
        </IconButton>
      </div>
      {action.help}
    </>
  );
}

/* --------------------------------------------------------------- help */

function Step({n, icon, children}: {n: number; icon?: ReactNode; children: ReactNode}) {
  return (
    <li className="flex items-start gap-3">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-nova-500/18 text-[0.76rem] font-black text-nova-100">{n}</span>
      <span className="min-w-0 flex-1 pt-0.5 text-[0.84rem] font-semibold leading-relaxed text-mist-200">
        {children}
        {icon && <span className="ml-1.5 inline-grid size-6 translate-y-1 place-items-center rounded-md border border-white/12 bg-white/[0.05] text-mist-100">{icon}</span>}
      </span>
    </li>
  );
}

function steps(platform: InstallPlatform): {title: string; body: ReactNode} {
  switch (platform) {
    case 'insecure':
      return {
        title: 'Open the secure link to install',
        body: (
          <>
            <p className="text-[0.84rem] font-semibold leading-relaxed text-mist-300">
              Browsers only install apps from a secure <b className="text-mist-100">https://</b> address. This page is open on
              <b className="text-mist-100"> {location.host}</b> over plain http, so the install option is switched off by the browser itself.
            </p>
            <ol className="mt-3 space-y-2.5">
              <Step n={1} icon={<Lock className="size-3.5" />}>Open Absolute Genesis from its https:// link (the one your admin shares).</Step>
              <Step n={2}>Tap <b>Install app</b> again. It will install in one tap.</Step>
            </ol>
            <p className="mt-3 text-[0.74rem] font-semibold leading-relaxed text-mist-500">
              Running it yourself? On the same computer, http://localhost:5173 installs fine. For phones, put the site on an https host or an https tunnel (see README, “Install as an app”).
            </p>
          </>
        ),
      };
    case 'ios-safari':
      return {
        title: 'Install on iPhone or iPad',
        body: (
          <ol className="space-y-2.5">
            <Step n={1} icon={<Share className="size-3.5" />}>Tap the Share button in Safari’s toolbar</Step>
            <Step n={2} icon={<SquarePlus className="size-3.5" />}>Scroll down and tap <b>Add to Home Screen</b></Step>
            <Step n={3}>Tap <b>Add</b>. Absolute Genesis appears on your home screen and opens full screen.</Step>
          </ol>
        ),
      };
    case 'ios-other':
      return {
        title: 'Install on iPhone or iPad',
        body: (
          <ol className="space-y-2.5">
            <Step n={1} icon={<Share className="size-3.5" />}>Tap the Share button (in Chrome it’s next to the address bar)</Step>
            <Step n={2} icon={<SquarePlus className="size-3.5" />}>Tap <b>Add to Home Screen</b></Step>
            <Step n={3}>Not there? Open this page in <b>Safari</b> and do the same.</Step>
          </ol>
        ),
      };
    case 'opera-mini':
      return {
        title: 'Use Chrome to install',
        body: (
          <ol className="space-y-2.5">
            <Step n={1} icon={<Globe className="size-3.5" />}>Opera Mini can’t install apps. Open this same link in <b>Chrome</b> (or Samsung Internet).</Step>
            <Step n={2}>Tap <b>Install app</b> there. It installs in one tap.</Step>
          </ol>
        ),
      };
    case 'samsung':
      return {
        title: 'Install with Samsung Internet',
        body: (
          <ol className="space-y-2.5">
            <Step n={1} icon={<Plus className="size-3.5" />}>Tap the install icon in the address bar, or open the menu ☰</Step>
            <Step n={2}>Choose <b>Add page to</b> → <b>Home screen</b> (or <b>Install</b>)</Step>
            <Step n={3}>Confirm. Absolute Genesis appears with your apps.</Step>
          </ol>
        ),
      };
    case 'firefox-android':
      return {
        title: 'Install with Firefox',
        body: (
          <ol className="space-y-2.5">
            <Step n={1} icon={<EllipsisVertical className="size-3.5" />}>Open the menu ⋮</Step>
            <Step n={2}>Tap <b>Install</b> (or <b>Add to Home screen</b>)</Step>
            <Step n={3}>Confirm. Absolute Genesis appears on your home screen.</Step>
          </ol>
        ),
      };
    case 'android':
      return {
        title: 'Install on Android',
        body: (
          <ol className="space-y-2.5">
            <Step n={1} icon={<EllipsisVertical className="size-3.5" />}>Open the browser menu ⋮ (top right)</Step>
            <Step n={2} icon={<Smartphone className="size-3.5" />}>Tap <b>Install app</b> or <b>Add to Home screen</b></Step>
            <Step n={3}>Tap <b>Install</b>. Absolute Genesis appears with your other apps.</Step>
          </ol>
        ),
      };
    case 'desktop-chromium':
      return {
        title: 'Install on this computer',
        body: (
          <ol className="space-y-2.5">
            <Step n={1} icon={<MonitorDown className="size-3.5" />}>Click the install icon at the right end of the address bar</Step>
            <Step n={2}>Or open the menu ⋮ → <b>Cast, save and share</b> → <b>Install page as app</b> (Edge: <b>Apps</b> → <b>Install this site as an app</b>)</Step>
            <Step n={3}>Click <b>Install</b>. It opens in its own window from your Start menu or dock.</Step>
          </ol>
        ),
      };
    case 'desktop-safari':
      return {
        title: 'Install on your Mac',
        body: (
          <ol className="space-y-2.5">
            <Step n={1}>In Safari’s menu bar choose <b>File</b> → <b>Add to Dock</b></Step>
            <Step n={2}>Click <b>Add</b>. Absolute Genesis opens from the Dock like any app.</Step>
          </ol>
        ),
      };
    case 'desktop-firefox':
      return {
        title: 'Use Chrome or Edge to install',
        body: (
          <ol className="space-y-2.5">
            <Step n={1} icon={<Globe className="size-3.5" />}>Firefox on computers can’t install web apps. Open this link in <b>Chrome</b> or <b>Edge</b>.</Step>
            <Step n={2}>Click <b>Install app</b> there.</Step>
          </ol>
        ),
      };
    default:
      return {
        title: 'Install Absolute Genesis',
        body: (
          <ol className="space-y-2.5">
            <Step n={1} icon={<EllipsisVertical className="size-3.5" />}>Open your browser menu</Step>
            <Step n={2}>Choose <b>Install app</b> or <b>Add to Home screen</b></Step>
            <Step n={3}>If there’s no such option, open this link in Chrome.</Step>
          </ol>
        ),
      };
  }
}

/** Live "why can't I install?" checklist, run on the player's own device. */
function InstallChecks({open}: {open: boolean}) {
  const [checks, setChecks] = useState<InstallCheck[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const run = () => {
    setChecks(null);
    runInstallChecks()
      .then(setChecks)
      .catch(() => setChecks([]));
  };
  useEffect(() => {
    if (open) run();
  }, [open]);
  const failing = checks?.filter((check) => check.state === 'fail') ?? [];
  useEffect(() => {
    if (failing.length > 0) setExpanded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failing.length]);
  const icon = (state: InstallCheck['state']) =>
    state === 'ok' ? (
      <CheckCircle2 className="size-4 shrink-0 text-mint-400" />
    ) : state === 'fail' ? (
      <XCircle className="size-4 shrink-0 text-flare-400" />
    ) : state === 'warn' ? (
      <AlertTriangle className="size-4 shrink-0 text-gold-300" />
    ) : (
      <Loader2 className="size-4 shrink-0 animate-spin text-mist-400" />
    );
  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02]">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left" aria-expanded={expanded}>
        {checks === null ? (
          <Loader2 className="size-4 animate-spin text-mist-400" />
        ) : failing.length ? (
          <XCircle className="size-4 text-flare-400" />
        ) : (
          <CheckCircle2 className="size-4 text-mint-400" />
        )}
        <span className="min-w-0 flex-1 text-[0.8rem] font-black text-mist-100">
          Install check{checks === null ? '…' : failing.length ? ` · ${failing.length} problem${failing.length === 1 ? '' : 's'} found` : ' · this device can install'}
        </span>
        <ChevronDown className={`size-4 text-mist-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="border-t border-white/8 px-3 pt-2 pb-3">
          <ul className="space-y-2">
            {(checks ?? []).map((check) => (
              <li key={check.id} className="flex items-start gap-2">
                <span className="pt-0.5">{icon(check.state)}</span>
                <span className="min-w-0">
                  <span className="block text-[0.76rem] font-extrabold text-mist-100">{check.label}</span>
                  <span className="block break-words text-[0.72rem] font-semibold leading-snug text-mist-400">{check.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={run} icon={<RefreshCw className="size-3.5" />}>
              Check again
            </Button>
          </div>
          <p className="mt-2 text-[0.66rem] font-semibold text-mist-600">Still stuck? Screenshot this list and send it to your admin.</p>
        </div>
      )}
    </div>
  );
}

export function InstallHelp({open, onClose}: {open: boolean; onClose: () => void}) {
  const platform = installPlatform();
  const iab = inAppBrowser();
  const framed = inFrame();
  const android = /android/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const {title, body} = iab
    ? {
        title: 'Open in Chrome first',
        body: (
          <>
            <p className="text-[0.84rem] font-semibold leading-relaxed text-mist-300">
              You opened the link inside <b className="text-mist-100">{iab}</b>. Apps can’t be installed from there. Open it in Chrome, then tap Install app.
            </p>
            {android && (
              <a href={openInChromeUrl()} className="mt-3 inline-flex">
                <Button size="sm" icon={<ExternalLink className="size-3.5" />}>
                  Open in Chrome
                </Button>
              </a>
            )}
            <ol className="mt-3 space-y-2.5">
              <Step n={1} icon={<EllipsisVertical className="size-3.5" />}>Or tap the menu ⋮ at the top right</Step>
              <Step n={2}>Choose <b>Open in Chrome</b> (or <b>Open in browser</b>)</Step>
            </ol>
          </>
        ),
      }
    : framed
      ? {
          title: 'Open in its own tab',
          body: (
            <>
              <p className="text-[0.84rem] font-semibold leading-relaxed text-mist-300">
                Absolute Genesis is showing inside another page (a preview frame). Browsers only install a site opened in its own tab.
              </p>
              <a href={location.href} target="_blank" rel="noreferrer" className="mt-3 inline-flex">
                <Button size="sm" icon={<ExternalLink className="size-3.5" />}>
                  Open in new tab
                </Button>
              </a>
            </>
          ),
        }
      : steps(platform);
  return (
    <Modal open={open} onClose={onClose} title={title} subtitle="Takes about 10 seconds. No app store needed." size="sm" footer={<Button variant="outline" onClick={onClose}>Got it</Button>}>
      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <img src="/brand/icon-192.png" alt="" className="size-12 shrink-0 rounded-xl" width={48} height={48} />
        <div className="min-w-0">
          <p className="text-[0.9rem] font-black text-mist-50">Absolute Genesis</p>
          <p className="flex items-center gap-1 text-[0.72rem] font-semibold text-mist-400">
            <CheckCircle2 className="size-3.5 text-mint-400" /> Free · small download · works offline
          </p>
        </div>
      </div>
      <div className="mt-4">{body}</div>
      <InstallChecks open={open} />
    </Modal>
  );
}
