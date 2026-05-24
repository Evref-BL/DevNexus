import fs from "node:fs";
import path from "node:path";
import {
  analyzeNexusProjectPath,
  type NexusPathHostPlatform,
  type NexusProjectPathAnalysis,
} from "../runtime/nexusPathResolver.js";
import type { NexusProjectComponentConfig } from "./nexusProjectConfig.js";

export type NexusComponentSourceRootTopologyLayout =
  | "embedded"
  | "workspace-local"
  | "explicit-external"
  | "legacy-external"
  | "incompatible-platform";

export type NexusComponentSourceRootTopologyState =
  | "present"
  | "missing"
  | "workspace-local-escape"
  | "incompatible-platform";

export interface NexusComponentSourceRootTopology {
  componentId: string;
  configuredSourceRoot: string | null;
  configuredBase: NexusProjectPathAnalysis["base"];
  configuredPath: string;
  effectivePath: string;
  realPath: string | null;
  layout: NexusComponentSourceRootTopologyLayout;
  state: NexusComponentSourceRootTopologyState;
  portable: boolean;
  compatible: boolean;
  exists: boolean;
  insideProjectRoot: boolean;
  realInsideProjectRoot: boolean | null;
  summary: string;
  nextAction: string | null;
}

export interface ClassifyNexusComponentSourceRootTopologyOptions {
  projectRoot: string;
  component: Pick<NexusProjectComponentConfig, "id" | "sourceRoot">;
  platform?: NexusPathHostPlatform;
  pathPlatform?: NexusPathHostPlatform;
}

export function classifyNexusComponentSourceRootTopology(
  options: ClassifyNexusComponentSourceRootTopologyOptions,
): NexusComponentSourceRootTopology {
  const projectRoot = path.resolve(options.projectRoot);
  const configuredSourceRoot = options.component.sourceRoot ?? null;
  const sourceRootValue = configuredSourceRoot ?? `componentsRoot:${options.component.id}`;
  const platform = options.platform ?? "auto";
  const pathPlatform = options.pathPlatform ?? platform;
  const configuredAnalysis = analyzeNexusProjectPath({
    projectRoot,
    value: sourceRootValue,
    platform,
  });

  if (!configuredAnalysis.compatible) {
    const fallback = analyzeNexusProjectPath({
      projectRoot,
      value: `componentsRoot:${options.component.id}`,
      platform: pathPlatform,
    });
    return topologyFromAnalysis({
      projectRoot,
      componentId: options.component.id,
      configuredSourceRoot,
      configuredAnalysis,
      effectiveAnalysis: fallback,
      layout: "incompatible-platform",
      stateOverride: "incompatible-platform",
      summary:
        `Configured sourceRoot ${sourceRootValue} is incompatible with ${platform}; using workspace-local fallback ${fallback.path}.`,
      nextAction:
        "Use a portable sourceRoot such as componentsRoot:<component-id> or sourcesRoot:<name>, or document an intentional host-local override.",
    });
  }

  const effectiveAnalysis = pathPlatform === platform
    ? configuredAnalysis
    : analyzeNexusProjectPath({
        projectRoot,
        value: sourceRootValue,
        platform: pathPlatform,
      });
  const layout = sourceRootLayout(projectRoot, configuredAnalysis, effectiveAnalysis);
  return topologyFromAnalysis({
    projectRoot,
    componentId: options.component.id,
    configuredSourceRoot,
    configuredAnalysis,
    effectiveAnalysis,
    layout,
  });
}

function topologyFromAnalysis(options: {
  projectRoot: string;
  componentId: string;
  configuredSourceRoot: string | null;
  configuredAnalysis: NexusProjectPathAnalysis;
  effectiveAnalysis: NexusProjectPathAnalysis;
  layout: NexusComponentSourceRootTopologyLayout;
  stateOverride?: NexusComponentSourceRootTopologyState;
  summary?: string;
  nextAction?: string | null;
}): NexusComponentSourceRootTopology {
  const exists = directoryExists(options.effectiveAnalysis.path);
  const insideProjectRoot = pathInside(options.projectRoot, options.effectiveAnalysis.path);
  const realPath = exists ? realpath(options.effectiveAnalysis.path) : null;
  const realProjectRoot = realpathIfExists(options.projectRoot);
  const realInsideProjectRoot = realPath
    ? pathInside(realProjectRoot, realPath)
    : null;
  const state = options.stateOverride ??
    sourceRootState({
      exists,
      layout: options.layout,
      realInsideProjectRoot,
    });
  const summary = options.summary ??
    sourceRootSummary({
      layout: options.layout,
      state,
      path: options.effectiveAnalysis.path,
    });

  return {
    componentId: options.componentId,
    configuredSourceRoot: options.configuredSourceRoot,
    configuredBase: options.configuredAnalysis.base,
    configuredPath: options.configuredAnalysis.path,
    effectivePath: options.effectiveAnalysis.path,
    realPath,
    layout: options.layout,
    state,
    portable: options.configuredAnalysis.portable,
    compatible: options.configuredAnalysis.compatible,
    exists,
    insideProjectRoot,
    realInsideProjectRoot,
    summary,
    nextAction: options.nextAction ?? sourceRootNextAction(options.layout, state),
  };
}

function sourceRootLayout(
  projectRoot: string,
  configuredAnalysis: NexusProjectPathAnalysis,
  effectiveAnalysis: NexusProjectPathAnalysis,
): NexusComponentSourceRootTopologyLayout {
  if (samePath(projectRoot, effectiveAnalysis.path)) {
    return "embedded";
  }
  if (
    (configuredAnalysis.base === "componentsRoot" ||
      configuredAnalysis.base === "projectRoot") &&
    pathInside(projectRoot, effectiveAnalysis.path)
  ) {
    return "workspace-local";
  }
  if (
    configuredAnalysis.base === "sourcesRoot" ||
    configuredAnalysis.base === "projectParent" ||
    configuredAnalysis.base === "home"
  ) {
    return "explicit-external";
  }
  return "legacy-external";
}

function samePath(left: string, right: string): boolean {
  return path.relative(path.resolve(left), path.resolve(right)) === "";
}

function sourceRootState(options: {
  exists: boolean;
  layout: NexusComponentSourceRootTopologyLayout;
  realInsideProjectRoot: boolean | null;
}): NexusComponentSourceRootTopologyState {
  if (!options.exists) {
    return "missing";
  }
  if (options.layout === "workspace-local" && options.realInsideProjectRoot === false) {
    return "workspace-local-escape";
  }
  return "present";
}

function sourceRootSummary(options: {
  layout: NexusComponentSourceRootTopologyLayout;
  state: NexusComponentSourceRootTopologyState;
  path: string;
}): string {
  if (options.state === "missing") {
    return `${layoutLabel(options.layout)} source root is missing: ${options.path}.`;
  }
  if (options.state === "workspace-local-escape") {
    return `Workspace-local-looking source root resolves outside the DevNexus workspace root: ${options.path}.`;
  }
  return `${layoutLabel(options.layout)} source root is present: ${options.path}.`;
}

function sourceRootNextAction(
  layout: NexusComponentSourceRootTopologyLayout,
  state: NexusComponentSourceRootTopologyState,
): string | null {
  if (state === "missing") {
    if (layout === "embedded") {
      return "Create or clone the project repository at the DevNexus workspace root, or choose another primary component source path.";
    }
    if (layout === "workspace-local") {
      return "Clone the component into the workspace-local components root before assigning work.";
    }
    return "Confirm this external layout is intentional, or migrate the checkout into componentsRoot:<component-id>.";
  }
  if (state === "workspace-local-escape") {
    return "Replace the symlink or junction with a real workspace-local clone, or configure an explicit external sourceRoot.";
  }
  if (state === "incompatible-platform") {
    return "Use a portable sourceRoot or configure this host through host-local setup instead of shared absolute paths.";
  }
  if (layout === "explicit-external") {
    return "Confirm this external source-root layout is intentional; migrate to workspace-local components when ready.";
  }
  if (layout === "legacy-external") {
    return "Treat this as legacy host-local checkout reuse; prefer migrating to componentsRoot:<component-id>.";
  }
  return null;
}

function layoutLabel(layout: NexusComponentSourceRootTopologyLayout): string {
  if (layout === "embedded") {
    return "embedded project-root";
  }
  if (layout === "workspace-local") {
    return "workspace-local";
  }
  if (layout === "explicit-external") {
    return "explicit external";
  }
  if (layout === "legacy-external") {
    return "legacy external";
  }
  return "incompatible-platform";
}

function directoryExists(directoryPath: string): boolean {
  return fs.existsSync(directoryPath) && fs.statSync(directoryPath).isDirectory();
}

function realpath(directoryPath: string): string {
  try {
    return fs.realpathSync.native(directoryPath);
  } catch {
    return fs.realpathSync(directoryPath);
  }
}

function realpathIfExists(directoryPath: string): string {
  return directoryExists(directoryPath) ? realpath(directoryPath) : path.resolve(directoryPath);
}

function pathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
