import type pino from "pino";
import type {
  SessionOutboundMessage,
  StartWorkspaceScriptRequest,
  WorkspaceDescriptorPayload,
  WorkspaceScriptPayload,
} from "../../messages.js";
import type { TerminalManager } from "../../../terminal/terminal-manager.js";
import type { ServiceProxySubsystem } from "../../service-proxy.js";
import type { WorkspaceScriptRuntimeStore } from "../../workspace-script-runtime-store.js";
import type { ScriptHealthState } from "../../script-health-monitor.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
import type { WorkspaceRegistry } from "../../workspace-registry.js";
import type {
  SpawnWorkspaceScriptOptions,
  WorktreeScriptResult,
} from "../../worktree-bootstrap.js";
import {
  buildWorkspaceScriptPayloads,
  readPaseoConfigForProjection,
} from "../../script-status-projection.js";
import { deriveProjectSlug } from "../../workspace-git-metadata.js";

type WorkspaceScriptsPayload = WorkspaceDescriptorPayload["scripts"];

interface WorkspaceScriptGitMetadata {
  projectSlug: string;
  currentBranch: string | null;
}

/**
 * The service-proxy-backed scripts a workspace exposes: build the scripts payload
 * snapshot, emit a script_status_update to clients, and start a script.
 *
 * The workspace descriptor builder, the script-status emission path, and the
 * start-script RPC all funnel through one assembly of buildWorkspaceScriptPayloads'
 * inputs and one "scripts available on this daemon?" guard, instead of duplicating
 * that assembly and guard across the session.
 */
export interface WorkspaceScriptsService {
  buildSnapshot(workspaceId: string, workspaceDirectory: string): WorkspaceScriptsPayload;
  emitStatusUpdate(workspaceId: string, workspaceDirectory: string): void;
  list(workspaceId: string): Promise<WorkspaceScriptPayload[]>;
  launch(input: { workspaceId: string; scriptName: string }): Promise<WorkspaceScriptPayload>;
  stop(input: { workspaceId: string; scriptName: string }): Promise<WorkspaceScriptPayload>;
  start(request: StartWorkspaceScriptRequest): Promise<void>;
}

type WorkspaceScriptsGitSource = Pick<
  WorkspaceGitService,
  "peekSnapshot" | "getWorkspaceGitMetadata"
>;

export function createWorkspaceScriptsService(deps: {
  serviceProxy: ServiceProxySubsystem | null;
  scriptRuntimeStore: WorkspaceScriptRuntimeStore | null;
  terminalManager: TerminalManager | null;
  workspaceRegistry: Pick<WorkspaceRegistry, "get">;
  workspaceGitService: WorkspaceScriptsGitSource;
  getDaemonTcpPort: (() => number | null) | null;
  getDaemonTcpHost: (() => string | null) | null;
  serviceProxyPublicBaseUrl: string | null;
  resolveScriptHealth: ((hostname: string) => ScriptHealthState | null) | null;
  logger: pino.Logger;
  emit: (message: SessionOutboundMessage) => void;
  spawnWorkspaceScript: (options: SpawnWorkspaceScriptOptions) => Promise<WorktreeScriptResult>;
}): WorkspaceScriptsService {
  const {
    serviceProxy,
    scriptRuntimeStore,
    terminalManager,
    workspaceRegistry,
    workspaceGitService,
    getDaemonTcpPort,
    getDaemonTcpHost,
    serviceProxyPublicBaseUrl,
    resolveScriptHealth,
    logger,
    emit,
    spawnWorkspaceScript,
  } = deps;

  function resolveGitMetadata(workspaceDirectory: string): WorkspaceScriptGitMetadata | undefined {
    const snapshot = workspaceGitService.peekSnapshot(workspaceDirectory);
    if (!snapshot) {
      return undefined;
    }
    return {
      projectSlug: deriveProjectSlug(
        workspaceDirectory,
        snapshot.git.isGit ? snapshot.git.remoteUrl : null,
      ),
      currentBranch: snapshot.git.currentBranch,
    };
  }

  function buildSnapshot(workspaceId: string, workspaceDirectory: string): WorkspaceScriptsPayload {
    if (!serviceProxy || !scriptRuntimeStore) {
      return [];
    }
    return buildWorkspaceScriptPayloads({
      workspaceId,
      workspaceDirectory,
      paseoConfig: readPaseoConfigForProjection(workspaceDirectory, logger),
      serviceProxy,
      runtimeStore: scriptRuntimeStore,
      daemonPort: getDaemonTcpPort?.() ?? null,
      serviceProxyPublicBaseUrl,
      gitMetadata: resolveGitMetadata(workspaceDirectory),
      resolveHealth: resolveScriptHealth ?? undefined,
    });
  }

  function emitStatusUpdate(workspaceId: string, workspaceDirectory: string): void {
    emit({
      type: "script_status_update",
      payload: {
        workspaceId,
        scripts: buildSnapshot(workspaceId, workspaceDirectory),
      },
    });
  }

  async function getWorkspace(workspaceId: string) {
    const workspace = await workspaceRegistry.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    return workspace;
  }

  function requireAvailable(): {
    serviceProxy: ServiceProxySubsystem;
    runtimeStore: WorkspaceScriptRuntimeStore;
    terminalManager: TerminalManager;
  } {
    if (!terminalManager || !serviceProxy || !scriptRuntimeStore) {
      throw new Error("Workspace scripts are not available on this daemon");
    }
    return { serviceProxy, runtimeStore: scriptRuntimeStore, terminalManager };
  }

  async function list(workspaceId: string): Promise<WorkspaceScriptPayload[]> {
    requireAvailable();
    const workspace = await getWorkspace(workspaceId);
    return buildSnapshot(workspace.workspaceId, workspace.cwd);
  }

  async function launchProcess(input: { workspaceId: string; scriptName: string }) {
    const available = requireAvailable();
    const workspace = await getWorkspace(input.workspaceId);
    const gitMetadata = await workspaceGitService.getWorkspaceGitMetadata(workspace.cwd);
    const result = await spawnWorkspaceScript({
      repoRoot: workspace.cwd,
      workspaceId: workspace.workspaceId,
      projectSlug: gitMetadata.projectSlug,
      branchName: gitMetadata.currentBranch,
      scriptName: input.scriptName,
      daemonPort: getDaemonTcpPort?.() ?? null,
      daemonListenHost: getDaemonTcpHost?.() ?? null,
      serviceProxyPublicBaseUrl,
      serviceProxy: available.serviceProxy,
      runtimeStore: available.runtimeStore,
      terminalManager: available.terminalManager,
      logger,
      onLifecycleChanged: () => {
        emitStatusUpdate(workspace.workspaceId, workspace.cwd);
      },
    });
    return { workspace, terminalId: result.terminalId };
  }

  async function launch(input: {
    workspaceId: string;
    scriptName: string;
  }): Promise<WorkspaceScriptPayload> {
    const { workspace } = await launchProcess(input);
    const script = buildSnapshot(workspace.workspaceId, workspace.cwd).find(
      (entry) => entry.scriptName === input.scriptName,
    );
    if (!script) {
      throw new Error(`Script '${input.scriptName}' did not produce a status record`);
    }
    emitStatusUpdate(workspace.workspaceId, workspace.cwd);
    return script;
  }

  async function stop(input: {
    workspaceId: string;
    scriptName: string;
  }): Promise<WorkspaceScriptPayload> {
    const available = requireAvailable();
    const workspace = await getWorkspace(input.workspaceId);
    const runtime = available.runtimeStore.get(input);
    if (!runtime || runtime.lifecycle !== "running") {
      throw new Error(`Script '${input.scriptName}' is not running`);
    }
    if (!available.terminalManager.getTerminal(runtime.terminalId)) {
      throw new Error(`Terminal for script '${input.scriptName}' is no longer available`);
    }

    // The launcher's terminal exit listener owns route removal and runtime state updates.
    await available.terminalManager.killTerminalAndWait(runtime.terminalId);

    const script = buildSnapshot(workspace.workspaceId, workspace.cwd).find(
      (entry) => entry.scriptName === input.scriptName,
    );
    if (!script) {
      throw new Error(`Script '${input.scriptName}' did not produce a status record`);
    }
    emitStatusUpdate(workspace.workspaceId, workspace.cwd);
    return script;
  }

  async function start(request: StartWorkspaceScriptRequest): Promise<void> {
    try {
      const { workspace, terminalId } = await launchProcess(request);
      emitStatusUpdate(workspace.workspaceId, workspace.cwd);
      emit({
        type: "start_workspace_script_response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          scriptName: request.scriptName,
          terminalId,
          error: null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start workspace script";
      logger.error(
        { err: error, workspaceId: request.workspaceId, scriptName: request.scriptName },
        "Failed to start workspace script",
      );
      emit({
        type: "start_workspace_script_response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          scriptName: request.scriptName,
          terminalId: null,
          error: message,
        },
      });
    }
  }

  return { buildSnapshot, emitStatusUpdate, list, launch, stop, start };
}
