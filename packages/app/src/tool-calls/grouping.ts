import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { isPaseoToolName } from "@getpaseo/protocol/tool-name-normalization";
import type { StreamItem, ToolCallItem } from "@/types/stream";

export const MIN_COMPACT_TOOL_CALLS = 4;

const DIRECT_PASEO_TOOL_PREFIX = "paseo_";
const DIRECT_SEARCH_TOOL_NAMES = new Set([
  "brave-search_brave_web_search",
  "brave-search_brave_llm_context",
]);

export interface CompactToolCallGroup {
  id: string;
  calls: ToolCallItem[];
  failedCount: number;
  isRunning: boolean;
  editedFileCount: number;
  commandCount: number;
  readFileCount: number;
  searchCount: number;
  otherToolCount: number;
  paseoCallCount: number;
}

export interface CompactToolCallRunsResult {
  tail: StreamItem[];
  head: StreamItem[];
  groupsByHostId: Map<string, CompactToolCallGroup>;
}

interface CompactToolCallRunsInput {
  tail: StreamItem[];
  head: StreamItem[];
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
}

function describeToolCall(item: ToolCallItem): ToolCallDescriptor {
  if (item.payload.source === "agent") {
    const { data } = item.payload;
    return {
      detail: data.detail,
      name: data.name,
      status: data.status,
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
  };
}

function isCompactableToolCall(item: StreamItem): item is ToolCallItem {
  if (item.kind !== "tool_call") {
    return false;
  }
  const descriptor = describeToolCall(item);
  return descriptor.detail.type !== "plan" && descriptor.name.trim().toLowerCase() !== "speak";
}

function buildCompactToolCallGroup(calls: ToolCallItem[]) {
  const editedFiles = new Set<string>();
  const readFiles = new Set<string>();
  let failedCount = 0;
  let isRunning = false;
  let commandCount = 0;
  let searchCount = 0;
  let otherToolCount = 0;
  let paseoCallCount = 0;

  for (const call of calls) {
    const descriptor = describeToolCall(call);
    const isFailed = descriptor.status === "failed";
    const isCallRunning = descriptor.status === "running";
    failedCount += isFailed ? 1 : 0;
    isRunning ||= isCallRunning;
    const normalizedName = descriptor.name.trim().toLowerCase();

    if (isPaseoToolName(descriptor.name) || normalizedName.startsWith(DIRECT_PASEO_TOOL_PREFIX)) {
      paseoCallCount += 1;
      continue;
    }
    if (descriptor.detail.type === "edit" || descriptor.detail.type === "write") {
      editedFiles.add(descriptor.detail.filePath);
      continue;
    }
    if (descriptor.detail.type === "shell") {
      commandCount += 1;
      continue;
    }
    if (descriptor.detail.type === "read") {
      readFiles.add(descriptor.detail.filePath);
      continue;
    }
    if (descriptor.detail.type === "search" || DIRECT_SEARCH_TOOL_NAMES.has(normalizedName)) {
      searchCount += 1;
      continue;
    }
    otherToolCount += 1;
  }

  const firstCall = calls[0];
  if (!firstCall) {
    throw new Error("Cannot build an empty tool call group");
  }
  return {
    id: firstCall.id,
    calls,
    failedCount,
    isRunning,
    editedFileCount: editedFiles.size,
    commandCount,
    readFileCount: readFiles.size,
    searchCount,
    otherToolCount,
    paseoCallCount,
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
      groupsByHostId.set(host.item.id, buildCompactToolCallGroup(calls));
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
