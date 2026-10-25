import { bucharestParts } from "../../lib/roText.js";
import { FolderGit2, OctagonAlert, ShieldAlert } from "lucide-react";
import { LegaFace } from "../../components/face/LegaFace.jsx";
import { useEffect, useRef, useState } from "react";
import { radialLayout, carousel, departmentDetail, DEPT_CODES, departmentStyle } from "../../lib/companyGraph.js";
import { StatePill } from "../../components/StatePill.jsx";
import { stateOf } from "../../lib/stateVocab.js";
import { TOOL_STATUS } from "./Sheet.jsx";
export function DepartmentCounts({ department: d, hideNumbers, rim = false }) {
    const counters = [["works", "lucrări", FolderGit2], ["blocked", "blocaje", OctagonAlert], ["waiting", "decizii", ShieldAlert]].filter(([key]) => d.counts?.[key] > 0);
    if (!counters.length)
        return null;
    return <span className="dept-counts">{counters.map(([key, label, Icon]) => <span key={key}><Icon size="1em" aria-hidden="true"/>{hideNumbers ? "•••" : d.counts[key]}<span className="sr-only"> {label}</span></span>)}</span>;
}
export function CompanyGraph({ graph, display, hideNumbers, decor, setDecor, onDepartment, shape = "CORE", coreState = "IDLE" }) {
    const departments = graph?.departments || [], nodes = radialLayout(departments, { rx: 38, ry: 40 }), refs = useRef({}), [focus, setFocus] = useState(null);
    const move = (e) => { if (e.key !== "ArrowLeft" && e.key !== "ArrowRight")
        return; e.preventDefault(); e.stopPropagation(); const key = carousel(departments, focus || departments[0]?.key, e.key === "ArrowLeft" ? "prev" : "next"); setFocus(key); refs.current[key]?.focus(); };
    return <section className="command-company" style={departmentStyle}><h2>Companie · {graph?.company?.name}</h2><p className="command-source">Structura configurată · citit la {bucharestParts(graph?.readAt).time}</p><div className="map-toolbar"><span className="map-legend">linie plină: activ · întreruptă: planificat · decor: fără semnificație</span>{!display && <button onClick={() => setDecor(!decor)}>Decor: {decor ? "pornit" : "oprit"}</button>}</div><div className="radial-map" onKeyDown={move}><svg viewBox="0 0 100 100" aria-hidden="true" preserveAspectRatio="none">{nodes.map((d) => <line key={d.key} x1="50" y1="50" x2={d.x} y2={d.y} className={d.status === "planned" ? "planned" : ""}><title>departament configurat</title></line>)}{decor && <g className="decor"><circle cx="50" cy="50" r="25"/><circle cx="50" cy="50" r="43"/><circle className="orbit-dot" cx="50" cy="7" r="0.6"/></g>}</svg><div className="radial-core"><LegaFace shape={shape} state={coreState} compact/><span>L3ga</span></div>{nodes.map((d) => <button key={d.key} ref={(el) => { refs.current[d.key] = el; }} className={`department-node ${d.status}`} style={{ left: `${d.x}%`, top: `${d.y}%`, "--dept": `var(--dept-${d.color})` }} tabIndex={d.key === (focus || departments[0]?.key) ? 0 : -1} disabled={display} onFocus={() => setFocus(d.key)} onKeyDown={(e) => { if (e.key === "Enter")
        e.stopPropagation(); }} onClick={() => onDepartment(d.key)}><span className="department-orb"><strong>{DEPT_CODES[d.key]}</strong><DepartmentCounts department={d} hideNumbers={hideNumbers} rim/></span><span className="department-label">{d.labelRo}</span>{d.status !== "active" && <span className="command-source">{d.status === "planned" ? "planificat" : "în pauză"}</span>}</button>)}</div></section>;
}
const authority = (v) => ({ READ_ONLY: "doar citire", OBSERVE: "observă", ASSISTED: "asistat", TRUSTED: "de încredere", HIGH_AUTONOMY_BOUNDED: "autonomie mare, delimitată" })[v] || v;
export function Department({ graph, departmentKey, display, hideNumbers = false, onDepartment, onSheet }) {
    const [compact, setCompact] = useState(() => window.innerHeight <= 900);
    useEffect(() => { const resize = () => setCompact(window.innerHeight <= 900); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, []);
    const limit = compact ? 2 : 3;
    const more = (items, n = limit) => items.length > n ? <p className="department-more">{hideNumbers ? "+ încă •••" : `+ încă ${items.length-n}`}</p> : null;
    const d = departmentDetail(graph, departmentKey), dep = d.department, t = v => hideNumbers && /\d/.test(String(v)) ? "•••" : v;
    if (!dep)
        return <p>Departamentul nu e disponibil.</p>;
    const source = (label) => <p className="command-source">Sursa: {label} · citit la {t(bucharestParts(graph.readAt).time)}</p>;
    return <section className="command-department"><header className="command-controls">{!display && <button onClick={() => onDepartment(carousel(graph.departments, dep.key, "prev"))}>‹ precedent</button>}<div><h2>{dep.labelRo}</h2><p className="command-source">{dep.name}</p><p>{t(dep.purpose)}</p></div>{!display && <button onClick={() => onDepartment(carousel(graph.departments, dep.key, "next"))}>următor ›</button>}</header><div className="sheet-sections"><section><h3>Roluri</h3><ul>{d.roles.slice(0, compact ? 1 : 2).map(r => <li key={r.id}><strong>{t(r.name)}</strong> · {authority(r.authority)}<p>Raportează către {t(graph.roles.find(x => x.id === r.reportsTo)?.name || (r.reportsTo === "owner" ? "proprietar" : r.reportsTo || "nespecificat"))} · {r.runningNow > 0 ? t(`rulează acum: ${r.runningNow}`) : "configurat"}</p><ul>{(r.responsibilities || []).slice(0, compact ? 1 : 2).map((x, i) => <li key={i}>{t(x)}</li>)}</ul>{more(r.responsibilities || [], compact ? 1 : 2)}</li>)}</ul>{more(d.roles, compact ? 1 : 2)}{!d.roles.length && <p>Niciun rol configurat</p>}{source("roles.json — departament, raportare")}</section><section><h3>Abilități</h3><div className="command-chips">{d.skills.slice(0, limit).map(s => display ? <span key={s.id}>{t(s.name)}</span> : <button key={s.id} onClick={() => onSheet(`skill:${s.name}`)}>{t(s.name)}</button>)}</div>{more(d.skills)}{!d.skills.length && <p>Nicio abilitate configurată</p>}{source("SKILL.md — roluri, unelte")}</section><section><h3>Unelte</h3><div className="command-chips">{d.tools.slice(0, limit).map(tool => <span key={tool.id}>{t(tool.name)} · {TOOL_STATUS[tool.status] || "stare necunoscută"}</span>)}</div>{more(d.tools)}{!d.tools.length && <p>Nicio unealtă configurată</p>}{source("roles.json; SKILL.md — unelte")}</section><section><h3>Lucrări active</h3><ul>{d.works.slice(0, limit).map(w => <li key={w.missionId}>{t(w.title)} <StatePill state={stateOf("mission", w.stage)} status={t(w.stage)}/></li>)}</ul>{more(d.works)}{!d.works.length && <p>Nimic în lucru</p>}{source("missions — departament; tasks — roluri")}</section></div></section>;
}
