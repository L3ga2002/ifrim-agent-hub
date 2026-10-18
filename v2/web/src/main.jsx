import { StrictMode, Suspense, lazy, useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./styles/app.css";
import "./styles/m02.css";
import "./styles/m06.css";
import "./styles/m07.css";
import "./styles/m10.css";
import "./styles/lega-one.css";
import { startHubConnection, useHub, setState } from "./store.js";
import { api } from "./api.js";
import { Shell } from "./shell/Shell.jsx";
import { Loading } from "./components/ui.jsx";
import { navigate } from "./nav.js";
import { ensureOwnerSession } from "./lib/ownerSession.js";

const screens = {
  // M06: Lega 2.0 — the cockpit you drive by intent (the start screen); the full dashboard stays one click away.
  lega: lazy(() => import("./screens/Lega.jsx")),
  control: lazy(() => import("./screens/ControlRoom.jsx")),
  conversations: lazy(() => import("./screens/Conversations.jsx")),
  focus: lazy(() => import("./screens/Focus.jsx")),
  missions: lazy(() => import("./screens/Missions.jsx")),
  agents: lazy(() => import("./screens/Agents.jsx")),
  projects: lazy(() => import("./screens/Projects.jsx")),
  memory: lazy(() => import("./screens/Memory.jsx")),
  approvals: lazy(() => import("./screens/Approvals.jsx")),
  tools: lazy(() => import("./screens/Tools.jsx")),
  integrations: lazy(() => import("./screens/Integrations.jsx")),
  health: lazy(() => import("./screens/Health.jsx")),
  sales: lazy(() => import("./screens/Sales.jsx")),
  company: lazy(() => import("./screens/Company.jsx")),
  ecosystem: lazy(() => import("./screens/Ecosystem.jsx")),
  system: lazy(() => import("./screens/System.jsx")),
  settings: lazy(() => import("./screens/Settings.jsx")),
  // M08: project autopilot & company intelligence, and the phone's own screen (rendered without the desktop shell).
  intel: lazy(() => import("./screens/Intel.jsx")),
  m: lazy(() => import("./screens/Mobile.jsx")),
  // M09: Content Studio (#/studio, #/studio/<tab>, #/studio/<contentProjectId>?sub=…&t=12.5).
  studio: lazy(() => import("./screens/Studio.jsx")),
  // M10: Desktop Operator (apps, import folders, plans, recent actions).
  desktop: lazy(() => import("./screens/Desktop.jsx")),
  // M11: the Delivery Room (#/livrare/<dlv>, #/livrare?projectId=…) and „Deciziile mele” (#/livrare/decizii).
  livrare: lazy(() => import("./screens/DeliveryRoom.jsx")),
};

export function parseRoute(hash) {
  const [pathPart, queryPart = ""] = hash.replace(/^#\/?/, "").split("?");
  const parts = pathPart.split("/").filter(Boolean).map(decodeURIComponent);
  const [name = "lega", id = null] = parts;
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  // Focus is the conversation workspace: /conversations (list + empty center) and /conversations/:id.
  if (name === "conversations") return { name: "focus", id, query };
  return { name: screens[name] ? name : "lega", id, query };
}

/**
 * M10.2 probe (U03): the old-flow screen a route enters, as the fixed key owner.nav accepts (server/owner/probe.mjs NAV_SCREENS),
 * or null. Only the screen key is ever sent — never an id, a query value or text. Integrations has no sub-route for its panels:
 * plain #/integrations is the "Validare live" panel (mode, gate, grant form); ?panel=isolation names the isolation panel.
 */
export function navScreenOf(route) {
  if (route.name === "integrations") return route.query?.panel === "isolation" ? "integrations.isolation" : "integrations.live";
  if (route.name === "approvals") return "approvals";
  if (route.name === "system" && route.query?.tab === "environments") return "system.environments";
  if (route.name === "missions" && route.query?.factory) return "missions.factory";
  if (route.name === "focus") return "focus.composer";
  return null;
}

function App() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // M10.2 probe: report ENTERING one of the counted screens (once per entry, not per re-render or id change inside it). Telemetry
  // only: a failure is ignored and never shown; the ref also absorbs StrictMode's double effect run.
  const lastNav = useRef(null);
  const navKey = navScreenOf(route);
  useEffect(() => {
    if (navKey === lastNav.current) return;
    lastNav.current = navKey;
    if (navKey) api("/api/owner/nav", { method: "POST", body: { screen: navKey } }).catch(() => {});
  }, [navKey]);
  useEffect(() => startHubConnection(), []);
  // Stage before M12: under the instance's local development profile the owner session opens without a dialog, and stays open
  // (re-checked every 5 minutes: a profile turned off ends it on the Hub, and the badge goes away).
  const [devMode, setDevMode] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = () => ensureOwnerSession().then((on) => { if (alive) setDevMode(Boolean(on)); });
    check();
    const timer = setInterval(check, 5 * 60000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  // M08 Zero-Menu: a plain start (no screen in the address) opens what the owner chose — the cockpit or the big Lega screen.
  useEffect(() => {
    const h = window.location.hash;
    if (h && h !== "#" && h !== "#/") return;
    api("/api/owner/start-view").then((r) => { if (r?.startView === "stage") setState({ stageOpen: true }); }).catch(() => {});
  }, []);
  useEffect(() => { document.getElementById("main")?.focus({ preventScroll: true }); }, [route.name]);
  const Screen = screens[route.name];
  const loading = useHub((s) => s.loading);
  const go = useCallback((path) => navigate(path), []);
  if (route.name === "m") return <Suspense fallback={<div className="mobile-app"><Loading lines={4} /></div>}><Screen /></Suspense>;
  return (
    <Shell route={route} go={go}>
      <Suspense fallback={<div className="page"><Loading lines={5} /></div>}>
        {loading ? <div className="page"><Loading lines={5} /></div> : <Screen id={route.id} query={route.query} go={go} key={`${route.name}:${route.id || ""}`} />}
      </Suspense>
      {devMode && <div className="dev-profile-badge" role="status" title="Sesiunea de proprietar e deschisă de profilul de dezvoltare locală al acestui Hub, fără Windows Hello (auditat). Se oprește cu: node v2/scripts/dev-profile.mjs off"
        style={{ position: "fixed", left: 12, bottom: 12, zIndex: 50, fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "var(--surface-2, rgba(0,0,0,.6))", color: "var(--text-2, #ccc)", opacity: 0.75, pointerEvents: "auto" }}>Mod dezvoltare locală</div>}
    </Shell>
  );
}

createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>);
