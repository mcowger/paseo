import { memo, useCallback, useMemo, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronRight, TriangleAlert, Wrench } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import type { CompactToolCallGroup as CompactToolCallGroupModel } from "@/tool-calls/grouping";

interface ToolCallGroupProps {
  group: CompactToolCallGroupModel;
  expanded: boolean;
  onExpandedChange: (groupId: string, expanded: boolean) => void;
  children: ReactNode;
}

function GroupHeaderIcon({ group }: { group: CompactToolCallGroupModel }) {
  if (group.failedCount > 0) {
    return <TriangleAlert size={11} color={styles.error.color} />;
  }
  if (group.isRunning) {
    return <ActivityIndicator size={11} color={styles.foreground.color} />;
  }
  return <Wrench size={11} color={styles.muted.color} />;
}

function joinSummaryParts(parts: string[], conjunction: string): string {
  let joined: string;
  if (parts.length === 1) {
    joined = parts[0] ?? "";
  } else if (parts.length === 2) {
    joined = `${parts[0]} ${conjunction} ${parts[1]}`;
  } else {
    joined = `${parts.slice(0, -1).join(", ")}, ${conjunction} ${parts.at(-1)}`;
  }
  const firstCharacter = joined[0];
  return firstCharacter ? `${firstCharacter.toLocaleUpperCase()}${joined.slice(1)}` : joined;
}

export const ToolCallGroup = memo(function ToolCallGroup({
  group,
  expanded,
  onExpandedChange,
  children,
}: ToolCallGroupProps) {
  const { t } = useTranslation();
  const handlePress = useCallback(
    () => onExpandedChange(group.id, !expanded),
    [expanded, group.id, onExpandedChange],
  );
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const headerStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.header,
      (pressed || hovered || expanded) && styles.headerActive,
    ],
    [expanded],
  );
  const summary = useMemo(() => {
    const parts: string[] = [];
    if (group.editedFileCount > 0) {
      parts.push(
        t(
          group.editedFileCount === 1
            ? "toolCallGroup.editedFiles.one"
            : "toolCallGroup.editedFiles.other",
          { count: group.editedFileCount },
        ),
      );
    }
    if (group.commandCount > 0) {
      parts.push(
        t(
          group.commandCount === 1 ? "toolCallGroup.commands.one" : "toolCallGroup.commands.other",
          { count: group.commandCount },
        ),
      );
    }
    if (group.readFileCount > 0) {
      parts.push(
        t(
          group.readFileCount === 1
            ? "toolCallGroup.readFiles.one"
            : "toolCallGroup.readFiles.other",
          { count: group.readFileCount },
        ),
      );
    }
    if (group.searchCount > 0) {
      parts.push(
        t(group.searchCount === 1 ? "toolCallGroup.searches.one" : "toolCallGroup.searches.other", {
          count: group.searchCount,
        }),
      );
    }
    if (group.otherToolCount > 0) {
      parts.push(
        t(
          group.otherToolCount === 1
            ? "toolCallGroup.otherTools.one"
            : "toolCallGroup.otherTools.other",
          { count: group.otherToolCount },
        ),
      );
    }
    if (group.paseoCallCount > 0) {
      parts.push(
        t(
          group.paseoCallCount === 1
            ? "toolCallGroup.paseoCalls.one"
            : "toolCallGroup.paseoCalls.other",
          { count: group.paseoCallCount },
        ),
      );
    }
    return joinSummaryParts(parts, t("toolCallGroup.and"));
  }, [group, t]);

  return (
    <View style={styles.container} testID="tool-call-group">
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        accessibilityLabel={summary}
        style={headerStyle}
      >
        <View style={styles.headerIcon}>
          <GroupHeaderIcon group={group} />
        </View>
        <Text style={styles.summary} numberOfLines={1}>
          {summary}
        </Text>
        {group.failedCount > 0 ? (
          <Text style={styles.error}>
            {t("toolCallGroup.failed", { count: group.failedCount })}
          </Text>
        ) : null}
        <ChevronRight
          size={12}
          color={styles.muted.color}
          style={expanded ? styles.chevronExpanded : undefined}
        />
      </Pressable>

      {expanded ? <View style={styles.expandedCalls}>{children}</View> : null}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    marginHorizontal: -theme.spacing[3],
  },
  header: {
    minHeight: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.lg,
  },
  headerActive: {
    backgroundColor: theme.colors.surface1,
  },
  headerIcon: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  summary: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  expandedCalls: {
    paddingTop: theme.spacing[1],
    marginHorizontal: theme.spacing[3],
  },
  chevronExpanded: {
    transform: [{ rotate: "90deg" }],
  },
  foreground: {
    color: theme.colors.foreground,
  },
  muted: {
    color: theme.colors.foregroundMuted,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
  },
}));
