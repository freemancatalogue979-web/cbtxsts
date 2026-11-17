import { Fragment, lazy, Suspense, useEffect, useState } from "react";
import { api, ApiError, getToken, RESTORED_EVENT, setToken } from "./lib/api";
import { ensureArtIndex } from "./lib/mlbb";
import { readAIWorkspaceLayout, saveAIWorkspaceLayout, type AIWorkspaceLayout } from "./lib/cloverAI";
import { applyTheme, parseSection, readThemePrefs, saveThemePrefs, type ThemePrefs } from "./lib/theme";
import type { Meta, User } from "./lib/types";
import { hashRoute } from "./lib/util";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { BrandImg } from "./components/Logo";
import { WifiOff } from "lucide-react";
import { Login } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";

// Pages load on first visit, so a phone downloads the dashboard first instead of
// the whole hub. Login and the dashboard stay in the main bundle for instant paint.
const TrainingPage = lazy(() => import("./pages/Training").then((m) => ({ default: m.TrainingPage })));
const ScrimsPage = lazy(() => import("./pages/Scrims").then((m) => ({ default: m.ScrimsPage })));
const TournamentsPage = lazy(() => import("./pages/Tournaments").then((m) => ({ default: m.TournamentsPage })));
const ReviewsPage = lazy(() => import("./pages/Reviews").then((m) => ({ default: m.ReviewsPage })));
const HeroesPage = lazy(() => import("./pages/Heroes").then((m) => ({ default: m.HeroesPage })));
const IntelPage = lazy(() => import("./pages/Intel").then((m) => ({ default: m.IntelPage })));
const EsportsPage = lazy(() => import("./pages/Esports").then((m) => ({ default: m.EsportsPage })));
const CloverAIPage = lazy(() => import("./pages/CloverAI").then((m) => ({ default: m.CloverAIPage })));
const AccountMLBBPage = lazy(() => import("./pages/AccountMLBB").then((m) => ({ default: m.AccountMLBBPage })));
const PlayersPage = lazy(() => import("./pages/Players").then((m) => ({ default: m.PlayersPage })));
const BansPage = lazy(() => import("./pages/Bans").then((m) => ({ default: m.BansPage })));
const DraftsPage = lazy(() => import("./pages/Drafts").then((m) => ({ default: m.DraftsPage })));
const MapsPage = lazy(() => import("./pages/Maps").then((m) => ({ default: m.MapsPage })));
const NotificationsPage = lazy(() => import("./pages/Notifications").then((m) => ({ default: m.NotificationsPage })));
const StrategyPage = lazy(() => import("./pages/Strategy").then((m) => ({ default: m.StrategyPage })));
const EventsPage = lazy(() => import("./pages/Events").then((m) => ({ default: m.EventsPage })));
const ArchivePage = lazy(() => import("./pages/Archive").then((m) => ({ default: m.ArchivePage })));
const TrashPage = lazy(() => import("./pages/Trash").then((m) => ({ default: m.TrashPage })));
const AdminPage = lazy(() => import("./pages/Admin").then((m) => ({ default: m.AdminPage })));

function deviceStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

function useRoute() {
  const [route, setRoute] = useState<string[]>(hashRoute());
  useEffect(() => {
    const onHash = () => setRoute(hashRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [booting, setBooting] = useState(true);
  // The hub could not be reached (no signal, server restarting). The session is
  // kept — only a real 401 signs a member out — and the app retries by itself.
  const [unreachable, setUnreachable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [aiLayout, setAILayout] = useState(() => readAIWorkspaceLayout(deviceStorage()));
  const [theme, setTheme] = useState<ThemePrefs>(() => readThemePrefs(deviceStorage()));
  const route = useRoute();
  // Before sign-in there is no area yet, so the theme is the login look.
  const section = user ? parseSection(route[0] || "dashboard") : "login";

  useEffect(() => { saveAIWorkspaceLayout(deviceStorage(), aiLayout); }, [aiLayout]);
  useEffect(() => { applyTheme(theme, section); saveThemePrefs(deviceStorage(), theme); }, [theme, section]);
  // Undo from the Trash toast: remount the open page so it shows the restored item.
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const bump = () => setRevision((r) => r + 1);
    window.addEventListener(RESTORED_EVENT, bump);
    return () => window.removeEventListener(RESTORED_EVENT, bump);
  }, []);

  useEffect(() => {
    const refreshMeta = () => { void api.get<Meta>("/meta").then(setMeta).catch(() => undefined); };
    window.addEventListener("clover:meta-changed", refreshMeta);
    return () => window.removeEventListener("clover:meta-changed", refreshMeta);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (getToken()) {
        try {
          const me = await api.get<User>("/auth/me");
          if (!cancelled) { setUser(me); setUnreachable(false); }
        } catch (error) {
          // A 401 already cleared the token in the API client: show sign-in.
          // Anything else must not sign the member out of an installed app.
          if (!cancelled && getToken() && !(error instanceof ApiError && error.status === 401)) setUnreachable(true);
        }
      }
      if (!cancelled) setBooting(false);
    }
    boot();
    return () => { cancelled = true; };
  }, [attempt]);

  useEffect(() => {
    if (!unreachable) return;
    const retry = () => setAttempt((n) => n + 1);
    const timer = window.setInterval(retry, 10_000);
    window.addEventListener("online", retry);
    return () => { window.clearInterval(timer); window.removeEventListener("online", retry); };
  }, [unreachable]);

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener("clover:unauthorized", onUnauthorized);
    return () => window.removeEventListener("clover:unauthorized", onUnauthorized);
  }, []);

  useEffect(() => {
    if (user && !meta) {
      api.get<Meta>("/meta").then((value) => { setMeta(value); setUnreachable(false); })
        .catch((error) => { if (!(error instanceof ApiError && error.status === 401)) setUnreachable(true); });
      ensureArtIndex(); // warm the official CDN artwork cache (fire-and-forget)
    }
  }, [user, meta, attempt]);

  if (booting) {
    return <div className="min-h-screen flex items-center justify-center"><Spinner label="Waking up the hub" /></div>;
  }

  if (unreachable && (!user || !meta)) {
    return <Unreachable onRetry={() => setAttempt((n) => n + 1)} />;
  }

  if (!user) {
    return <Login onLogin={(u) => { setUser(u); window.location.hash = "/dashboard"; }} />;
  }

  if (!meta) {
    return <div className="min-h-screen flex items-center justify-center"><Spinner label="Loading reference data" /></div>;
  }

  const rest = route.slice(1);
  const toggleAILayout = (key: keyof AIWorkspaceLayout) => setAILayout((previous) => ({ ...previous, [key]: !previous[key] }));

  let page: React.ReactNode;
  switch (section) {
    case "ai":
      page = <CloverAIPage me={user} desktopLayout={aiLayout} onToggleDesktopLayout={toggleAILayout} />;
      break;
    case "training":
      page = <TrainingPage me={user} meta={meta} parts={rest} />;
      break;
    case "tournaments":
      page = <TournamentsPage me={user} meta={meta} parts={rest} />;
      break;
    case "scrims":
      page = <ScrimsPage me={user} meta={meta} parts={rest} />;
      break;
    case "reviews":
      page = <ReviewsPage me={user} meta={meta} parts={rest} />;
      break;
    case "heroes":
      page = <HeroesPage me={user} meta={meta} parts={rest} />;
      break;
    case "intel":
      page = <IntelPage me={user} parts={rest} />;
      break;
    case "esports":
      page = <EsportsPage me={user} />;
      break;
    case "mlbb":
      page = <AccountMLBBPage />;
      break;
    case "players":
      page = <PlayersPage me={user} meta={meta} parts={rest} />;
      break;
    case "bans":
      page = <BansPage me={user} meta={meta} />;
      break;
    case "drafts":
      page = <DraftsPage me={user} meta={meta} parts={rest} />;
      break;
    case "maps":
      page = <MapsPage me={user} parts={rest} />;
      break;
    case "strategy":
      page = <StrategyPage me={user} meta={meta} />;
      break;
    case "events":
      page = <EventsPage me={user} meta={meta} />;
      break;
    case "archive":
      page = <ArchivePage me={user} parts={rest} />;
      break;
    case "notifications":
      page = <NotificationsPage me={user} />;
      break;
    case "trash":
      page = <TrashPage me={user} />;
      break;
    case "admin":
      page = <AdminPage me={user} meta={meta} />;
      break;
    default:
      page = <DashboardPage me={user} />;
  }
  // A new key after Undo remounts the page, so it refetches and shows the restored item.
  page = <Fragment key={revision}>{page}</Fragment>;

  return (
    <Layout user={user} onUserUpdate={setUser}
      theme={theme} onThemeChange={setTheme} section={section}
      hideDesktopNav={section === "ai" && !aiLayout.navigationOpen}
      onLogout={() => { api.post("/auth/logout").catch(() => undefined); setToken(null); setUser(null); window.location.hash = "/login"; }}>
      <Suspense fallback={<Spinner label="Opening" />}>{page}</Suspense>
    </Layout>
  );
}

/** Shown when the hub can't be reached at start-up. The member stays signed in. */
function Unreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="min-h-screen bg-ink flex items-center justify-center p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="card w-full max-w-sm p-6 text-center" role="alert">
        <div className="flex justify-center"><BrandImg size={64} /></div>
        <div className="mt-4 inline-flex items-center gap-2 text-amber text-[12px] font-bold"><WifiOff size={15} /> Can't reach the hub</div>
        <p className="mt-2 text-[12.5px] text-mute leading-relaxed">No connection right now. You're still signed in, and the hub reconnects by itself as soon as the signal is back.</p>
        <button type="button" className="btn-primary w-full justify-center mt-5" onClick={onRetry}>Try again</button>
      </div>
    </div>
  );
}
