import { Folder, Folders, ListFilter, MessagesSquare, type LucideIcon } from "lucide-react-native";
import { memo, useCallback, useMemo, type ReactElement } from "react";
import { Image, Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useProjectIconQuery } from "@/hooks/use-project-icon-query";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarSessionFilter, SidebarSessionViewMode } from "./types";
import { useVisibleSidebarSessionFilterProjects } from "./use-sidebar-session-workspaces";

interface SidebarSessionsToggleProps {
  serverId: string | null;
  mode: SidebarSessionViewMode;
  filter: SidebarSessionFilter;
  projects: readonly SidebarProjectEntry[];
  onModeChange: (mode: SidebarSessionViewMode) => void;
  onFilterChange: (filter: SidebarSessionFilter) => void;
}

const PILL_TRANSITION = LinearTransition.duration(160);
const LABEL_FADE = { in: FadeIn.duration(120), out: FadeOut.duration(80) };

export const SidebarSessionsToggle = memo(function SidebarSessionsToggle({
  serverId,
  mode,
  filter,
  projects,
  onModeChange,
  onFilterChange,
}: SidebarSessionsToggleProps): ReactElement {
  const sessionsActive = mode === "sessions";

  const handleWorkspacesPress = useCallback(() => {
    onModeChange("workspaces");
  }, [onModeChange]);
  const handleSessionsPress = useCallback(() => {
    onModeChange("sessions");
  }, [onModeChange]);

  return (
    <View style={styles.container}>
      <View style={styles.pillGroup}>
        <TogglePill
          label="Workspaces"
          icon={Folders}
          active={!sessionsActive}
          onPress={handleWorkspacesPress}
          testID="sidebar-toggle-workspaces"
        />
        <TogglePill
          label="Sessions"
          icon={MessagesSquare}
          active={sessionsActive}
          onPress={handleSessionsPress}
          testID="sidebar-toggle-sessions"
        />
      </View>
      {sessionsActive ? (
        <SidebarSessionsFilterMenu
          serverId={serverId}
          filter={filter}
          projects={projects}
          onFilterChange={onFilterChange}
        />
      ) : null}
    </View>
  );
});

function SidebarSessionsFilterMenu({
  serverId,
  filter,
  projects,
  onFilterChange,
}: {
  serverId: string | null;
  filter: SidebarSessionFilter;
  projects: readonly SidebarProjectEntry[];
  onFilterChange: (filter: SidebarSessionFilter) => void;
}) {
  const { theme } = useUnistyles();
  const filterActive = filter.type !== "all";
  const visibleFilterProjects = useVisibleSidebarSessionFilterProjects({ serverId, projects });

  const handleAllSelect = useCallback(() => {
    onFilterChange({ type: "all" });
  }, [onFilterChange]);

  const filterTriggerStyle = useCallback(
    ({ hovered = false, open = false }: PressableStateCallbackType & { open?: boolean }) => [
      styles.filterButton,
      (hovered || open || filterActive) && styles.filterButtonHovered,
    ],
    [filterActive],
  );

  const filterIcon = useMemo(
    () => (
      <ListFilter
        size={theme.iconSize.sm}
        color={filterActive ? theme.colors.foreground : theme.colors.foregroundMuted}
      />
    ),
    [filterActive, theme.colors.foreground, theme.colors.foregroundMuted, theme.iconSize.sm],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityLabel="Filter sessions"
        accessibilityRole="button"
        style={filterTriggerStyle}
        testID="sidebar-sessions-filter-trigger"
      >
        {filterIcon}
        {filterActive ? <View style={styles.filterBadge} /> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={260} scrollable maxHeight={420}>
        <DropdownMenuItem selected={filter.type === "all"} onSelect={handleAllSelect}>
          All
        </DropdownMenuItem>
        {visibleFilterProjects.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <FilterSectionHeading>Workspace</FilterSectionHeading>
            {visibleFilterProjects.flatMap((project) =>
              project.workspaces.map((workspace) => (
                <WorkspaceFilterItem
                  key={workspace.workspaceKey}
                  selected={
                    filter.type === "workspace" && filter.workspaceKey === workspace.workspaceKey
                  }
                  label={workspace.name}
                  description={project.projectName}
                  workspaceKey={workspace.workspaceKey}
                  onFilterChange={onFilterChange}
                />
              )),
            )}
            <DropdownMenuSeparator />
            <FilterSectionHeading>Project</FilterSectionHeading>
            {visibleFilterProjects.map((project) => (
              <ProjectFilterItem
                key={project.projectKey}
                selected={filter.type === "project" && filter.projectKey === project.projectKey}
                label={project.projectName}
                projectKey={project.projectKey}
                serverId={serverId}
                iconWorkingDir={project.iconWorkingDir}
                onFilterChange={onFilterChange}
              />
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TogglePill({
  label,
  icon: Icon,
  active,
  onPress,
  testID,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { theme } = useUnistyles();
  const iconColor = active ? theme.colors.foreground : theme.colors.foregroundMuted;
  const pillStyleActive = useMemo(() => [styles.pill, styles.pillActive], []);
  const pillStyleHovered = useMemo(() => [styles.pill, styles.pillHovered], []);
  const renderInner = useCallback(
    ({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => {
      let pillStyle;
      if (active) pillStyle = pillStyleActive;
      else if (hovered) pillStyle = pillStyleHovered;
      else pillStyle = styles.pill;
      return (
        <Animated.View layout={PILL_TRANSITION} style={pillStyle}>
          <Icon size={theme.iconSize.sm} color={iconColor} />
          {active ? (
            <Animated.Text
              entering={LABEL_FADE.in}
              exiting={LABEL_FADE.out}
              style={styles.pillTextActive}
            >
              {label}
            </Animated.Text>
          ) : null}
        </Animated.View>
      );
    },
    [Icon, active, iconColor, label, pillStyleActive, pillStyleHovered, theme.iconSize.sm],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
    >
      {renderInner}
    </Pressable>
  );
}

function FilterSectionHeading({ children }: { children: string }) {
  return (
    <View style={styles.filterSectionHeading}>
      <Text style={styles.filterSectionHeadingText}>{children}</Text>
    </View>
  );
}

function WorkspaceFilterItem({
  selected,
  label,
  description,
  workspaceKey,
  onFilterChange,
}: {
  selected: boolean;
  label: string;
  description: string;
  workspaceKey: string;
  onFilterChange: (filter: SidebarSessionFilter) => void;
}) {
  const handleSelect = useCallback(() => {
    onFilterChange({ type: "workspace", workspaceKey });
  }, [onFilterChange, workspaceKey]);

  return (
    <DropdownMenuItem selected={selected} description={description} onSelect={handleSelect}>
      {label}
    </DropdownMenuItem>
  );
}

function ProjectFilterItem({
  selected,
  label,
  projectKey,
  serverId,
  iconWorkingDir,
  onFilterChange,
}: {
  selected: boolean;
  label: string;
  projectKey: string;
  serverId: string | null;
  iconWorkingDir: string;
  onFilterChange: (filter: SidebarSessionFilter) => void;
}) {
  const handleSelect = useCallback(() => {
    onFilterChange({ type: "project", projectKey });
  }, [onFilterChange, projectKey]);

  const leading = useMemo(
    () => <ProjectIconLeading serverId={serverId} cwd={iconWorkingDir} />,
    [serverId, iconWorkingDir],
  );

  return (
    <DropdownMenuItem selected={selected} leading={leading} onSelect={handleSelect}>
      {label}
    </DropdownMenuItem>
  );
}

function ProjectIconLeading({ serverId, cwd }: { serverId: string | null; cwd: string }) {
  const { theme } = useUnistyles();
  const { icon } = useProjectIconQuery({ serverId: serverId ?? "", cwd });
  const dataUri = useMemo(() => {
    if (!icon || !icon.mimeType || !icon.data) {
      return null;
    }
    return `data:${icon.mimeType};base64,${icon.data}`;
  }, [icon]);
  const imageSource = useMemo(() => (dataUri ? { uri: dataUri } : null), [dataUri]);

  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {imageSource ? (
        <Image source={imageSource} style={styles.projectIconImage} />
      ) : (
        <View style={styles.projectIconFallback}>
          <Folder size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  pillGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minWidth: 0,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 28,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  pillActive: {
    backgroundColor: theme.colors.surfaceSidebarHover,
    paddingRight: theme.spacing[3],
  },
  pillHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  pillTextActive: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  filterButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
    position: "relative",
  },
  filterButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  filterBadge: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 5,
    height: 5,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foreground,
  },
  filterSectionHeading: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  filterSectionHeadingText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  projectIconImage: {
    width: theme.iconSize.sm,
    height: theme.iconSize.sm,
    borderRadius: theme.borderRadius.sm,
  },
  projectIconFallback: {
    width: theme.iconSize.sm,
    height: theme.iconSize.sm,
    alignItems: "center",
    justifyContent: "center",
  },
}));
