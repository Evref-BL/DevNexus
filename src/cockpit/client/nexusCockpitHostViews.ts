// @ts-nocheck
import {
  chevronDownIcon,
  codeIcon,
  finderIcon,
  folderIcon,
  localAppIcon,
  renderActionStrip,
  signalIcon,
  terminalIcon,
} from "./nexusCockpitActions.js";
import {
  compactPath,
  countLabel,
  escapeAttribute,
  escapeHtml,
  formatDisplayText,
  formatTime,
  truncate,
} from "./nexusCockpitFormat.js";
import { renderThemeToggle } from "./nexusCockpitTheme.js";

export function renderHostDashboard(host, themeMode, hostFocus = 'components') {
  const focus = normalizeHostFocus(hostFocus);
  const workspaceCount = host?.workspaceCount ?? 0;
  const summary = host.partial === true ? `${countLabel(workspaceCount, 'workspace')}, loading signals` : `${countLabel(workspaceCount, 'workspace')}, ${needsAttentionLabel(host.needsAttentionCount ?? 0)}`;
  return `<div class="dn-shell dn-host-dashboard"><header class="dn-header"><div><span class="dn-eyebrow">DevNexus cockpit</span><h1>Host Cockpit</h1><p>${escapeHtml(summary)}</p></div>${renderHostHeaderActions(host, themeMode)}</header>${renderHostOverview(host, null, '', { hostMode: true, focus })}${renderHostSignals(host, focus)}${renderHostActionQueue(host, focus)}</div>`;
}

function renderHostHeaderActions(host, themeMode) {
  const homePath = host?.homePath ?? '';
  return `<div class="dn-header-actions dn-host-header-actions"><div class="dn-header-strip"><span class="dn-header-pill dn-host-identity"><span>Host</span><strong title="${escapeHtml(hostIdentity(host))}">${escapeHtml(hostIdentity(host))}</strong></span><span class="dn-header-pill dn-header-stamp"><span>Generated</span><strong>${escapeHtml(formatTime(host?.generatedAt))}</strong></span>${renderPathOpenMenu('home', 'Home', homePath)}</div>${renderThemeToggle(themeMode)}</div>`;
}

export function renderProjectHeaderActions(snapshot, themeMode, selectedWorkspaceId = '') {
  const root = snapshot?.project?.root ?? '';
  return `<div class="dn-header-actions dn-project-header-actions"><div class="dn-header-strip">${renderHostNavButton(selectedWorkspaceId)}<span class="dn-header-pill dn-header-stamp"><span>Generated</span><strong>${escapeHtml(formatTime(snapshot?.generatedAt))}</strong></span>${renderPathOpenMenu('project', 'Project', root)}</div>${renderThemeToggle(themeMode)}</div>`;
}

export function hostIdentity(host) {
  const value = host?.hostId ?? host?.hostname ?? host?.hostName ?? '';
  if (String(value).trim()) return String(value).trim();
  if (typeof location === 'object' && location?.hostname) return location.hostname;
  return 'local host';
}

function renderHostSignals(host, hostFocus = 'components') {
  const workspaces = host?.workspaces ?? [];
  const totalThreads = sumBy(workspaces, (workspace) => workspace.threadCount);
  const totalHitl = sumBy(workspaces, (workspace) => workspace.needsDecisionCount);
  const readyWork = sumBy(workspaces, (workspace) => workspace.eligibleWorkCount);
  const plugins = sumBy(workspaces, (workspace) => workspace.pluginCount);
  const loading = host?.partial === true;
  const signals = [
    { id: 'components', label: 'Workspaces', value: String(host?.workspaceCount ?? workspaces.length), detail: 'Registered and local project cockpits' },
    { id: 'blockers', label: 'Needs attention', value: loading ? '...' : String(host?.needsAttentionCount ?? 0), detail: loading ? 'Loading signals' : 'Workspaces with approvals, dirty state, or errors' },
    { id: 'worktrees', label: 'Threads', value: loading ? '...' : String(totalThreads), detail: loading ? 'Loading thread state' : `${countLabel(totalHitl, 'action')} needed` },
    { id: 'eligible-work', label: 'Tracked work', value: loading ? '...' : String(readyWork), detail: loading ? 'Loading tracked work' : (readyWork ? 'Ready issues and work items' : 'No ready work') },
    { id: 'plugins', label: 'Plugins', value: String(plugins), detail: 'Installed DevNexus plugin instances' },
  ];
  return `<section class="dn-signals" aria-label="Host signals">${signals.map((signal) => `<button class="dn-signal dn-host-signal signal-${escapeAttribute(signal.id)} ${signal.id === hostFocus ? 'selected' : ''}" type="button" data-host-focus="${escapeHtml(signal.id)}"><span class="dn-signal-top"><span class="dn-signal-icon">${signalIcon(signal.id)}</span><span class="dn-label">${escapeHtml(signal.label)}</span></span><strong>${escapeHtml(signal.value)}</strong><p>${escapeHtml(signal.detail)}</p></button>`).join('')}</section>`;
}

function hostSignalTarget(id) {
  if (id === 'components' || id === 'plugins') return 'host-workspaces';
  return 'host-action-queue';
}

function renderHostActionQueue(host, hostFocus = 'components') {
  const allActions = host?.actionQueue ?? [];
  const actions = filteredHostActions(allActions, hostFocus, host?.workspaces ?? []);
  const accentMap = workspaceAccentMap(host?.workspaces ?? []);
  const body = host?.partial === true ? renderInlineLoading('Loading action queue') : (actions.length ? actions.slice(0, 8).map((action) => renderHostActionCard(action, accentMap)).join('') : `<p>${escapeHtml(emptyHostActionText(hostFocus))}</p>`);
  return `<section class="dn-panel dn-host-action-panel" id="host-action-queue"><div class="dn-panel-heading"><div><span class="dn-eyebrow">Host HITL</span><h2>${escapeHtml(hostActionQueueTitle(hostFocus))}</h2></div><span class="dn-count">${escapeHtml(`${actions.length} of ${countLabel(allActions.length, 'action')}`)}</span></div><div class="dn-host-action-list">${body}</div></section>`;
}

function renderHostActionCard(action, accentMap) {
  const updated = action.updatedAt ? ` · ${formatTime(action.updatedAt)}` : '';
  const detail = formatDisplayText(action.detail);
  const decisionClass = action.kind === 'ready-work' ? 'continue' : action.tone === 'danger' ? 'rescue' : 'review';
  const targetSelection = action.primaryAction?.targetSelectionId ?? '';
  const provider = action.providerAction ? renderActionStrip([action.providerAction], 'compact') : '';
  return `<article class="dn-host-action-shell"><button class="dn-host-action-card action-${escapeAttribute(action.kind)}" style="${projectAccentStyle(action.workspaceId, accentMap)}" type="button" data-workspace-id="${escapeHtml(action.workspaceId)}" data-workspace-selection-id="${escapeHtml(targetSelection)}"><span class="dn-card-title"><strong>${escapeHtml(action.workspaceName)}</strong><span class="dn-thread-decision decision-${decisionClass}">${escapeHtml(action.state)}</span></span><span class="dn-card-meta">${escapeHtml(action.reason)}${escapeHtml(updated)}</span><p title="${escapeHtml(detail)}">${escapeHtml(truncate(detail, 110))}</p><span class="dn-action-label">${escapeHtml(action.primaryAction?.label ?? 'Open workspace')}</span></button>${provider}</article>`;
}

export function renderHostNavButton(selectedWorkspaceId) {
  return selectedWorkspaceId ? `<button class="dn-action" type="button" data-workspace-id="">${signalIcon('worktrees')}<span class="dn-action-label">Host cockpit</span></button>` : '';
}

function renderOpenMenu(target, label) {
  const safeTarget = target === 'home' ? 'home' : 'project';
  return `<details class="dn-open-menu"><summary class="dn-action dn-open-trigger">${folderIcon()}<span class="dn-action-label">${escapeHtml(label)}</span><span class="dn-open-chevron-shell">${chevronDownIcon()}</span></summary>${renderOpenOptions(safeTarget)}</details>`;
}

export function renderPathOpenMenu(target, label, pathValue) {
  const safeTarget = target === 'home' ? 'home' : 'project';
  const value = pathValue ?? '';
  return `<details class="dn-open-menu dn-header-path-menu"><summary class="dn-header-path-control">${localAppIcon('file', finderIcon())}<span class="dn-header-path-copy"><span class="dn-header-path-label">${escapeHtml(label)}</span><strong class="dn-header-path-value" title="${escapeHtml(value)}">${escapeHtml(compactPath(value))}</strong></span><span class="dn-open-chevron-shell">${chevronDownIcon()}</span></summary>${renderOpenOptions(safeTarget)}</details>`;
}

function renderOpenOptions(safeTarget) {
  return `<div class="dn-open-options"><button class="dn-open-option" type="button" data-open-target="${safeTarget}" data-open-app="code">${localAppIcon('code', codeIcon())}<span class="dn-action-label">VS Code</span></button><button class="dn-open-option" type="button" data-open-target="${safeTarget}" data-open-app="file">${localAppIcon('file', finderIcon())}<span class="dn-action-label">Finder</span></button><button class="dn-open-option" type="button" data-open-target="${safeTarget}" data-open-app="terminal">${localAppIcon('terminal', terminalIcon())}<span class="dn-action-label">Terminal</span></button></div>`;
}

const projectAccentCount = 7;

function projectAccentStyle(value, accentMap = null) {
  const key = String(value ?? 'workspace');
  const mapped = accentMap instanceof Map ? accentMap.get(key) : undefined;
  const index = typeof mapped === 'number' ? mapped : stableAccentIndex(key);
  return `--dn-project-accent:var(--dn-branch-${index}); --dn-workspace-accent:var(--dn-project-accent);`;
}

function stableAccentIndex(value) {
  const text = String(value ?? 'workspace');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = ((hash * 31) + text.charCodeAt(index)) >>> 0;
  return hash % projectAccentCount;
}

function workspaceAccentMap(workspaces) {
  const map = new Map();
  for (const workspace of workspaces ?? []) {
    if (!workspace?.id || map.has(workspace.id)) continue;
    map.set(workspace.id, map.size % projectAccentCount);
  }
  return map;
}

function sumBy(values, selector) {
  return values.reduce((total, value) => total + Number(selector(value) ?? 0), 0);
}

function needsAttentionLabel(value) {
  const count = Number(value ?? 0);
  return `${count} ${count === 1 ? 'needs' : 'need'} attention`;
}

export function renderLoading(themeMode, host, selectedWorkspaceId = '') {
  const title = selectedWorkspaceId ? 'Switching workspace' : 'Loading host cockpit';
  const detail = selectedWorkspaceId ? 'Loading workspace state.' : 'Reading registered workspaces, threads, plugins, and approvals.';
  return `<div class="dn-shell"><header class="dn-header"><div><span class="dn-eyebrow">DevNexus cockpit</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></div><div class="dn-header-actions">${renderHostNavButton(selectedWorkspaceId)}${renderThemeToggle(themeMode)}</div></header>${renderHostOverview(host, null, selectedWorkspaceId)}<section class="dn-panel dn-loading-panel" aria-busy="true"><span class="dn-loader" aria-hidden="true"></span><div class="dn-loading-copy"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p><div class="dn-skeleton-stack" aria-hidden="true"><span class="dn-skeleton" style="width:92%"></span><span class="dn-skeleton" style="width:76%"></span><span class="dn-skeleton" style="width:54%"></span></div></div></section></div>`;
}

export function renderHostOverview(host, snapshot, selectedWorkspaceId = '', options = {}) {
  const allWorkspaces = host?.workspaces ?? [];
  if (!allWorkspaces.length) return '';
  const workspaces = filteredHostWorkspaces(allWorkspaces, options.focus);
  const accentMap = workspaceAccentMap(allWorkspaces);
  const workspaceCount = host?.workspaceCount ?? allWorkspaces.length;
  const count = host?.partial === true ? `Loading signals · ${countLabel(workspaceCount, 'workspace')}` : (options.hostMode ? `${workspaces.length} shown · ${countLabel(workspaceCount, 'workspace')} total` : `${needsAttentionLabel(host.needsAttentionCount ?? 0)} · ${countLabel(workspaceCount, 'workspace')}`);
  const body = workspaces.length ? workspaces.slice(0, 8).map((workspace) => renderWorkspaceCard(workspace, snapshot, selectedWorkspaceId, !options.hostMode, accentMap)).join('') : `<p>${escapeHtml(emptyHostWorkspaceText(options.focus))}</p>`;
  return `<section class="dn-panel dn-host-panel" id="host-workspaces"><div class="dn-panel-heading"><div><span class="dn-eyebrow">Host cockpit</span><h2>${escapeHtml(hostWorkspaceTitle(options.focus))}</h2></div><span class="dn-count">${escapeHtml(count)}</span></div><div class="dn-workspace-list">${body}</div></section>`;
}

function renderWorkspaceCard(workspace, snapshot, selectedWorkspaceId = '', highlightCurrent = true, accentMap = null) {
  const status = workspace.loading ? 'loading' : (workspace.error ? 'unavailable' : workspaceToneLabel(workspace));
  const detail = workspace.loading ? 'Loading workspace signals.' : formatDisplayText(workspace.summary);
  const title = workspace.current && snapshot ? snapshot.project.name : workspace.name;
  const meta = workspace.loading ? [countLabel(workspace.componentCount, 'component'), 'signals loading', countLabel(workspace.pluginCount, 'plugin')] : [countLabel(workspace.componentCount, 'component'), `${workspace.needsDecisionCount} active HITL`, countLabel(workspace.threadCount, 'active thread'), countLabel(workspace.pluginCount, 'plugin')];
  const selected = workspace.id === selectedWorkspaceId || (highlightCurrent && !selectedWorkspaceId && workspace.current) ? 'selected' : '';
  const currentClass = workspace.current ? 'current-workspace' : '';
  const currentBadge = workspace.current ? '<span class="dn-workspace-current-badge">current</span>' : '';
  return `<button class="dn-workspace-card ${currentClass} tone-${escapeAttribute(workspace.tone)} ${selected}" style="${projectAccentStyle(workspace.id, accentMap)}" type="button" data-workspace-id="${escapeHtml(workspace.id)}" aria-label="Open ${escapeHtml(title)}"><span class="dn-card-title"><strong title="${escapeHtml(workspace.root)}">${escapeHtml(title)}</strong>${currentBadge}</span><p title="${escapeHtml(detail)}">${escapeHtml(detail)}</p><div class="dn-workspace-meta"><span>${escapeHtml(status)}</span>${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div></button>`;
}

export function renderInlineLoading(label) {
  return `<p class="dn-inline-loading">${escapeHtml(label)}</p>`;
}

export function renderProgressivePanel(id, eyebrow, title, detail) {
  return `<div class="dn-panel" id="${escapeAttribute(id)}"><div class="dn-panel-heading"><div><span class="dn-eyebrow">${escapeHtml(eyebrow)}</span><h2>${escapeHtml(title)}</h2></div><span class="dn-count">loading</span></div>${renderInlineLoading(detail)}<div class="dn-skeleton-stack" aria-hidden="true"><span class="dn-skeleton" style="width:86%"></span><span class="dn-skeleton" style="width:68%"></span><span class="dn-skeleton" style="width:42%"></span></div></div>`;
}

function workspaceToneLabel(workspace) {
  if (workspace.blockerCount > 0 || workspace.automationStatus === 'blocked') return 'blocked';
  if (workspace.needsDecisionCount > 0) return 'needs action';
  if (workspace.dirtyComponentCount > 0) return 'dirty';
  if (workspace.eligibleWorkCount > 0) return 'ready work';
  return 'clear';
}

export function normalizeHostFocus(value) {
  const id = String(value ?? '').trim();
  return ['components', 'blockers', 'worktrees', 'eligible-work', 'plugins'].includes(id) ? id : 'components';
}

function filteredHostActions(actions, hostFocus = 'components', workspaces = []) {
  const focus = normalizeHostFocus(hostFocus);
  if (focus === 'worktrees') return actions.filter((action) => action.kind === 'thread');
  if (focus === 'eligible-work') return actions.filter((action) => action.kind === 'ready-work');
  if (focus === 'plugins') {
    const pluginWorkspaceIds = new Set(workspaces.filter((workspace) => workspace.pluginCount > 0).map((workspace) => workspace.id));
    return actions.filter((action) => pluginWorkspaceIds.has(action.workspaceId));
  }
  if (focus === 'components') return actions;
  return actions.filter((action) => ['blocker', 'workspace-error', 'approval', 'thread', 'dirty'].includes(action.kind));
}

function filteredHostWorkspaces(workspaces, hostFocus = 'components') {
  const focus = normalizeHostFocus(hostFocus);
  if (focus === 'plugins') return workspaces.filter((workspace) => workspace.pluginCount > 0);
  if (focus === 'worktrees') return workspaces.filter((workspace) => workspace.threadCount > 0 || workspace.needsDecisionCount > 0);
  if (focus === 'eligible-work') return workspaces.filter((workspace) => (workspace.eligibleWorkCount ?? 0) > 0);
  if (focus === 'blockers') return workspaces.filter((workspace) => workspace.tone === 'danger' || workspace.tone === 'warn');
  return workspaces;
}

function hostActionQueueTitle(hostFocus = 'components') {
  const focus = normalizeHostFocus(hostFocus);
  if (focus === 'worktrees') return 'Thread Queue';
  if (focus === 'eligible-work') return 'Tracked Work';
  if (focus === 'plugins') return 'Workspace Actions';
  if (focus === 'blockers') return 'Needs Attention';
  return 'Action Queue';
}

function hostWorkspaceTitle(hostFocus = 'components') {
  const focus = normalizeHostFocus(hostFocus);
  if (focus === 'worktrees') return 'Thread Workspaces';
  if (focus === 'eligible-work') return 'Ready Workspaces';
  if (focus === 'plugins') return 'Plugin Workspaces';
  if (focus === 'blockers') return 'Attention Workspaces';
  return 'Workspaces';
}

function emptyHostActionText(hostFocus = 'components') {
  const focus = normalizeHostFocus(hostFocus);
  if (focus === 'worktrees') return 'No thread needs action.';
  if (focus === 'eligible-work') return 'No tracked work is ready.';
  if (focus === 'plugins') return 'No plugin-specific action is needed.';
  if (focus === 'blockers') return 'No attention item is waiting.';
  return 'No workspace needs attention.';
}

function emptyHostWorkspaceText(hostFocus = 'components') {
  const focus = normalizeHostFocus(hostFocus);
  if (focus === 'worktrees') return 'No workspace has active threads.';
  if (focus === 'eligible-work') return 'No workspace reports ready tracked work.';
  if (focus === 'plugins') return 'No workspace reports installed plugins.';
  if (focus === 'blockers') return 'No workspace needs attention.';
  return 'No registered workspace found.';
}
