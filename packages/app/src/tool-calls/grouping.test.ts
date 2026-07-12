import { describe, expect, it } from "vitest";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { StreamItem, ToolCallItem } from "@/types/stream";
import { compactToolCallRuns } from "./grouping";

function toolCall(
  id: string,
  detail: ToolCallDetail,
  options: {
    name?: string;
    status?: "running" | "completed" | "failed" | "canceled";
  } = {},
): ToolCallItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(`2026-01-01T00:00:${id.padStart(2, "0")}.000Z`),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: options.name ?? detail.type,
        status: options.status ?? "completed",
        error: options.status === "failed" ? "boom" : null,
        detail,
      },
    },
  };
}

function assistant(id: string): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text: id,
    timestamp: new Date("2026-01-01T00:01:00.000Z"),
  };
}

describe("compactToolCallRuns", () => {
  it("preserves the original arrays when compaction is disabled", () => {
    const tail = [toolCall("1", { type: "shell", command: "one" })];
    const head = [toolCall("2", { type: "shell", command: "two" })];

    const result = compactToolCallRuns({ tail, head, cwd: "/repo", enabled: false });

    expect(result.tail).toBe(tail);
    expect(result.head).toBe(head);
    expect(result.groupsByHostId.size).toBe(0);
  });

  it("replaces four contiguous calls with their final call as a stable host", () => {
    const calls = [
      toolCall("1", { type: "shell", command: "one" }),
      toolCall("2", { type: "shell", command: "two" }),
      toolCall("3", { type: "read", filePath: "/repo/src/a.ts" }),
      toolCall("4", { type: "edit", filePath: "/repo/src/a.ts" }),
    ];

    const result = compactToolCallRuns({ tail: calls, head: [], cwd: "/repo", enabled: true });

    expect(result.tail).toEqual([calls[3]]);
    expect(result.head).toEqual([]);
    expect(result.groupsByHostId.get("4")?.id).toBe("1");
    expect(result.groupsByHostId.get("4")?.calls).toEqual(calls);

    const nextCall = toolCall("5", { type: "shell", command: "five" }, { status: "running" });
    const updated = compactToolCallRuns({
      tail: [...calls, nextCall],
      head: [],
      cwd: "/repo",
      enabled: true,
    });
    expect(updated.groupsByHostId.get("5")?.id).toBe("1");
  });

  it("does not compact short runs and stops at visible content boundaries", () => {
    const firstRun = [
      toolCall("1", { type: "shell", command: "one" }),
      toolCall("2", { type: "shell", command: "two" }),
      toolCall("3", { type: "shell", command: "three" }),
    ];
    const boundary = assistant("assistant");
    const secondRun = [
      toolCall("4", { type: "read", filePath: "/repo/a.ts" }),
      toolCall("5", { type: "read", filePath: "/repo/b.ts" }),
      toolCall("6", { type: "read", filePath: "/repo/c.ts" }),
      toolCall("7", { type: "read", filePath: "/repo/d.ts" }),
    ];

    const result = compactToolCallRuns({
      tail: [...firstRun, boundary, ...secondRun],
      head: [],
      cwd: "/repo",
      enabled: true,
    });

    expect(result.tail).toEqual([...firstRun, boundary, secondRun[3]]);
    expect([...result.groupsByHostId.keys()]).toEqual(["7"]);
  });

  it("forms one group across the history and live-head boundary", () => {
    const tail = [
      assistant("assistant"),
      toolCall("1", { type: "shell", command: "one" }),
      toolCall("2", { type: "shell", command: "two" }),
    ];
    const head = [
      toolCall("3", { type: "read", filePath: "/repo/a.ts" }),
      toolCall("4", { type: "edit", filePath: "/repo/a.ts" }, { status: "running" }),
    ];

    const result = compactToolCallRuns({ tail, head, cwd: "/repo", enabled: true });

    expect(result.tail).toEqual([tail[0]]);
    expect(result.head).toEqual([head[1]]);
    expect(result.groupsByHostId.get("4")?.calls).toEqual([...tail.slice(1), ...head]);
    expect(result.groupsByHostId.get("4")?.isRunning).toBe(true);
  });

  it("summarizes categories in first-seen order with unique paths and hosts", () => {
    const calls = [
      toolCall("1", { type: "read", filePath: "/repo/src/a.ts" }),
      toolCall("2", { type: "read", filePath: "C:\\repo\\src\\beta.ts" }),
      toolCall("3", { type: "fetch", url: "https://github.com/org/repo" }),
      toolCall(
        "4",
        { type: "search", query: "paseo", toolName: "web_search" },
        { status: "failed" },
      ),
      toolCall("5", { type: "fetch", url: "not a url" }),
    ];

    const result = compactToolCallRuns({ tail: calls, head: [], cwd: "/repo", enabled: true });
    const group = result.groupsByHostId.get("5");

    expect(group).toMatchObject({
      callCount: 5,
      failedCount: 1,
      isRunning: false,
    });
    expect(group?.categories).toEqual([
      {
        key: "read",
        label: "Read",
        iconName: "eye",
        callCount: 2,
        failedCount: 0,
        runningCount: 0,
        resources: ["a.ts", "beta.ts"],
      },
      {
        key: "fetch",
        label: "Web fetch",
        iconName: "search",
        callCount: 2,
        failedCount: 0,
        runningCount: 0,
        resources: ["github.com", "not a url"],
      },
      {
        key: "web_search",
        label: "Web search",
        iconName: "search",
        callCount: 1,
        failedCount: 1,
        runningCount: 0,
        resources: [],
      },
    ]);
  });

  it("keeps plan and spoken-message calls outside compact groups", () => {
    const shellCalls = ["1", "2", "3", "4"].map((id) =>
      toolCall(id, { type: "shell", command: id }),
    );
    const plan = toolCall("5", { type: "plan", text: "Plan" });
    const speak = toolCall(
      "6",
      { type: "unknown", input: "Hello", output: null },
      { name: "speak" },
    );

    const result = compactToolCallRuns({
      tail: [...shellCalls, plan, speak],
      head: [],
      cwd: "/repo",
      enabled: true,
    });

    expect(result.tail).toEqual([shellCalls[3], plan, speak]);
    expect(result.groupsByHostId.get("4")?.calls).toEqual(shellCalls);
  });
});
