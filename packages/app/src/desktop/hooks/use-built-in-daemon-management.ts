import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  type DesktopDaemonStatus,
  startDesktopDaemon,
  stopDesktopDaemon,
} from "@/desktop/daemon/desktop-daemon";
import {
  executeDaemonManagementToggle,
  type DaemonManagementToggleResult,
} from "@/desktop/daemon/daemon-management-toggle";
import { useDesktopIpcErrorReporter } from "@/desktop/hooks/desktop-ipc-error";
import type { DesktopSettings } from "@/desktop/settings/desktop-settings";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { upsertDesktopDaemonConnection } from "@/runtime/daemon-start-service";
import { confirmDialog } from "@/utils/confirm-dialog";

type DesktopDaemonSettings = DesktopSettings["daemon"];

class DaemonConnectionRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DaemonConnectionRegistrationError";
  }
}

function formatDaemonManagementErrorMessage(error: Error, isManagingDaemon: boolean): string {
  if (error instanceof DaemonConnectionRegistrationError) {
    return "Built-in daemon started, but Paseo could not save the localhost connection. Toggle daemon management off and on again, or add localhost manually.";
  }
  if (isManagingDaemon) {
    return "Built-in daemon management was paused, but Paseo could not stop the daemon.";
  }
  return "Unable to update built-in daemon management.";
}

interface UseBuiltInDaemonManagementInput {
  daemonStatus: DesktopDaemonStatus | null;
  settings: DesktopDaemonSettings;
  updateSettings: (next: Partial<DesktopDaemonSettings>) => Promise<unknown>;
  setStatus: (status: DesktopDaemonStatus) => void;
  refreshStatus: () => void;
}

interface UseBuiltInDaemonManagementResult {
  isUpdating: boolean;
  toggle: () => void;
}

export function useBuiltInDaemonManagement(
  input: UseBuiltInDaemonManagementInput,
): UseBuiltInDaemonManagementResult {
  const { daemonStatus, settings, updateSettings, setStatus, refreshStatus } = input;
  const reportError = useDesktopIpcErrorReporter();
  const { mutate: toggleDaemonManagement, isPending: isUpdating } = useMutation<
    DaemonManagementToggleResult,
    Error
  >({
    mutationFn: async () => {
      const result = await executeDaemonManagementToggle(
        settings.manageBuiltInDaemon,
        daemonStatus,
        {
          confirm: () =>
            confirmDialog({
              title: "Pause built-in daemon",
              message:
                "This will stop the built-in daemon immediately. Running agents and terminals connected to the built-in daemon will be stopped.",
              confirmLabel: "Pause and stop",
              cancelLabel: "Cancel",
              destructive: true,
            }),
          persistSettings: (next) => updateSettings(next) as Promise<void>,
          startDaemon: startDesktopDaemon,
          stopDaemon: stopDesktopDaemon,
        },
      );
      if (result.kind === "enabled") {
        const upsertResult = await upsertDesktopDaemonConnection(
          getHostRuntimeStore(),
          result.newStatus,
        );
        if (!upsertResult.ok) {
          throw new DaemonConnectionRegistrationError(upsertResult.error);
        }
      }
      return result;
    },
    onError: (error) => {
      if (error instanceof DaemonConnectionRegistrationError) {
        refreshStatus();
      }
      reportError({
        error,
        message: formatDaemonManagementErrorMessage(error, settings.manageBuiltInDaemon),
        logLabel: "[Settings] Failed to update built-in daemon management",
      });
    },
    onSuccess: (result) => {
      if (result.kind === "cancelled") {
        return;
      }
      if (result.newStatus) {
        setStatus(result.newStatus);
      }
      refreshStatus();
    },
  });

  const toggle = useCallback(() => {
    if (isUpdating) {
      return;
    }

    toggleDaemonManagement();
  }, [isUpdating, toggleDaemonManagement]);

  return { isUpdating, toggle };
}
