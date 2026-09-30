import { LayoutDashboard, MessageSquare, Target, Bot, FolderGit2, Brain, ShieldCheck, Wrench, Plug, Activity, Building2, Network, Cpu, Settings } from "lucide-react";

export const navigate = (path) => { window.location.hash = path; };

export const NAV = [
  { id: "control", label: "Control", long: "Control Room", icon: LayoutDashboard, key: "1" },
  { id: "conversations", label: "Conversații", long: "Conversații", icon: MessageSquare, key: "2" },
  { id: "missions", label: "Misiuni", long: "Misiuni", icon: Target, key: "3" },
  { id: "approvals", label: "Aprobări", long: "Aprobări", icon: ShieldCheck, key: "4" },
  { id: "agents", label: "Agenți", long: "Agenți", icon: Bot, key: "5" },
  { id: "projects", label: "Proiecte", long: "Proiecte", icon: FolderGit2, key: "6" },
  { id: "memory", label: "Memorie", long: "Memorie", icon: Brain, key: "7" },
  { id: "tools", label: "Instrumente", long: "Instrumente & computer", icon: Wrench, key: "8" },
  { id: "integrations", label: "Integrări", long: "Integrări & abonamente", icon: Plug, key: "9" },
  { id: "health", label: "Sănătate", long: "Utilizare & sănătate", icon: Activity },
  { id: "company", label: "Companie", long: "Companie & Chief of Staff", icon: Building2 },
  { id: "ecosystem", label: "Ecosisteme", long: "Ecosisteme AI: audit, suprafețe, rutare", icon: Network },
  { id: "system", label: "Sistem", long: "Sistem: diagnostic, programări, politici", icon: Cpu },
  { id: "settings", label: "Setări", long: "Setări", icon: Settings },
];
