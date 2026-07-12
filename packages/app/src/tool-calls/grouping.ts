import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { getFileNameFromPath } from "@/attachments/utils";
import { buildToolCallDisplayModel } from "@/utils/tool-call-display";
import { resolveToolCallIconName, type ToolCallIcon } from "@/utils/tool-call-icon-name";
import type { StreamItem, ToolCallItem } from "@/types/stream";

export const MIN_COMPACT_TOOL_CALLS = 4;

export interface ToolCallCategorySummary {
  key: string;
  label: string;
  iconName: ToolCallIcon;
  callCount: number;
  failedCount: number;
  runningCount: number;
  resources: string[];
}

export interface CompactToolCallGroup {
  id: string;
  calls: ToolCallItem[];
  callCount: number;
  failedCount: number;
  isRunning: boolean;
  categories: ToolCallCategorySummary[];
}

export interface CompactToolCallRunsResult {
  tail: StreamItem[];
  head: StreamItem[];
  groupsByHostId: Map<string, CompactToolCallGroup>;
}

interface CompactToolCallRunsInput {
  tail: StreamItem[];
  head: StreamItem[];
  cwd?: string;
  enabled: boolean;
}

interface TaggedStreamItem {
  segment: "tail" | "head";
  item: StreamItem;
}

interface ToolCallDescriptor {
  detail: ToolCallDetail;
  name: string;
  status: "running" | "completed" | "failed" | "canceled";
  error: unknown;
  metadata?: Record<string, unknown>;
}

function describeToolCall(item: ToolCallItem): ToolCallDescriptor {
  if (item.payload.source === "agent") {
    const { data } = item.payload;
    return {
      detail: data.detail,
      name: data.name,
      status: data.status,
      error: data.error,
      metadata: data.metadata,
    };
  }

  const { data } = item.payload;
  return {
    detail: {
      type: "unknown",
      input: data.arguments ?? null,
      output: data.result ?? null,
    },
    name: data.toolName,
    status: data.status === "executing" ? "running" : data.status,
    error: data.error,
  };
}

function isCompactableToolCall(item: StreamItem): item is ToolCallItem {
  if (item.kind !== "tool_call") {
    return false;
  }
  const descriptor = describeToolCall(item);
  return descriptor.detail.type !== "plan" && descriptor.name.trim().toLowerCase() !== "speak";
}

function resourceForDetail(detail: ToolCallDetail, summary: string | undefined): string | null {
  if (detail.type === "read" || detail.type === "edit" || detail.type === "write") {
    const path = summary ?? detail.filePath;
    return getFileNameFromPath(path) ?? path;
  }
  if (detail.type !== "fetch") {
    return null;
  }
  try {
    return new URL(detail.url).hostname || detail.url;
  } catch {
    return detail.url;
  }
}

function categoryIdentity(input: { detail: ToolCallDetail; displayName: string }): {
  key: string;
  label: string;
} {
  const { detail, displayName } = input;
  if (detail.type === "search" && detail.toolName === "web_search") {
    return { key: "web_search", label: "Web search" };
  }
  if (detail.type === "fetch") {
    return { key: "fetch", label: "Web fetch" };
  }
  if (detail.type !== "unknown" && detail.type !== "plain_text") {
    return { key: detail.type, label: displayName };
  }
  return { key: `tool:${displayName.toLowerCase()}`, label: displayName };
}

function buildCompactToolCallGroup(calls: ToolCallItem[], cwd: string | undefined) {
  const categories = new Map<string, ToolCallCategorySummary>();
  let failedCount = 0;
  let isRunning = false;

  for (const call of calls) {
    const descriptor = describeToolCall(call);
    const display = buildToolCallDisplayModel({
      name: descriptor.name,
      status: descriptor.status,
      error: descriptor.error,
      detail: descriptor.detail,
      metadata: descriptor.metadata,
      cwd,
    });
    const identity = categoryIdentity({
      detail: descriptor.detail,
      displayName: display.displayName,
    });
    const isFailed = descriptor.status === "failed";
    const isCallRunning = descriptor.status === "running";
    failedCount += isFailed ? 1 : 0;
    isRunning ||= isCallRunning;

    let category = categories.get(identity.key);
    if (!category) {
      category = {
        ...identity,
        iconName: resolveToolCallIconName(descriptor.name, descriptor.detail),
        callCount: 0,
        failedCount: 0,
        runningCount: 0,
        resources: [],
      };
      categories.set(identity.key, category);
    }
    category.callCount += 1;
    category.failedCount += isFailed ? 1 : 0;
    category.runningCount += isCallRunning ? 1 : 0;
    const resource = resourceForDetail(descriptor.detail, display.summary);
    if (resource && !category.resources.includes(resource)) {
      category.resources.push(resource);
    }
  }

  const firstCall = calls[0];
  if (!firstCall) {
    throw new Error("Cannot build an empty tool call group");
  }
  return {
    id: firstCall.id,
    calls,
    callCount: calls.length,
    failedCount,
    isRunning,
    categories: [...categories.values()],
  } satisfies CompactToolCallGroup;
}

export function compactToolCallRuns(input: CompactToolCallRunsInput): CompactToolCallRunsResult {
  if (!input.enabled) {
    return {
      tail: input.tail,
      head: input.head,
      groupsByHostId: new Map(),
    };
  }

  const taggedItems: TaggedStreamItem[] = [
    ...input.tail.map((item) => ({ segment: "tail" as const, item })),
    ...input.head.map((item) => ({ segment: "head" as const, item })),
  ];
  const compactedTail: StreamItem[] = [];
  const compactedHead: StreamItem[] = [];
  const groupsByHostId = new Map<string, CompactToolCallGroup>();
  let pendingRun: TaggedStreamItem[] = [];

  const append = ({ segment, item }: TaggedStreamItem) => {
    (segment === "tail" ? compactedTail : compactedHead).push(item);
  };
  const flushRun = () => {
    if (pendingRun.length >= MIN_COMPACT_TOOL_CALLS) {
      const host = pendingRun.at(-1);
      if (!host) {
        throw new Error("Cannot compact an empty tool call run");
      }
      const calls = pendingRun.map(({ item }) => item as ToolCallItem);
      append(host);
      groupsByHostId.set(host.item.id, buildCompactToolCallGroup(calls, input.cwd));
    } else {
      for (const entry of pendingRun) {
        append(entry);
      }
    }
    pendingRun = [];
  };

  for (const entry of taggedItems) {
    if (isCompactableToolCall(entry.item)) {
      pendingRun.push(entry);
      continue;
    }
    flushRun();
    append(entry);
  }
  flushRun();

  if (groupsByHostId.size === 0) {
    return {
      tail: input.tail,
      head: input.head,
      groupsByHostId,
    };
  }
  return {
    tail: compactedTail,
    head: compactedHead,
    groupsByHostId,
  };
}
