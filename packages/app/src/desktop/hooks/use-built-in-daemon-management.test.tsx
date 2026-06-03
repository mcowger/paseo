/**
 * @vitest-environment jsdom
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopDaemonStatus } from "@/desktop/daemon/desktop-daemon";
import { useBuiltInDaemonManagement } from "./use-built-in-daemon-management";

const desktopDaemon = vi.hoisted(() => ({
  startDesktopDaemon: vi.fn(),
  stopDesktopDaemon: vi.fn(),
}));

const daemonStartService = vi.hoisted(() => ({
  upsertDesktopDaemonConnection: vi.fn(),
}));

const hostRuntime = vi.hoisted(() => {
  const store = { upsertConnectionFromListen: vi.fn() };
  return {
    store,
    getHostRuntimeStore: vi.fn(() => store),
  };
});

const ipcErrorReporter = vi.hoisted(() => ({
  reportError: vi.fn(),
}));

vi.mock("@/desktop/daemon/desktop-daemon", () => desktopDaemon);

vi.mock("@/runtime/daemon-start-service", () => daemonStartService);

vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: hostRuntime.getHostRuntimeStore,
}));

vi.mock("@/desktop/hooks/desktop-ipc-error", () => ({
  useDesktopIpcErrorReporter: () => ipcErrorReporter.reportError,
}));

vi.mock("@/utils/confirm-dialog", () => ({
  confirmDialog: vi.fn(),
}));

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderDesktopHook<TResult>(callback: () => TResult) {
  const queryClient = createQueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return renderHook(callback, { wrapper });
}

function makeStatus(overrides: Partial<DesktopDaemonStatus> = {}): DesktopDaemonStatus {
  return {
    serverId: "srv_desktop",
    status: "running",
    listen: "127.0.0.1:6767",
    hostname: "desktop",
    pid: 123,
    home: "/tmp/paseo",
    version: "0.1.0",
    desktopManaged: true,
    error: null,
    ...overrides,
  };
}

describe("useBuiltInDaemonManagement", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes daemon status when re-enable starts the daemon but cannot save localhost", async () => {
    const startedStatus = makeStatus({ listen: null });
    const updateSettings = vi.fn(async () => undefined);
    const setStatus = vi.fn();
    const refreshStatus = vi.fn();
    desktopDaemon.startDesktopDaemon.mockResolvedValue(startedStatus);
    daemonStartService.upsertDesktopDaemonConnection.mockResolvedValue({
      ok: false,
      error: "Desktop daemon did not return a listen address.",
    });

    const { result } = renderDesktopHook(() =>
      useBuiltInDaemonManagement({
        daemonStatus: makeStatus({ status: "stopped", desktopManaged: false }),
        settings: { manageBuiltInDaemon: false, keepRunningAfterQuit: false },
        updateSettings,
        setStatus,
        refreshStatus,
      }),
    );

    act(() => {
      result.current.toggle();
    });

    await waitFor(() => {
      expect(refreshStatus).toHaveBeenCalledOnce();
    });
    expect(setStatus).not.toHaveBeenCalled();
    expect(ipcErrorReporter.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Built-in daemon started, but Paseo could not save the localhost connection. Toggle daemon management off and on again, or add localhost manually.",
      }),
    );
  });
});
