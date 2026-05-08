import { describe, expect, it } from "vitest";
import {
  createSidebarSessionWorkspaceLookup,
  deriveSidebarSessionFilterAvailability,
  deriveSidebarSessionFilterProjects,
  shouldIncludeSidebarSessionAgent,
} from "./session-filtering";
import type { SidebarSessionAgent, SidebarSessionWorkspace } from "./types";

const WORKSPACES: SidebarSessionWorkspace[] = [
  {
    serverId: "server-1",
    workspaceId: "workspace-1",
    workspaceKey: "server-1:workspace-1",
    workspaceName: "Main",
    projectKey: "project-a",
    projectName: "Project A",
    workspaceDirectory: "/repo/main",
  },
  {
    serverId: "server-1",
    workspaceId: "workspace-2",
    workspaceKey: "server-1:workspace-2",
    workspaceName: "Docs",
    projectKey: "project-b",
    projectName: "Project B",
    workspaceDirectory: "/repo/docs",
  },
  {
    serverId: "server-1",
    workspaceId: "workspace-3",
    workspaceKey: "server-1:workspace-3",
    workspaceName: "API",
    projectKey: "project-a",
    projectName: "Project A",
    workspaceDirectory: "/repo/api",
  },
];

const AGENTS: SidebarSessionAgent[] = [
  { id: "main", serverId: "server-1", cwd: "/repo/main/", archivedAt: null },
  { id: "docs", serverId: "server-1", cwd: "/repo/docs", archivedAt: null },
  { id: "api", serverId: "server-1", cwd: "/repo/api", archivedAt: null },
  { id: "unmapped", serverId: "server-1", cwd: "/repo/missing", archivedAt: null },
  { id: "other-server", serverId: "server-2", cwd: "/repo/main", archivedAt: null },
  {
    id: "archived",
    serverId: "server-1",
    cwd: "/repo/main",
    archivedAt: new Date("2026-05-08T10:00:00.000Z"),
  },
];

function projectWorkspaceKeys(project: {
  projectKey: string;
  workspaces: { workspaceKey: string }[];
}) {
  return {
    projectKey: project.projectKey,
    workspaceKeys: project.workspaces.map((workspace) => workspace.workspaceKey),
  };
}

describe("sidebar session filtering", () => {
  it("hides unmapped agents and includes every mapped active agent for All", () => {
    const lookup = createSidebarSessionWorkspaceLookup(WORKSPACES);

    const visibleIds = AGENTS.filter((agent) =>
      shouldIncludeSidebarSessionAgent({
        agent,
        filter: { type: "all" },
        lookup,
      }),
    ).map((agent) => agent.id);

    expect(visibleIds).toEqual(["main", "docs", "api"]);
  });

  it("filters by workspace", () => {
    const lookup = createSidebarSessionWorkspaceLookup(WORKSPACES);

    const visibleIds = AGENTS.filter((agent) =>
      shouldIncludeSidebarSessionAgent({
        agent,
        filter: { type: "workspace", workspaceKey: "server-1:workspace-2" },
        lookup,
      }),
    ).map((agent) => agent.id);

    expect(visibleIds).toEqual(["docs"]);
  });

  it("filters by project", () => {
    const lookup = createSidebarSessionWorkspaceLookup(WORKSPACES);

    const visibleIds = AGENTS.filter((agent) =>
      shouldIncludeSidebarSessionAgent({
        agent,
        filter: { type: "project", projectKey: "project-a" },
        lookup,
      }),
    ).map((agent) => agent.id);

    expect(visibleIds).toEqual(["main", "api"]);
  });

  it("derives filter options only from mapped active agents", () => {
    const lookup = createSidebarSessionWorkspaceLookup(WORKSPACES);
    const availability = deriveSidebarSessionFilterAvailability({
      agents: [
        AGENTS[0],
        AGENTS[3],
        {
          id: "archived-docs",
          serverId: "server-1",
          cwd: "/repo/docs",
          archivedAt: new Date("2026-05-08T10:00:00.000Z"),
        },
      ],
      lookup,
    });

    expect(availability).toEqual({
      workspaceKeys: ["server-1:workspace-1"],
      projectKeys: ["project-a"],
    });
    const filterProjects = deriveSidebarSessionFilterProjects({
      projects: [
        {
          projectKey: "project-a",
          projectName: "Project A",
          projectKind: "git",
          iconWorkingDir: "/repo",
          workspaces: [
            {
              workspaceKey: "server-1:workspace-1",
              serverId: "server-1",
              workspaceId: "workspace-1",
              projectKey: "project-a",
              projectRootPath: "/repo",
              workspaceDirectory: "/repo/main",
              projectKind: "git",
              workspaceKind: "worktree",
              name: "Main",
              statusBucket: "done",
              archivingAt: null,
              diffStat: null,
              scripts: [],
              hasRunningScripts: false,
            },
            {
              workspaceKey: "server-1:workspace-3",
              serverId: "server-1",
              workspaceId: "workspace-3",
              projectKey: "project-a",
              projectRootPath: "/repo",
              workspaceDirectory: "/repo/api",
              projectKind: "git",
              workspaceKind: "worktree",
              name: "API",
              statusBucket: "done",
              archivingAt: null,
              diffStat: null,
              scripts: [],
              hasRunningScripts: false,
            },
          ],
        },
        {
          projectKey: "project-b",
          projectName: "Project B",
          projectKind: "git",
          iconWorkingDir: "/repo/docs",
          workspaces: [
            {
              workspaceKey: "server-1:workspace-2",
              serverId: "server-1",
              workspaceId: "workspace-2",
              projectKey: "project-b",
              projectRootPath: "/repo/docs",
              workspaceDirectory: "/repo/docs",
              projectKind: "git",
              workspaceKind: "worktree",
              name: "Docs",
              statusBucket: "done",
              archivingAt: null,
              diffStat: null,
              scripts: [],
              hasRunningScripts: false,
            },
          ],
        },
      ],
      availability,
      workspaceNameByKey: new Map([["server-1:workspace-1", "Main"]]),
    });

    expect(filterProjects.map(projectWorkspaceKeys)).toEqual([
      { projectKey: "project-a", workspaceKeys: ["server-1:workspace-1"] },
    ]);
  });
});
