import { useEffect, useRef } from "react";
import { Sun, Network, Siren, Rocket, Users, FlaskConical, Trophy, Sparkles, GraduationCap, Scale, Smartphone } from "lucide-react";
import "../styles/m08.css";
import { INTEL_TABS, intelRoute, intelHref } from "../lib/intelLogic.js";
import { Today, Twin, Board, Simulation, League } from "./intel/Company.jsx";
import { WarRoom, Autopilot, Skills } from "./intel/Engineering.jsx";
import { Lessons, Decisions, Devices } from "./intel/Owner.jsx";

const ICONS = { today: Sun, twin: Network, warroom: Siren, autopilot: Rocket, board: Users, simulation: FlaskConical, league: Trophy, skills: Sparkles, lessons: GraduationCap, decisions: Scale, devices: Smartphone };
const PANELS = { today: Today, twin: Twin, warroom: WarRoom, autopilot: Autopilot, board: Board, simulation: Simulation, league: League, skills: Skills, lessons: Lessons, decisions: Decisions, devices: Devices };

// The screen remounts when the tab (route) changes: a tab chosen with the keyboard gets the focus back after the remount.
let focusAfterNavigation = null;

/** Accessible tab bar (arrows, Home/End), the same pattern as Vânzări/Sistem; tabs are links in the hash. */
function IntelTabs({ value, go }) {
  const refs = useRef({});
  useEffect(() => { if (focusAfterNavigation === value) { refs.current[value]?.focus(); focusAfterNavigation = null; } }, [value]);
  const onKeyDown = (e, index) => {
    const next = e.key === "ArrowRight" ? (index + 1) % INTEL_TABS.length : e.key === "ArrowLeft" ? (index - 1 + INTEL_TABS.length) % INTEL_TABS.length : e.key === "Home" ? 0 : e.key === "End" ? INTEL_TABS.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    focusAfterNavigation = INTEL_TABS[next][0];
    go(intelHref(INTEL_TABS[next][0]));
    refs.current[INTEL_TABS[next][0]]?.focus();
  };
  return (
    <div className="tabs page-tabs scroll" role="tablist" aria-label="Pilot automat și inteligența companiei">
      {INTEL_TABS.map(([id, label], i) => {
        const Icon = ICONS[id];
        return (
          <button key={id} type="button" role="tab" id={`intel-tab-${id}`} aria-controls="intel-panel" aria-selected={value === id} tabIndex={value === id ? 0 : -1}
            ref={(el) => { refs.current[id] = el; }} onClick={() => go(intelHref(id))} onKeyDown={(e) => onKeyDown(e, i)}>
            <Icon size={14} aria-hidden="true" />{label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * M08 — Project Autopilot & Company Intelligence. One screen over the same Hub data the cockpit uses: what changed, what blocks
 * what (Digital Twin), incidents (War Room), objectives with one confirmed plan (Autopilot), the weekly meeting, scenarios
 * (labelled SIMULARE), the agents' league (no winner on thin data), skill candidates, lessons you taught Lega, the decision
 * packages and the paired phone. Reading never starts work; every effect goes through the same commands, envelopes and grants.
 */
export default function Intel({ id, query, go }) {
  const route = intelRoute(id, query);
  const Panel = PANELS[route.tab];
  return (
    <div className="page intel">
      <div className="page-head">
        <div><h1>Pilot automat</h1><p>Inteligența companiei din datele Hub-ului: citirea nu pornește nimic; orice efect trece prin planul confirmat de tine.</p></div>
      </div>
      <IntelTabs value={route.tab} go={go} />
      <div id="intel-panel" role="tabpanel" aria-labelledby={`intel-tab-${route.tab}`} className="intel-panel">
        <Panel itemId={route.id} go={go} />
      </div>
    </div>
  );
}
