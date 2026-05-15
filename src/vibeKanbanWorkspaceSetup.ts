import path from "node:path";
import process from "node:process";

function powershellSingleQuoted(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function buildWindowsVibeKanbanWorkspaceSetupScript(
  managedRoot: string,
  sourceRoot: string,
): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$managedRoot = ${powershellSingleQuoted(path.resolve(managedRoot))}`,
    `$sourceRoot = ${powershellSingleQuoted(path.resolve(sourceRoot))}`,
    "$workspaceRoot = (Get-Location).Path",
    "",
    "function Add-GitInfoExclude([string] $entry) {",
    "  $excludePath = git rev-parse --git-path info/exclude",
    "  if (-not (Test-Path -LiteralPath $excludePath)) {",
    "    New-Item -ItemType File -Path $excludePath -Force | Out-Null",
    "  }",
    "  $existing = Get-Content -LiteralPath $excludePath -ErrorAction SilentlyContinue",
    "  if ($existing -notcontains $entry) {",
    "    Add-Content -LiteralPath $excludePath -Value $entry",
    "  }",
    "}",
    "",
    "$agentsSource = Join-Path $managedRoot 'AGENTS.md'",
    "$agentsTarget = Join-Path $workspaceRoot 'AGENTS.md'",
    "if ((Test-Path -LiteralPath $agentsSource) -and -not (Test-Path -LiteralPath $agentsTarget)) {",
    "  Copy-Item -LiteralPath $agentsSource -Destination $agentsTarget -Force",
    "  Add-GitInfoExclude 'AGENTS.md'",
    "}",
    "",
    "$codexSource = Join-Path $managedRoot '.codex'",
    "$codexTarget = Join-Path $workspaceRoot '.codex'",
    "if ((Test-Path -LiteralPath $codexSource) -and -not (Test-Path -LiteralPath (Join-Path $codexTarget 'config.toml'))) {",
    "  New-Item -ItemType Directory -Path $codexTarget -Force | Out-Null",
    "  Copy-Item -Path (Join-Path $codexSource '*') -Destination $codexTarget -Recurse -Force",
    "  Add-GitInfoExclude '.codex/'",
    "}",
    "",
    "$sourceNodeModules = Join-Path $sourceRoot 'node_modules'",
    "$workspaceNodeModules = Join-Path $workspaceRoot 'node_modules'",
    "if ((Test-Path -LiteralPath $sourceNodeModules) -and -not (Test-Path -LiteralPath $workspaceNodeModules)) {",
    "  New-Item -ItemType Junction -Path $workspaceNodeModules -Target $sourceNodeModules | Out-Null",
    "  Add-GitInfoExclude 'node_modules/'",
    "} elseif (-not (Test-Path -LiteralPath $sourceNodeModules)) {",
    "  Write-Host \"Source checkout has no node_modules at $sourceNodeModules; skipping dependency junction.\"",
    "}",
    "",
    "Write-Host 'Vibe workspace setup complete for DevNexus-managed project.'",
  ].join("\n");
}

function shellSingleQuoted(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function buildPosixVibeKanbanWorkspaceSetupScript(
  managedRoot: string,
  sourceRoot: string,
): string {
  return [
    "set -eu",
    `managed_root=${shellSingleQuoted(path.resolve(managedRoot))}`,
    `source_root=${shellSingleQuoted(path.resolve(sourceRoot))}`,
    "workspace_root=$(pwd)",
    "",
    "add_git_info_exclude() {",
    "  entry=$1",
    "  exclude_path=$(git rev-parse --git-path info/exclude)",
    "  mkdir -p \"$(dirname \"$exclude_path\")\"",
    "  touch \"$exclude_path\"",
    "  if ! grep -Fxq \"$entry\" \"$exclude_path\"; then",
    "    printf '%s\\n' \"$entry\" >> \"$exclude_path\"",
    "  fi",
    "}",
    "",
    "if [ -f \"$managed_root/AGENTS.md\" ] && [ ! -e \"$workspace_root/AGENTS.md\" ]; then",
    "  cp \"$managed_root/AGENTS.md\" \"$workspace_root/AGENTS.md\"",
    "  add_git_info_exclude 'AGENTS.md'",
    "fi",
    "",
    "if [ -d \"$managed_root/.codex\" ] && [ ! -f \"$workspace_root/.codex/config.toml\" ]; then",
    "  mkdir -p \"$workspace_root/.codex\"",
    "  cp -R \"$managed_root/.codex/.\" \"$workspace_root/.codex/\"",
    "  add_git_info_exclude '.codex/'",
    "fi",
    "",
    "if [ -d \"$source_root/node_modules\" ] && [ ! -e \"$workspace_root/node_modules\" ]; then",
    "  ln -s \"$source_root/node_modules\" \"$workspace_root/node_modules\"",
    "  add_git_info_exclude 'node_modules/'",
    "elif [ ! -d \"$source_root/node_modules\" ]; then",
    "  printf '%s\\n' \"Source checkout has no node_modules at $source_root/node_modules; skipping dependency link.\"",
    "fi",
    "",
    "printf '%s\\n' 'Vibe workspace setup complete for DevNexus-managed project.'",
  ].join("\n");
}

export function buildVibeKanbanWorkspaceSetupScript(
  managedRoot: string,
  sourceRoot: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32"
    ? buildWindowsVibeKanbanWorkspaceSetupScript(managedRoot, sourceRoot)
    : buildPosixVibeKanbanWorkspaceSetupScript(managedRoot, sourceRoot);
}
