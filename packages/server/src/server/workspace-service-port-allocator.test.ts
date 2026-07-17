import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { allocateWorkspaceServicePort } from "./workspace-service-port-allocator.js";

describe("allocateWorkspaceServicePort", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("allocates an available port within the configured range", async () => {
    const port = await getFreePort();

    await expect(
      allocateWorkspaceServicePort({
        allocation: { range: `${port}-${port}` },
        cwd: tmpdir(),
        scriptName: "web",
      }),
    ).resolves.toBe(port);
  });

  it("fails when every port in the configured range is occupied", async () => {
    const server = net.createServer();
    const port = await listen(server);

    await expect(
      allocateWorkspaceServicePort({
        allocation: { range: `${port}-${port}` },
        cwd: tmpdir(),
        scriptName: "web",
      }),
    ).rejects.toThrow(`No available service port in configured range ${port}-${port}`);

    await close(server);
  });

  it("passes the service name to portScript and runs it in the workspace", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "workspace-service-port-allocator-"));
    tempDirs.push(tempDir);
    const port = await getFreePort();
    const scriptPath = join(tempDir, "portmake");
    writeFileSync(
      scriptPath,
      `#!/bin/sh\nprintf '%s' "$PWD" > cwd\nprintf '%s' "$1" > argv\nprintf '%s' "$PASEO_SCRIPTNAME" > env\nprintf '${port}\\n'\n`,
    );
    chmodSync(scriptPath, 0o755);

    await expect(
      allocateWorkspaceServicePort({
        allocation: { range: "1-1", portScript: scriptPath },
        cwd: tempDir,
        scriptName: "app-server",
      }),
    ).resolves.toBe(port);
    expect(readFileSync(join(tempDir, "cwd"), "utf8")).toBe(tempDir);
    expect(readFileSync(join(tempDir, "argv"), "utf8")).toBe("app-server");
    expect(readFileSync(join(tempDir, "env"), "utf8")).toBe("app-server");
  });

  it("accepts a valid portScript result that is already occupied", async () => {
    const server = net.createServer();
    const port = await listen(server);
    const scriptPath = createPortScript(String(port));

    await expect(
      allocateWorkspaceServicePort({
        allocation: { portScript: scriptPath },
        cwd: tmpdir(),
        scriptName: "api",
      }),
    ).resolves.toBe(port);

    await close(server);
  });

  it("rejects invalid portScript output", async () => {
    const scriptPath = createPortScript("not-a-port");

    await expect(
      allocateWorkspaceServicePort({
        allocation: { portScript: scriptPath },
        cwd: tmpdir(),
        scriptName: "web",
      }),
    ).rejects.toThrow("must print exactly one TCP port");
  });

  function createPortScript(output: string): string {
    const tempDir = mkdtempSync(join(tmpdir(), "workspace-service-port-allocator-"));
    tempDirs.push(tempDir);
    const scriptPath = join(tempDir, "portmake");
    writeFileSync(scriptPath, `#!/bin/sh\nprintf '%s\\n' '${output}'\n`);
    chmodSync(scriptPath, 0o755);
    return scriptPath;
  }
});

function getFreePort(): Promise<number> {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected TCP server address"));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
    server.on("error", reject);
  });
}

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected TCP server address");
      }
      resolve(address.port);
    });
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
