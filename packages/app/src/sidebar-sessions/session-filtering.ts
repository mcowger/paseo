import type { SidebarSessionAgent, SidebarSessionFilter, SidebarSessionWorkspace } from "./types";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";

export interface SidebarSessionWorkspaceLookup {
  workspaceByExecutionKey: Map<string, SidebarSessionWorkspace>;
}

export interface SidebarSessionFilterAvailability {
  workspaceKeys: readonly string[];
  projectKeys: readonly string[];
}

function executionKey(serverId: string, cwd: string): string {
  return `${serverId}:${cwd}`;
}

export function createSidebarSessionWorkspaceLookup(
  workspaces: readonly SidebarSessionWorkspace[],
): SidebarSessionWorkspaceLookup {
  const workspaceByExecutionKey = new Map<string, SidebarSessionWorkspace>();
  for (const workspace of workspaces) {
    const normalizedDirectory = normalizeWorkspacePath(workspace.workspaceDirectory);
    if (!normalizedDirectory) {
      continue;
    }
    workspaceByExecutionKey.set(executionKey(workspace.serverId, normalizedDirectory), workspace);
  }
  return { workspaceByExecutionKey };
}

export function resolveSidebarSessionWorkspace(
  lookup: SidebarSessionWorkspaceLookup,
  agent: SidebarSessionAgent,
): SidebarSessionWorkspace | null {
  const normalizedCwd = normalizeWorkspacePath(agent.cwd);
  if (!normalizedCwd) {
    return null;
  }
  return lookup.workspaceByExecutionKey.get(executionKey(agent.serverId, normalizedCwd)) ?? null;
}

export function resolveSidebarSessionWorkspaceId(input: {
  agent: SidebarSessionAgent;
  workspaces: Iterable<WorkspaceDescriptor> | null | undefined;
}): string | null {
  const normalizedCwd = normalizeWorkspacePath(input.agent.cwd);
  if (!normalizedCwd) {
    return null;
  }

  for (const workspace of input.workspaces ?? []) {
    if (normalizeWorkspacePath(workspace.workspaceDirectory) === normalizedCwd) {
      return workspace.id;
    }
  }
  return null;
}

export function shouldIncludeSidebarSessionAgent(input: {
  agent: SidebarSessionAgent;
  filter: SidebarSessionFilter;
  lookup: SidebarSessionWorkspaceLookup;
}): boolean {
  if (input.agent.archivedAt) {
    return false;
  }

  const workspace = resolveSidebarSessionWorkspace(input.lookup, input.agent);
  if (!workspace) {
    return false;
  }

  if (input.filter.type === "all") {
    return true;
  }
  if (input.filter.type === "workspace") {
    return workspace.workspaceKey === input.filter.workspaceKey;
  }
  return workspace.projectKey === input.filter.projectKey;
}

export function deriveSidebarSessionFilterAvailability(input: {
  agents: readonly SidebarSessionAgent[];
  lookup: SidebarSessionWorkspaceLookup;
}): SidebarSessionFilterAvailability {
  const workspaceKeys = new Set<string>();
  const projectKeys = new Set<string>();

  for (const agent of input.agents) {
    if (agent.archivedAt) {
      continue;
    }
    const workspace = resolveSidebarSessionWorkspace(input.lookup, agent);
    if (!workspace) {
      continue;
    }
    workspaceKeys.add(workspace.workspaceKey);
    projectKeys.add(workspace.projectKey);
  }

  return {
    workspaceKeys: Array.from(workspaceKeys).sort(),
    projectKeys: Array.from(projectKeys).sort(),
  };
}

export function deriveSidebarSessionFilterProjects(input: {
  projects: readonly SidebarProjectEntry[];
  availability: SidebarSessionFilterAvailability;
  workspaceNameByKey: ReadonlyMap<string, string>;
}): SidebarProjectEntry[] {
  if (input.projects.length === 0 || input.availability.workspaceKeys.length === 0) {
    return [];
  }

  const visibleWorkspaceKeys = new Set(input.availability.workspaceKeys);
  const visibleProjectKeys = new Set(input.availability.projectKeys);
  const projects: SidebarProjectEntry[] = [];

  for (const project of input.projects) {
    if (!visibleProjectKeys.has(project.projectKey)) {
      continue;
    }
    const workspaces = project.workspaces
      .filter((workspace) => visibleWorkspaceKeys.has(workspace.workspaceKey))
      .map((workspace) => {
        const name = input.workspaceNameByKey.get(workspace.workspaceKey);
        return name && name !== workspace.name ? Object.assign({}, workspace, { name }) : workspace;
      });
    if (workspaces.length === 0) {
      continue;
    }
    projects.push({ ...project, workspaces });
  }

  return projects;
}
