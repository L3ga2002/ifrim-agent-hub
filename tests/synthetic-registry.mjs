import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// The V1 API reads ..\PROJECTS.md and ..\.ifrim-system\AGENT_TEAM_V2.json. Tests give it a synthetic projects root inside
// .ifrim/tmp instead (HUB_TEST_PROJECTS_ROOT), so they never depend on, or write into, the owner's real registry and projects.
export const SYNTHETIC_AGENT_IDS = [
  "main", "ifrim-prompt-architect", "ifrim-product", "ifrim-architect", "ifrim-frontend", "ifrim-backend", "ifrim-qa",
  "ifrim-reviewer", "ifrim-backend-reviewer", "ifrim-frontend-reviewer", "ifrim-security-reviewer",
];

export async function writeSyntheticRegistry(root, projects = [
  { name: "Ifrim Agent Hub", folder: "ifrim-agent-hub" },
  { name: "ProDelivery", folder: "prodelivery" },
]) {
  await mkdir(path.join(root, ".ifrim-system"), { recursive: true });
  const sections = [];
  const paths = {};
  for (const project of projects) {
    const projectPath = path.join(root, project.folder);
    await mkdir(projectPath, { recursive: true });
    paths[project.name] = projectPath;
    sections.push(`## ${project.name}\n\n- Path: ${projectPath}\n- Status: synthetic test project\n`);
  }
  await writeFile(path.join(root, "PROJECTS.md"), `# Projects (synthetic test registry)\n\n${sections.join("\n")}`, "utf8");
  await writeFile(path.join(root, ".ifrim-system", "AGENT_TEAM_V2.json"), `${JSON.stringify({
    version: "synthetic-test",
    agents: SYNTHETIC_AGENT_IDS.map((id) => ({ id, title: id, kind: "synthetic", workspace: path.join(root, "workspaces", id) })),
  }, null, 2)}\n`, "utf8");
  return paths;
}
