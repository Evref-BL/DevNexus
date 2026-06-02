// @ts-nocheck
import { cockpitStyles } from "./nexusCockpitStyles.js";
import {
  chatIcon,
  chevronDownIcon,
  clipboardIcon,
  codeIcon,
  finderIcon,
  folderIcon,
  gearIcon,
  localAppIcon,
  plusIcon,
  renderActionStrip,
  renderDisabledAction,
  renderProviderAction,
  signalIcon,
  terminalIcon,
  trashIcon,
  uniqueActions,
} from "./nexusCockpitActions.js";
import {
  compactBranchName,
  compactPath,
  countLabel,
  displayBody,
  displayTitle,
  escapeAttribute,
  escapeHtml,
  formatDisplayText,
  formatTime,
  toneForStatus,
  truncate,
} from "./nexusCockpitFormat.js";
import {
  historyRows,
} from "./history/nexusCockpitWorkMap.js";
import {
  featureGitBranches,
  gitHistoryCommitBySelectId,
  gitHistoryDetail,
  gitHistoryRows,
  isGitHistorySelection,
  normalizeGitHistoryFilter,
  renderGitHistory,
  threadsForGitBranches,
  trackedWorkForGitBranches,
} from "./history/nexusCockpitEventHistory.js";
import { bindGitHistoryColumnResizers } from "./history/nexusCockpitHistoryColumns.js";
import { bindGitHistoryInteractions } from "./history/nexusCockpitHistoryInteractions.js";
import {
  cockpitTooltipText,
  installCockpitTooltips,
  isCockpitTooltipTargetTruncated,
} from "./nexusCockpitTooltips.js";
import {
  applyThemePreference,
  bindThemeControls,
  normalizeThemeMode,
  readStoredThemeMode,
  renderThemeToggle,
  writeStoredThemeMode,
} from "./nexusCockpitTheme.js";
import {
  dashboardErrorMessage,
  dashboardRenderSignature,
  mergeDashboardSnapshot,
  sectionLoaded,
} from "./nexusCockpitRenderState.js";
import {
  hostIdentity,
  normalizeHostFocus,
  renderHostDashboard,
  renderHostNavButton,
  renderHostOverview,
  renderInlineLoading,
  renderLoading,
  renderPathOpenMenu,
  renderProjectHeaderActions,
  renderProgressivePanel,
} from "./nexusCockpitHostViews.js";

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
  let gitHistoryFilter = '';
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
  const gitHistoryInteractions = bindGitHistoryInteractions(root);
  const onGitHistoryColumnsChange = () => {
    lastRenderSignature = null;
    renderCurrent();
  };
  const systemThemeQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const onSystemThemeChange = () => {
    if (themeMode !== 'system') return;
    applyThemePreference(themeMode);
    renderCurrent();
  };
  if (systemThemeQuery?.addEventListener) systemThemeQuery.addEventListener('change', onSystemThemeChange);
  else if (systemThemeQuery?.addListener) systemThemeQuery.addListener(onSystemThemeChange);
  root.addEventListener('dn-git-history-columns-change', onGitHistoryColumnsChange);
  function setThemeMode(nextThemeMode) {
    if (disposed) return;
    themeMode = normalizeThemeMode(nextThemeMode);
    writeStoredThemeMode(themeMode);
    applyThemePreference(themeMode);
    renderCurrent();
  }
  function setSelectedId(nextSelectedId) {
    if (disposed) return;
    selectedId = nextDashboardSelectedId(selectedId, nextSelectedId);
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
    if (graph && isGitHistorySelection(selectedId)) {
      const visible = new Set(graph.rows.map((row) => row.selectId));
      if (!visible.has(selectedId)) selectedId = null;
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
    gitHistoryFilter = '';
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
    bindSelectionControls(root, setSelectedId, setGitHistoryFilter);
    bindCockpitConfigWindow(root);
    bindHostSignalControls(root, setHostFocus);
    bindGitHistoryColumnResizers(root);
    gitHistoryInteractions.refresh();
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
  return { dispose() { disposed = true; clearInterval(timer); root.removeEventListener('dn-git-history-columns-change', onGitHistoryColumnsChange); gitHistoryInteractions.dispose(); tooltipController.dispose(); if (systemThemeQuery?.removeEventListener) systemThemeQuery.removeEventListener('change', onSystemThemeChange); else if (systemThemeQuery?.removeListener) systemThemeQuery.removeListener(onSystemThemeChange); } };
}

function injectStyles() {
  if (document.getElementById('dev-nexus-cockpit-styles')) return;
  const style = document.createElement('style');
  style.id = 'dev-nexus-cockpit-styles';
  style.textContent = cockpitStyles;
  document.head.appendChild(style);
}

function renderDashboard(snapshot, themeMode, selectedId, host, selectedWorkspaceId = '', gitHistoryFilter = '') {
  const activeSelection = findSelectableById(snapshot, selectedId) ? selectedId : null;
  const loading = snapshot.partial === true;
  const componentsLoaded = sectionLoaded(snapshot, 'components');
  const threadsLoaded = sectionLoaded(snapshot, 'threads');
  const trackedLoaded = sectionLoaded(snapshot, 'tracked-work');
  const gitHistory = loading && !componentsLoaded ? renderProgressivePanel('project-git-history', 'Event history', 'Project Events', 'Loading events, refs, and parent edges.') : renderGitHistory(snapshot, activeSelection, gitHistoryFilter);
  const threadInbox = loading && !threadsLoaded ? renderProgressivePanel('hitl-queue', 'HITL queue', 'Action Needed', 'Loading active threads and local decisions.') : renderThreadInbox(snapshot, activeSelection);
  const trackedWork = loading && !trackedLoaded ? renderProgressivePanel('tracked-work-panel', 'Tracked work', 'Issues and Work Items', 'Loading provider and local work items.') : renderTrackedWork(snapshot, activeSelection);
  const activity = loading && !threadsLoaded ? renderProgressivePanel('activity-panel', 'Activity', 'Recent Signals', 'Loading workspace events.') : `<div class="dn-panel" id="activity-panel"><h2>Activity</h2><div class="dn-events">${snapshot.events.slice(0, 7).map((event) => renderEvent(event, activeSelection)).join('')}</div></div>`;
  const blockers = loading && !trackedLoaded ? renderProgressivePanel('blockers-panel', 'Blockers', 'Blockers', 'Loading approvals and blockers.') : `<div class="dn-panel dn-blockers-panel" id="blockers-panel"><h2>Blockers</h2>${renderBlockers(snapshot, activeSelection)}</div>`;
  return `<div class="dn-shell dn-project-cockpit">
    ${renderProjectTopBar(snapshot, themeMode, selectedWorkspaceId)}
    <div class="dn-cockpit-layout">
      ${renderCockpitLeftRail(snapshot, activeSelection, gitHistoryFilter)}
      <main class="dn-cockpit-main" aria-label="Project state">${gitHistory}</main>
      ${renderCockpitOperationsPanel(snapshot, { threadInbox, trackedWork, activity, blockers })}
    </div>
    ${renderCockpitConfigWindow(snapshot)}
  </div>`;
}

function renderProjectTopBar(snapshot, themeMode, selectedWorkspaceId = '') {
  const metrics = cockpitMetrics(snapshot);
  const status = [
    cockpitTopbarMetric('Decisions', metrics.pendingDecisions, metrics.pendingDecisions > 0 ? 'warn' : 'good'),
    cockpitTopbarMetric('Blockers', metrics.blockers, metrics.blockers > 0 ? 'danger' : 'good'),
    cockpitTopbarMetric('Threads', metrics.activeThreads, metrics.activeThreads > 0 ? 'active' : 'neutral'),
    cockpitTopbarMetric('Tracked', metrics.trackedWork, metrics.trackedWork > 0 ? 'active' : 'neutral'),
  ].join('');
  return `<header class="dn-cockpit-topbar"><div class="dn-topbar-title"><span class="dn-eyebrow">DevNexus cockpit</span><strong title="${escapeHtml(snapshot.project.name)}">${escapeHtml(snapshot.project.name)}</strong><span title="${escapeHtml(snapshot.summary)}">${escapeHtml(snapshot.summary)}</span></div><div class="dn-topbar-status" aria-label="Workspace status">${status}</div><div class="dn-topbar-actions">${renderHostNavButton(selectedWorkspaceId)}<span class="dn-header-pill dn-header-stamp"><span>Generated</span><strong>${escapeHtml(formatTime(snapshot?.generatedAt))}</strong></span>${renderPathOpenMenu('project', 'Project', snapshot?.project?.root ?? '')}${renderThemeToggle(themeMode)}</div></header>`;
}

function cockpitTopbarMetric(label, value, tone) {
  return `<span class="dn-topbar-metric tone-${escapeAttribute(tone)}"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></span>`;
}

function cockpitMetrics(snapshot) {
  const threads = snapshot.threads ?? {};
  const tracked = snapshot.trackedWork ?? {};
  return {
    pendingDecisions: Number(threads.needsDecisionCount ?? 0),
    activeThreads: Number(threads.activeCount ?? threads.records?.length ?? 0),
    blockers: Array.isArray(snapshot.blockers) ? snapshot.blockers.length : 0,
    trackedWork: Number(tracked.readyCount ?? 0) + Number(tracked.blockedCount ?? 0) + Number(tracked.importCandidateCount ?? 0),
    components: Array.isArray(snapshot.components) ? snapshot.components.length : 0,
    plugins: Number(snapshot.plugins?.enabledCount ?? 0),
  };
}

function renderCockpitLeftRail(snapshot, selectedId, gitHistoryFilter = '') {
  const metrics = cockpitMetrics(snapshot);
  return `<aside class="dn-left-rail" id="cockpit-left-rail" aria-label="Cockpit navigation"><section class="dn-rail-section dn-rail-project"><span class="dn-eyebrow">Project</span><strong title="${escapeHtml(snapshot.project.root ?? snapshot.project.name)}">${escapeHtml(snapshot.project.name)}</strong><p title="${escapeHtml(snapshot.summary)}">${escapeHtml(snapshot.summary)}</p></section><nav class="dn-rail-nav" aria-label="Project sections"><a href="#project-git-history"><span>Events</span><strong>${escapeHtml(countLabel(snapshot.history?.totalCommitCount ?? 0, 'event'))}</strong></a><a href="#hitl-queue"><span>Decisions</span><strong>${escapeHtml(String(metrics.pendingDecisions))}</strong></a><a href="#tracked-work-panel"><span>Tracked work</span><strong>${escapeHtml(String(metrics.trackedWork))}</strong></a><a href="#blockers-panel"><span>Blockers</span><strong>${escapeHtml(String(metrics.blockers))}</strong></a></nav>${renderComponentRail(snapshot, selectedId, gitHistoryFilter)}${renderWorkflowRail(snapshot)}${renderWorktreeStateRail(snapshot)}${renderSettingsRail(snapshot)}</aside>`;
}

function renderComponentRail(snapshot, selectedId, gitHistoryFilter = '') {
  const components = snapshot.components ?? [];
  const visible = components.slice(0, 8);
  const more = components.length > visible.length ? `<span class="dn-rail-muted">${escapeHtml(countLabel(components.length - visible.length, 'more component'))}</span>` : '';
  const activeHistoryComponentId = cockpitActiveHistoryComponentId(snapshot, gitHistoryFilter);
  const body = visible.length ? visible.map((component) => {
    const id = `component:${component.id}`;
    const git = component.git;
    const tone = git?.dirty ? 'warn' : component.sourceRootExists ? 'good' : 'danger';
    const branch = git?.branch ?? 'no branch';
    const selected = activeHistoryComponentId ? component.id === activeHistoryComponentId : id === selectedId;
    return `<div class="dn-component-rail-row ${selected ? 'selected' : ''}"><button class="dn-rail-item ${selected ? 'selected' : ''}" type="button" data-select-id="${escapeHtml(id)}" data-git-history-filter="${escapeHtml(`component:${component.id}`)}" data-scroll-target="project-git-history" aria-pressed="${selected ? 'true' : 'false'}"><span class="dn-dot tone-${escapeAttribute(tone)}"></span><span title="${escapeHtml(component.name)}">${escapeHtml(component.name)}</span><em title="${escapeHtml(branch)}">${escapeHtml(compactBranchName(branch))}</em></button><button class="dn-rail-icon-button" type="button" data-cockpit-config-action="edit-component" ${cockpitComponentConfigAttributes(component, snapshot, 'Save changes')} aria-label="${escapeHtml(`Edit ${component.name} configuration`)}" title="${escapeHtml(`Edit ${component.name} configuration`)}">${gearIcon()}</button><button class="dn-rail-icon-button danger" type="button" data-cockpit-config-action="remove-component" ${cockpitComponentConfigAttributes(component, snapshot, 'Remove component')} aria-label="${escapeHtml(`Remove ${component.name}`)}" title="${escapeHtml(`Remove ${component.name}`)}">${trashIcon()}</button></div>`;
  }).join('') : '<p>No components loaded.</p>';
  return `<section class="dn-rail-section" id="components-panel"><div class="dn-rail-heading-row"><span class="dn-rail-heading">Components</span><button class="dn-rail-icon-button primary" type="button" data-cockpit-config-action="add-component" data-config-kind="Project configuration" data-config-title="Add component" data-config-summary="Register a new DevNexus component in this workspace." data-config-action-label="Create component" data-config-name="New component" data-config-role="component" data-config-tracker="not configured" data-config-branch="not configured" data-config-path="${escapeHtml(snapshot.project?.root ?? '')}" aria-label="Add component" title="Add component">${plusIcon()}</button></div><div class="dn-rail-list">${body}${more}</div></section>`;
}

function cockpitActiveHistoryComponentId(snapshot, gitHistoryFilter = '') {
  const normalized = normalizeGitHistoryFilter(gitHistoryFilter);
  const componentMatch = /^component:([^|]+)/u.exec(normalized);
  const requested = componentMatch?.[1] ?? '';
  const repositories = snapshot.history?.repositories ?? [];
  if (requested && repositories.some((repository) => repository.componentId === requested)) return requested;
  return repositories[0]?.componentId ?? '';
}

function cockpitComponentConfigAttributes(component, snapshot, actionLabel) {
  const git = component.git ?? {};
  const state = git.dirty ? 'dirty' : component.sourceRootExists ? 'clean' : 'missing';
  const attrs = {
    'data-config-kind': 'Component configuration',
    'data-config-title': component.name ?? component.id ?? 'Component',
    'data-config-summary': 'Manage component registration, source root, tracker, and branch defaults.',
    'data-config-action-label': actionLabel,
    'data-config-name': component.name ?? component.id ?? 'Component',
    'data-config-role': component.role ?? 'component',
    'data-config-tracker': component.defaultTrackerId ?? 'none',
    'data-config-branch': git.branch ?? 'missing branch',
    'data-config-path': component.sourceRoot ?? component.root ?? snapshot.project?.root ?? '',
    'data-config-state': state,
  };
  return Object.entries(attrs).map(([name, value]) => `${name}="${escapeHtml(value)}"`).join(' ');
}

function renderCockpitConfigWindow(snapshot) {
  return `<section class="dn-config-overlay" data-cockpit-config-window hidden aria-hidden="true"><div class="dn-config-window" role="dialog" aria-modal="false" aria-labelledby="cockpit-config-window-title"><header><div><span class="dn-eyebrow" data-config-window-kind>Component configuration</span><h2 id="cockpit-config-window-title" data-config-window-title>Configure component</h2><p data-config-window-summary>Component configuration edits need a guarded project config action.</p></div><button class="dn-config-close" type="button" data-cockpit-config-close aria-label="Close configuration window">×</button></header><div class="dn-config-window-body"><nav class="dn-config-nav" aria-label="Configuration sections"><button type="button" class="selected">Components</button><button type="button" disabled title="Workflow settings will use this window pattern.">Workflows</button><button type="button" disabled title="Extension settings will use this window pattern.">Extensions</button></nav><section class="dn-config-pane"><dl class="dn-config-facts"><div><dt>Name</dt><dd data-config-window-name>${escapeHtml(snapshot.project?.name ?? 'Component')}</dd></div><div><dt>Role</dt><dd data-config-window-role>component</dd></div><div><dt>Tracker</dt><dd data-config-window-tracker>not configured</dd></div><div><dt>Branch</dt><dd data-config-window-branch>not configured</dd></div><div><dt>Source</dt><dd data-config-window-path title="${escapeHtml(snapshot.project?.root ?? '')}">${escapeHtml(snapshot.project?.root ?? 'not configured')}</dd></div><div><dt>State</dt><dd data-config-window-state>not opened</dd></div></dl><div class="dn-config-editor"><label><span>Component name</span><input type="text" data-config-window-input-name disabled /></label><label><span>Source root</span><input type="text" data-config-window-input-path disabled /></label></div><div class="dn-config-actions"><button class="dn-action" type="button" disabled data-config-window-primary>Save changes</button><button class="dn-action danger" type="button" disabled>Remove component</button><span>Component configuration edits need a guarded project config action.</span></div></section></div></div></section>`;
}

function renderWorkflowRail(snapshot) {
  const workflows = snapshot.gitWorkflows;
  const features = snapshot.features;
  const counters = [
    workflows?.activeRunCount ? `${workflows.activeRunCount} active` : null,
    workflows?.waitingRunCount ? `${workflows.waitingRunCount} waiting` : null,
    workflows?.blockedRunCount ? `${workflows.blockedRunCount} blocked` : null,
    features?.activeCount ? `${features.activeCount} features` : null,
  ].filter(Boolean);
  const runs = (workflows?.runs ?? []).slice(0, 3).map((run) => `<span class="dn-rail-run tone-${escapeAttribute(gitWorkflowRunTone(run))}" title="${escapeHtml(run.branchName ?? run.currentRef ?? run.id)}">${escapeHtml(truncate(run.statusLabel ?? run.status ?? 'workflow', 28))}</span>`).join('');
  return `<section class="dn-rail-section" id="active-features"><span class="dn-rail-heading">Workflows</span><p>${escapeHtml(counters.join(' · ') || 'No workflow runs recorded.')}</p>${runs ? `<div class="dn-rail-runs">${runs}</div>` : ''}</section>`;
}

function renderWorktreeStateRail(snapshot) {
  const rows = safeHistoryRows(snapshot);
  const lanes = rows.lanes ?? [];
  const worktreeCount = snapshot.worktrees?.records?.length ?? 0;
  const laneItems = lanes.slice(0, 5).map((lane) => {
    const count = rows.rows.filter((row) => row.lane === lane.index).length;
    return `<span style="--dn-branch-color:var(--dn-branch-${lane.index});"><strong>${escapeHtml(lane.label)}</strong><em>${escapeHtml(countLabel(count, 'record'))}</em></span>`;
  }).join('');
  return `<section class="dn-rail-section" id="worktree-state-panel"><span class="dn-rail-heading">Worktree state</span><p>${escapeHtml(countLabel(worktreeCount, 'worktree'))} mapped onto event refs.</p><div class="dn-worktree-state-list">${laneItems}</div></section>`;
}

function safeHistoryRows(snapshot) {
  try {
    return historyRows({
      ...snapshot,
      weave: snapshot.weave ?? { nodes: [], lanes: [] },
      worktrees: snapshot.worktrees ?? { records: [] },
    });
  } catch {
    return { rows: [], lanes: [] };
  }
}

function renderSettingsRail(snapshot) {
  const plugins = snapshot.plugins ?? {};
  const count = [countLabel(plugins.enabledCount ?? 0, 'enabled plugin'), plugins.capabilityCount ? countLabel(plugins.capabilityCount, 'capability', 'capabilities') : null].filter(Boolean).join(' · ');
  return `<section class="dn-rail-section" id="plugins-panel"><span class="dn-rail-heading">Settings</span><p>Extensions, local tools, and cockpit options.</p><span class="dn-rail-muted">${escapeHtml(count)}</span></section>`;
}

function renderCockpitOperationsPanel(snapshot, panels) {
  const metrics = cockpitMetrics(snapshot);
  const pendingLabel = `${metrics.pendingDecisions} pending`;
  return `<details class="dn-ops-panel" id="cockpit-ops-panel" data-panel-state="closed" data-ops-pending-count="${escapeHtml(String(metrics.pendingDecisions))}"><summary aria-label="${escapeHtml(`Open operations panel, ${pendingLabel}`)}"><span class="dn-ops-icon">${signalIcon('worktrees')}</span><span class="dn-ops-summary-copy"><strong>Operations</strong><em>${escapeHtml(pendingLabel)}</em></span><span class="dn-ops-badge">${escapeHtml(String(metrics.pendingDecisions))}</span></summary><div class="dn-ops-panel-body">${panels.threadInbox}${panels.trackedWork}${panels.activity}${panels.blockers}</div></details>`;
}

function bindCockpitConfigWindow(container) {
  const overlay = container.querySelector('[data-cockpit-config-window]');
  if (!overlay) return;
  const close = () => {
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
  };
  const setText = (selector, value) => {
    const element = overlay.querySelector(selector);
    if (element) element.textContent = String(value ?? '');
  };
  const setInput = (selector, value) => {
    const element = overlay.querySelector(selector);
    if (element) element.value = String(value ?? '');
  };
  const open = (button) => {
    const action = button.getAttribute('data-cockpit-config-action') ?? '';
    const primaryLabel = button.getAttribute('data-config-action-label') ?? (action === 'remove-component' ? 'Remove component' : 'Save changes');
    setText('[data-config-window-kind]', button.getAttribute('data-config-kind') ?? 'Component configuration');
    setText('[data-config-window-title]', button.getAttribute('data-config-title') ?? 'Configure component');
    setText('[data-config-window-summary]', button.getAttribute('data-config-summary') ?? 'Component configuration edits need a guarded project config action.');
    setText('[data-config-window-name]', button.getAttribute('data-config-name') ?? '');
    setText('[data-config-window-role]', button.getAttribute('data-config-role') ?? '');
    setText('[data-config-window-tracker]', button.getAttribute('data-config-tracker') ?? '');
    setText('[data-config-window-branch]', button.getAttribute('data-config-branch') ?? '');
    setText('[data-config-window-path]', button.getAttribute('data-config-path') ?? '');
    setText('[data-config-window-state]', button.getAttribute('data-config-state') ?? 'pending configuration action');
    setText('[data-config-window-primary]', primaryLabel);
    setInput('[data-config-window-input-name]', button.getAttribute('data-config-name') ?? '');
    setInput('[data-config-window-input-path]', button.getAttribute('data-config-path') ?? '');
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    overlay.querySelector('[data-cockpit-config-close]')?.focus?.();
  };
  container.querySelectorAll('[data-cockpit-config-action]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      open(button);
    });
  });
  overlay.querySelectorAll('[data-cockpit-config-close]').forEach((button) => {
    button.addEventListener('click', close);
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
}

function bindSelectionControls(container, onSelect, onGitHistoryFilter = null) {
  container.addEventListener('change', (event) => {
    const target = eventElementTarget(event.target);
    const historySelect = target?.closest?.('[data-git-history-project-select], [data-git-history-branch-select]');
    if (!historySelect || !container.contains(historySelect)) return;
    onGitHistoryFilter?.(historySelect.value);
  });
  container.addEventListener('click', (event) => {
    const target = eventElementTarget(event.target);
    const historyFilterButton = target?.closest?.('[data-git-history-filter]');
    if (historyFilterButton && container.contains(historyFilterButton)) {
      onGitHistoryFilter?.(historyFilterButton.getAttribute('data-git-history-filter'));
      const targetId = historyFilterButton.getAttribute('data-scroll-target');
      if (targetId) scrollToDashboardSection(targetId);
      return;
    }
    const button = target?.closest?.('[data-select-id]');
    if (!button || !container.contains(button)) return;
    onSelect(button.getAttribute('data-select-id'));
    const targetId = button.getAttribute('data-scroll-target');
    if (targetId) scrollToDashboardSection(targetId);
  });
}

function eventElementTarget(target) {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function nextDashboardSelectedId(currentSelectedId, nextSelectedId) {
  const next = String(nextSelectedId ?? '');
  if (!next) return null;
  return next === String(currentSelectedId ?? '') ? null : next;
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

function renderFeatureOverview(snapshot, selectedId) {
  const features = snapshot.features;
  const records = features?.records ?? [];
  const count = features ? [countLabel(features.activeCount ?? 0, 'active feature'), features.needsAttentionCount ? countLabel(features.needsAttentionCount, 'needs review') : null].filter(Boolean).join(' · ') : '0 active features';
  const note = features?.incomplete && features.detail ? `<p class="dn-panel-note">${escapeHtml(features.detail)}</p>` : '';
  const visible = records.slice(0, 6);
  const more = records.length > visible.length ? `<div class="dn-feature-more">${escapeHtml(countLabel(records.length - visible.length, 'more feature'))}</div>` : '';
  const body = records.length ? `${visible.map((feature) => renderFeatureCard(feature, selectedId)).join('')}${more}` : '<p>No active feature branch delivery configured.</p>';
  return `<div class="dn-panel dn-feature-panel" id="active-features"><div class="dn-panel-heading"><div><span class="dn-eyebrow">Project workflow</span><h2>Active Features</h2></div><span class="dn-count">${escapeHtml(count)}</span></div>${note}${renderGitWorkflowOverview(snapshot.gitWorkflows)}<div class="dn-feature-list">${body}</div></div>`;
}

function renderGitWorkflowOverview(gitWorkflows) {
  if (!gitWorkflows) return '';
  const profiles = gitWorkflows?.profiles ?? [];
  const runs = gitWorkflows?.runs ?? [];
  const activeProfile = profiles.find((profile) => profile.id === gitWorkflows.activeProfileId) ?? profiles[0] ?? null;
  const profileTitle = activeProfile?.name ?? gitWorkflows.activeProfileId ?? 'No profile configured';
  const profileMeta = [
    activeProfile?.branchStrategy,
    activeProfile?.targetBranch ? `target ${activeProfile.targetBranch}` : null,
    activeProfile?.finalPullRequest ? 'pull request' : null,
    activeProfile?.gateCount ? countLabel(activeProfile.gateCount, 'gate') : null,
  ].filter(Boolean);
  const counters = [
    workflowCount(gitWorkflows.activeRunCount ?? 0, 'active'),
    workflowCount(gitWorkflows.waitingRunCount ?? 0, 'waiting'),
    workflowCount(gitWorkflows.blockedRunCount ?? 0, 'blocked'),
  ].filter(Boolean);
  const recentRuns = runs.slice(0, 3).map(renderGitWorkflowRun).join('');
  const runBody = recentRuns || '<p>No workflow runs recorded yet.</p>';
  return `<section class="dn-git-workflows" aria-label="Git workflows"><div class="dn-git-workflows-head"><div><span class="dn-label">Git workflows</span><strong title="${escapeHtml(profileTitle)}">${escapeHtml(profileTitle)}</strong>${profileMeta.length ? `<span class="dn-git-workflow-meta">${profileMeta.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</span>` : ''}</div><span class="dn-git-workflow-counts">${counters.join('')}</span></div><div class="dn-git-workflow-runs">${runBody}</div></section>`;
}

function renderGitWorkflowRun(run) {
  const title = run.branchName ?? run.currentRef ?? run.workItemId ?? run.id;
  const meta = [
    run.statusLabel ?? run.status,
    run.nextOwnerLabel,
    run.targetBranch ? `target ${run.targetBranch}` : null,
    run.evidenceCount ? countLabel(run.evidenceCount, 'evidence item') : null,
  ].filter(Boolean);
  return `<article class="dn-git-workflow-run tone-${escapeAttribute(gitWorkflowRunTone(run))}"><strong title="${escapeHtml(title)}">${escapeHtml(truncate(title, 72))}</strong><span class="dn-git-workflow-run-meta">${meta.map((item) => `<span title="${escapeHtml(item)}">${escapeHtml(item)}</span>`).join('')}</span></article>`;
}

function workflowCount(value, label) {
  return value > 0 ? `<span>${escapeHtml(`${value} ${label}`)}</span>` : '';
}

function gitWorkflowRunTone(run) {
  if (run.status === 'blocked') return 'danger';
  if (run.status === 'ready_for_review' || run.status === 'waiting') return 'warn';
  if (run.terminalOutcome || ['completed', 'merged'].includes(run.status)) return 'good';
  return 'active';
}

function renderFeatureCard(feature, selectedId) {
  const selected = feature.id === selectedId ? ' selected' : '';
  const tone = feature.tone ?? toneForStatus(feature.status, 'feature');
  const meta = [feature.branchStrategy, feature.featureBranch ?? feature.reviewBranchPattern, countLabel(feature.branchCount ?? 0, 'branch'), countLabel(feature.threadCount ?? 0, 'thread')].filter(Boolean);
  return `<button class="dn-feature-card tone-${escapeAttribute(tone)}${selected}" type="button" data-select-id="${escapeHtml(feature.id)}" data-scroll-target="selected-item"><span class="dn-feature-title"><strong title="${escapeHtml(feature.title)}">${escapeHtml(feature.title)}</strong><span class="dn-feature-status">${escapeHtml(feature.statusLabel ?? feature.status)}</span></span><p title="${escapeHtml(formatDisplayText(feature.detail))}">${escapeHtml(formatDisplayText(feature.detail))}</p><span class="dn-feature-meta">${meta.map((item) => `<span title="${escapeHtml(item)}">${escapeHtml(item)}</span>`).join('')}</span></button>`;
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
  return `<div class="dn-panel dn-plugin-panel" id="plugins-panel"><div class="dn-panel-heading"><div><span class="dn-eyebrow">Extensions</span><h2>Plugins</h2></div><span class="dn-count">${escapeHtml(count)}</span></div><div class="dn-plugin-list">${body}</div><p class="dn-plugin-note">Curated plugin catalogue entries copy a refresh command. Direct install stays policy-gated.</p></div>`;
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

function defaultSelectedId(snapshot) {
  const urgentFeature = (snapshot.features?.records ?? []).find((candidate) => candidate.status === 'blocked' || candidate.status === 'needs-review');
  if (urgentFeature) return urgentFeature.id;
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

export const fetchDevNexusCockpit = fetchDevNexusDashboard;
export const fetchDevNexusCockpitShell = fetchDevNexusDashboardShell;
export const fetchDevNexusCockpitSection = fetchDevNexusDashboardSection;
export const fetchDevNexusCockpitHost = fetchDevNexusDashboardHost;
export const fetchDevNexusCockpitProjects = fetchDevNexusDashboardProjects;
export const mountDevNexusCockpit = mountDevNexusDashboard;

export {
  cockpitThreadPrompt,
  dashboardRenderSignature,
  defaultSelectedId,
  nextDashboardSelectedId,
  renderDashboard,
  renderFeatureOverview,
  renderHostDashboard,
  renderHostOverview,
  renderPlugins,
  renderProjectHeaderActions,
  renderSignal,
  renderThreadActions,
  renderThreadInbox,
  renderTrackedWork,
  selectedDetail,
  signalPanelTarget,
};
