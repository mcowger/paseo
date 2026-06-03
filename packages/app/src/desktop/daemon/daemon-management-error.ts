export class DaemonConnectionRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DaemonConnectionRegistrationError";
  }
}

export interface DaemonManagementErrorPresentation {
  message: string;
  refreshStatus: boolean;
}

export function getDaemonManagementErrorPresentation(
  error: Error,
  isManagingDaemon: boolean,
): DaemonManagementErrorPresentation {
  if (error instanceof DaemonConnectionRegistrationError) {
    return {
      message:
        "Built-in daemon started, but Paseo could not save the localhost connection. Toggle daemon management off and on again, or add localhost manually.",
      refreshStatus: true,
    };
  }
  if (isManagingDaemon) {
    return {
      message: "Built-in daemon management was paused, but Paseo could not stop the daemon.",
      refreshStatus: false,
    };
  }
  return {
    message: "Unable to update built-in daemon management.",
    refreshStatus: false,
  };
}
