import os from "node:os";
import path from "node:path";
import process from "node:process";

export type NexusPathHostPlatform = "auto" | "macos" | "windows" | "linux";
export type NexusPathStyle = "posix" | "windows";
export type NexusProjectPathBase =
  | "absolute"
  | "projectRoot"
  | "projectParent"
  | "home"
  | "sourcesRoot";

export interface AnalyzeNexusProjectPathOptions {
  projectRoot: string;
  value: string;
  platform?: NexusPathHostPlatform | NexusPathStyle;
  homePath?: string;
  sourcesRoot?: string;
}

export interface NexusProjectPathAnalysis {
  input: string;
  path: string;
  platform: NexusPathStyle;
  base: NexusProjectPathBase;
  portable: boolean;
  compatible: boolean;
  absolute: boolean;
}

const portableBaseNames = new Set([
  "projectRoot",
  "projectParent",
  "home",
  "sourcesRoot",
]);

export function resolveNexusProjectPath(
  options: AnalyzeNexusProjectPathOptions,
): string {
  return analyzeNexusProjectPath(options).path;
}

export function analyzeNexusProjectPath(
  options: AnalyzeNexusProjectPathOptions,
): NexusProjectPathAnalysis {
  const platform = normalizeNexusPathPlatform(options.platform);
  const input = options.value.trim();
  const absoluteKind = absolutePathKind(input);

  if (absoluteKind) {
    return {
      input,
      path: normalizeAbsoluteForKind(input, absoluteKind),
      platform,
      base: "absolute",
      portable: false,
      compatible: absoluteKind === platform,
      absolute: true,
    };
  }

  const portableBase = splitPortableBase(input);
  if (portableBase) {
    const base = resolvePortableBase(options, portableBase.base, platform);
    return {
      input,
      path: joinForPlatform(platform, base, portableBase.tail),
      platform,
      base: portableBase.base,
      portable: true,
      compatible: true,
      absolute: isAbsoluteForPlatform(base, platform),
    };
  }

  return {
    input,
    path: joinForPlatform(platform, options.projectRoot, input),
    platform,
    base: "projectRoot",
    portable: true,
    compatible: true,
    absolute: isAbsoluteForPlatform(options.projectRoot, platform),
  };
}

export function normalizeNexusPathPlatform(
  platform: NexusPathHostPlatform | NexusPathStyle | undefined,
): NexusPathStyle {
  if (!platform || platform === "auto") {
    return process.platform === "win32" ? "windows" : "posix";
  }
  if (platform === "windows") {
    return "windows";
  }
  if (platform === "macos" || platform === "linux" || platform === "posix") {
    return "posix";
  }
  throw new Error("path platform must be auto, macos, windows, linux, posix, or windows");
}

function resolvePortableBase(
  options: AnalyzeNexusProjectPathOptions,
  base: NexusProjectPathBase,
  platform: NexusPathStyle,
): string {
  const pathApi = pathApiForPlatform(platform);
  if (base === "projectRoot") {
    return normalizePortableSegment(options.projectRoot, platform);
  }
  if (base === "projectParent") {
    return pathApi.dirname(normalizePortableSegment(options.projectRoot, platform));
  }
  if (base === "home") {
    return normalizePortableSegment(options.homePath ?? os.homedir(), platform);
  }
  if (base === "sourcesRoot") {
    return normalizePortableSegment(
      options.sourcesRoot ??
        pathApi.join(
          pathApi.dirname(normalizePortableSegment(options.projectRoot, platform)),
          "sources",
        ),
      platform,
    );
  }

  return normalizePortableSegment(options.projectRoot, platform);
}

function splitPortableBase(
  value: string,
): { base: NexusProjectPathBase; tail: string } | null {
  const match = /^([A-Za-z][A-Za-z0-9_-]*):(.*)$/u.exec(value);
  if (!match) {
    return null;
  }

  const base = match[1];
  if (!portableBaseNames.has(base)) {
    return null;
  }

  return {
    base: base as NexusProjectPathBase,
    tail: match[2] ?? "",
  };
}

function pathApiForPlatform(platform: NexusPathStyle): typeof path.posix {
  return platform === "windows" ? path.win32 : path.posix;
}

function joinForPlatform(
  platform: NexusPathStyle,
  base: string,
  tail: string,
): string {
  const pathApi = pathApiForPlatform(platform);
  if (!tail.trim()) {
    return pathApi.normalize(base);
  }
  return pathApi.normalize(
    pathApi.join(base, normalizePortableSegment(tail, platform)),
  );
}

function normalizePortableSegment(value: string, platform: NexusPathStyle): string {
  if (platform === "windows") {
    return value.replace(/\//gu, "\\");
  }
  return value.replace(/\\/gu, "/");
}

function absolutePathKind(value: string): NexusPathStyle | null {
  if (isWindowsAbsolutePath(value)) {
    return "windows";
  }
  if (isPosixAbsolutePath(value)) {
    return "posix";
  }
  return null;
}

function normalizeAbsoluteForKind(value: string, kind: NexusPathStyle): string {
  return kind === "windows" ? path.win32.normalize(value) : path.posix.normalize(value);
}

function isAbsoluteForPlatform(value: string, platform: NexusPathStyle): boolean {
  return platform === "windows"
    ? isWindowsAbsolutePath(value)
    : isPosixAbsolutePath(value);
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(value) || /^\\\\[^\\]/u.test(value);
}

function isPosixAbsolutePath(value: string): boolean {
  return value.startsWith("/");
}
