import React, { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import {
  FlatList,
  Pressable,
  Text,
  View,
  type ListRenderItem,
  type PressableStateCallbackType,
} from "react-native";
import { useShallow } from "zustand/shallow";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { SidebarAgentListSkeleton } from "@/components/sidebar-agent-list-skeleton";
import { getProviderIcon } from "@/components/provider-icons";
import {
  type AggregatedAgentIdEntry,
  useAggregatedAgentIds,
  useAggregatedAgentsInitialLoad,
} from "@/hooks/use-aggregated-agents";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useSessionStore } from "@/stores/session-store";
import { navigateToPreparedWorkspaceTab, prepareWorkspaceTab } from "@/utils/workspace-navigation";
import { formatTimeAgo } from "@/utils/time";
import {
  createSidebarSessionWorkspaceLookup,
  resolveSidebarSessionWorkspaceId,
  shouldIncludeSidebarSessionAgent,
} from "./session-filtering";
import { selectSidebarSessionSlice } from "./select-sidebar-session-slice";
import type { SidebarSessionFilter } from "./types";
import { useSidebarSessionWorkspaces } from "./use-sidebar-session-workspaces";

interface SidebarSessionsViewProps {
  serverId: string | null;
  projects: readonly SidebarProjectEntry[];
  filter: SidebarSessionFilter;
}

export function SidebarSessionsView({
  serverId,
  projects,
  filter,
}: SidebarSessionsViewProps): ReactElement {
  const isInitialLoad = useAggregatedAgentsInitialLoad();
  const workspaces = useSidebarSessionWorkspaces({ serverId, projects });
  const lookup = useMemo(() => createSidebarSessionWorkspaceLookup(workspaces), [workspaces]);
  const filterAgent = useCallback(
    (agent: AggregatedAgentIdEntry) =>
      shouldIncludeSidebarSessionAgent({
        agent,
        filter,
        lookup,
      }),
    [filter, lookup],
  );
  const sessionIds = useAggregatedAgentIds({
    filter: filterAgent,
    sort: "createdAt-desc-stable",
  });

  if (isInitialLoad) {
    return <SidebarAgentListSkeleton />;
  }

  return <SidebarSessionsList serverId={serverId} sessionIds={sessionIds} />;
}

const SidebarSessionsList = memo(function SidebarSessionsList({
  serverId,
  sessionIds,
}: {
  serverId: string | null;
  sessionIds: readonly string[];
}): ReactElement {
  const renderItem: ListRenderItem<string> = useCallback(
    ({ item }) => (serverId ? <SidebarSessionRow id={item} serverId={serverId} /> : null),
    [serverId],
  );
  const keyExtractor = useCallback((id: string) => `${serverId ?? ""}:${id}`, [serverId]);

  return (
    <FlatList
      data={sessionIds}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={EmptySessions}
    />
  );
});

const SidebarSessionRow = memo(function SidebarSessionRow({
  id,
  serverId,
}: {
  id: string;
  serverId: string;
}): ReactElement | null {
  const { theme } = useUnistyles();
  const [isHovered, setIsHovered] = useState(false);
  const agent = useSessionStore(
    useShallow((state) => selectSidebarSessionSlice(state, serverId, id)),
  );
  const agentCwd = agent?.cwd ?? null;

  const handlePress = useCallback(() => {
    if (!agentCwd) {
      return;
    }

    const workspaceId = resolveSidebarSessionWorkspaceId({
      agent: {
        id,
        serverId,
        cwd: agentCwd,
        archivedAt: null,
      },
      workspaces: useSessionStore.getState().sessions[serverId]?.workspaces?.values(),
    });
    if (!workspaceId) {
      return;
    }

    const target = { kind: "agent" as const, agentId: id };
    prepareWorkspaceTab({
      serverId,
      workspaceId,
      target,
    });
    navigateToPreparedWorkspaceTab({
      serverId,
      workspaceId,
      target,
    });
  }, [agentCwd, id, serverId]);

  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.row,
      isHovered && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isHovered],
  );

  const titleStyle = useMemo(() => [styles.title, isHovered && styles.titleHovered], [isHovered]);

  if (!agent || agent.archivedAt) {
    return null;
  }

  const ProviderIcon = getProviderIcon(agent.provider);

  return (
    <View onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={agent.title || "New session"}
        onPress={handlePress}
        style={pressableStyle}
        testID={`sidebar-session-row-${serverId}-${id}`}
      >
        <View style={styles.providerIconWrap}>
          <ProviderIcon size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
        </View>
        <Text style={titleStyle} numberOfLines={1}>
          {agent.title || "New session"}
        </Text>
        <Text style={styles.timeAgo} numberOfLines={1}>
          {formatTimeAgo(agent.lastActivityAt)}
        </Text>
      </Pressable>
    </View>
  );
});

function EmptySessions(): ReactElement {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyText}>No sessions</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[4],
  },
  row: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    marginBottom: theme.spacing[1],
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  providerIconWrap: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    fontWeight: "400",
    lineHeight: 20,
    color: theme.colors.foreground,
    opacity: 0.76,
  },
  titleHovered: {
    opacity: 1,
  },
  timeAgo: {
    flexShrink: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  emptyState: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[6],
  },
  emptyText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
