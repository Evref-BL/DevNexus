import { escapeAttribute, escapeHtml } from "./nexusCockpitFormat.js";

export function renderActionStrip(actions: readonly any[] | undefined, mode = ""): string {
  const visibleActions = uniqueActions(actions ?? []).slice(0, 3);
  if (!visibleActions.length) return "";
  const className = mode ? `dn-action-strip ${mode}` : "dn-action-strip";
  return `<div class="${className}">${visibleActions.map((action) => renderProviderAction(action)).join("")}</div>`;
}

export function renderDisabledAction(
  label: string,
  title: string,
  icon = signalIcon("blockers"),
): string {
  return `<button class="dn-action dn-policy-action" type="button" disabled title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${icon}<span class="dn-action-label">${escapeHtml(label)}</span></button>`;
}

export function renderProviderAction(action: any): string {
  const provider = action.provider ?? "web";
  const kind = action.kind ?? "provider-link";
  const label = actionChipLabel(action);
  return `<a class="dn-action provider-${escapeAttribute(provider)} kind-${escapeAttribute(kind)}" href="${escapeHtml(action.href)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(externalActionLabel(action))}" aria-label="${escapeHtml(externalActionLabel(action))}">${providerIcon(provider)}<span class="dn-action-label">${escapeHtml(label)}</span>${externalLinkIcon()}</a>`;
}

export function clipboardIcon(): string {
  return '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6 2.5h4M6.5 1.5h3A1.5 1.5 0 0111 3v.5H5V3a1.5 1.5 0 011.5-1.5zM4 3.5H3A1.5 1.5 0 001.5 5v8A1.5 1.5 0 003 14.5h10A1.5 1.5 0 0014.5 13V5A1.5 1.5 0 0013 3.5h-1"/></svg>';
}

export function folderIcon(): string {
  return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4.5A1.5 1.5 0 013 3h3l1.2 1.5H13A1.5 1.5 0 0114.5 6v6A1.5 1.5 0 0113 13.5H3A1.5 1.5 0 011.5 12z"/></svg>';
}

export function chevronDownIcon(): string {
  return '<svg class="dn-open-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.25 4.75 6 7.25l2.75-2.5"/></svg>';
}

export function codeIcon(): string {
  return '<svg class="dn-app-icon dn-app-icon-vscode" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.9 2.1 10.7.7 5.6 5.6 2.5 3.3 1.1 4 4.2 8l-3.1 4 1.4.7 3.1-2.3 5.1 4.9 3.2-1.4V2.1zM10.6 5v6L7.2 8l3.4-3z"/></svg>';
}

export function localAppIcon(app: string, fallback: string): string {
  const src = `/api/local/app-icon?app=${encodeURIComponent(app)}`;
  return `<span class="dn-app-icon-shell"><img class="dn-app-icon-img" src="${src}" alt="" aria-hidden="true" onload="this.style.opacity='1';this.nextElementSibling.style.display='none'" onerror="this.remove()">${fallback}</span>`;
}

export function finderIcon(): string {
  return '<svg class="dn-app-icon dn-app-icon-finder" viewBox="0 0 16 16" aria-hidden="true"><rect class="finder-left" x="1.8" y="2" width="12.4" height="12" rx="2"/><path class="finder-right" d="M8 2h4.2A2 2 0 0114.2 4v8a2 2 0 01-2 2H8z"/><path d="M8 2v12M4.6 6.1h.01M11.4 6.1h.01M5 10.4c1.8 1 4.2 1 6 0"/></svg>';
}

export function terminalIcon(): string {
  return '<svg class="dn-app-icon dn-app-icon-terminal" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="2.5" width="12.4" height="11" rx="2"/><path d="M4.2 6.2 6.2 8l-2 1.8M8.2 10.1h3.5"/></svg>';
}

export function chatIcon(): string {
  return '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M3 3.5h10A1.5 1.5 0 0114.5 5v4A1.5 1.5 0 0113 10.5H8l-3.5 3v-3H3A1.5 1.5 0 011.5 9V5A1.5 1.5 0 013 3.5z"/><path fill="none" stroke-width="1.8" stroke-linecap="round" d="M5 6.5h6M5 8.5h3"/></svg>';
}

export function signalIcon(id: string): string {
  if (id === "components") return '<svg viewBox="0 0 24 24"><path d="M4 7l8-4 8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4"/><path d="M4 17l8 4 8-4"/></svg>';
  if (id === "automation") return '<svg viewBox="0 0 24 24"><path d="M6 8a3 3 0 116 0c0 2-3 2-3 5"/><path d="M18 16a3 3 0 11-6 0c0-2 3-2 3-5"/><path d="M9 21v-2"/><path d="M15 3v2"/></svg>';
  if (id === "eligible-work") return '<svg viewBox="0 0 24 24"><path d="M5 6h14"/><path d="M5 12h10"/><path d="M5 18h6"/><path d="M17 16l2 2 4-5"/></svg>';
  if (id === "worktrees") return '<svg viewBox="0 0 24 24"><path d="M7 3v7a4 4 0 004 4h6"/><path d="M7 21v-7"/><circle cx="7" cy="4" r="2"/><circle cx="7" cy="20" r="2"/><circle cx="19" cy="14" r="2"/></svg>';
  if (id === "blockers") return '<svg viewBox="0 0 24 24"><path d="M12 3l10 18H2L12 3z"/><path d="M12 9v5"/><path d="M12 18h.01"/></svg>';
  if (id === "plugins") return '<svg viewBox="0 0 24 24"><path d="M8 4h8"/><path d="M8 20h8"/><path d="M12 4v5"/><path d="M12 15v5"/><path d="M5 9h14v6H5z"/><path d="M7 12h.01"/><path d="M17 12h.01"/></svg>';
  return '<svg viewBox="0 0 24 24"><path d="M6 3v6a4 4 0 004 4h4"/><path d="M18 21v-6a4 4 0 00-4-4h-4"/><circle cx="6" cy="3" r="2"/><circle cx="18" cy="21" r="2"/></svg>';
}

export function uniqueActions(actions: readonly any[] | undefined): any[] {
  const seen = new Set<string>();
  const unique = [];
  for (const action of actions ?? []) {
    if (!action?.href || seen.has(action.href)) continue;
    seen.add(action.href);
    unique.push(action);
  }
  return unique;
}

export function renderNexusCockpitActionsClientSource(): string {
  return [
    renderActionStrip,
    renderDisabledAction,
    renderProviderAction,
    actionChipLabel,
    providerRecordId,
    externalActionLabel,
    providerIcon,
    externalLinkIcon,
    clipboardIcon,
    folderIcon,
    chevronDownIcon,
    codeIcon,
    localAppIcon,
    finderIcon,
    terminalIcon,
    chatIcon,
    signalIcon,
    uniqueActions,
  ]
    .map(standaloneNexusCockpitActionSource)
    .join("\n\n");
}

function standaloneNexusCockpitActionSource(fn: Function): string {
  return fn.toString()
    .replace(/\b__vite_ssr_import_\d+__\.escapeHtml\b/gu, "escapeHtml")
    .replace(/\b__vite_ssr_import_\d+__\.escapeAttribute\b/gu, "escapeAttribute");
}

function actionChipLabel(action: any): string {
  const label = action.label ?? "Open provider";
  if (action.title && (action.kind === "issue" || action.kind === "pull-request")) {
    return `${providerRecordId(action)}: ${action.title}`;
  }
  if (action.kind === "issue") return label.replace(/^Open issue #/u, "#");
  if (action.kind === "pull-request") return label.replace(/^Open PR #/u, "PR #");
  if (label === "Open repository") return "Repository";
  return label.replace(/^Open /u, "");
}

function providerRecordId(action: any): string {
  const label = action.label ?? "";
  const pr = /PR #(\d+)/iu.exec(label);
  if (pr) return `PR #${pr[1]}`;
  const issue = /#(\d+)/u.exec(label);
  if (issue) return `#${issue[1]}`;
  return action.kind === "pull-request" ? "PR" : "Issue";
}

function externalActionLabel(action: any): string {
  return `${action.label ?? "Open provider"} (opens in a new tab)`;
}

function providerIcon(provider: string): string {
  if (provider === "github") return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 .2a8 8 0 00-2.5 15.6c.4.1.5-.2.5-.4v-1.4c-2.2.5-2.7-.9-2.7-.9-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.3.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-3.9 0-.9.3-1.6.8-2.2-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8A7.4 7.4 0 018 3.7c.7 0 1.4.1 2 .3 1.5-1 2.2-.8 2.2-.8.5 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.2 0 3-1.8 3.7-3.6 3.9.3.3.6.8.6 1.6v2.4c0 .2.1.5.6.4A8 8 0 008 .2z"/></svg>';
  return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.2a6.8 6.8 0 100 13.6A6.8 6.8 0 008 1.2zm0 1.4c.7.8 1.2 1.8 1.4 2.9H6.6C6.8 4.4 7.3 3.4 8 2.6zm-3.2.8c-.4.6-.7 1.3-.9 2.1H2.8a5.5 5.5 0 012-2.1zm8.4 2.1h-1.1c-.2-.8-.5-1.5-.9-2.1a5.5 5.5 0 012 2.1zM2.5 8c0-.4 0-.7.1-1.1h1.1a9 9 0 000 2.2H2.6c-.1-.4-.1-.7-.1-1.1zm2.6 0c0-.4 0-.7.1-1.1h5.6c.1.4.1.7.1 1.1s0 .7-.1 1.1H5.2C5.1 8.7 5.1 8.4 5.1 8zm1.5 2.5h2.8c-.2 1.1-.7 2.1-1.4 2.9-.7-.8-1.2-1.8-1.4-2.9zm4.6 2.1c.4-.6.7-1.3.9-2.1h1.1a5.5 5.5 0 01-2 2.1zm2.2-3.5h-1.1a9 9 0 000-2.2h1.1c.1.4.1.7.1 1.1s0 .7-.1 1.1zM2.8 10.5h1.1c.2.8.5 1.5.9 2.1a5.5 5.5 0 01-2-2.1z"/></svg>';
}

function externalLinkIcon(): string {
  return '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6 4H3.8A1.8 1.8 0 002 5.8v6.4A1.8 1.8 0 003.8 14h6.4a1.8 1.8 0 001.8-1.8V10M9 2h5v5M8 8l5.5-5.5"/></svg>';
}
