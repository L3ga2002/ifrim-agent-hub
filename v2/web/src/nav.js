import { AudioLines, LayoutDashboard, MessageSquare, Target, Bot, FolderGit2, Brain, ShieldCheck, Wrench, Plug, Activity, Building2, Network, Cpu, Settings, Briefcase, Radar, Clapperboard, MonitorCog, Inbox, History } from "lucide-react";

export const navigate = (path) => { window.location.hash = path; };

/**
 * M15: the rail is organised around the owner's work — L3ga (the one screen), Decizii, Lucrări, Rezultate — then the departments, then
 * „Avansat” (the technical screens, folded). Every route keeps its address (`#/<id>` or `href`); Alt+1–9 keep their screens.
 * `group`: main | dept | adv.
 */
export const NAV = [
  { id: "lega", label: "L3ga", long: "Lega · ecranul unic (conversație, comenzi, decizii, rezultate)", icon: AudioLines, group: "main" },
  { id: "decizii", href: "/livrare/decizii", label: "Decizii", long: "Deciziile mele: tot ce așteaptă confirmarea ta", icon: Inbox, group: "main" },
  { id: "missions", label: "Lucrări", long: "Misiuni și lucrări", icon: Target, key: "3", group: "main" },
  { id: "rezultate", label: "Rezultate", long: "Rezultate și istoric (livrări, oferte, dosare, devize)", icon: History, group: "main" },
  { id: "sales", label: "Vânzări", long: "Vânzări & lead-uri", icon: Briefcase, group: "dept" },
  { id: "studio", label: "Studio", long: "Content Studio", icon: Clapperboard, group: "dept" },
  { id: "company", label: "Companie", long: "Companie & Chief of Staff", icon: Building2, group: "dept" },
  { id: "intel", label: "Pilot", long: "Pilot automat & inteligența companiei", icon: Radar, group: "adv" },
  { id: "control", label: "Control", long: "Control Room", icon: LayoutDashboard, key: "1", group: "adv" },
  { id: "conversations", label: "Conversații", long: "Conversații", icon: MessageSquare, key: "2", group: "adv" },
  { id: "approvals", label: "Aprobări", long: "Aprobări tehnice", icon: ShieldCheck, key: "4", group: "adv" },
  { id: "agents", label: "Agenți", long: "Agenți", icon: Bot, key: "5", group: "adv" },
  { id: "projects", label: "Proiecte", long: "Proiecte", icon: FolderGit2, key: "6", group: "adv" },
  { id: "memory", label: "Memorie", long: "Memorie", icon: Brain, key: "7", group: "adv" },
  { id: "tools", label: "Instrumente", long: "Instrumente & computer", icon: Wrench, key: "8", group: "adv" },
  { id: "integrations", label: "Integrări", long: "Integrări & abonamente", icon: Plug, key: "9", group: "adv" },
  { id: "health", label: "Sănătate", long: "Utilizare & sănătate", icon: Activity, group: "adv" },
  { id: "desktop", label: "Operator", long: "Operator desktop: aplicații, foldere, planuri", icon: MonitorCog, group: "adv" },
  { id: "ecosystem", label: "Ecosisteme", long: "Ecosisteme AI: audit, suprafețe, rutare", icon: Network, group: "adv" },
  { id: "system", label: "Sistem", long: "Sistem: diagnostic, programări, politici", icon: Cpu, group: "adv" },
  { id: "settings", label: "Setări", long: "Setări", icon: Settings, group: "adv" },
];

export const NAV_GROUPS = [["main", null], ["dept", "Departamente"], ["adv", "Avansat"]];

/** The address of a rail item. */
export const navHref = (item) => `#${item.href || `/${item.id}`}`;

/** Which rail item a route belongs to (the Delivery Room's own pages count as Rezultate; „Deciziile mele” as Decizii). */
export function navCurrent(route) {
  if (!route) return null;
  if (route.name === "livrare") return route.id === "decizii" ? "decizii" : "rezultate";
  if (route.name === "focus") return "conversations";
  return route.name;
}
