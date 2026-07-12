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
import { useIsCompactFormFactor } from "@/constants/layout";
import type {
  CompactToolCallGroup as CompactToolCallGroupModel,
  ToolCallCategorySummary,
} from "@/tool-calls/grouping";
import { componentForToolCallIcon } from "@/utils/tool-call-icon";

interface ToolCallGroupProps {
  group: CompactToolCallGroupModel;
  expanded: boolean;
  onExpandedChange: (groupId: string, expanded: boolean) => void;
  children: ReactNode;
}

function CategoryStatus({ category }: { category: ToolCallCategorySummary }) {
  const { t } = useTranslation();
  if (category.failedCount > 0) {
    return (
      <View style={styles.categoryStatus}>
        <TriangleAlert size={12} color={styles.error.color} />
        <Text style={styles.error}>
          {t("toolCallGroup.failed", { count: category.failedCount })}
        </Text>
      </View>
    );
  }
  if (category.runningCount > 0) {
    return <ActivityIndicator size={12} color={styles.muted.color} />;
  }
  return null;
}

function GroupHeaderIcon({ group }: { group: CompactToolCallGroupModel }) {
  if (group.failedCount > 0) {
    return <TriangleAlert size={12} color={styles.error.color} />;
  }
  if (group.isRunning) {
    return <ActivityIndicator size={12} color={styles.foreground.color} />;
  }
  return <Wrench size={12} color={styles.muted.color} />;
}

function CategoryRow({
  category,
  resourceLimit,
}: {
  category: ToolCallCategorySummary;
  resourceLimit: number;
}) {
  const Icon = componentForToolCallIcon(category.iconName);
  const visibleResources = category.resources.slice(0, resourceLimit);
  const hiddenResourceCount = category.resources.length - visibleResources.length;
  const resourceText = [
    ...visibleResources,
    ...(hiddenResourceCount > 0 ? [`+${hiddenResourceCount}`] : []),
  ].join(", ");

  return (
    <View style={styles.categoryRow}>
      <View style={styles.categoryIcon}>
        <Icon size={12} color={styles.muted.color} />
      </View>
      <Text style={styles.categoryLabel}>{category.label}</Text>
      <Text style={styles.categoryCount}>×{category.callCount}</Text>
      <CategoryStatus category={category} />
      {resourceText ? (
        <Text style={styles.resources} numberOfLines={1}>
          {resourceText}
        </Text>
      ) : null}
    </View>
  );
}

export const ToolCallGroup = memo(function ToolCallGroup({
  group,
  expanded,
  onExpandedChange,
  children,
}: ToolCallGroupProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const resourceLimit = isCompact ? 2 : 3;
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

  return (
    <View style={styles.container} testID="tool-call-group">
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        accessibilityLabel={t("toolCallGroup.accessibilityLabel", { count: group.callCount })}
        style={headerStyle}
      >
        <View style={styles.headerIcon}>
          <GroupHeaderIcon group={group} />
        </View>
        <Text style={styles.title}>{t("toolCallGroup.title")}</Text>
        <Text style={styles.callCount}>×{group.callCount}</Text>
        {group.failedCount > 0 ? (
          <Text style={styles.error}>
            {t("toolCallGroup.failed", { count: group.failedCount })}
          </Text>
        ) : null}
        <ChevronRight
          size={14}
          color={styles.muted.color}
          style={expanded ? styles.chevronExpanded : undefined}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.expandedCalls}>{children}</View>
      ) : (
        <View style={styles.categories}>
          {group.categories.map((category) => (
            <CategoryRow key={category.key} category={category} resourceLimit={resourceLimit} />
          ))}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    marginHorizontal: -theme.spacing[3],
  },
  header: {
    minHeight: 30,
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
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  callCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  categories: {
    gap: theme.spacing[1],
    paddingLeft: theme.spacing[8],
    paddingRight: theme.spacing[2],
    paddingTop: theme.spacing[1],
  },
  categoryRow: {
    minHeight: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  categoryIcon: {
    width: 14,
    alignItems: "center",
  },
  categoryLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    minWidth: 64,
  },
  categoryCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  categoryStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  resources: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  expandedCalls: {
    paddingTop: theme.spacing[1],
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
