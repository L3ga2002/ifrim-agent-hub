import { useEffect, useRef } from "react";
import { KanbanSquare, Clapperboard, Library as LibraryIcon, Gauge, MonitorSmartphone, LineChart } from "lucide-react";
import "../styles/m08.css";
import "../styles/m09.css";
import { STUDIO_TABS, studioRoute, studioHref } from "../lib/studioLogic.js";
import { ErrorNotice, Loading } from "../components/ui.jsx";
import { useStudio, Limitations } from "./studio/common.jsx";
import { Board } from "./studio/Board.jsx";
import { ProjectDetail, ProjectPicker } from "./studio/Project.jsx";
import { Library } from "./studio/Library.jsx";
import { CommandCenter, Platforms } from "./studio/Overview.jsx";
import { Analytics } from "./studio/Analytics.jsx";
import { ToolsPanel } from "./studio/Tools.jsx";
import { studioToolsPanelOpen, STUDIO_TOOLS_HREF } from "../lib/uiLogic.js";

const ICONS = { board: KanbanSquare, project: Clapperboard, library: LibraryIcon, command: Gauge, platforms: MonitorSmartphone, analytics: LineChart };

// The screen remounts when the tab (route id) changes: a tab chosen with the keyboard gets the focus back after the remount.
let focusAfterNavigation = null;

/** Accessible tab bar (arrows, Home/End), the same pattern as Pilot/Vânzări; tabs are links in the hash. */
function StudioTabs({ value, go }) {
  const refs = useRef({});
  useEffect(() => { if (focusAfterNavigation === value) { refs.current[value]?.focus(); focusAfterNavigation = null; } }, [value]);
  const onKeyDown = (e, index) => {
    const n = STUDIO_TABS.length;
    const next = e.key === "ArrowRight" ? (index + 1) % n : e.key === "ArrowLeft" ? (index - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (next === null) return;
    e.preventDefault();
    focusAfterNavigation = STUDIO_TABS[next][0];
    go(studioHref(STUDIO_TABS[next][0]));
    refs.current[STUDIO_TABS[next][0]]?.focus();
  };
  return (
    <div className="tabs page-tabs scroll" role="tablist" aria-label="Content Studio">
      {STUDIO_TABS.map(([id, label], i) => {
        const Icon = ICONS[id];
        return (
          <button key={id} type="button" role="tab" id={`studio-tab-${id}`} aria-controls="studio-panel" aria-selected={value === id} tabIndex={value === id ? 0 : -1}
            ref={(el) => { refs.current[id] = el; }} onClick={() => go(studioHref(id))} onKeyDown={(e) => onKeyDown(e, i)}>
            <Icon size={14} aria-hidden="true" />{label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * M09 — Content Studio. The editorial chain (idea → brief → script → storyboard), the local production (library → edit plan →
 * render → QA → corrections at a timecode → platform variants) and the distribution as hash-bound manifests with manual packs.
 * Opening the Studio reads only: it never starts the microphone, a recording, a render or an upload. Every effect is a command
 * the Hub validates; approvals come only from your owner session (Windows Hello), never from this page alone.
 */
export default function Studio({ id, query, go }) {
  const route = studioRoute(id, query);
  const status = useStudio("/api/media/status", ["settings.changed", "media.render.", "media.tool."]);
  // M10.2 (#27): the Unelte panel (pin / acknowledge ffmpeg) opens by address (#/studio?panel=tools: a blocker, a refusal, Lega's
  // arrow) or by itself when the last inspection says renders are refused; otherwise a link in the header reaches it.
  const toolsOpen = studioToolsPanelOpen(query, status.data?.tools);
  return (
    <div className="page studio">
      <div className="page-head">
        <div><h1>Content Studio</h1><p>Producție video locală și distribuție pregătită manual: nimic nu se încarcă sau se publică automat, iar aprobările vin doar din sesiunea ta.</p></div>
        <div className="row wrap">
          {status.data && <Limitations items={status.data.limitations} compact />}
          {!toolsOpen && <a className="btn sm" href={STUDIO_TOOLS_HREF}>Unelte</a>}
        </div>
      </div>
      <StudioTabs value={route.tab} go={go} />
      <div id="studio-panel" role="tabpanel" aria-labelledby={`studio-tab-${route.tab}`} className="studio-panel">
        {status.error && <ErrorNotice error={status.error} onRetry={status.reload} />}
        {toolsOpen && <ToolsPanel focus={query?.panel === "tools"} onChanged={status.reload} />}
        {route.tab === "board" && <Board go={go} />}
        {route.tab === "project" && (route.projectId
          ? <ProjectDetail projectId={route.projectId} sub={route.sub} tMs={route.tMs} versionId={route.versionId} go={go} status={status.data} />
          : <ProjectPicker go={go} />)}
        {route.tab === "library" && (status.loading && !status.data ? <Loading lines={4} /> : <Library status={status.data} reloadStatus={status.reload} />)}
        {route.tab === "command" && <CommandCenter status={status.data} go={go} />}
        {route.tab === "platforms" && <Platforms />}
        {route.tab === "analytics" && <Analytics go={go} />}
      </div>
    </div>
  );
}
