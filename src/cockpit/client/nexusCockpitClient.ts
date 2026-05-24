// @ts-nocheck
import { buildWriteHistoryLayout } from "../../dashboard/nexusDashboardHistoryLayout.js";
import { cockpitStyles } from "./nexusCockpitStyles.js";
import {
  bindGitHistoryColumnResizers,
  gitHistoryColumnStyle,
  readStoredGitHistoryColumnWidths,
  renderGitHistoryColumnHeader,
} from "./history/nexusCockpitHistoryColumns.js";
import { renderNexusCockpitHistoryGraphSvg } from "./history/nexusCockpitHistoryGraphSvg.js";
import {
  cockpitTooltipText,
  installCockpitTooltips,
  isCockpitTooltipTargetTruncated,
} from "./nexusCockpitTooltips.js";

export interface DevNexusDashboardMountOptions {
  actionToken?: string;
  baseUrl?: string;
  hostRefreshMs?: number;
  refreshMs?: number;
  theme?: string;
  workspaceId?: string;
}

export interface DevNexusDashboardMountHandle {
  dispose(): void;
}

const defaultRefreshMs = 15000;
const themeStorageKey = 'dev-nexus-cockpit-theme';
const legacyThemeStorageKey = 'dev-nexus-dashboard-theme';
const gitHistoryInlineDetailRows = 7;
export async function fetchDevNexusDashboard(baseUrl = '', workspaceId = '') {
  const response = await fetch(`${baseUrl}/api/cockpit${workspaceQuery(workspaceId)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Cockpit API returned ${response.status}`);
  return response.json();
}

export async function fetchDevNexusDashboardShell(baseUrl = '', workspaceId = '') {
  const response = await fetch(`${baseUrl}/api/cockpit/shell${workspaceQuery(workspaceId)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Cockpit shell API returned ${response.status}`);
  return response.json();
}

export async function fetchDevNexusDashboardSection(baseUrl = '', workspaceId = '', section = '') {
  const query = `${workspaceQuery(workspaceId)}${workspaceQuery(workspaceId) ? '&' : '?'}section=${encodeURIComponent(section)}`;
  const response = await fetch(`${baseUrl}/api/cockpit/section${query}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Cockpit section API returned ${response.status}`);
  return response.json();
}

export async function fetchDevNexusDashboardHost(baseUrl = '', workspaceId = '') {
  const response = await fetch(`${baseUrl}/api/host${workspaceQuery(workspaceId)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Host API returned ${response.status}`);
  return response.json();
}

export async function fetchDevNexusDashboardProjects(baseUrl = '', workspaceId = '') {
  const response = await fetch(`${baseUrl}/api/projects${workspaceQuery(workspaceId)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Projects API returned ${response.status}`);
  const payload = await response.json();
  return payload.host ?? { version: 1, partial: true, generatedAt: new Date().toISOString(), hostId: hostIdentity(null), workspaceCount: payload.projects?.length ?? 0, needsAttentionCount: 0, actionQueue: [], workspaces: payload.projects ?? [] };
}

function workspaceQuery(workspaceId) {
  const id = normalizeWorkspaceId(workspaceId);
  return id ? `?workspace=${encodeURIComponent(id)}` : '';
}

export function mountDevNexusDashboard(root, options = {}) {
  if (!root) throw new Error('mountDevNexusDashboard requires a root element');
  const baseUrl = options.baseUrl ?? '';
  const actionToken = options.actionToken ?? (typeof globalThis !== 'undefined' ? (globalThis.__DEV_NEXUS_COCKPIT_ACTION_TOKEN__ ?? globalThis.__DEV_NEXUS_DASHBOARD_ACTION_TOKEN__ ?? '') : '');
  const refreshMs = options.refreshMs ?? defaultRefreshMs;
  const hostRefreshMs = options.hostRefreshMs ?? Math.max(refreshMs * 4, 60000);
  let themeMode = normalizeThemeMode(options.theme ?? readStoredThemeMode());
  let selectedWorkspaceId = normalizeWorkspaceId(options.workspaceId ?? readWorkspaceIdFromLocation());
  let selectedId = null;
  let hostFocus = 'components';
  let gitHistoryFilter = 'all';
  let latestSnapshot = null;
  let latestHost = null;
  let latestError = null;
  let lastRenderSignature = null;
  let lastHostRefreshAt = 0;
  let disposed = false;
  let inFlight = false;
  let hostInFlight = false;
  let workspaceSectionToken = 0;
  applyThemePreference(themeMode);
  injectStyles();
  const tooltipController = installCockpitTooltips(root);
  const systemThemeQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const onSystemThemeChange = () => {
    if (themeMode !== 'system') return;
    applyThemePreference(themeMode);
    renderCurrent();
  };
  if (systemThemeQuery?.addEventListener) systemThemeQuery.addEventListener('change', onSystemThemeChange);
  else if (systemThemeQuery?.addListener) systemThemeQuery.addListener(onSystemThemeChange);
  function setThemeMode(nextThemeMode) {
    if (disposed) return;
    themeMode = normalizeThemeMode(nextThemeMode);
    writeStoredThemeMode(themeMode);
    applyThemePreference(themeMode);
    renderCurrent();
  }
  function setSelectedId(nextSelectedId) {
    if (disposed) return;
    selectedId = String(nextSelectedId ?? '');
    renderCurrent();
  }
  function setHostFocus(nextHostFocus) {
    if (disposed) return;
    hostFocus = normalizeHostFocus(nextHostFocus);
    renderCurrent();
  }
  function setGitHistoryFilter(nextFilter) {
    if (disposed) return;
    gitHistoryFilter = normalizeGitHistoryFilter(nextFilter);
    const graph = latestSnapshot ? gitHistoryRows(latestSnapshot, gitHistoryFilter) : null;
    if (graph?.rows?.length) {
      const visible = new Set(graph.rows.map((row) => row.selectId));
      if (!visible.has(selectedId)) selectedId = graph.rows[0].selectId;
    }
    renderCurrent();
  }
  function setWorkspaceId(nextWorkspaceId) {
    const nextSelectedId = arguments.length > 1 ? arguments[1] : null;
    if (disposed) return;
    const normalized = normalizeWorkspaceId(nextWorkspaceId);
    if (normalized === selectedWorkspaceId && !nextSelectedId) return;
    selectedWorkspaceId = normalized;
    selectedId = nextSelectedId ? String(nextSelectedId) : null;
    gitHistoryFilter = 'all';
    latestSnapshot = null;
    latestError = null;
    lastHostRefreshAt = 0;
    lastRenderSignature = null;
    workspaceSectionToken += 1;
    writeWorkspaceIdToLocation(selectedWorkspaceId);
    renderCurrent();
    void refresh(true);
  }
  function renderRoot(markup, signature = '') {
    if (signature && signature === lastRenderSignature) return;
    lastRenderSignature = signature || markup;
    tooltipController.hide();
    root.innerHTML = markup;
    bindThemeControls(root, setThemeMode);
    bindSelectionControls(root, setSelectedId);
    bindHostSignalControls(root, setHostFocus);
    bindGitHistoryFilterControls(root, setGitHistoryFilter);
    bindGitHistoryColumnResizers(root);
    bindWorkspaceControls(root, setWorkspaceId);
    bindLocalActions(root, baseUrl, actionToken, selectedWorkspaceId, () => refresh(true));
  }
  function renderCurrent() {
    if (disposed) return;
    if (!selectedWorkspaceId) {
      if (latestHost) renderRoot(renderHostDashboard(latestHost, themeMode, hostFocus), dashboardRenderSignature({ scope: 'host', themeMode, hostFocus, host: latestHost }));
      else if (latestError) renderRoot(renderError(latestError, themeMode), dashboardRenderSignature({ scope: 'host-error', themeMode, error: dashboardErrorMessage(latestError) }));
      else renderRoot(renderLoading(themeMode, latestHost, selectedWorkspaceId), dashboardRenderSignature({ scope: 'host-loading', themeMode, host: latestHost }));
      return;
    }
    if (latestSnapshot) {
      renderRoot(renderDashboard(latestSnapshot, themeMode, selectedId, latestHost, selectedWorkspaceId, gitHistoryFilter), dashboardRenderSignature({ scope: 'workspace', themeMode, selectedWorkspaceId, selectedId, gitHistoryFilter, snapshot: latestSnapshot, host: latestHost }));
    } else if (latestError) {
      renderRoot(renderError(latestError, themeMode), dashboardRenderSignature({ scope: 'workspace-error', themeMode, selectedWorkspaceId, error: dashboardErrorMessage(latestError), host: latestHost }));
    } else {
      renderRoot(renderLoading(themeMode, latestHost, selectedWorkspaceId), dashboardRenderSignature({ scope: 'workspace-loading', themeMode, selectedWorkspaceId, host: latestHost }));
    }
  }
  async function refresh(force = false) {
    if (inFlight && !force) return;
    inFlight = true;
    try {
      const workspaceId = selectedWorkspaceId;
      if (!workspaceId) {
        if (!latestHost) {
          const shell = await fetchDevNexusDashboardProjects(baseUrl);
          if (workspaceId !== selectedWorkspaceId) return;
          latestHost = shell;
          latestSnapshot = null;
          latestError = null;
          renderCurrent();
        }
        const host = await fetchDevNexusDashboardHost(baseUrl);
        if (workspaceId !== selectedWorkspaceId) return;
        latestHost = host;
        latestSnapshot = null;
        latestError = null;
        lastHostRefreshAt = Date.now();
        renderCurrent();
        return;
      }
      const shouldRefreshHost = !latestHost || Date.now() - lastHostRefreshAt >= hostRefreshMs;
      const needsHostShell = shouldRefreshHost && !latestHost;
      let sectionRefresh = null;
      let sectionToken = workspaceSectionToken;
      if (!latestSnapshot || latestSnapshot.partial === true) {
        const shell = await fetchDevNexusDashboardShell(baseUrl, workspaceId);
        if (workspaceId !== selectedWorkspaceId) return;
        latestSnapshot = shell;
        latestError = null;
        if (!findSelectableById(shell, selectedId)) selectedId = defaultSelectedId(shell);
        renderCurrent();
        sectionToken = ++workspaceSectionToken;
        sectionRefresh = refreshWorkspaceSections(workspaceId, sectionToken);
      }
      if (needsHostShell) void refreshHostShell();
      if (sectionRefresh) {
        await sectionRefresh;
        if (disposed || workspaceId !== selectedWorkspaceId || sectionToken !== workspaceSectionToken) return;
      }
      const snapshot = await fetchDevNexusDashboard(baseUrl, workspaceId);
      if (workspaceId !== selectedWorkspaceId) return;
      latestSnapshot = snapshot;
      latestError = null;
      workspaceSectionToken += 1;
      if (!findSelectableById(snapshot, selectedId)) selectedId = defaultSelectedId(snapshot);
      renderCurrent();
      if (shouldRefreshHost) void refreshHost();
    } catch (error) {
      const hasVisibleData = selectedWorkspaceId ? Boolean(latestSnapshot) : Boolean(latestHost);
      latestError = error;
      if (!hasVisibleData) {
        latestSnapshot = null;
        renderCurrent();
      }
    } finally {
      inFlight = false;
    }
  }
  async function refreshWorkspaceSections(workspaceId, token) {
    const sections = ['components', 'plugins', 'threads', 'tracked-work'];
    await Promise.all(sections.map(async (section) => {
      try {
        const payload = await fetchDevNexusDashboardSection(baseUrl, workspaceId, section);
        if (disposed || workspaceId !== selectedWorkspaceId || token !== workspaceSectionToken) return;
        latestSnapshot = mergeDashboardSnapshot(latestSnapshot, payload.patch);
        if (latestSnapshot && !findSelectableById(latestSnapshot, selectedId)) selectedId = defaultSelectedId(latestSnapshot);
        renderCurrent();
      } catch {
        // Keep the shell visible; the full snapshot is still the final reconciliation path.
      }
    }));
  }
  async function refreshHost() {
    if (hostInFlight) return;
    hostInFlight = true;
    try {
      const workspaceId = selectedWorkspaceId;
      const host = await fetchDevNexusDashboardHost(baseUrl, workspaceId);
      if (workspaceId !== selectedWorkspaceId) return;
      latestHost = host;
      lastHostRefreshAt = Date.now();
      renderCurrent();
    } catch (error) {
      latestError = error;
      if (!latestHost && !latestSnapshot) renderCurrent();
    } finally {
      hostInFlight = false;
    }
  }
  async function refreshHostShell() {
    if (hostInFlight || latestHost) return;
    hostInFlight = true;
    try {
      const workspaceId = selectedWorkspaceId;
      const host = await fetchDevNexusDashboardProjects(baseUrl, workspaceId);
      if (workspaceId !== selectedWorkspaceId) return;
      latestHost = host;
      renderCurrent();
    } catch (error) {
      latestError = error;
      if (!latestHost && !latestSnapshot) renderCurrent();
    } finally {
      hostInFlight = false;
    }
  }
  renderCurrent();
  void refresh();
  const timer = setInterval(refresh, refreshMs);
  return { dispose() { disposed = true; clearInterval(timer); tooltipController.dispose(); if (systemThemeQuery?.removeEventListener) systemThemeQuery.removeEventListener('change', onSystemThemeChange); else if (systemThemeQuery?.removeListener) systemThemeQuery.removeListener(onSystemThemeChange); } };
}

function injectStyles() {
  if (document.getElementById('dev-nexus-cockpit-styles')) return;
  const style = document.createElement('style');
  style.id = 'dev-nexus-cockpit-styles';
  style.textContent = cockpitStyles;
  document.head.appendChild(style);
}

function renderDashboard(snapshot, themeMode, selectedId, host, selectedWorkspaceId = '', gitHistoryFilter = 'all') {
  const activeSelection = findSelectableById(snapshot, selectedId) ? selectedId : defaultSelectedId(snapshot);
  const loading = snapshot.partial === true;
  const componentsLoaded = sectionLoaded(snapshot, 'components');
  const threadsLoaded = sectionLoaded(snapshot, 'threads');
  const trackedLoaded = sectionLoaded(snapshot, 'tracked-work');
  const pluginsLoaded = sectionLoaded(snapshot, 'plugins');
  const gitHistory = loading && !componentsLoaded ? renderProgressivePanel('project-git-history', 'Write history', 'Project Writes', 'Loading write events, refs, and parent edges.') : renderGitHistory(snapshot, activeSelection, gitHistoryFilter);
  const workHistory = loading && !threadsLoaded ? renderProgressivePanel('parallel-work-map', 'Workspace map', 'Activity Lanes', 'Loading source checkout, branches, automation, and decisions.') : renderWorkHistory(snapshot, activeSelection);
  const features = loading && !threadsLoaded ? renderProgressivePanel('active-features', 'Project workflow', 'Active Features', 'Loading feature branches and active threads.') : renderFeatureOverview(snapshot, activeSelection);
  const threadInbox = loading && !threadsLoaded ? renderProgressivePanel('hitl-queue', 'HITL queue', 'Action Needed', 'Loading active threads and local decisions.') : renderThreadInbox(snapshot, activeSelection);
  const trackedWork = loading && !trackedLoaded ? renderProgressivePanel('tracked-work-panel', 'Tracked work', 'Issues and Work Items', 'Loading provider and local work items.') : renderTrackedWork(snapshot, activeSelection);
  const plugins = loading && !pluginsLoaded ? renderProgressivePanel('plugins-panel', 'Extensions', 'Plugins', 'Loading local plugin candidates and capability details.') : renderPlugins(snapshot.plugins);
  const activity = loading && !threadsLoaded ? renderProgressivePanel('activity-panel', 'Activity', 'Recent Signals', 'Loading workspace events.') : `<div class="dn-panel" id="activity-panel"><h2>Activity</h2><div class="dn-events">${snapshot.events.slice(0, 7).map((event) => renderEvent(event, activeSelection)).join('')}</div></div>`;
  const blockers = loading && !trackedLoaded ? renderProgressivePanel('blockers-panel', 'Blockers', 'Blockers', 'Loading approvals and blockers.') : `<div class="dn-panel dn-blockers-panel" id="blockers-panel"><h2>Blockers</h2>${renderBlockers(snapshot, activeSelection)}</div>`;
  return `<div class="dn-shell">
    <header class="dn-header">
      <div><span class="dn-eyebrow">DevNexus cockpit</span><h1>${escapeHtml(snapshot.project.name)}</h1><p>${escapeHtml(snapshot.summary)}</p></div>
      ${renderProjectHeaderActions(snapshot, themeMode, selectedWorkspaceId)}
    </header>
    ${renderHostOverview(host, snapshot, selectedWorkspaceId)}
    ${renderSignals(snapshot.signals, activeSelection)}
    ${isGitHistorySelection(activeSelection) ? '' : renderSelectedItem(snapshot, activeSelection)}
    <section class="dn-main-grid">
      <div class="dn-work-stack">${gitHistory}${features}${workHistory}${threadInbox}${trackedWork}</div>
    </section>
    <section class="dn-plugin-row">${plugins}</section>
    <section class="dn-grid dn-secondary-grid">
      <div class="dn-panel dn-components-panel" id="components-panel"><h2>Components</h2>${renderComponents(snapshot.components, activeSelection)}</div>
      ${activity}
      ${blockers}
    </section>
  </div>`;
}

function renderHostDashboard(host, themeMode, hostFocus = 'components') {
  const focus = normalizeHostFocus(hostFocus);
  const workspaceCount = host?.workspaceCount ?? 0;
  const summary = host.partial === true ? `${countLabel(workspaceCount, 'workspace')}, loading signals` : `${countLabel(workspaceCount, 'workspace')}, ${needsAttentionLabel(host.needsAttentionCount ?? 0)}`;
  return `<div class="dn-shell dn-host-dashboard"><header class="dn-header"><div><span class="dn-eyebrow">DevNexus cockpit</span><h1>Host Cockpit</h1><p>${escapeHtml(summary)}</p></div>${renderHostHeaderActions(host, themeMode)}</header>${renderHostOverview(host, null, '', { hostMode: true, focus })}${renderHostSignals(host, focus)}${renderHostActionQueue(host, focus)}</div>`;
}

function renderHostHeaderActions(host, themeMode) {
  const homePath = host?.homePath ?? '';
  return `<div class="dn-header-actions dn-host-header-actions"><div class="dn-header-strip"><span class="dn-header-pill dn-host-identity"><span>Host</span><strong title="${escapeHtml(hostIdentity(host))}">${escapeHtml(hostIdentity(host))}</strong></span><span class="dn-header-pill dn-header-stamp"><span>Generated</span><strong>${escapeHtml(formatTime(host?.generatedAt))}</strong></span>${renderPathOpenMenu('home', 'Home', homePath)}</div>${renderThemeToggle(themeMode)}</div>`;
}

function renderProjectHeaderActions(snapshot, themeMode, selectedWorkspaceId = '') {
  const root = snapshot?.project?.root ?? '';
  return `<div class="dn-header-actions dn-project-header-actions"><div class="dn-header-strip">${renderHostNavButton(selectedWorkspaceId)}<span class="dn-header-pill dn-header-stamp"><span>Generated</span><strong>${escapeHtml(formatTime(snapshot?.generatedAt))}</strong></span>${renderPathOpenMenu('project', 'Project', root)}</div>${renderThemeToggle(themeMode)}</div>`;
}

function hostIdentity(host) {
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

function renderHostNavButton(selectedWorkspaceId) {
  return selectedWorkspaceId ? `<button class="dn-action" type="button" data-workspace-id="">${signalIcon('worktrees')}<span class="dn-action-label">Host cockpit</span></button>` : '';
}

function renderOpenMenu(target, label) {
  const safeTarget = target === 'home' ? 'home' : 'project';
  return `<details class="dn-open-menu"><summary class="dn-action dn-open-trigger">${folderIcon()}<span class="dn-action-label">${escapeHtml(label)}</span><span class="dn-open-chevron-shell">${chevronDownIcon()}</span></summary>${renderOpenOptions(safeTarget)}</details>`;
}

function renderPathOpenMenu(target, label, pathValue) {
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

function countLabel(value, singular, pluralValue = `${singular}s`) {
  const count = Number(value ?? 0);
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

function needsAttentionLabel(value) {
  const count = Number(value ?? 0);
  return `${count} ${count === 1 ? 'needs' : 'need'} attention`;
}

function mergeDashboardSnapshot(snapshot, patch) {
  if (!snapshot) return patch ?? null;
  if (!patch) return snapshot;
  const loaded = new Set([...(snapshot.loadedSections ?? []), ...(patch.loadedSections ?? [])]);
  return { ...snapshot, ...patch, loadedSections: [...loaded], partial: snapshot.partial === true && patch.partial !== false ? true : patch.partial };
}

function dashboardRenderSignature(value) {
  try {
    return JSON.stringify(stripVolatileDashboardFields(value));
  } catch {
    return '';
  }
}

function stripVolatileDashboardFields(value) {
  if (Array.isArray(value)) return value.map(stripVolatileDashboardFields);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'generatedAt' && !(key === 'time' && isRefreshClockEvent(value))).map(([key, child]) => [key, stripVolatileDashboardFields(child)]));
  }
  return value;
}

function isRefreshClockEvent(value) {
  const id = String(value?.id ?? '');
  return id === 'snapshot-generated' || id === 'automation-status' || id === 'eligible-work' || /^blocker-\d+$/u.test(id);
}

function dashboardErrorMessage(error) {
  return error instanceof Error ? error.message : String(error ?? '');
}

function sectionLoaded(snapshot, section) {
  return snapshot?.partial !== true || (snapshot.loadedSections ?? []).includes(section);
}

function renderLoading(themeMode, host, selectedWorkspaceId = '') {
  const title = selectedWorkspaceId ? 'Switching workspace' : 'Loading host cockpit';
  const detail = selectedWorkspaceId ? 'Loading workspace state.' : 'Reading registered workspaces, threads, plugins, and approvals.';
  return `<div class="dn-shell"><header class="dn-header"><div><span class="dn-eyebrow">DevNexus cockpit</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></div><div class="dn-header-actions">${renderHostNavButton(selectedWorkspaceId)}${renderThemeToggle(themeMode)}</div></header>${renderHostOverview(host, null, selectedWorkspaceId)}<section class="dn-panel dn-loading-panel" aria-busy="true"><span class="dn-loader" aria-hidden="true"></span><div class="dn-loading-copy"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p><div class="dn-skeleton-stack" aria-hidden="true"><span class="dn-skeleton" style="width:92%"></span><span class="dn-skeleton" style="width:76%"></span><span class="dn-skeleton" style="width:54%"></span></div></div></section></div>`;
}

function renderHostOverview(host, snapshot, selectedWorkspaceId = '', options = {}) {
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

function renderInlineLoading(label) {
  return `<p class="dn-inline-loading">${escapeHtml(label)}</p>`;
}

function renderProgressivePanel(id, eyebrow, title, detail) {
  return `<div class="dn-panel" id="${escapeAttribute(id)}"><div class="dn-panel-heading"><div><span class="dn-eyebrow">${escapeHtml(eyebrow)}</span><h2>${escapeHtml(title)}</h2></div><span class="dn-count">loading</span></div>${renderInlineLoading(detail)}<div class="dn-skeleton-stack" aria-hidden="true"><span class="dn-skeleton" style="width:86%"></span><span class="dn-skeleton" style="width:68%"></span><span class="dn-skeleton" style="width:42%"></span></div></div>`;
}

function workspaceToneLabel(workspace) {
  if (workspace.blockerCount > 0 || workspace.automationStatus === 'blocked') return 'blocked';
  if (workspace.needsDecisionCount > 0) return 'needs action';
  if (workspace.dirtyComponentCount > 0) return 'dirty';
  if (workspace.eligibleWorkCount > 0) return 'ready work';
  return 'clear';
}

function normalizeHostFocus(value) {
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

function renderThemeToggle(themeMode) {
  return `<div class="dn-theme-toggle" role="group" aria-label="Color theme"><button type="button" data-theme-mode="system" aria-pressed="${themeMode === 'system' ? 'true' : 'false'}">System</button><button type="button" data-theme-mode="light" aria-pressed="${themeMode === 'light' ? 'true' : 'false'}">Light</button><button type="button" data-theme-mode="dark" aria-pressed="${themeMode === 'dark' ? 'true' : 'false'}">Dark</button></div>`;
}

function bindThemeControls(container, onSelect) {
  container.querySelectorAll('[data-theme-mode]').forEach((button) => {
    button.addEventListener('click', () => onSelect(button.getAttribute('data-theme-mode')));
  });
}

function bindSelectionControls(container, onSelect) {
  container.querySelectorAll('[data-select-id]').forEach((button) => {
    button.addEventListener('click', () => {
      onSelect(button.getAttribute('data-select-id'));
      const targetId = button.getAttribute('data-scroll-target');
      if (targetId) scrollToDashboardSection(targetId);
    });
  });
}

function bindHostSignalControls(container, onSelect) {
  container.querySelectorAll('[data-host-focus]').forEach((button) => {
    button.addEventListener('click', () => {
      const focus = normalizeHostFocus(button.getAttribute('data-host-focus'));
      onSelect(focus);
      scrollToDashboardSection(hostSignalTarget(focus));
    });
  });
}

function bindGitHistoryFilterControls(container, onSelect) {
  container.querySelectorAll('[data-git-history-filter]').forEach((button) => {
    button.addEventListener('click', () => onSelect(button.getAttribute('data-git-history-filter')));
  });
}

function scrollToDashboardSection(targetId) {
  requestAnimationFrame(() => {
    const target = document.getElementById(targetId);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function bindWorkspaceControls(container, onSelect) {
  container.querySelectorAll('[data-workspace-id]').forEach((button) => {
    button.addEventListener('click', () => onSelect(button.getAttribute('data-workspace-id'), button.getAttribute('data-workspace-selection-id')));
  });
}

function bindLocalActions(container, baseUrl = '', actionToken = '', workspaceId = '', onMutation = null) {
  container.querySelectorAll('[data-open-target][data-open-app]').forEach((button) => {
    button.addEventListener('click', async () => {
      const target = button.getAttribute('data-open-target') ?? '';
      const app = button.getAttribute('data-open-app') ?? '';
      const label = button.querySelector('.dn-action-label');
      const originalLabel = label?.textContent ?? '';
      button.disabled = true;
      if (label) label.textContent = 'Opening...';
      try {
        const headers = { 'content-type': 'application/json' };
        if (actionToken) headers['x-dev-nexus-action-token'] = actionToken;
        const response = await fetch(`${baseUrl}/api/local/open${workspaceQuery(workspaceId)}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ target, app }),
        });
        const payload = await response.json();
        if (!response.ok || payload?.ok !== true) throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
        if (label) label.textContent = 'Opened';
        button.closest('details')?.removeAttribute('open');
      } catch (error) {
        if (label) label.textContent = 'Setup needed';
        button.title = error instanceof Error ? error.message : String(error);
      } finally {
        setTimeout(() => { if (label) label.textContent = originalLabel; button.disabled = false; }, 1200);
      }
    });
  });
  container.querySelectorAll('[data-thread-action][data-thread-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.getAttribute('data-thread-action') ?? '';
      const threadId = button.getAttribute('data-thread-id') ?? '';
      const label = button.querySelector('.dn-action-label');
      const originalLabel = label?.textContent ?? '';
      const busyLabel = action === 'forget' ? 'Forgetting...' : 'Archiving...';
      const doneLabel = action === 'forget' ? 'Forgotten' : 'Archived';
      button.disabled = true;
      if (label) label.textContent = busyLabel;
      try {
        const headers = { 'content-type': 'application/json' };
        if (actionToken) headers['x-dev-nexus-action-token'] = actionToken;
        const response = await fetch(`${baseUrl}/api/cockpit/thread-action${workspaceQuery(workspaceId)}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ action, threadId }),
        });
        const payload = await response.json();
        if (!response.ok || payload?.ok !== true) throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
        if (label) label.textContent = doneLabel;
        if (typeof onMutation === 'function') await onMutation();
      } catch (error) {
        if (label) label.textContent = 'Action failed';
        button.title = error instanceof Error ? error.message : String(error);
        setTimeout(() => { if (label) label.textContent = originalLabel; button.disabled = false; }, 1600);
      }
    });
  });
  container.querySelectorAll('[data-copy-prompt], [data-copy-text]').forEach((button) => {
    button.addEventListener('click', async () => {
      const prompt = button.getAttribute('data-copy-text') ?? button.getAttribute('data-copy-prompt') ?? '';
      const label = button.querySelector('.dn-action-label');
      const originalLabel = label?.textContent ?? button.getAttribute('data-copy-reset-label') ?? 'Copy';
      const doneLabel = button.getAttribute('data-copy-done-label') ?? (button.hasAttribute('data-copy-prompt') ? 'Copied prompt' : 'Copied');
      const resetLabel = button.getAttribute('data-copy-reset-label') ?? originalLabel;
      try {
        await navigator.clipboard.writeText(prompt);
        button.dataset.copied = 'true';
        if (label) label.textContent = doneLabel;
      } catch {
        button.dataset.copied = 'error';
        if (label) label.textContent = 'Copy failed';
      }
      setTimeout(() => { delete button.dataset.copied; if (label) label.textContent = resetLabel; }, 1600);
    });
  });
  container.querySelectorAll('[data-start-chat-prompt]').forEach((button) => {
    button.addEventListener('click', async () => {
      const prompt = button.getAttribute('data-start-chat-prompt') ?? '';
      const title = button.getAttribute('data-start-chat-title') ?? '';
      const targetId = button.getAttribute('data-chat-target-id') ?? '';
      const startingLabel = button.getAttribute('data-chat-resume') === 'true' ? 'Resuming...' : 'Starting...';
      const label = button.querySelector('.dn-action-label');
      button.disabled = true;
      if (label) label.textContent = startingLabel;
      try {
        const headers = { 'content-type': 'application/json' };
        if (actionToken) headers['x-dev-nexus-action-token'] = actionToken;
        const response = await fetch(`${baseUrl}/api/codex/thread${workspaceQuery(workspaceId)}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ prompt, title, targetId }),
        });
        const payload = await response.json();
        if (!response.ok || payload?.ok !== true) throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
        if (label) label.textContent = payload.result?.status === 'resumed' ? 'Chat resumed' : 'Chat started';
        button.title = `Thread ${payload.result?.threadId ?? 'started'}`;
      } catch (error) {
        if (label) label.textContent = 'Setup needed';
        button.title = error instanceof Error ? error.message : String(error);
      } finally {
        button.disabled = false;
      }
    });
  });
}

function renderSignals(signals, selectedId) {
  return `<section class="dn-signals" aria-label="Current workspace signals">${signals.map((signal) => renderSignal(signal, selectedId)).join('')}</section>`;
}

function renderSignal(signal, selectedId) {
  const id = `signal:${signal.id}`;
  const detail = formatDisplayText(signal.detail);
  return `<button class="dn-signal signal-${escapeAttribute(signal.id)} ${id === selectedId ? 'selected' : ''}" type="button" data-select-id="${escapeHtml(id)}" data-scroll-target="${escapeHtml(signalPanelTarget(signal.id))}"><span class="dn-signal-top"><span class="dn-signal-icon">${signalIcon(signal.id)}</span><span class="dn-label">${escapeHtml(signal.label)}</span></span><strong>${escapeHtml(signal.value)}</strong><p title="${escapeHtml(detail)}">${escapeHtml(detail)}</p></button>`;
}

function signalPanelTarget(id) {
  if (id === 'components') return 'components-panel';
  if (id === 'automation') return 'selected-item';
  if (id === 'eligible-work') return 'tracked-work-panel';
  if (id === 'worktrees') return 'hitl-queue';
  if (id === 'blockers') return 'blockers-panel';
  if (id === 'plugins') return 'plugins-panel';
  return 'selected-item';
}

function renderEvent(event, selectedId) {
  const relatedId = event.relatedNodeIds.find(Boolean) ?? `event:${event.id}`;
  return `<article class="dn-event-card"><button class="dn-event ${relatedId === selectedId ? 'selected' : ''}" type="button" data-select-id="${escapeHtml(relatedId)}"><span class="dn-label">${escapeHtml(formatTime(event.time))} · ${escapeHtml(event.source)}</span><strong>${escapeHtml(event.title)}</strong><p>${escapeHtml(formatDisplayText(event.body))}</p></button>${renderActionStrip(event.actions, 'compact')}</article>`;
}

function isGitHistorySelection(selectedId) {
  return String(selectedId ?? '').startsWith('history:');
}

function renderGitHistory(snapshot, selectedId, filter = 'all') {
  const activeFilter = normalizeGitHistoryFilter(filter);
  const graph = gitHistoryRows(snapshot, activeFilter);
  if (!graph) return `<div class="dn-panel dn-git-panel" id="project-git-history"><div class="dn-panel-heading"><div><span class="dn-eyebrow">Write history</span><h2>Project Writes</h2></div><span class="dn-count">0 write events</span></div><p>No write history loaded.</p></div>`;
  const repository = graph.repository;
  const count = `${countLabel(graph.rows.length, 'write event')} · ${countLabel(repository.branchNames?.length ?? 0, 'branch', 'branches')}`;
  const note = repository.moreAvailable ? `<p class="dn-git-note">Showing the newest ${repository.commits.length} write events. Branch filters use the loaded history window.</p>` : '';
  return `<div class="dn-panel dn-git-panel" id="project-git-history"><div class="dn-panel-heading"><div><span class="dn-eyebrow">Write history</span><h2>Project Writes</h2><p class="dn-history-note">Git commits are write events; parent edges define the graph topology.</p></div><span class="dn-count">${escapeHtml(count)}</span></div>${renderGitHistoryFilters(snapshot, repository, activeFilter)}${renderGitHistoryBoard(snapshot, graph, selectedId)}${note}</div>`;
}

function renderGitHistoryBoard(snapshot, graph, selectedId) {
  const widths = readStoredGitHistoryColumnWidths();
  const visualGraph = gitHistoryVisualGraph(graph, selectedId);
  return `<div class="dn-git-board" data-git-board style="${escapeHtml(gitHistoryColumnStyle(widths))}"><div class="dn-git-graph-column">${renderGitHistoryColumnHeader('graph', 'Graph', widths)}${renderGitHistorySvg(visualGraph)}</div><div class="dn-git-table"><div class="dn-git-column-row">${renderGitHistoryColumnHeader('description', 'Description', widths)}${renderGitHistoryColumnHeader('date', 'Date', widths)}${renderGitHistoryColumnHeader('author', 'Author', widths)}${renderGitHistoryColumnHeader('commit', 'Commit', widths)}</div><div class="dn-git-rows">${renderGitHistoryRows(snapshot, graph, selectedId)}</div></div></div>`;
}

function normalizeGitHistoryFilter(value) {
  const text = String(value ?? '').trim();
  if (!text || text === 'all') return 'all';
  if (text.startsWith('branch:') && text.slice('branch:'.length).trim()) return `branch:${text.slice('branch:'.length).trim()}`;
  if (text.startsWith('feature:') && text.slice('feature:'.length).trim()) return `feature:${text.slice('feature:'.length).trim()}`;
  return 'all';
}

function renderGitHistoryFilters(snapshot, repository, activeFilter) {
  const filters = gitHistoryFilters(snapshot, repository);
  if (filters.length <= 1) return '';
  return `<div class="dn-git-filters" aria-label="Write history filters">${filters.map((filter) => `<button class="dn-git-filter" type="button" data-git-history-filter="${escapeHtml(filter.id)}" aria-pressed="${filter.id === activeFilter ? 'true' : 'false'}" title="${escapeHtml(filter.title ?? filter.label)}">${escapeHtml(filter.label)}</button>`).join('')}</div>`;
}

function gitHistoryFilters(snapshot, repository) {
  const filters = [{ id: 'all', label: 'All writes', title: 'Show the loaded project write history' }];
  const seen = new Set(filters.map((filter) => filter.id));
  const push = (id, label, title = label) => {
    const normalized = normalizeGitHistoryFilter(id);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    filters.push({ id: normalized, label, title });
  };
  if (repository.defaultBranch) push(`branch:${repository.defaultBranch}`, repository.defaultBranch, `Show ${repository.defaultBranch} and its loaded write ancestors`);
  for (const feature of snapshot.features?.records ?? []) {
    const branches = featureGitBranches(feature);
    if (!branches.length) continue;
    push(`feature:${feature.id}`, feature.title, `Show write events reachable from ${feature.title}`);
  }
  const branchNames = gitHistoryBranchNames(repository);
  for (const branch of branchNames) push(`branch:${branch}`, compactBranchName(branch), `Show ${branch} and its loaded write ancestors`);
  return filters.slice(0, 18);
}

function gitHistoryBranchNames(repository) {
  const names = [];
  const seen = new Set();
  const remember = (name) => {
    const normalized = normalizeGitBranchName(name);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    names.push(normalized);
  };
  for (const commit of repository.commits ?? []) {
    for (const ref of commit.refs ?? []) {
      if (ref.kind === 'branch' || ref.kind === 'remote') remember(ref.name);
    }
  }
  for (const branch of repository.branchNames ?? []) remember(branch);
  return names;
}

function featureGitBranches(feature) {
  return [...new Set([feature.featureBranch, ...(feature.branches ?? [])].filter(Boolean).map((branch) => String(branch).trim()).filter(Boolean))];
}

function normalizeGitBranchName(value) {
  return String(value ?? '').trim().replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, '').replace(/^remotes\//, '');
}

function filteredGitHistoryCommits(snapshot, repository, filter) {
  const commits = repository.commits ?? [];
  if (filter === 'all') return commits;
  const headHashes = gitHistoryFilterHeadHashes(snapshot, repository, filter);
  if (!headHashes.size) return [];
  const reachable = collectGitAncestorHashes(commits, headHashes);
  return commits.filter((commit) => reachable.has(commit.hash));
}

function gitHistoryFilterHeadHashes(snapshot, repository, filter) {
  const headHashes = new Set();
  if (filter.startsWith('branch:')) {
    for (const hash of branchHeadHashes(repository, filter.slice('branch:'.length))) headHashes.add(hash);
  } else if (filter.startsWith('feature:')) {
    const id = filter.slice('feature:'.length);
    const feature = (snapshot.features?.records ?? []).find((candidate) => candidate.id === id);
    for (const branch of featureGitBranches(feature ?? {})) {
      for (const hash of branchHeadHashes(repository, branch)) headHashes.add(hash);
    }
  }
  return headHashes;
}

function branchHeadHashes(repository, branchName) {
  const wanted = normalizeGitBranchName(branchName);
  const hashes = new Set();
  if (!wanted) return hashes;
  for (const commit of repository.commits ?? []) {
    for (const ref of commit.refs ?? []) {
      if (ref.kind !== 'branch' && ref.kind !== 'remote') continue;
      const refName = normalizeGitBranchName(ref.name);
      if (refName === wanted || refName.endsWith(`/${wanted}`)) hashes.add(ref.hash || commit.hash);
    }
  }
  if (!hashes.size && repository.defaultBranch === wanted && repository.head) hashes.add(repository.head);
  return hashes;
}

function collectGitAncestorHashes(commits, headHashes) {
  const byHash = new Map(commits.map((commit) => [commit.hash, commit]));
  const reachable = new Set();
  const queue = [...headHashes];
  while (queue.length) {
    const hash = queue.shift();
    if (!hash || reachable.has(hash)) continue;
    reachable.add(hash);
    const commit = byHash.get(hash);
    if (!commit) continue;
    for (const parent of commit.parents ?? []) queue.push(parent);
  }
  return reachable;
}

function gitHistoryRows(snapshot, filter = 'all') {
  const repository = (snapshot.history?.repositories ?? []).find((candidate) => (candidate.commits ?? []).length > 0) ?? null;
  if (!repository) return null;
  const commits = filteredGitHistoryCommits(snapshot, repository, normalizeGitHistoryFilter(filter));
  const commitsByHash = new Map(commits.map((commit) => [commit.hash, commit]));
  const layout = buildWriteHistoryLayout({
    writeEvents: commits.map((commit) => ({
      id: commit.hash,
      parentIds: commit.parents ?? [],
      subject: commit.subject ?? commit.shortHash ?? commit.hash,
    })),
  });
  const rows = layout.nodes.map((node) => {
    const commit = commitsByHash.get(node.writeEventId);
    if (!commit) return null;
    return { repository, commit, lane: node.lane, colorLane: node.colorIndex, index: node.row, selectId: gitHistorySelectId(repository, commit) };
  }).filter(Boolean);
  const paths = layout.segments.map((segment) => ({
    colorLane: segment.colorIndex,
    fromLane: segment.fromLane,
    toLane: segment.toLane,
    fromIndex: segment.fromRow,
    toIndex: segment.toRow,
    points: segment.points.map((point) => ({ lane: point.lane, index: point.row })),
  }));
  return { repository, rows, paths, maxLane: layout.maxRouteLane, layout };
}

function renderGitHistorySvg(graph) {
  return renderNexusCockpitHistoryGraphSvg(graph, {
    ariaLabel: 'Git write history graph',
  });
}

function renderGitHistoryRows(snapshot, graph, selectedId) {
  return graph.rows.map((row) => {
    const detail = row.selectId === selectedId ? renderGitHistoryDetailPanel(snapshot, graph, selectedId) : '';
    return `${renderGitHistoryRow(snapshot, row, selectedId)}${detail}`;
  }).join('');
}

function gitHistoryVisualGraph(graph, selectedId) {
  if (!isGitHistorySelection(selectedId)) return graph;
  const selectedRow = graph.rows.find((row) => row.selectId === selectedId);
  if (!selectedRow) return graph;
  const pivot = selectedRow.index;
  const shiftIndex = (index) => {
    const value = Number(index);
    if (!Number.isFinite(value)) return index;
    return value > pivot ? value + gitHistoryInlineDetailRows : value;
  };
  return {
    ...graph,
    rows: graph.rows.map((row) => ({ ...row, index: shiftIndex(row.index) })),
    paths: (graph.paths ?? []).map((path) => ({
      ...path,
      fromIndex: path.fromIndex === undefined ? path.fromIndex : shiftIndex(path.fromIndex),
      toIndex: path.toIndex === undefined ? path.toIndex : shiftIndex(path.toIndex),
      points: (path.points ?? []).map((point) => ({ ...point, index: shiftIndex(point.index) })),
    })),
  };
}

function renderGitHistoryRow(snapshot, row, selectedId) {
  const selected = row.selectId === selectedId ? ' selected' : '';
  const refs = (row.commit.refs ?? []).filter((ref) => ref.kind !== 'head').slice(0, 3);
  const refChips = refs.map((ref) => `<span class="dn-git-ref" style="--dn-branch-color:var(--dn-branch-${(row.colorLane ?? row.lane) % 7});" title="${escapeHtml(ref.name)}">${escapeHtml(ref.name)}</span>`).join('');
  const badges = gitHistoryAnnotations(snapshot, row.repository, row.commit).slice(0, 3).map((annotation) => `<span class="dn-git-badge tone-${escapeAttribute(annotation.tone)}" title="${escapeHtml(annotation.title ?? annotation.label)}">${escapeHtml(annotation.label)}</span>`).join('');
  const date = formatTime(row.commit.committedAt);
  const author = row.commit.authorName ?? '';
  const authorTitle = [row.commit.authorName, row.commit.authorEmail].filter(Boolean).join(' · ');
  return `<button class="dn-git-history-row${selected}" type="button" data-select-id="${escapeHtml(row.selectId)}"><span class="dn-git-subject"><span class="dn-git-refs">${refChips}</span><strong title="${escapeHtml(row.commit.subject)}">${escapeHtml(row.commit.subject)}</strong><span class="dn-git-badges">${badges}</span></span><span class="dn-git-date" title="${escapeHtml(row.commit.committedAt)}">${escapeHtml(date)}</span><span class="dn-git-author" title="${escapeHtml(authorTitle || author)}">${escapeHtml(author)}</span><span class="dn-git-sha" title="${escapeHtml(row.commit.hash ?? row.commit.shortHash)}">${escapeHtml(row.commit.shortHash)}</span></button>`;
}

function renderGitHistoryDetailPanel(snapshot, graph, selectedId) {
  if (!selectedId || !String(selectedId).startsWith('history:')) return '';
  const row = graph.rows.find((candidate) => candidate.selectId === selectedId);
  if (!row) return '';
  const commit = row.commit;
  const parents = gitHistoryParentCommits(row.repository, commit);
  const children = gitHistoryChildCommits(row.repository, commit);
  const annotations = gitHistoryAnnotations(snapshot, row.repository, commit);
  const actions = uniqueActions(annotations.flatMap((annotation) => annotation.actions ?? []));
  const markers = annotations.length
    ? `<div class="dn-history-marker-list">${annotations.map((annotation) => `<span class="dn-history-marker tone-${escapeAttribute(annotation.tone)}" title="${escapeHtml(annotation.title ?? annotation.label)}">${escapeHtml(annotation.label)}</span>`).join('')}</div>`
    : '<p>No attached decision, review, or tracked-work markers.</p>';
  const actionStrip = actions.length ? renderActionStrip(actions, 'compact') : '<p>No direct action for this write event.</p>';
  const facts = [
    ['Parents', parents.length ? parents.map(gitHistoryWriteEventLabel).join(', ') : 'none'],
    ['Children', children.length ? children.map(gitHistoryWriteEventLabel).join(', ') : 'none'],
    ['Source', commit.shortHash ?? commit.hash],
  ];
  return `<section class="dn-git-detail-panel dn-git-inline-detail" data-history-detail-for="${escapeHtml(row.selectId)}"><article class="dn-git-detail-main"><span class="dn-label">Selected write event</span><strong title="${escapeHtml(commit.subject)}">${escapeHtml(commit.subject)}</strong><p>${escapeHtml([commit.authorName, formatTime(commit.committedAt)].filter(Boolean).join(' · ') || 'Git commit write event')}</p><dl class="dn-git-detail-grid">${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd title="${escapeHtml(value)}">${escapeHtml(value)}</dd></div>`).join('')}</dl></article><aside class="dn-git-detail-side"><span class="dn-label">Attached details</span>${markers}<span class="dn-label">Actions</span>${actionStrip}</aside></section>`;
}

function gitHistoryParentCommits(repository, commit) {
  const byHash = new Map((repository.commits ?? []).map((candidate) => [candidate.hash, candidate]));
  return (commit.parents ?? []).map((parent) => byHash.get(parent)).filter(Boolean);
}

function gitHistoryChildCommits(repository, commit) {
  return (repository.commits ?? []).filter((candidate) => (candidate.parents ?? []).includes(commit.hash));
}

function gitHistoryWriteEventLabel(commit) {
  return [commit.shortHash, commit.subject].filter(Boolean).join(' ');
}

function gitHistoryAnnotations(snapshot, repository, commit) {
  const branchNames = gitCommitBranchNames(commit);
  const features = featuresForGitBranches(snapshot, branchNames);
  const threads = threadsForGitBranches(snapshot, branchNames);
  const trackedWork = trackedWorkForGitBranches(snapshot, branchNames);
  const annotations = [];
  for (const feature of features.slice(0, 2)) {
    annotations.push({ kind: 'feature', label: feature.statusLabel ?? feature.status ?? 'Feature', title: feature.title, tone: toneForStatus(feature.status, 'feature'), feature, actions: [] });
  }
  if (threads.length) {
    const needsDecision = threads.filter((thread) => thread.decision === 'review' || thread.decision === 'rescue' || thread.decision === 'blocked').length;
    annotations.push({ kind: 'thread', label: countLabel(threads.length, 'thread'), title: needsDecision ? countLabel(needsDecision, 'action') + ' needed' : 'Active thread', tone: needsDecision ? 'warn' : 'active', threads, actions: threads.flatMap((thread) => thread.actions ?? []) });
  }
  if (trackedWork.length) {
    const blocked = trackedWork.filter((item) => item.kind === 'blocked').length;
    annotations.push({ kind: 'tracked-work', label: countLabel(trackedWork.length, 'issue'), title: blocked ? countLabel(blocked, 'blocker') : 'Tracked work', tone: blocked ? 'danger' : 'active', trackedWork, actions: trackedWork.flatMap((item) => item.actions ?? []) });
  }
  return annotations;
}

function gitCommitBranchNames(commit) {
  return [...new Set((commit.refs ?? []).filter((ref) => ref.kind === 'branch' || ref.kind === 'remote').map((ref) => normalizeGitBranchName(ref.name)).filter(Boolean))];
}

function featuresForGitBranches(snapshot, branchNames) {
  return (snapshot.features?.records ?? []).filter((feature) => branchSetsIntersect(branchNames, featureGitBranches(feature)));
}

function threadsForGitBranches(snapshot, branchNames) {
  return (snapshot.threads?.records ?? []).filter((thread) => branchSetsIntersect(branchNames, [thread.branchName]));
}

function trackedWorkForGitBranches(snapshot, branchNames) {
  return (snapshot.trackedWork?.records ?? []).filter((item) => branchNames.some((branch) => trackedWorkMentionsBranch(item, branch)));
}

function trackedWorkMentionsBranch(item, branch) {
  const normalized = normalizeBranchSearchToken(branch);
  if (!normalized) return false;
  const text = normalizeBranchSearchToken([item.id, item.logicalItemId, item.title, item.detail, item.webUrl].filter(Boolean).join(' '));
  return text.includes(normalized) || normalized.split('-').some((token) => token.length > 3 && text.includes(token));
}

function normalizeBranchSearchToken(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function branchSetsIntersect(left, right) {
  const normalizedRight = new Set((right ?? []).map(normalizeGitBranchName).filter(Boolean));
  return (left ?? []).map(normalizeGitBranchName).some((branch) => normalizedRight.has(branch) || [...normalizedRight].some((candidate) => candidate.endsWith(`/${branch}`) || branch.endsWith(`/${candidate}`)));
}

function gitHistorySelectId(repository, commit) {
  return `history:${repository.componentId}:${commit.hash}`;
}

function renderFeatureOverview(snapshot, selectedId) {
  const features = snapshot.features;
  const records = features?.records ?? [];
  const count = features ? [countLabel(features.activeCount ?? 0, 'active feature'), features.needsAttentionCount ? countLabel(features.needsAttentionCount, 'needs review') : null].filter(Boolean).join(' · ') : '0 active features';
  const note = features?.incomplete && features.detail ? `<p class="dn-panel-note">${escapeHtml(features.detail)}</p>` : '';
  const visible = records.slice(0, 6);
  const more = records.length > visible.length ? `<div class="dn-feature-more">${escapeHtml(countLabel(records.length - visible.length, 'more feature'))}</div>` : '';
  const body = records.length ? `${visible.map((feature) => renderFeatureCard(feature, selectedId)).join('')}${more}` : '<p>No active feature branch delivery configured.</p>';
  return `<div class="dn-panel dn-feature-panel" id="active-features"><div class="dn-panel-heading"><div><span class="dn-eyebrow">Project workflow</span><h2>Active Features</h2></div><span class="dn-count">${escapeHtml(count)}</span></div>${note}<div class="dn-feature-list">${body}</div></div>`;
}

function renderFeatureCard(feature, selectedId) {
  const selected = feature.id === selectedId ? ' selected' : '';
  const tone = feature.tone ?? toneForStatus(feature.status, 'feature');
  const meta = [feature.branchStrategy, feature.featureBranch ?? feature.reviewBranchPattern, countLabel(feature.branchCount ?? 0, 'branch'), countLabel(feature.threadCount ?? 0, 'thread')].filter(Boolean);
  return `<button class="dn-feature-card tone-${escapeAttribute(tone)}${selected}" type="button" data-select-id="${escapeHtml(feature.id)}" data-scroll-target="selected-item"><span class="dn-feature-title"><strong title="${escapeHtml(feature.title)}">${escapeHtml(feature.title)}</strong><span class="dn-feature-status">${escapeHtml(feature.statusLabel ?? feature.status)}</span></span><p title="${escapeHtml(formatDisplayText(feature.detail))}">${escapeHtml(formatDisplayText(feature.detail))}</p><span class="dn-feature-meta">${meta.map((item) => `<span title="${escapeHtml(item)}">${escapeHtml(item)}</span>`).join('')}</span></button>`;
}

function renderWorkHistory(snapshot, selectedId) {
  const timeline = historyRows(snapshot);
  const rows = timeline.rows;
  const reader = '<div class="dn-map-reader"><span>Not Git history</span><span>Each rail is a workspace category</span><span>Rows are current records</span><span>Click a row for actions</span></div>';
  return `<div class="dn-panel dn-history-panel" id="parallel-work-map"><div class="dn-panel-heading"><div><span class="dn-eyebrow">Workspace map</span><h2>Activity Lanes</h2><p class="dn-history-note">Current workspace records grouped by source checkout, active branches, automation, and decisions.</p>${reader}</div><span class="dn-count">${countLabel(rows.length, 'record')} · ${countLabel(timeline.lanes.length, 'lane')}</span></div>${renderLaneKey(timeline.lanes)}<div class="dn-branch-board" role="list">${renderBranchGraph(rows, timeline.lanes)}<div class="dn-history-rows">${rows.map((row) => renderHistoryItem(row, selectedId)).join('')}</div></div></div>`;
}

function renderHistoryItem(row, selectedId) {
  const node = row.node;
  const tone = toneForStatus(node.status, node.kind);
  const selected = node.id === selectedId ? 'selected' : '';
  const detail = formatDisplayText(row.detail ?? node.detail ?? node.status);
  const title = `${row.title ?? node.label} · ${detail}`;
  return `<button class="dn-history-item ${selected} kind-${escapeAttribute(node.kind)}" style="--dn-lane:${row.lane}; --dn-branch-color:var(--dn-branch-${row.lane});" type="button" data-lane="${row.lane}" data-select-id="${escapeHtml(node.id)}" title="${escapeHtml(title)}"><span class="dn-branch-dot" aria-hidden="true"></span><span class="dn-history-main"><strong>${escapeHtml(row.title ?? node.label)}</strong></span><span class="dn-history-detail">${escapeHtml(detail)}</span><span class="dn-history-status tone-${escapeAttribute(tone)}">${escapeHtml(node.status)}</span></button>`;
}

function renderLaneKey(lanes) {
  return `<div class="dn-lane-key" aria-label="Work map lanes">${lanes.map((lane) => `<span style="--dn-branch-color:var(--dn-branch-${lane.index});" title="${escapeHtml(`${lane.label}: ${lane.detail ?? lane.shortLabel}`)}"><strong>${escapeHtml(lane.label)}</strong><em>${escapeHtml(lane.detail ?? lane.shortLabel)}</em></span>`).join('')}</div>`;
}

function renderSelectedItem(snapshot, selectedId) {
  const detail = selectedDetail(snapshot, selectedId);
  const body = formatDisplayText(detail.body);
  const actions = `${renderActionStrip(detail.actions)}${renderChatActionStrip(detail.chat)}` || '<p>No direct action for this item.</p>';
  const evidence = `<dl class="dn-detail-grid">${detail.facts.slice(0, 6).map((fact) => { const value = formatDisplayText(fact[1]); return `<div><dt>${escapeHtml(fact[0])}</dt><dd title="${escapeHtml(value)}">${escapeHtml(truncate(value, 90))}</dd></div>`; }).join('')}</dl>${detail.events.length ? `<div class="dn-related"><span class="dn-label">Related activity</span>${detail.events.slice(0, 2).map((event) => `<article><strong>${escapeHtml(truncate(event.title, 70))}</strong><p>${escapeHtml(truncate(formatDisplayText(event.body), 120))}</p>${renderActionStrip(event.actions, 'compact')}</article>`).join('')}</div>` : ''}`;
  return `<section class="dn-panel dn-selected-panel" id="selected-item"><div class="dn-panel-heading"><div><span class="dn-eyebrow">Selected item</span><h2>${escapeHtml(truncate(detail.title, 88))}</h2></div><span class="dn-count">${escapeHtml(detail.events.length ? `${detail.events.length} related` : 'in focus')}</span></div><div class="dn-selected-layout"><article class="dn-selected-section"><span class="dn-label">Summary</span><p title="${escapeHtml(body)}">${escapeHtml(truncate(body, 220))}</p></article><article class="dn-selected-section"><span class="dn-label">Actions</span>${actions}</article><article class="dn-selected-section"><span class="dn-label">Evidence</span>${evidence}</article><article class="dn-selected-section"><span class="dn-label">Diagnostics</span><div class="dn-diagnostic-pills"><span>${escapeHtml(countLabel(detail.facts.length, 'fact'))}</span><span>${escapeHtml(countLabel(detail.actions.length, 'link'))}</span><span>${escapeHtml(countLabel(detail.events.length, 'event'))}</span></div></article></div></section>`;
}

function renderComponents(components, selectedId) {
  return `<div class="dn-component-grid">${components.map((component) => { const id = `component:${component.id}`; const git = component.git; const loading = component.sourceRootExists && !git; const tone = git?.dirty ? 'warn' : component.sourceRootExists ? (loading ? 'neutral' : 'good') : 'danger'; const branch = git?.branch ?? (loading ? 'loading branch' : 'missing branch'); const state = git ? (git.dirty ? 'dirty' : 'clean') : (loading ? 'loading' : 'missing'); return `<button class="dn-component-card ${id === selectedId ? 'selected' : ''}" type="button" data-select-id="${escapeHtml(id)}"><span class="dn-card-title"><strong>${escapeHtml(component.name)}</strong><span class="dn-dot tone-${tone}"></span></span><span class="dn-label">${escapeHtml(component.role)} · ${escapeHtml(component.defaultTrackerId ?? 'no tracker')}</span><span class="dn-card-meta">${escapeHtml(branch)} · ${escapeHtml(state)}</span></button>`; }).join('')}</div>`;
}

function renderThreadInbox(snapshot, selectedId) {
  const threads = snapshot.threads?.records ?? [];
  const count = snapshot.threads ? [`${countLabel(snapshot.threads.needsDecisionCount, 'action')} needed`, snapshot.threads.incomplete ? 'local first' : null].filter(Boolean).join(' · ') : '0 actions needed';
  const note = snapshot.threads?.incomplete && snapshot.threads.detail ? `<p class="dn-panel-note">${escapeHtml(snapshot.threads.detail)}</p>` : '';
  const body = threads.length ? threads.slice(0, 5).map((thread) => renderThreadCard(thread, selectedId)).join('') : '<p>No open threads.</p>';
  return `<div class="dn-panel dn-thread-panel" id="hitl-queue"><div class="dn-panel-heading"><div><span class="dn-eyebrow">HITL queue</span><h2>Action Needed</h2></div><span class="dn-count">${escapeHtml(count)}</span></div>${note}<div class="dn-thread-list">${body}</div></div>`;
}

function renderThreadCard(thread, selectedId) {
  const selectId = threadSelectId(thread);
  const selected = selectId === selectedId ? ' selected' : '';
  const meta = [thread.componentId ?? 'workspace', thread.workItemId, thread.hostId, `updated ${formatTime(thread.updatedAt)}`].filter(Boolean).join(' · ');
  const nextAction = threadNextActionLabel(thread);
  return `<article class="dn-thread-card${selected}"><button class="dn-thread-button" type="button" data-select-id="${escapeHtml(selectId)}" data-scroll-target="selected-item"><div class="dn-thread-card-header"><span class="dn-thread-main"><strong>${escapeHtml(thread.title)}</strong><span class="dn-card-meta">${escapeHtml(meta)}</span></span><span class="dn-thread-decision decision-${escapeAttribute(thread.decision)}">${escapeHtml(thread.decisionLabel)}</span></div><p title="${escapeHtml(thread.decisionDetail)}">${escapeHtml(formatDisplayText(thread.decisionDetail))}</p><span class="dn-thread-next"><span>Next</span><strong title="${escapeHtml(nextAction)}">${escapeHtml(nextAction)}</strong></span></button>${renderThreadActions(thread)}</article>`;
}

function threadNextActionLabel(thread) {
  const decision = String(thread?.decision ?? '').toLowerCase();
  if (decision === 'archive') return 'Archive local record';
  if (decision === 'forget') return 'Forget stale record';
  if (decision === 'rescue') return 'Inspect before cleanup';
  if (decision === 'blocked') return 'Resolve blocker';
  if (decision === 'resume') return 'Resume thread';
  if (decision === 'continue' || decision === 'working') return 'Continue thread';
  if (decision === 'merged') return 'Confirm merged state';
  return 'Review decision';
}

function threadSelectId(thread) {
  return `thread:${thread.id}`;
}

function renderThreadActions(thread) {
  const links = uniqueActions(thread.actions ?? []).slice(0, 2).map((action) => renderProviderAction(action)).join('');
  const policyAction = renderThreadPolicyAction(thread);
  const prompt = cockpitThreadPrompt(thread);
  const title = `Continue ${thread.title}`;
  return `<div class="dn-action-strip compact">${links}${policyAction}${renderChatButtons({ prompt, title, targetId: `thread:${thread.id}`, resumeThreadId: thread.assistantThreadId })}</div>`;
}

function renderThreadPolicyAction(thread) {
  if (thread.decision === 'archive') return renderThreadLocalAction(thread, 'archive', 'Archive');
  if (thread.decision === 'forget') return renderThreadLocalAction(thread, 'forget', 'Forget');
  return '';
}

function renderThreadLocalAction(thread, action, label) {
  return `<button class="dn-action dn-local-action" type="button" data-thread-action="${escapeHtml(action)}" data-thread-id="${escapeHtml(thread.id)}" title="${escapeHtml(`${label} locally; no files are deleted`)}">${signalIcon('worktrees')}<span class="dn-action-label">${escapeHtml(label)}</span></button>`;
}

function renderChatActionStrip(chat, mode = '') {
  if (!chat?.prompt) return '';
  const className = mode ? `dn-action-strip ${mode}` : 'dn-action-strip';
  return `<div class="${className}">${renderChatButtons(chat)}</div>`;
}

function renderChatButtons(chat) {
  const title = chat.title ?? 'Continue in chat';
  const targetId = chat.targetId ?? '';
  const resume = Boolean(chat.resumeThreadId);
  const primaryLabel = resume ? 'Resume chat' : 'Start chat';
  return `<button class="dn-action dn-start-action" type="button" data-start-chat-prompt="${escapeHtml(chat.prompt)}" data-start-chat-title="${escapeHtml(title)}" data-chat-target-id="${escapeHtml(targetId)}" data-chat-resume="${resume ? 'true' : 'false'}">${chatIcon()}<span class="dn-action-label">${primaryLabel}</span></button><button class="dn-action dn-local-action" type="button" data-copy-prompt="${escapeHtml(chat.prompt)}">${clipboardIcon()}<span class="dn-action-label">Copy prompt</span></button>`;
}

function cockpitThreadPrompt(thread) {
  const lines = [
    sentenceLine('Continue cockpit thread', thread.title),
    sentenceLine('Decision', thread.decisionLabel),
    sentenceLine('Reason', thread.decisionDetail),
    thread.componentId ? sentenceLine('Component', thread.componentId) : '',
    thread.branchName ? sentenceLine('Branch', thread.branchName) : '',
    thread.workItemId ? sentenceLine('Work item', thread.workItemId) : '',
    thread.hostId ? sentenceLine('Host', thread.hostId) : '',
    'Inspect the current workspace state, preserve unrelated changes, and recommend the next safe action.'
  ].filter(Boolean);
  return lines.join('\n');
}

function detailPrompt(detail) {
  const lines = [
    sentenceLine('Continue cockpit item', detail.title),
    sentenceLine('Status', factValue(detail.facts, 'Status')),
    sentenceLine('Type', factValue(detail.facts, 'Type')),
    sentenceLine('Reason', detail.body),
    'Inspect the current workspace state, preserve unrelated changes, and recommend the next safe action.'
  ].filter(Boolean);
  return lines.join('\n');
}

function sentenceLine(label, value) {
  const text = stripTerminalPunctuation(formatDisplayText(value));
  return text ? `${label}: ${text}.` : '';
}

function stripTerminalPunctuation(value) {
  return String(value ?? '').trim().replace(/([.!?,;:]+)(["')\]]*)$/u, '$2').trim();
}

function factValue(facts, label) {
  return facts.find((fact) => fact[0] === label)?.[1] ?? '';
}

function renderTrackedWork(snapshot, selectedId) {
  const tracked = snapshot.trackedWork;
  const records = tracked?.records ?? [];
  const count = tracked ? [tracked.blockedCount ? countLabel(tracked.blockedCount, 'blocked item') : null, countLabel(tracked.readyCount, 'ready item'), countLabel(tracked.importCandidateCount, 'import candidate'), countLabel(tracked.staleCount, 'stale item'), tracked.incomplete ? 'local first' : null].filter(Boolean).join(' · ') : '0 ready items';
  const note = tracked?.incomplete && tracked.detail ? `<p class="dn-panel-note">${escapeHtml(tracked.detail)}</p>` : '';
  const body = records.length ? records.slice(0, 8).map((item) => renderTrackedWorkCard(item, selectedId)).join('') : '<p>No tracked work is waiting.</p>';
  return `<div class="dn-panel dn-tracked-panel" id="tracked-work-panel"><div class="dn-panel-heading"><div><span class="dn-eyebrow">Tracked work</span><h2>Issues and Work Items</h2></div><span class="dn-count">${escapeHtml(count)}</span></div>${note}<div class="dn-tracked-list">${body}</div></div>`;
}

function renderTrackedWorkCard(item, selectedId) {
  const selectId = trackedWorkSelectId(item);
  const selected = selectId === selectedId ? ' selected' : '';
  const meta = [item.componentName || item.componentId, item.provider, item.trackerId, item.updatedAt ? `updated ${formatTime(item.updatedAt)}` : null].filter(Boolean).join(' · ');
  const detail = formatDisplayText(item.detail);
  return `<article class="dn-tracked-card kind-${escapeAttribute(item.kind)}${selected}"><button class="dn-tracked-button" type="button" data-select-id="${escapeHtml(selectId)}"><div class="dn-tracked-card-header"><span class="dn-thread-main"><strong title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</strong><span class="dn-card-meta">${escapeHtml(meta)}</span></span><span class="dn-thread-decision decision-${trackedWorkDecisionClass(item)}">${escapeHtml(item.kindLabel)}</span></div><p title="${escapeHtml(detail)}">${escapeHtml(detail)}</p></button>${renderActionStrip(item.actions, 'compact')}</article>`;
}

function trackedWorkSelectId(item) {
  return `tracked-work:${item.componentId}:${item.id}`;
}

function trackedWorkBySelectId(snapshot, id) {
  return (snapshot.trackedWork?.records ?? []).find((item) => trackedWorkSelectId(item) === id) ?? null;
}

function trackedWorkDecisionClass(item) {
  if (item.status === 'blocked' || item.kind === 'blocked') return 'blocked';
  if (item.kind === 'ready') return 'continue';
  if (item.kind === 'stale') return 'rescue';
  if (item.kind === 'import-candidate') return 'review';
  return 'archive';
}

function renderPlugins(plugins) {
  const records = plugins?.records ?? [];
  const available = plugins?.availableCount ?? records.filter((plugin) => plugin.source === 'local' || plugin.state === 'available').length;
  const disabled = records.filter((plugin) => plugin.source !== 'local' && !plugin.enabled).length;
  const countParts = [countLabel(plugins?.enabledCount ?? 0, 'enabled plugin')];
  if (available) countParts.push(countLabel(available, 'available plugin'));
  if (disabled) countParts.push(countLabel(disabled, 'disabled plugin'));
  if (plugins?.capabilityCount) countParts.push(countLabel(plugins.capabilityCount, 'capability', 'capabilities'));
  const count = countParts.join(' · ');
  const body = records.length ? records.map(renderPluginCard).join('') : '<p>No DevNexus plugins installed.</p>';
  return `<div class="dn-panel dn-plugin-panel" id="plugins-panel"><div class="dn-panel-heading"><div><span class="dn-eyebrow">Extensions</span><h2>Plugins</h2></div><span class="dn-count">${escapeHtml(count)}</span></div><div class="dn-plugin-list">${body}</div><p class="dn-plugin-note">Local plugin candidates copy a refresh command. Direct install stays policy-gated.</p></div>`;
}

function renderPluginCard(plugin) {
  const state = plugin.state ?? (plugin.enabled ? 'enabled' : 'disabled');
  const stateClass = state === 'enabled' ? 'continue' : state === 'available' ? 'review' : 'archive';
  const detail = plugin.detail || [countLabel(plugin.projectedSkillCount, 'skill'), countLabel(plugin.mcpServerCount, 'MCP server'), countLabel(plugin.setupActionCount, 'setup step'), countLabel(plugin.dependencyProjectionCount, 'dependency', 'dependencies')].join(' · ');
  const meta = [plugin.packageName || plugin.id, plugin.version, plugin.sourcePath ? compactPath(plugin.sourcePath) : null].filter(Boolean).join(' · ');
  const pills = pluginPills(plugin);
  const action = renderPluginPolicyAction(plugin);
  return `<article class="dn-plugin-card"><div class="dn-plugin-card-header"><strong>${escapeHtml(plugin.name)}</strong><span class="dn-thread-decision decision-${stateClass}">${escapeHtml(state)}</span></div><span class="dn-card-meta">${escapeHtml(meta)}</span><p>${escapeHtml(detail)}</p>${pills}${action}</article>`;
}

function renderPluginPolicyAction(plugin) {
  if (plugin.state === 'available') {
    if (!plugin.refreshCommand) return `<div class="dn-action-strip compact">${renderDisabledAction('Refresh unavailable', 'No local plugin refresh command is available', signalIcon('plugins'))}</div>`;
    return `<div class="dn-action-strip compact"><button class="dn-action dn-local-action" type="button" data-copy-text="${escapeHtml(plugin.refreshCommand)}" data-copy-done-label="Copied command" data-copy-reset-label="Copy command" title="Copy the plugin refresh command">${clipboardIcon()}<span class="dn-action-label">Copy command</span></button></div>`;
  }
  if (!plugin.enabled) return `<div class="dn-action-strip compact">${renderDisabledAction('Enable unavailable', 'Needs plugin enable policy', signalIcon('plugins'))}</div>`;
  if (plugin.setupActionCount > 0) return `<div class="dn-action-strip compact">${renderDisabledAction('Setup unavailable', 'Needs plugin setup policy', signalIcon('plugins'))}</div>`;
  return '';
}

function pluginPills(plugin) {
  const values = [
    ...(plugin.projectedSkills ?? []).map((skill) => `Skill: ${skill}`),
    ...(plugin.mcpServers ?? []).map((server) => `MCP: ${server}`),
    ...(plugin.setupHints ?? []).map((hint) => `Setup: ${hint}`),
    ...(plugin.dependencyHints ?? []).map((hint) => `Deps: ${hint}`),
  ].slice(0, 6);
  if (!values.length) return '';
  return `<div class="dn-plugin-pills">${values.map((value) => `<span title="${escapeHtml(value)}">${escapeHtml(truncate(value, 44))}</span>`).join('')}</div>`;
}

function renderBlockers(snapshot, selectedId) {
  if (!snapshot.blockers.length) return '<p>No blockers.</p>';
  const nodesById = new Map(snapshot.weave.nodes.map((node) => [node.id, node]));
  return `<div class="dn-blocker-list">${snapshot.blockers.slice(0, 8).map((blocker, index) => { const id = `blocker:${index}`; const node = nodesById.get(id); return `<article class="dn-blocker-card"><button class="dn-blocker ${id === selectedId ? 'selected' : ''}" type="button" data-select-id="${escapeHtml(id)}"><span class="dn-label tone-warn">Blocker</span><strong>${escapeHtml(formatDisplayText(blocker))}</strong></button>${renderActionStrip(node?.actions, 'compact')}</article>`; }).join('')}</div>`;
}

function renderActionStrip(actions, mode = '') {
  const visibleActions = uniqueActions(actions ?? []).slice(0, 3);
  if (!visibleActions.length) return '';
  const className = mode ? `dn-action-strip ${mode}` : 'dn-action-strip';
  return `<div class="${className}">${visibleActions.map((action) => renderProviderAction(action)).join('')}</div>`;
}

function renderDisabledAction(label, title, icon = signalIcon('blockers')) {
  return `<button class="dn-action dn-policy-action" type="button" disabled title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${icon}<span class="dn-action-label">${escapeHtml(label)}</span></button>`;
}

function renderProviderAction(action) {
  const provider = action.provider ?? 'web';
  const kind = action.kind ?? 'provider-link';
  const label = actionChipLabel(action);
  return `<a class="dn-action provider-${escapeAttribute(provider)} kind-${escapeAttribute(kind)}" href="${escapeHtml(action.href)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(externalActionLabel(action))}" aria-label="${escapeHtml(externalActionLabel(action))}">${providerIcon(provider)}<span class="dn-action-label">${escapeHtml(label)}</span>${externalLinkIcon()}</a>`;
}

function actionChipLabel(action) {
  const label = action.label ?? 'Open provider';
  if (action.title && (action.kind === 'issue' || action.kind === 'pull-request')) return `${providerRecordId(action)}: ${action.title}`;
  if (action.kind === 'issue') return label.replace(/^Open issue #/u, '#');
  if (action.kind === 'pull-request') return label.replace(/^Open PR #/u, 'PR #');
  if (label === 'Open repository') return 'Repository';
  return label.replace(/^Open /u, '');
}

function providerRecordId(action) {
  const label = action.label ?? '';
  const pr = /PR #(\d+)/iu.exec(label);
  if (pr) return `PR #${pr[1]}`;
  const issue = /#(\d+)/u.exec(label);
  if (issue) return `#${issue[1]}`;
  return action.kind === 'pull-request' ? 'PR' : 'Issue';
}

function externalActionLabel(action) {
  return `${action.label ?? 'Open provider'} (opens in a new tab)`;
}

function providerIcon(provider) {
  if (provider === 'github') return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 .2a8 8 0 00-2.5 15.6c.4.1.5-.2.5-.4v-1.4c-2.2.5-2.7-.9-2.7-.9-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.3.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-3.9 0-.9.3-1.6.8-2.2-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8A7.4 7.4 0 018 3.7c.7 0 1.4.1 2 .3 1.5-1 2.2-.8 2.2-.8.5 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.2 0 3-1.8 3.7-3.6 3.9.3.3.6.8.6 1.6v2.4c0 .2.1.5.6.4A8 8 0 008 .2z"/></svg>';
  return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.2a6.8 6.8 0 100 13.6A6.8 6.8 0 008 1.2zm0 1.4c.7.8 1.2 1.8 1.4 2.9H6.6C6.8 4.4 7.3 3.4 8 2.6zm-3.2.8c-.4.6-.7 1.3-.9 2.1H2.8a5.5 5.5 0 012-2.1zm8.4 2.1h-1.1c-.2-.8-.5-1.5-.9-2.1a5.5 5.5 0 012 2.1zM2.5 8c0-.4 0-.7.1-1.1h1.1a9 9 0 000 2.2H2.6c-.1-.4-.1-.7-.1-1.1zm2.6 0c0-.4 0-.7.1-1.1h5.6c.1.4.1.7.1 1.1s0 .7-.1 1.1H5.2C5.1 8.7 5.1 8.4 5.1 8zm1.5 2.5h2.8c-.2 1.1-.7 2.1-1.4 2.9-.7-.8-1.2-1.8-1.4-2.9zm4.6 2.1c.4-.6.7-1.3.9-2.1h1.1a5.5 5.5 0 01-2 2.1zm2.2-3.5h-1.1a9 9 0 000-2.2h1.1c.1.4.1.7.1 1.1s0 .7-.1 1.1zM2.8 10.5h1.1c.2.8.5 1.5.9 2.1a5.5 5.5 0 01-2-2.1z"/></svg>';
}

function externalLinkIcon() {
  return '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6 4H3.8A1.8 1.8 0 002 5.8v6.4A1.8 1.8 0 003.8 14h6.4a1.8 1.8 0 001.8-1.8V10M9 2h5v5M8 8l5.5-5.5"/></svg>';
}

function clipboardIcon() {
  return '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6 2.5h4M6.5 1.5h3A1.5 1.5 0 0111 3v.5H5V3a1.5 1.5 0 011.5-1.5zM4 3.5H3A1.5 1.5 0 001.5 5v8A1.5 1.5 0 003 14.5h10A1.5 1.5 0 0014.5 13V5A1.5 1.5 0 0013 3.5h-1"/></svg>';
}

function folderIcon() {
  return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4.5A1.5 1.5 0 013 3h3l1.2 1.5H13A1.5 1.5 0 0114.5 6v6A1.5 1.5 0 0113 13.5H3A1.5 1.5 0 011.5 12z"/></svg>';
}

function chevronDownIcon() {
  return '<svg class="dn-open-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.25 4.75 6 7.25l2.75-2.5"/></svg>';
}

function codeIcon() {
  return '<svg class="dn-app-icon dn-app-icon-vscode" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.9 2.1 10.7.7 5.6 5.6 2.5 3.3 1.1 4 4.2 8l-3.1 4 1.4.7 3.1-2.3 5.1 4.9 3.2-1.4V2.1zM10.6 5v6L7.2 8l3.4-3z"/></svg>';
}

function localAppIcon(app, fallback) {
  const src = `/api/local/app-icon?app=${encodeURIComponent(app)}`;
  return `<span class="dn-app-icon-shell"><img class="dn-app-icon-img" src="${src}" alt="" aria-hidden="true" onload="this.style.opacity='1';this.nextElementSibling.style.display='none'" onerror="this.remove()">${fallback}</span>`;
}

function finderIcon() {
  return '<svg class="dn-app-icon dn-app-icon-finder" viewBox="0 0 16 16" aria-hidden="true"><rect class="finder-left" x="1.8" y="2" width="12.4" height="12" rx="2"/><path class="finder-right" d="M8 2h4.2A2 2 0 0114.2 4v8a2 2 0 01-2 2H8z"/><path d="M8 2v12M4.6 6.1h.01M11.4 6.1h.01M5 10.4c1.8 1 4.2 1 6 0"/></svg>';
}

function terminalIcon() {
  return '<svg class="dn-app-icon dn-app-icon-terminal" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="2.5" width="12.4" height="11" rx="2"/><path d="M4.2 6.2 6.2 8l-2 1.8M8.2 10.1h3.5"/></svg>';
}

function chatIcon() {
  return '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M3 3.5h10A1.5 1.5 0 0114.5 5v4A1.5 1.5 0 0113 10.5H8l-3.5 3v-3H3A1.5 1.5 0 011.5 9V5A1.5 1.5 0 013 3.5z"/><path fill="none" stroke-width="1.8" stroke-linecap="round" d="M5 6.5h6M5 8.5h3"/></svg>';
}

function signalIcon(id) {
  if (id === 'components') return '<svg viewBox="0 0 24 24"><path d="M4 7l8-4 8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4"/><path d="M4 17l8 4 8-4"/></svg>';
  if (id === 'automation') return '<svg viewBox="0 0 24 24"><path d="M6 8a3 3 0 116 0c0 2-3 2-3 5"/><path d="M18 16a3 3 0 11-6 0c0-2 3-2 3-5"/><path d="M9 21v-2"/><path d="M15 3v2"/></svg>';
  if (id === 'eligible-work') return '<svg viewBox="0 0 24 24"><path d="M5 6h14"/><path d="M5 12h10"/><path d="M5 18h6"/><path d="M17 16l2 2 4-5"/></svg>';
  if (id === 'worktrees') return '<svg viewBox="0 0 24 24"><path d="M7 3v7a4 4 0 004 4h6"/><path d="M7 21v-7"/><circle cx="7" cy="4" r="2"/><circle cx="7" cy="20" r="2"/><circle cx="19" cy="14" r="2"/></svg>';
  if (id === 'blockers') return '<svg viewBox="0 0 24 24"><path d="M12 3l10 18H2L12 3z"/><path d="M12 9v5"/><path d="M12 18h.01"/></svg>';
  if (id === 'plugins') return '<svg viewBox="0 0 24 24"><path d="M8 4h8"/><path d="M8 20h8"/><path d="M12 4v5"/><path d="M12 15v5"/><path d="M5 9h14v6H5z"/><path d="M7 12h.01"/><path d="M17 12h.01"/></svg>';
  return '<svg viewBox="0 0 24 24"><path d="M6 3v6a4 4 0 004 4h4"/><path d="M18 21v-6a4 4 0 00-4-4h-4"/><circle cx="6" cy="3" r="2"/><circle cx="18" cy="21" r="2"/></svg>';
}

function historyRows(snapshot) {
  const nodesById = new Map(snapshot.weave.nodes.map((node) => [node.id, node]));
  const lanes = timelineLanes(snapshot);
  const laneByKey = new Map(lanes.map((lane) => [lane.key, lane]));
  const rows = [];
  const addRow = (node, laneKey, title, detail) => {
    const lane = laneByKey.get(laneKey) ?? laneByKey.get('worktrees') ?? laneByKey.get('main') ?? lanes[0];
    if (!node || !lane || rows.some((row) => row.node.id === node.id)) return;
    rows.push({ node, index: rows.length, lane: lane.index, laneLabel: lane.shortLabel, title, detail, timeMs: nodeTimeMs(node) });
  };
  for (const group of groupedBranchNodes(snapshot.weave.nodes)) {
    addRow(group.node, 'main', group.node.label, group.detail);
  }
  for (const worktree of snapshot.worktrees.records) {
    const node = nodesById.get(`worktree:${worktree.id}`);
    const branch = worktree.branchName ?? worktree.id;
    const laneKey = laneByKey.has(worktreeLaneKey(worktree)) ? worktreeLaneKey(worktree) : 'worktrees';
    const dedicatedLane = laneKey !== 'worktrees';
    const scope = [worktree.componentId, worktree.workItemId, worktree.hostId].filter(Boolean).join(' · ');
    const detail = dedicatedLane ? `${compactBranchName(branch)} · ${scope || 'worktree'} · updated ${formatTime(worktree.updatedAt)}` : `${scope || 'worktree'} · updated ${formatTime(worktree.updatedAt)}`;
    addRow(node, laneKey, dedicatedLane ? worktreeRowTitle(worktree) : compactBranchName(branch), detail);
  }
  snapshot.weave.nodes.filter((node) => node.kind === 'run' || node.kind === 'target-cycle').sort(compareNodesNewestFirst).forEach((node) => addRow(node, 'cycles', displayTitle(node, snapshot), node.detail));
  snapshot.weave.nodes.filter((node) => node.kind === 'authority' || node.kind === 'blocker').forEach((node) => addRow(node, 'policy', displayTitle(node, snapshot), displayBody(node, snapshot)));
  if (!rows.length) addRow(nodesById.get('project'), 'main', snapshot.project.name, snapshot.project.root);
  rows.sort(compareTimelineRows);
  rows.slice(0, 36).forEach((row, index) => { row.index = index; });
  return { rows: rows.slice(0, 36), lanes };
}

function timelineLanes(snapshot) {
  const source = snapshot.project.defaultBranch ?? 'main';
  const lanes = [{ key: 'main', label: 'Source checkout', shortLabel: 'Source', detail: `${source} component heads`, index: 0 }];
  const seen = new Set(['main']);
  const activeWorktrees = snapshot.worktrees.records.filter((worktree) => worktree.branchName);
  let representedWorktrees = 0;
  for (const worktree of activeWorktrees) {
    if (lanes.length >= 3) break;
    const key = worktreeLaneKey(worktree);
    if (seen.has(key)) continue;
    seen.add(key);
    representedWorktrees += 1;
    const branch = compactBranchName(worktree.branchName ?? worktree.id);
    lanes.push({ key, label: 'Active branch', shortLabel: 'Branch', detail: branch, index: lanes.length });
  }
  const remainingWorktrees = Math.max(0, activeWorktrees.length - representedWorktrees);
  lanes.push({ key: 'worktrees', label: 'More branches', shortLabel: 'More', detail: remainingWorktrees ? countLabel(remainingWorktrees, 'grouped branch', 'grouped branches') : 'Grouped active branches', index: lanes.length });
  lanes.push({ key: 'cycles', label: 'Automation', shortLabel: 'Automation', detail: 'Runs and target cycles', index: lanes.length });
  lanes.push({ key: 'policy', label: 'Decisions', shortLabel: 'Decisions', detail: 'Approvals and blockers', index: lanes.length });
  return lanes.slice(0, 6).map((lane, index) => ({ ...lane, index }));
}

function groupedBranchNodes(nodes) {
  const groups = new Map();
  nodes.filter((node) => node.kind === 'branch').forEach((node) => {
    const key = node.label || node.id;
    const group = groups.get(key) ?? { node, count: 0, dirty: false };
    group.count += 1;
    group.dirty = group.dirty || node.status === 'dirty';
    if (!groups.has(key) || node.status === 'dirty') group.node = node;
    groups.set(key, group);
  });
  return [...groups.values()].map((group) => ({ node: group.node, detail: group.count > 1 ? `${group.count} component checkouts` : group.node.detail }));
}

function worktreeRowTitle(worktree) {
  if (worktree.workItemId) return worktree.workItemId;
  if (worktree.componentId) return `${worktree.componentId} worktree`;
  return worktree.id;
}

function renderBranchGraph(rows, lanes) {
  const rowHeight = 34;
  const height = Math.max(rowHeight, rows.length * rowHeight);
  const xForLane = (lane) => 22 + lane * 18;
  const railTop = rowHeight / 2;
  const railBottom = Math.max(railTop, height - rowHeight / 2);
  const rails = lanes.map((lane) => `<path d="M ${xForLane(lane.index)} ${railTop} V ${railBottom}" stroke="var(--dn-branch-${lane.index})" stroke-width="3" opacity="0.58" />`).join('');
  const rowGuides = rows.map((row, index) => {
    const y = index * rowHeight + rowHeight / 2;
    const x = xForLane(row.lane);
    return `<path d="M ${x} ${y} H 118" stroke="var(--dn-branch-${row.lane})" stroke-width="2" opacity="0.34" />`;
  }).join('');
  return `<svg class="dn-branch-svg" width="122" height="${height}" viewBox="0 0 122 ${height}" aria-hidden="true" data-row-height="${rowHeight}">${rails}${rowGuides}</svg>`;
}

function compareTimelineRows(left, right) {
  if (left.lane !== right.lane) return left.lane - right.lane;
  const leftPriority = rowPriority(left.node);
  const rightPriority = rowPriority(right.node);
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  return (right.timeMs ?? 0) - (left.timeMs ?? 0);
}

function rowPriority(node) {
  if (node.kind === 'branch') return 0;
  if (node.kind === 'authority') return 1;
  if (node.kind === 'worktree') return 2;
  if (node.kind === 'run' || node.kind === 'target-cycle') return 3;
  if (node.kind === 'blocker') return 4;
  return 5;
}

function compareNodesNewestFirst(left, right) {
  return nodeTimeMs(right) - nodeTimeMs(left);
}

function nodeTimeMs(node) {
  if (!node?.timestamp) return 0;
  const time = new Date(node.timestamp).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function worktreeLaneKey(worktree) {
  return `worktree:${worktree.branchName ?? worktree.id}`;
}

function compactBranchName(value) {
  const text = String(value ?? 'worktree');
  const parts = text.split('/').filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join('/') : text;
}

function defaultSelectedId(snapshot) {
  const urgentFeature = (snapshot.features?.records ?? []).find((candidate) => candidate.status === 'blocked' || candidate.status === 'needs-review');
  if (urgentFeature) return urgentFeature.id;
  const commit = firstGitHistoryCommit(snapshot);
  if (commit) return gitHistorySelectId(commit.repository, commit.commit);
  const feature = (snapshot.features?.records ?? [])[0];
  if (feature) return feature.id;
  const node = snapshot.weave.nodes.find((candidate) => ['blocked', 'failed', 'dirty', 'missing'].includes(candidate.status)) ?? snapshot.weave.nodes.find((candidate) => candidate.kind === 'project') ?? snapshot.weave.nodes[0];
  return node?.id ?? `signal:${snapshot.signals[0]?.id ?? 'components'}`;
}

function findSelectableById(snapshot, id) {
  if (!id) return false;
  if (String(id).startsWith('signal:')) return snapshot.signals.some((signal) => `signal:${signal.id}` === id);
  if (String(id).startsWith('history:')) return Boolean(gitHistoryCommitBySelectId(snapshot, id));
  if (String(id).startsWith('feature:')) return Boolean(featureBySelectId(snapshot, id));
  if (String(id).startsWith('tracked-work:')) return Boolean(trackedWorkBySelectId(snapshot, id));
  if (String(id).startsWith('thread:')) return Boolean(threadBySelectId(snapshot, id));
  return snapshot.weave.nodes.some((node) => node.id === id);
}

function selectedDetail(snapshot, selectedId) {
  const id = findSelectableById(snapshot, selectedId) ? selectedId : defaultSelectedId(snapshot);
  if (String(id).startsWith('signal:')) return signalDetail(snapshot, id);
  if (String(id).startsWith('history:')) return gitHistoryDetail(snapshot, id);
  if (String(id).startsWith('feature:')) return featureDetail(snapshot, id);
  if (String(id).startsWith('tracked-work:')) return trackedWorkDetail(snapshot, id);
  if (String(id).startsWith('thread:')) return threadDetail(snapshot, id);
  const node = snapshot.weave.nodes.find((candidate) => candidate.id === id) ?? snapshot.weave.nodes[0];
  const lane = snapshot.weave.lanes.find((candidate) => candidate.id === node?.laneId);
  const facts = [['Type', displayKind(node)], ['Status', node?.status ?? 'unknown'], ['Lane', displayLane(lane?.label ?? node?.laneId)]];
  if (node?.timestamp) facts.push(['Time', formatTime(node.timestamp)]);
  enrichNodeFacts(snapshot, node, facts);
  const events = relatedEvents(snapshot, node?.id);
  const actions = uniqueActions([...(node?.actions ?? []), ...events.flatMap((event) => event.actions ?? [])]);
  const detail = { title: displayTitle(node, snapshot), body: displayBody(node, snapshot), facts, events, actions };
  return { ...detail, chat: detailChat(node, detail) };
}

function firstGitHistoryCommit(snapshot) {
  const repository = (snapshot.history?.repositories ?? []).find((candidate) => (candidate.commits ?? []).length > 0) ?? null;
  const commit = repository?.commits?.[0] ?? null;
  return repository && commit ? { repository, commit } : null;
}

function gitHistoryCommitBySelectId(snapshot, id) {
  const parts = String(id).split(':');
  const componentId = parts[1];
  const hash = parts.slice(2).join(':');
  const repository = (snapshot.history?.repositories ?? []).find((candidate) => candidate.componentId === componentId) ?? null;
  const commit = repository?.commits?.find((candidate) => candidate.hash === hash) ?? null;
  return repository && commit ? { repository, commit } : null;
}

function gitHistoryDetail(snapshot, id) {
  const match = gitHistoryCommitBySelectId(snapshot, id);
  const commit = match?.commit;
  const repository = match?.repository;
  const refs = (commit?.refs ?? []).filter((ref) => ref.kind !== 'head').map((ref) => ref.name).join(', ') || 'none';
  const annotations = commit && repository ? gitHistoryAnnotations(snapshot, repository, commit) : [];
  const facts = [
    ['Type', 'write event'],
    ['Component', repository?.componentName ?? repository?.componentId ?? 'workspace'],
    ['Commit', commit?.shortHash ?? 'unknown'],
    ['Parents', String(commit?.parents?.length ?? 0)],
    ['Author', commit?.authorName ?? 'unknown'],
    ['Refs', refs],
  ];
  const featureNames = annotations.filter((annotation) => annotation.kind === 'feature').map((annotation) => annotation.title).filter(Boolean);
  const threadCount = annotations.filter((annotation) => annotation.kind === 'thread').reduce((total, annotation) => total + (annotation.threads?.length ?? 0), 0);
  const issueCount = annotations.filter((annotation) => annotation.kind === 'tracked-work').reduce((total, annotation) => total + (annotation.trackedWork?.length ?? 0), 0);
  if (featureNames.length) facts.push(['Feature', featureNames.join(', ')]);
  if (threadCount) facts.push(['Threads', String(threadCount)]);
  if (issueCount) facts.push(['Tracked work', String(issueCount)]);
  if (commit?.committedAt) facts.push(['Time', formatTime(commit.committedAt)]);
  const actions = uniqueActions(annotations.flatMap((annotation) => annotation.actions ?? []));
  return { title: commit?.subject ?? 'Write event', body: commit?.subject ?? 'Git commit recorded as a write event.', facts, events: [], actions, chat: null };
}

function featureBySelectId(snapshot, id) {
  return (snapshot.features?.records ?? []).find((feature) => feature.id === id) ?? null;
}

function featureDetail(snapshot, id) {
  const feature = featureBySelectId(snapshot, id);
  const facts = [
    ['Type', 'feature'],
    ['Status', feature?.statusLabel ?? 'unknown'],
    ['Branch strategy', feature?.branchStrategy ?? 'unknown'],
    ['Feature branch', feature?.featureBranch ?? 'none'],
    ['Review branches', feature?.reviewBranchPattern ?? 'none'],
    ['Target branch', feature?.finalPublicationTarget ?? 'unknown'],
  ];
  if (feature?.updatedAt) facts.push(['Updated', formatTime(feature.updatedAt)]);
  const actions = featureActions(snapshot, feature);
  const detail = { title: feature?.title ?? 'Feature', body: feature?.detail ?? 'Feature branch delivery plan.', facts, events: [], actions };
  return { ...detail, chat: { prompt: featurePrompt(feature ?? detail), title: `Continue ${detail.title}`, targetId: id } };
}

function featureActions(snapshot, feature) {
  if (!feature) return [];
  const branches = featureGitBranches(feature);
  const threads = threadsForGitBranches(snapshot, branches);
  const trackedWork = trackedWorkForGitBranches(snapshot, branches);
  return uniqueActions([...threads.flatMap((thread) => thread.actions ?? []), ...trackedWork.flatMap((item) => item.actions ?? [])]);
}

function featurePrompt(feature) {
  const lines = [
    sentenceLine('Continue feature', feature.title),
    sentenceLine('Status', feature.statusLabel ?? feature.status),
    sentenceLine('Branch strategy', feature.branchStrategy),
    sentenceLine('Feature branch', feature.featureBranch),
    sentenceLine('Review branches', feature.reviewBranchPattern),
    sentenceLine('Target branch', feature.finalPublicationTarget),
    'Inspect the feature state, preserve unrelated changes, and recommend the next safe action.'
  ].filter(Boolean);
  return lines.join('\n');
}

function trackedWorkDetail(snapshot, id) {
  const item = trackedWorkBySelectId(snapshot, id);
  const actions = uniqueActions(item?.actions ?? []);
  const events = relatedEvents(snapshot, `work-item:${item?.componentId}-${item?.id}`);
  const facts = [
    ['Type', 'tracked work'],
    ['Status', item?.status ?? 'unknown'],
    ['Component', item?.componentName ?? item?.componentId ?? 'workspace'],
    ['Provider', item?.provider ?? 'local'],
    ['Tracker', item?.trackerId ?? 'none'],
  ];
  if (item?.updatedAt) facts.push(['Updated', formatTime(item.updatedAt)]);
  const detail = { title: item?.title ?? 'Tracked work', body: item?.detail ?? 'Tracked work needs review.', facts, events, actions: uniqueActions([...actions, ...events.flatMap((event) => event.actions ?? [])]) };
  return { ...detail, chat: { prompt: detailPrompt(detail), title: `Continue ${detail.title}`, targetId: id } };
}

function threadBySelectId(snapshot, id) {
  return (snapshot.threads?.records ?? []).find((thread) => threadSelectId(thread) === id) ?? null;
}

function threadDetail(snapshot, id) {
  const thread = threadBySelectId(snapshot, id);
  const actions = uniqueActions(thread?.actions ?? []);
  const facts = [
    ['Type', 'thread'],
    ['Decision', thread?.decisionLabel ?? 'review'],
    ['Component', thread?.componentId ?? 'workspace'],
    ['Branch', thread?.branchName ?? 'none'],
    ['Work item', thread?.workItemId ?? 'none'],
    ['Host', thread?.hostId ?? 'unknown'],
  ];
  if (thread?.updatedAt) facts.push(['Updated', formatTime(thread.updatedAt)]);
  const detail = { title: thread?.title ?? 'Thread', body: thread?.decisionDetail ?? 'Review this thread.', facts, events: [], actions };
  return { ...detail, chat: { prompt: cockpitThreadPrompt(thread ?? { title: detail.title, decisionLabel: 'Review', decisionDetail: detail.body }), title: `Continue ${detail.title}`, targetId: id, resumeThreadId: thread?.assistantThreadId } };
}

function detailChat(node, detail) {
  if (!node || !isActionableNode(node)) return null;
  return { prompt: detailPrompt(detail), title: `Continue ${detail.title}` };
}

function isActionableNode(node) {
  return ['authority', 'blocker', 'worktree', 'run', 'target-cycle'].includes(node.kind) || ['blocked', 'failed', 'dirty', 'missing', 'stale'].includes(node.status);
}

function displayTitle(node, snapshot) {
  if (!node) return snapshot.project.name;
  if (node.kind === 'run') return statusTitle('Run', node.status);
  if (node.kind === 'target-cycle') return statusTitle('Cycle', node.status);
  if (node.kind === 'authority') return 'Approval';
  return node.label;
}

function displayBody(node, snapshot) {
  if (!node) return snapshot.summary;
  if (node.kind === 'authority') return node.detail || 'A provider action needs approval before automation can continue.';
  if (node.kind === 'blocker') return readableBlocker(node.detail);
  return node.detail ?? snapshot.summary;
}

function displayKind(node) {
  if (!node) return 'unknown';
  if (node.kind === 'target-cycle') return 'target cycle';
  if (node.kind === 'work-item') return 'work item';
  if (node.kind === 'authority') return 'approval';
  return node.kind;
}

function displayLane(value) {
  if (value === 'Authority' || value === 'authority') return 'Approval';
  if (value === 'Cycles' || value === 'cycles') return 'Cycles and runs';
  if (value === 'Branches' || value === 'branches') return 'Source and worktrees';
  return value ?? 'unknown';
}

function statusTitle(prefix, status) {
  const text = String(status ?? '').replace(/[-_]+/g, ' ').trim();
  return text ? `${prefix} ${text}` : prefix;
}

function readableBlocker(value) {
  const text = String(value ?? 'Blocked');
  return formatDisplayText(text.replace(/lease-[0-9a-f]+/giu, 'a stale work record').replace(/codex\/[A-Za-z0-9/_-]+/gu, 'a work branch'));
}

function signalDetail(snapshot, id) {
  const signal = snapshot.signals.find((candidate) => `signal:${candidate.id}` === id) ?? snapshot.signals[0];
  if (id === 'signal:worktrees' && snapshot.threads) return { title: 'Threads', body: 'Open work threads are shown in Action Needed.', facts: [['Open', String(snapshot.threads.totalCount)], ['Needs review', String(snapshot.threads.needsDecisionCount)]], events: [], actions: [], chat: null };
  const events = id === 'signal:blockers' ? snapshot.events.filter((event) => event.id.startsWith('blocker-')).slice(0, 3) : snapshot.events.slice(0, 2);
  return { title: signal?.label ?? 'Signal', body: signal?.detail ?? snapshot.summary, facts: [['Value', signal?.value ?? 'unknown'], ['Tone', signal?.tone ?? 'neutral'], ['Project', snapshot.project.name]], events, actions: uniqueActions(events.flatMap((event) => event.actions ?? [])), chat: null };
}

function enrichNodeFacts(snapshot, node, facts) {
  if (!node) return;
  if (node.kind === 'component') {
    const component = snapshot.components.find((candidate) => `component:${candidate.id}` === node.id);
    if (component) {
      facts.push(['Role', component.role]);
      facts.push(['Tracker', component.defaultTrackerId ?? 'none']);
      facts.push(['Branch', component.git?.branch ?? 'missing']);
      facts.push(['Git', component.git?.dirty ? 'dirty' : 'clean']);
    }
  }
  if (node.kind === 'worktree') {
    const worktree = snapshot.worktrees.records.find((candidate) => `worktree:${candidate.id}` === node.id);
    if (worktree) {
      facts.push(['Component', worktree.componentId ?? 'workspace']);
      facts.push(['Work item', worktree.workItemId ?? 'none']);
      facts.push(['Branch', worktree.branchName ?? 'none']);
      facts.push(['Host', worktree.hostId]);
      facts.push(['Updated', formatTime(worktree.updatedAt)]);
    }
  }
  if (node.kind === 'authority' && snapshot.authority) {
    facts.push(['Components', String(snapshot.authority.components.length)]);
    facts.push(['Blocked actions', String(snapshot.authority.blockedActionCount)]);
    facts.push(['Approvals', String(snapshot.authority.fallbackActionCount)]);
  }
}

function relatedEvents(snapshot, nodeId) {
  return nodeId ? snapshot.events.filter((event) => event.relatedNodeIds.includes(nodeId)) : [];
}

function uniqueActions(actions) {
  const seen = new Set();
  const unique = [];
  for (const action of actions ?? []) {
    if (!action?.href || seen.has(action.href)) continue;
    seen.add(action.href);
    unique.push(action);
  }
  return unique;
}

function toneForStatus(status, kind) {
  if (['ready', 'clean', 'completed', 'configured'].includes(status)) return 'good';
  if (['working', 'active', 'head', 'dispatched'].includes(status) || kind === 'project') return 'active';
  if (['blocked', 'failed', 'dirty', 'missing'].includes(status)) return 'danger';
  if (['stale', 'warning'].includes(status) || kind === 'blocker') return 'warn';
  return 'neutral';
}

function renderWeave(weave) {
  const laneHeight = 76;
  const nodeWidth = 156;
  const nodeHeight = 48;
  const gapX = 192;
  const positions = new Map();
  weave.lanes.forEach((lane, laneIndex) => lane.nodeIds.forEach((nodeId, nodeIndex) => positions.set(nodeId, { x: 132 + nodeIndex * gapX, y: 42 + laneIndex * laneHeight })));
  const width = Math.max(920, 360 + Math.max(0, ...weave.lanes.map((lane) => lane.nodeIds.length)) * gapX);
  const height = 72 + weave.lanes.length * laneHeight;
  const edges = weave.edges.map((edge) => renderEdge(edge, positions, nodeWidth, nodeHeight)).join('');
  const laneLabels = weave.lanes.map((lane, index) => `<text class="dn-lane-label" x="16" y="${54 + index * laneHeight}">${escapeHtml(lane.label)}</text>`).join('');
  const nodes = weave.nodes.map((node) => renderNode(node, positions.get(node.id), nodeWidth, nodeHeight)).join('');
  return `<div class="dn-weave"><svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="DevNexus work weave">${laneLabels}${edges}${nodes}</svg></div>`;
}

function renderEdge(edge, positions, nodeWidth, nodeHeight) {
  const from = positions.get(edge.from);
  const to = positions.get(edge.to);
  if (!from || !to) return '';
  const x1 = from.x + nodeWidth;
  const y1 = from.y + nodeHeight / 2;
  const x2 = to.x;
  const y2 = to.y + nodeHeight / 2;
  const mid = x1 + Math.max(28, (x2 - x1) / 2);
  return `<path class="dn-edge" d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" />`;
}

function renderNode(node, position, width, height) {
  if (!position) return '';
  const label = truncate(node.label, 24);
  const detail = truncate(node.detail, 30);
  return `<g class="dn-node status-${escapeAttribute(node.status)}" transform="translate(${position.x} ${position.y})"><rect width="${width}" height="${height}"></rect><text x="10" y="20">${escapeHtml(label)}</text><text class="dn-node-detail" x="10" y="36">${escapeHtml(detail)}</text></g>`;
}

function renderError(error, themeMode) {
  return `<div class="dn-shell"><header class="dn-header"><div><h1>DevNexus Cockpit</h1><p>Dashboard data could not be loaded.</p></div><div class="dn-header-actions">${renderThemeToggle(themeMode)}</div></header><section class="dn-panel" style="margin-top:18px"><h2>Dashboard unavailable</h2><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p></section></div>`;
}

function normalizeThemeMode(value) {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

function resolveThemeMode(mode) {
  if (mode !== 'system') return mode;
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyThemePreference(mode) {
  const normalized = normalizeThemeMode(mode);
  document.documentElement.dataset.devNexusThemePreference = normalized;
  document.documentElement.dataset.devNexusTheme = resolveThemeMode(normalized);
}

function readStoredThemeMode() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return 'system';
    return normalizeThemeMode(
      window.localStorage.getItem(themeStorageKey) ??
      window.localStorage.getItem(legacyThemeStorageKey),
    );
  } catch {
    return 'system';
  }
}

function writeStoredThemeMode(mode) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(themeStorageKey, normalizeThemeMode(mode));
  } catch {
    // Storage may be disabled for embedded cockpits.
  }
}

function normalizeWorkspaceId(value) {
  return String(value ?? '').trim();
}

function readWorkspaceIdFromLocation() {
  try {
    if (typeof window === 'undefined') return '';
    return new URL(window.location.href).searchParams.get('workspace') ?? '';
  } catch {
    return '';
  }
}

function writeWorkspaceIdToLocation(workspaceId) {
  try {
    if (typeof window === 'undefined' || !window.history?.replaceState) return;
    const url = new URL(window.location.href);
    const id = normalizeWorkspaceId(workspaceId);
    if (id) url.searchParams.set('workspace', id);
    else url.searchParams.delete('workspace');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Embedded cockpits may not expose a mutable location.
  }
}

function truncate(value, limit) {
  const text = String(value ?? '');
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 3))}...` : text;
}

function compactPath(value) {
  const text = String(value ?? '');
  const parts = text.split('/').filter(Boolean);
  return parts.length > 3 ? `.../${parts.slice(-3).join('/')}` : text;
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value ?? '') : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDisplayText(value) {
  const text = String(value ?? '').replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/gu, (match) => formatTime(match));
  if (/No resolved auth profile is available for publication action provider\.pull_request\.open/iu.test(text)) return 'No bot credential is available for opening a pull request. Approval is required.';
  return text.replace(/provider\.pull_request\.open/gu, 'opening a pull request').replace(/coordination\.handoff/gu, 'approval').replace(/advisory worktree lease/giu, 'advisory thread record').replace(/worktree lease/giu, 'thread record').replace(/human approval/giu, 'approval');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function escapeAttribute(value) {
  return String(value ?? '').replace(/[^A-Za-z0-9_-]/g, '-');
}


export const fetchDevNexusCockpit = fetchDevNexusDashboard;
export const fetchDevNexusCockpitShell = fetchDevNexusDashboardShell;
export const fetchDevNexusCockpitSection = fetchDevNexusDashboardSection;
export const fetchDevNexusCockpitHost = fetchDevNexusDashboardHost;
export const fetchDevNexusCockpitProjects = fetchDevNexusDashboardProjects;
export const mountDevNexusCockpit = mountDevNexusDashboard;
