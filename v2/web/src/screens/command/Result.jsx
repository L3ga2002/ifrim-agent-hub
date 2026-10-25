import { useEffect, useRef, useState } from "react";
import { useRead, Source, ReadState, concealed } from "./Recap.jsx";
export default function Result({ deliveryId, hideNumbers = false, display = false, shotIndex = 0, onShot }) {
    const list = useRead(deliveryId ? null : "/api/deliveries"), [large, setLarge] = useState(false), [broken, setBroken] = useState(false);
    const dialog = useRef(null), trigger = useRef(null);
    const index = shotIndex, setIndex = value => onShot?.(value);
    const id = deliveryId || list.data?.deliveries?.filter(d => ["READY", "NEEDS_OWNER"].includes(d.status)).sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))[0]?.id;
    const r = useRead(id ? `/api/deliveries/${encodeURIComponent(id)}` : null), projects = useRead("/api/projects"), d = r.data, t = v => concealed(v, hideNumbers);
    useEffect(() => { setBroken(false); }, [id, index]);
    useEffect(() => {
      if (!large) return;
      const previous = document.activeElement;
      dialog.current?.querySelector("button:not(:disabled)")?.focus();
      const key = e => {
        if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); setLarge(false); }
        if (e.key === "Tab") {
          const buttons = [...dialog.current.querySelectorAll("button:not(:disabled),[href],[tabindex='0']")];
          const first = buttons[0], last = buttons.at(-1);
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      };
      window.addEventListener("keydown", key, true);
      return () => { window.removeEventListener("keydown", key, true); (trigger.current || previous)?.focus(); };
    }, [large]);
    if (!id)
        return <section className="command-result command-p1"><h2>Rezultat</h2><p>{list.error ? "Date indisponibile" : list.data ? "Nicio livrare pregătită" : "Se citesc livrările…"}</p></section>;
    if (!d)
        return <ReadState resource={r}/>;
    const shots = d.preview?.shots || [], s = shots[Math.min(index, Math.max(0, shots.length - 1))], project = projects.data?.projects?.find(p => p.id === d.delivery.projectId);
    const warnings = [...(d.summary?.warnings || []), ...(d.observations || []).map(o => o.text)];
    for (const kind of ["master", "vertical"]) {
        const qa = d.clip?.[kind]?.qa;
        if (qa) {
            const status = typeof qa === "string" ? qa : qa.status || qa.verdict;
            if (["WARN", "FAIL"].includes(status))
                warnings.push(`${kind}: ${status} · ${typeof qa === "object" ? JSON.stringify(qa) : qa}`);
        }
    }
    return <section className="command-result command-p1"><h2>{t(d.delivery.title)}</h2><p>{t(d.delivery.projectName)} · {project ? project.source === "hub-test" ? "proiect de test" : "proiect real" : "tip de proiect necunoscut"}</p><Source label="Livrarea salvată" at={r.readAt} hideNumbers={hideNumbers}/><figure className={`result-shot${large ? " enlarged" : ""}`} ref={dialog} role={large ? "dialog" : undefined} aria-modal={large ? "true" : undefined} aria-label={large ? "Captură mărită" : undefined}>{s?.src && !broken && !hideNumbers ? <>{display || large ? <img src={s.src} alt={t(s.viewportLabel || s.criterion)} onError={() => setBroken(true)}/> : <button ref={trigger} className="result-zoom" aria-label={`Mărește captura ${t(s.viewportLabel || s.criterion || "salvată")}`} onClick={() => setLarge(true)}><img src={s.src} alt={t(s.viewportLabel || s.criterion)} onError={() => setBroken(true)}/></button>}</> : <p>{hideNumbers ? "Captură ascunsă" : `Captura lipsește · ${t(s?.criterion || d.software?.criteria?.map(c => c.id).join(", ") || "niciun criteriu cu o captură salvată")}`}</p>}{s && <figcaption>{t(s.viewportLabel)} · {t(s.status)} · {t(s.criterion)}</figcaption>}{!display && <div className="command-controls"><button aria-label="Captura precedentă" disabled={index === 0} onClick={() => { setIndex(index - 1); setBroken(false); }}>←</button><button aria-label="Captura următoare" disabled={index >= shots.length - 1} onClick={() => { setIndex(index + 1); setBroken(false); }}>→</button>{large && <button onClick={() => setLarge(false)}>Închide captura (Esc)</button>}</div>}</figure><p>{t(d.summary?.sections?.[0]?.text || "Rezumat necunoscut")}</p><p>Specificație: {t(d.software?.spec?.version)} · SHA pachet: {t(d.software?.bundle?.shaPrefix)} · versiune pachet: necunoscută</p>{warnings.map((w, i) => <p className="result-warning" key={i}>⚠ {t(typeof w === "string" ? w : JSON.stringify(w))}</p>)}<p>Decizia se ia în L3ga → Ce te așteaptă {!display && <a href="#/lega">Deschide L3ga</a>}</p></section>;
}
