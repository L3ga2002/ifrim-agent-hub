import { StrictMode, Suspense, lazy, useEffect, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import "./styles/app.css";
import { startHubConnection, useHub } from "./store.js";
import { Shell } from "./shell/Shell.jsx";
import { Loading } from "./components/ui.jsx";
import { navigate } from "./nav.js";

const screens = {
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
  company: lazy(() => import("./screens/Company.jsx")),
  ecosystem: lazy(() => import("./screens/Ecosystem.jsx")),
  system: lazy(() => import("./screens/System.jsx")),
  settings: lazy(() => import("./screens/Settings.jsx")),
};

export function parseRoute(hash) {
  const [pathPart, queryPart = ""] = hash.replace(/^#\/?/, "").split("?");
  const parts = pathPart.split("/").filter(Boolean).map(decodeURIComponent);
  const [name = "control", id = null] = parts;
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  if (name === "conversations" && id) return { name: "focus", id, query };
  return { name: screens[name] ? name : "control", id, query };
}


function App() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => startHubConnection(), []);
  useEffect(() => { document.getElementById("main")?.focus({ preventScroll: true }); }, [route.name]);
  const Screen = screens[route.name];
  const loading = useHub((s) => s.loading);
  const go = useCallback((path) => navigate(path), []);
  return (
    <Shell route={route} go={go}>
      <Suspense fallback={<div className="page"><Loading lines={5} /></div>}>
        {loading ? <div className="page"><Loading lines={5} /></div> : <Screen id={route.id} query={route.query} go={go} key={`${route.name}:${route.id || ""}`} />}
      </Suspense>
    </Shell>
  );
}

createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>);
