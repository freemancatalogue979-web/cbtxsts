import { lazy, Suspense, useEffect, useState } from "react";
import { api, getToken, setToken } from "./lib/api";
import { ensureArtIndex } from "./lib/mlbb";
import { readAIWorkspaceLayout, saveAIWorkspaceLayout, type AIWorkspaceLayout } from "./lib/cloverAI";
import { applyFontChoice, readFontChoice, saveFontChoice, type FontChoice } from "./lib/fontPrefs";
import { applyTheme, parseSection, readThemePrefs, saveThemePrefs, type ThemePrefs } from "./lib/theme";
import type { Meta, User } from "./lib/types";
import { hashRoute } from "./lib/util";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
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
  const [aiLayout, setAILayout] = useState(() => readAIWorkspaceLayout(deviceStorage()));
  const [font, setFont] = useState<FontChoice>(() => readFontChoice(deviceStorage()));
  const [theme, setTheme] = useState<ThemePrefs>(() => readThemePrefs(deviceStorage()));
  const route = useRoute();
  // Before sign-in there is no area yet, so the theme is the login look.
  const section = user ? parseSection(route[0] || "dashboard") : "login";

  useEffect(() => { saveAIWorkspaceLayout(deviceStorage(), aiLayout); }, [aiLayout]);
  useEffect(() => { applyFontChoice(font); saveFontChoice(deviceStorage(), font); }, [font]);
  useEffect(() => { applyTheme(theme, section); saveThemePrefs(deviceStorage(), theme); }, [theme, section]);

  useEffect(() => {
    const refreshMeta = () => { void api.get<Meta>("/meta").then(setMeta).catch(() => undefined); };
    window.addEventListener("clover:meta-changed", refreshMeta);
    return () => window.removeEventListener("clover:meta-changed", refreshMeta);
  }, []);

  useEffect(() => {
    async function boot() {
      if (getToken()) {
        try {
          const me = await api.get<User>("/auth/me");
          setUser(me);
        } catch {
          setToken(null);
        }
      }
      setBooting(false);
    }
    boot();
    const onUnauthorized = () => setUser(null);
    window.addEventListener("clover:unauthorized", onUnauthorized);
    return () => window.removeEventListener("clover:unauthorized", onUnauthorized);
  }, []);

  useEffect(() => {
    if (user && !meta) {
      api.get<Meta>("/meta").then(setMeta).catch(() => setMeta(null));
      ensureArtIndex(); // warm the official CDN artwork cache (fire-and-forget)
    }
  }, [user, meta]);

  if (booting) {
    return <div className="min-h-screen flex items-center justify-center"><Spinner label="Waking up the hub" /></div>;
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
    case "admin":
      page = <AdminPage me={user} meta={meta} />;
      break;
    default:
      page = <DashboardPage me={user} />;
  }

  return (
    <Layout user={user} onUserUpdate={setUser} font={font} onFontChange={setFont}
      theme={theme} onThemeChange={setTheme} section={section}
      hideDesktopNav={section === "ai" && !aiLayout.navigationOpen}
      onLogout={() => { api.post("/auth/logout").catch(() => undefined); setToken(null); setUser(null); window.location.hash = "/login"; }}>
      <Suspense fallback={<Spinner label="Opening" />}>{page}</Suspense>
    </Layout>
  );
}
