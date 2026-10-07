import { useEffect, useState } from "react";
import { api, getToken, setToken } from "./lib/api";
import type { Meta, User } from "./lib/types";
import { hashRoute } from "./lib/util";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { Login } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { TrainingPage } from "./pages/Training";
import { ScrimsPage } from "./pages/Scrims";
import { ReviewsPage } from "./pages/Reviews";
import { HeroesPage } from "./pages/Heroes";
import { PlayersPage } from "./pages/Players";
import { BansPage } from "./pages/Bans";
import { DraftsPage } from "./pages/Drafts";
import { MapsPage } from "./pages/Maps";
import { StrategyPage } from "./pages/Strategy";
import { EventsPage } from "./pages/Events";
import { AdminPage } from "./pages/Admin";

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
  const route = useRoute();

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

  const section = route[0] || "dashboard";
  const rest = route.slice(1);

  let page: React.ReactNode;
  switch (section) {
    case "training":
      page = <TrainingPage me={user} meta={meta} parts={rest} />;
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
    case "admin":
      page = <AdminPage me={user} meta={meta} />;
      break;
    default:
      page = <DashboardPage />;
  }

  return (
    <Layout user={user} onUserUpdate={setUser} onLogout={() => { setToken(null); setUser(null); window.location.hash = "/login"; }}>
      {page}
    </Layout>
  );
}
