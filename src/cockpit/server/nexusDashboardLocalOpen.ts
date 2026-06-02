import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type NexusDashboardLocalOpenTarget = "home" | "project";

export type NexusDashboardLocalOpenApp = "file" | "code" | "terminal";

export interface NexusDashboardLocalOpenRequest {
  target: NexusDashboardLocalOpenTarget;
  app: NexusDashboardLocalOpenApp;
  path: string;
}

export interface NexusDashboardLocalOpenResult
  extends NexusDashboardLocalOpenRequest {
  ok: boolean;
  command?: string;
  args?: string[];
  error?: string;
}

export type NexusDashboardLocalResourceOpener = (
  request: NexusDashboardLocalOpenRequest,
) => Promise<NexusDashboardLocalOpenResult>;

interface NexusDashboardLocalAppIcon {
  readonly body: Buffer | string;
  readonly contentType: string;
}

export async function dashboardLocalAppIcon(
  app: NexusDashboardLocalOpenApp,
): Promise<NexusDashboardLocalAppIcon> {
  const pngPath = await dashboardDarwinAppIconPng(app);
  if (pngPath) {
    return {
      body: await fs.promises.readFile(pngPath),
      contentType: "image/png",
    };
  }
  return {
    body: fallbackLocalAppIconSvg(app),
    contentType: "image/svg+xml; charset=utf-8",
  };
}

async function dashboardDarwinAppIconPng(
  app: NexusDashboardLocalOpenApp,
): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  const source = dashboardDarwinAppIconSource(app);
  if (!source) return null;
  try {
    const stat = await fs.promises.stat(source);
    const cacheRoot = path.join(os.tmpdir(), "dev-nexus-dashboard-app-icons");
    await fs.promises.mkdir(cacheRoot, { recursive: true });
    const target = path.join(
      cacheRoot,
      `${app}-${stat.size}-${Math.trunc(stat.mtimeMs)}.png`,
    );
    if (!fs.existsSync(target)) {
      await execFilePromise("sips", [
        "-s",
        "format",
        "png",
        source,
        "--out",
        target,
      ]);
    }
    return target;
  } catch {
    return null;
  }
}

function dashboardDarwinAppIconSource(
  app: NexusDashboardLocalOpenApp,
): string | null {
  const homeApplications = path.join(os.homedir(), "Applications");
  const candidates: Record<NexusDashboardLocalOpenApp, string[]> = {
    code: [
      "/Applications/Visual Studio Code.app/Contents/Resources/Code.icns",
      path.join(homeApplications, "Visual Studio Code.app/Contents/Resources/Code.icns"),
      "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/Code - Insiders.icns",
      path.join(homeApplications, "Visual Studio Code - Insiders.app/Contents/Resources/Code - Insiders.icns"),
    ],
    file: [
      "/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/FinderIcon.icns",
    ],
    terminal: [
      "/System/Applications/Utilities/Terminal.app/Contents/Resources/Terminal.icns",
      "/Applications/Utilities/Terminal.app/Contents/Resources/Terminal.icns",
    ],
  };
  return candidates[app].find((candidate) => fs.existsSync(candidate)) ?? null;
}

function execFilePromise(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function fallbackLocalAppIconSvg(app: NexusDashboardLocalOpenApp): string {
  const colors: Record<NexusDashboardLocalOpenApp, string> = {
    code: "#2f80ed",
    file: "#5bb6ff",
    terminal: "#24272e",
  };
  const color = colors[app];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="${color}"/></svg>`;
}

export async function openDashboardLocalResource(
  request: NexusDashboardLocalOpenRequest,
): Promise<NexusDashboardLocalOpenResult> {
  const { command, args } = dashboardLocalOpenCommand(request);
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", (error) => {
      resolve({
        ...request,
        ok: false,
        command,
        args,
        error: error.message,
      });
    });
    child.once("spawn", () => {
      child.unref();
      resolve({
        ...request,
        ok: true,
        command,
        args,
      });
    });
  });
}

function dashboardLocalOpenCommand(
  request: NexusDashboardLocalOpenRequest,
): { command: string; args: string[] } {
  if (process.platform === "darwin") {
    if (request.app === "code") {
      return { command: "open", args: ["-a", "Visual Studio Code", request.path] };
    }
    if (request.app === "terminal") {
      return { command: "open", args: ["-a", "Terminal", request.path] };
    }
    return { command: "open", args: [request.path] };
  }
  if (process.platform === "win32") {
    if (request.app === "code") {
      return { command: "cmd.exe", args: ["/d", "/s", "/c", "start", "", "code", request.path] };
    }
    if (request.app === "terminal") {
      return { command: "cmd.exe", args: ["/d", "/s", "/c", "start", "", "cmd", "/k", "cd", "/d", request.path] };
    }
    return { command: "explorer.exe", args: [request.path] };
  }
  if (request.app === "code") {
    return { command: "code", args: [request.path] };
  }
  if (request.app === "terminal") {
    return { command: "x-terminal-emulator", args: ["--working-directory", request.path] };
  }
  return { command: "xdg-open", args: [request.path] };
}
