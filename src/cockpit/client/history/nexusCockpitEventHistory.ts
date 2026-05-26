// @ts-nocheck
import { buildNexusDashboardHistoryLayout } from "../../server/nexusDashboardHistoryLayout.js";
import {
  cloudFetchIcon,
  gearIcon,
  renderActionStrip,
  searchIcon,
  uniqueActions,
} from "../nexusCockpitActions.js";
import {
  countLabel,
  escapeAttribute,
  escapeHtml,
  formatTime,
  toneForStatus,
} from "../nexusCockpitFormat.js";
import {
  gitHistoryColumnStyle,
  gitHistoryColumnVisibilityAttributes,
  readStoredGitHistoryColumnWidths,
  readStoredGitHistoryColumnVisibility,
  renderGitHistoryColumnHeader,
  renderGitHistoryColumnVisibilityMenu,
} from "./nexusCockpitHistoryColumns.js";
import { renderNexusCockpitHistoryGraphSvg } from "./nexusCockpitHistoryGraphSvg.js";

const gitHistoryInlineDetailRows = 9;
const gitHistoryRowHeight = 26;

function isGitHistorySelection(selectedId) {
  return String(selectedId ?? '').startsWith('history:');
}

function renderGitHistory(snapshot, selectedId, filter = '') {
  const repositories = gitHistoryRepositories(snapshot);
  const activeFilter = activeGitHistoryFilter(snapshot, filter);
  const graph = gitHistoryRows(snapshot, activeFilter);
  if (!graph) return `<div class="dn-panel dn-git-panel" id="project-git-history"><div class="dn-panel-heading"><div><span class="dn-eyebrow">Event history</span><h2>Project Events</h2></div><span class="dn-count">0 events</span></div><p>No events loaded.</p></div>`;
  const branchCount = gitHistoryBranchNames(graph.repositories).length;
  const count = `${countLabel(graph.rows.length, 'event')} · ${countLabel(graph.repositories.length, 'repo')} · ${countLabel(branchCount, 'branch', 'branches')}`;
  const cappedRepositories = graph.repositories.filter((repository) => repository.moreAvailable);
  const note = cappedRepositories.length ? `<p class="dn-git-note">Showing the newest loaded events for ${countLabel(cappedRepositories.length, 'repo')}. Branch filters use each loaded history window.</p>` : '';
  return `<div class="dn-panel dn-git-panel" id="project-git-history"><div class="dn-panel-heading"><div><span class="dn-eyebrow">Event history</span><h2>Project Events</h2><p class="dn-history-note">Git commits are events; parent edges define the graph topology.</p></div><span class="dn-count">${escapeHtml(count)}</span></div>${renderGitHistoryTopBar(snapshot, repositories, activeFilter)}${renderGitHistoryBoard(snapshot, graph, selectedId)}${note}</div>`;
}

function renderGitHistoryBoard(snapshot, graph, selectedId) {
  const widths = readStoredGitHistoryColumnWidths();
  const visibility = readStoredGitHistoryColumnVisibility();
  const visualGraph = gitHistoryVisualGraph(graph, selectedId);
  const detailOpen = isGitHistorySelection(selectedId) && graph.rows.some((row) => row.selectId === selectedId);
  return `<div class="dn-git-board" data-git-board data-git-detail-open="${detailOpen ? 'true' : 'false'}" ${gitHistoryColumnVisibilityAttributes(visibility)} style="${escapeHtml(gitHistoryColumnStyle(widths, visibility))}"><div class="dn-git-graph-column">${renderGitHistoryColumnHeader('graph', 'Graph', widths, visibility)}${renderGitHistorySvg(visualGraph)}${renderGitHistoryGraphDetailEdge(visualGraph)}</div><div class="dn-git-table"><div class="dn-git-column-row">${renderGitHistoryColumnHeader('description', 'Description', widths, visibility)}${renderGitHistoryColumnHeader('date', 'Date', widths, visibility)}${renderGitHistoryColumnHeader('author', 'Author', widths, visibility)}${renderGitHistoryColumnHeader('commit', 'Commit', widths, visibility)}</div><div class="dn-git-rows">${renderGitHistoryRows(snapshot, graph, selectedId)}</div></div></div>`;
}

function normalizeGitHistoryFilter(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text === 'all') return 'all';
  const scopedBranch = /^component:([^|]+)\|branch:(.+)$/u.exec(text);
  if (scopedBranch?.[1]?.trim() && scopedBranch?.[2]?.trim()) {
    return `component:${scopedBranch[1].trim()}|branch:${scopedBranch[2].trim()}`;
  }
  if (text.startsWith('component:') && text.slice('component:'.length).trim()) return `component:${text.slice('component:'.length).trim()}`;
  if (text.startsWith('branch:') && text.slice('branch:'.length).trim()) return `branch:${text.slice('branch:'.length).trim()}`;
  if (text.startsWith('feature:') && text.slice('feature:'.length).trim()) return `feature:${text.slice('feature:'.length).trim()}`;
  return '';
}

function activeGitHistoryFilter(snapshot, filter = '') {
  const normalized = normalizeGitHistoryFilter(filter);
  if (normalized === 'all' || normalized.startsWith('branch:') || normalized.startsWith('feature:')) return normalized;
  const repositories = gitHistoryRepositories(snapshot);
  const fallback = repositories[0]?.componentId ? `component:${repositories[0].componentId}` : '';
  if (!normalized) return fallback;
  const componentId = gitHistoryFilterProjectId(normalized);
  if (!componentId) return fallback;
  return repositories.some((repository) => repository.componentId === componentId) ? normalized : fallback;
}

function gitHistoryFilterProjectId(filter) {
  const text = normalizeGitHistoryFilter(filter);
  if (!text.startsWith('component:')) return '';
  const branchIndex = text.indexOf('|branch:');
  return branchIndex >= 0 ? text.slice('component:'.length, branchIndex) : text.slice('component:'.length);
}

function gitHistoryFilterBranchName(filter) {
  const text = normalizeGitHistoryFilter(filter);
  if (text.startsWith('branch:')) return text.slice('branch:'.length);
  const branchIndex = text.indexOf('|branch:');
  return branchIndex >= 0 ? text.slice(branchIndex + '|branch:'.length) : '';
}

function gitHistoryScopedFilter(projectId, branchName = '') {
  const component = String(projectId ?? '').trim();
  const branch = String(branchName ?? '').trim();
  if (!component) return branch ? `branch:${branch}` : '';
  return branch ? `component:${component}|branch:${branch}` : `component:${component}`;
}

function renderGitHistoryTopBar(snapshot, repositories, activeFilter) {
  const activeProjectId = gitHistoryFilterProjectId(activeFilter) || repositories[0]?.componentId || '';
  const activeRepository = repositories.find((repository) => repository.componentId === activeProjectId) ?? repositories[0] ?? null;
  return `<div class="dn-git-topbar" aria-label="Event history controls">${renderGitHistoryProjectControl(repositories, activeProjectId)}${renderGitHistoryBranchControl(activeRepository, activeFilter)}${renderGitHistorySearchControls()}${renderGitHistoryToolbarActions(snapshot, activeRepository)}</div>`;
}

function renderGitHistoryProjectControl(repositories, activeProjectId) {
  if (!repositories.length) return '';
  const options = repositories.map((repository) => {
    const value = `component:${repository.componentId}`;
    const selected = repository.componentId === activeProjectId ? ' selected' : '';
    const title = [repository.componentName, repository.repositoryPath].filter(Boolean).join(' · ');
    return `<option value="${escapeHtml(value)}"${selected} title="${escapeHtml(title)}">${escapeHtml(repository.componentName ?? repository.componentId)}</option>`;
  }).join('');
  return `<label class="dn-git-context-control"><span>Project</span><select class="dn-git-context-select" data-git-history-project-select aria-label="Project">${options}</select></label>`;
}

function renderGitHistoryBranchControl(repository, activeFilter) {
  if (!repository) return '';
  const activeBranch = gitHistoryFilterBranchName(activeFilter);
  const projectId = repository.componentId ?? '';
  const branches = gitHistoryBranchNames(repository);
  const allValue = gitHistoryScopedFilter(projectId);
  const options = [`<option value="${escapeHtml(allValue)}"${activeBranch ? '' : ' selected'}>Show all branches</option>`]
    .concat(branches.map((branch) => {
      const value = gitHistoryScopedFilter(projectId, branch);
      const selected = branch === activeBranch ? ' selected' : '';
      return `<option value="${escapeHtml(value)}"${selected} title="${escapeHtml(branch)}">${escapeHtml(branch)}</option>`;
    }))
    .join('');
  return `<label class="dn-git-context-control dn-git-branch-control"><span>Branches</span><select class="dn-git-context-select" data-git-history-branch-select aria-label="Branches">${options}</select></label>`;
}

function renderGitHistorySearchControls() {
  return `<div class="dn-git-search" data-git-history-search role="search" aria-label="Search event history"><span class="dn-git-search-icon">${searchIcon()}</span><input class="dn-git-search-input" type="search" data-git-history-search-input placeholder="Search events" autocomplete="off" spellcheck="false" /><span class="dn-git-search-status" data-git-history-search-status aria-live="polite"></span><button class="dn-git-search-button" type="button" data-git-history-search-action="previous" aria-label="Previous event match" title="Previous match">Prev</button><button class="dn-git-search-button" type="button" data-git-history-search-action="next" aria-label="Next match">Next</button><button class="dn-git-search-button" type="button" data-git-history-search-action="clear" aria-label="Clear event search" title="Clear search">Clear</button></div>`;
}

function renderGitHistoryToolbarActions(snapshot, repository) {
  const repoLabel = repository?.componentName ?? repository?.componentId ?? 'project';
  return `<div class="dn-git-toolbar-actions"><button class="dn-git-icon-button" type="button" disabled data-git-history-fetch-remotes title="${escapeHtml(`Fetch remotes for ${repoLabel} needs a local Git action policy`)}" aria-label="${escapeHtml(`Fetch remotes for ${repoLabel}`)}">${cloudFetchIcon()}</button>${renderGitHistoryColumnVisibilityMenu(undefined, gearIcon())}</div>`;
}

function gitHistoryBranchNames(repositoryOrRepositories) {
  const repositories = Array.isArray(repositoryOrRepositories)
    ? repositoryOrRepositories
    : [repositoryOrRepositories].filter(Boolean);
  const names = [];
  const seen = new Set();
  const remember = (name) => {
    const normalized = normalizeGitBranchName(name);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    names.push(normalized);
  };
  for (const repository of repositories) {
    for (const commit of repository.commits ?? []) {
      for (const ref of commit.refs ?? []) {
        if (ref.kind === 'branch' || ref.kind === 'remote') remember(ref.name);
      }
    }
    for (const branch of repository.branchNames ?? []) remember(branch);
  }
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
  const projectId = gitHistoryFilterProjectId(filter);
  const branchName = gitHistoryFilterBranchName(filter);
  if (projectId && repository.componentId !== projectId) return [];
  if (projectId && !branchName) return commits;
  if (filter === 'all') return commits;
  const headHashes = gitHistoryFilterHeadHashes(snapshot, repository, filter);
  if (!headHashes.size) return [];
  const reachable = collectGitAncestorHashes(commits, headHashes);
  return commits.filter((commit) => reachable.has(commit.hash));
}

function gitHistoryFilterHeadHashes(snapshot, repository, filter) {
  const headHashes = new Set();
  const branchName = gitHistoryFilterBranchName(filter);
  if (branchName) {
    for (const hash of branchHeadHashes(repository, branchName)) headHashes.add(hash);
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

function gitHistoryRows(snapshot, filter = '') {
  const repositories = gitHistoryRepositories(snapshot);
  if (!repositories.length) return null;
  const normalizedFilter = activeGitHistoryFilter(snapshot, filter);
  const commitRows = repositories.flatMap((repository, repositoryIndex) =>
    filteredGitHistoryCommits(snapshot, repository, normalizedFilter).map((commit, commitIndex) => ({
      repository,
      repositoryIndex,
      commit,
      commitIndex,
      eventId: gitHistorySelectId(repository, commit),
    })),
  ).sort(gitHistoryCommitRowCompare);
  const commitsByEventId = new Map(commitRows.map((row) => [row.eventId, row]));
  const layout = buildNexusDashboardHistoryLayout({
    events: commitRows.map((row) => ({
      id: row.eventId,
      parentIds: (row.commit.parents ?? []).map((parent) => gitHistoryEventId(row.repository, parent)),
      subject: row.commit.subject ?? row.commit.shortHash ?? row.commit.hash,
    })),
  });
  const rows = layout.nodes.map((node) => {
    const row = commitsByEventId.get(node.eventId);
    if (!row) return null;
    return {
      repository: row.repository,
      commit: row.commit,
      lane: node.lane,
      colorLane: node.colorIndex,
      index: node.row,
      selectId: row.eventId,
      tooltip: gitHistoryNodeTooltip(snapshot, row.repository, row.commit),
    };
  }).filter(Boolean);
  const paths = layout.segments.map((segment) => ({
    trackId: segment.trackId,
    colorLane: segment.colorIndex,
    fromLane: segment.fromLane,
    toLane: segment.toLane,
    fromIndex: segment.fromRow,
    toIndex: segment.toRow,
    points: segment.points.map((point) => ({ lane: point.lane, index: point.row })),
  }));
  const visibleRepositoryIds = new Set(commitRows.map((row) => row.repository.componentId));
  const visibleRepositories = repositories.filter((repository) => visibleRepositoryIds.has(repository.componentId));
  const graphRepositories = visibleRepositories.length ? visibleRepositories : repositories;
  return { repository: graphRepositories[0], repositories: graphRepositories, rows, paths, maxLane: layout.maxRouteLane, layout };
}

function gitHistoryRepositories(snapshot) {
  return (snapshot.history?.repositories ?? []).filter((candidate) => (candidate.commits ?? []).length > 0);
}

function gitHistoryCommitRowCompare(left, right) {
  const leftTime = gitHistoryCommitTime(left.commit);
  const rightTime = gitHistoryCommitTime(right.commit);
  if (leftTime !== rightTime) return rightTime - leftTime;
  if (left.repositoryIndex !== right.repositoryIndex) return left.repositoryIndex - right.repositoryIndex;
  return left.commitIndex - right.commitIndex;
}

function gitHistoryCommitTime(commit) {
  const value = Date.parse(commit.committedAt ?? '');
  return Number.isFinite(value) ? value : 0;
}

function gitHistoryEventId(repository, hash) {
  return `history:${repository.componentId}:${hash}`;
}

function renderGitHistorySvg(graph) {
  return renderNexusCockpitHistoryGraphSvg(graph, {
    ariaLabel: 'Git history graph',
    rowHeight: gitHistoryRowHeight,
  });
}

function renderGitHistoryGraphDetailEdge(graph) {
  const selectedRow = (graph.rows ?? []).find((row) => row.selected);
  if (!selectedRow) return '';
  const selectedIndex = Number(selectedRow.index);
  if (!Number.isFinite(selectedIndex)) return '';
  const top = 30 + (selectedIndex + 1) * gitHistoryRowHeight;
  const height = gitHistoryInlineDetailRows * gitHistoryRowHeight;
  return `<span class="dn-git-graph-detail-edge" aria-hidden="true" style="top:${top}px;height:${height}px;"></span>`;
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
    rows: graph.rows.map((row) => ({
      ...row,
      index: shiftIndex(row.index),
      selected: row.selectId === selectedId,
    })),
    paths: (graph.paths ?? []).map((path) => ({
      ...path,
      fromIndex: path.fromIndex === undefined ? path.fromIndex : shiftIndex(path.fromIndex),
      toIndex: path.toIndex === undefined ? path.toIndex : shiftIndex(path.toIndex),
      points: gitHistoryVisualPathPoints(path.points ?? [], pivot, shiftIndex),
    })),
  };
}

function gitHistoryVisualPathPoints(points, pivot, shiftIndex) {
  const visualPoints = [];
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const previous = points[index - 1];
    const shiftedPoint = { ...point, index: shiftIndex(point.index) };
    if (previous && gitHistoryPathSegmentCrossesDetailGap(previous, point, pivot)) {
      const previousLane = Number(previous.lane);
      const pointLane = Number(point.lane);
      const shiftedIndex = Number(shiftedPoint.index);
      if (Number.isFinite(previousLane) && Number.isFinite(pointLane) && Number.isFinite(shiftedIndex) && previousLane !== pointLane) {
        if (previousLane < pointLane) {
          appendGitHistoryVisualPoint(visualPoints, { ...point, index: point.index });
          appendGitHistoryVisualPoint(visualPoints, shiftedPoint);
        } else {
          appendGitHistoryVisualPoint(visualPoints, {
            ...previous,
            index: Math.max(Number(previous.index), shiftedIndex - 1),
          });
          appendGitHistoryVisualPoint(visualPoints, shiftedPoint);
        }
        continue;
      }
    }
    appendGitHistoryVisualPoint(visualPoints, shiftedPoint);
  }
  return visualPoints;
}

function gitHistoryPathSegmentCrossesDetailGap(previous, point, pivot) {
  const previousIndex = Number(previous.index);
  const pointIndex = Number(point.index);
  return Number.isFinite(previousIndex) && Number.isFinite(pointIndex) && previousIndex <= pivot && pointIndex > pivot;
}

function appendGitHistoryVisualPoint(points, point) {
  const last = points[points.length - 1];
  if (last && last.lane === point.lane && last.index === point.index) return;
  points.push(point);
}

function renderGitHistoryRow(snapshot, row, selectedId) {
  const selected = row.selectId === selectedId ? ' selected' : '';
  const merge = (row.commit.parents ?? []).length > 1 ? ' merge' : '';
  const refs = (row.commit.refs ?? []).filter((ref) => ref.kind !== 'head').slice(0, 3);
  const branchName = refs.find((ref) => ref.kind === 'branch' || ref.kind === 'remote')?.name ?? refs[0]?.name ?? '';
  const componentLabel = row.repository.componentName ?? row.repository.componentId ?? 'Workspace';
  const refChips = refs.map((ref) => `<span class="dn-git-ref" style="--dn-branch-color:var(--dn-branch-${(row.colorLane ?? row.lane) % 12});" title="${escapeHtml(ref.name)}">${escapeHtml(ref.name)}</span>`).join('');
  const badges = gitHistoryAnnotations(snapshot, row.repository, row.commit).slice(0, 3).map((annotation) => `<span class="dn-git-badge tone-${escapeAttribute(annotation.tone)}" title="${escapeHtml(annotation.title ?? annotation.label)}">${escapeHtml(annotation.label)}</span>`).join('');
  const date = formatTime(row.commit.committedAt);
  const author = row.commit.authorName ?? '';
  const authorTitle = [row.commit.authorName, row.commit.authorEmail].filter(Boolean).join(' · ');
  const searchText = [
    componentLabel,
    row.repository.repositoryPath,
    ...refs.map((ref) => ref.name),
    row.commit.subject,
    date,
    row.commit.committedAt,
    author,
    row.commit.authorEmail,
    row.commit.shortHash,
    row.commit.hash,
  ].filter(Boolean).join(' ');
  const copyCommit = row.commit.hash ?? row.commit.shortHash ?? '';
  const copyBranch = branchName ? `<button class="dn-git-row-menu-item" type="button" data-copy-text="${escapeHtml(branchName)}">Copy branch</button>` : '';
  const utilityMenu = `<details class="dn-git-row-menu"><summary class="dn-git-row-menu-trigger" aria-label="Event actions">...</summary><div class="dn-git-row-menu-options"><button class="dn-git-row-menu-item" type="button" data-select-id="${escapeHtml(row.selectId)}">Toggle details</button><button class="dn-git-row-menu-item" type="button" data-copy-text="${escapeHtml(copyCommit)}">Copy commit</button>${copyBranch}</div></details>`;
  return `<div class="dn-git-history-row-wrap"><button class="dn-git-history-row${selected}${merge}" type="button" data-select-id="${escapeHtml(row.selectId)}" data-history-search-text="${escapeAttribute(searchText)}"><span class="dn-git-subject" data-git-cell="description"><span class="dn-git-refs">${refChips}</span><span class="dn-git-description" title="${escapeHtml(row.commit.subject)}">${escapeHtml(row.commit.subject)}</span><span class="dn-git-badges">${badges}</span></span><span class="dn-git-date" data-git-cell="date" title="${escapeHtml(row.commit.committedAt)}">${escapeHtml(date)}</span><span class="dn-git-author" data-git-cell="author" title="${escapeHtml(authorTitle || author)}">${escapeHtml(author)}</span><span class="dn-git-sha" data-git-cell="commit" title="${escapeHtml(row.commit.hash ?? row.commit.shortHash)}">${escapeHtml(row.commit.shortHash)}</span></button>${utilityMenu}</div>`;
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
  const refs = gitCommitBranchNames(commit);
  const markers = annotations.length
    ? `<div class="dn-history-marker-list">${annotations.map((annotation) => `<span class="dn-history-marker tone-${escapeAttribute(annotation.tone)}" title="${escapeHtml(annotation.title ?? annotation.label)}">${escapeHtml(annotation.label)}</span>`).join('')}</div>`
    : '<p>No attached decision, review, or tracked-work markers.</p>';
  const actionStrip = actions.length ? renderActionStrip(actions, 'compact') : '<p>No direct action for this event.</p>';
  const facts = [
    ['Component', row.repository.componentName ?? row.repository.componentId ?? 'Workspace'],
    ['Commit', commit.shortHash ?? commit.hash],
    ['Author', [commit.authorName, commit.authorEmail].filter(Boolean).join(' · ') || 'unknown'],
    ['Time', formatTime(commit.committedAt) || commit.committedAt || 'unknown'],
    ['Parents', parents.length ? countLabel(parents.length, 'parent') : 'none'],
    ['Children', children.length ? countLabel(children.length, 'child', 'children') : 'none'],
  ];
  const refChips = refs.length
    ? `<div class="dn-git-detail-chip-list">${refs.slice(0, 6).map((ref) => `<span class="dn-git-detail-chip" title="${escapeHtml(ref)}">${escapeHtml(ref)}</span>`).join('')}</div>`
    : '<p class="dn-git-detail-muted">No branch refs loaded.</p>';
  return `<section class="dn-git-detail-panel dn-git-inline-detail" data-history-detail-for="${escapeHtml(row.selectId)}"><article class="dn-git-detail-main"><span class="dn-label">Event details</span><strong title="${escapeHtml(commit.subject)}">${escapeHtml(commit.subject)}</strong><p>${escapeHtml([row.repository.repositoryPath, commit.hash].filter(Boolean).join(' · ') || 'Git commit event')}</p><dl class="dn-git-detail-grid">${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd title="${escapeHtml(value)}">${escapeHtml(value)}</dd></div>`).join('')}</dl><div class="dn-git-detail-relations">${renderGitHistoryRelationChips('Parents', parents)}${renderGitHistoryRelationChips('Children', children)}</div></article><aside class="dn-git-detail-side"><span class="dn-label">Branches</span>${refChips}<span class="dn-label">Attached details</span>${markers}${renderGitHistoryAnnotationDetails(annotations)}<span class="dn-label">Actions</span>${actionStrip}</aside></section>`;
}

function renderGitHistoryRelationChips(label, commits) {
  if (!commits.length) return `<div><span class="dn-label">${escapeHtml(label)}</span><p class="dn-git-detail-muted">none</p></div>`;
  return `<div><span class="dn-label">${escapeHtml(label)}</span><div class="dn-git-detail-chip-list">${commits.slice(0, 4).map((commit) => `<span class="dn-git-detail-chip" title="${escapeHtml(gitHistoryEventLabel(commit))}">${escapeHtml(commit.shortHash ?? commit.hash)}</span>`).join('')}</div></div>`;
}

function renderGitHistoryAnnotationDetails(annotations) {
  if (!annotations.length) return '';
  return `<div class="dn-git-attached-list">${annotations.map((annotation) => {
    const items = gitHistoryAnnotationItems(annotation).slice(0, 4);
    const itemList = items.length
      ? items.map((item) => `<li title="${escapeHtml(item)}">${escapeHtml(item)}</li>`).join('')
      : `<li>${escapeHtml(annotation.title ?? annotation.label)}</li>`;
    return `<section class="dn-git-attached-group"><span class="dn-history-marker tone-${escapeAttribute(annotation.tone)}">${escapeHtml(annotation.label)}</span><ul>${itemList}</ul></section>`;
  }).join('')}</div>`;
}

function gitHistoryAnnotationItems(annotation) {
  if (annotation.kind === 'feature') return [annotation.title].filter(Boolean);
  if (annotation.kind === 'thread') return (annotation.threads ?? []).map((thread) => thread.title ?? thread.branchName ?? thread.id).filter(Boolean);
  if (annotation.kind === 'tracked-work') return (annotation.trackedWork ?? []).map((item) => item.title ?? item.logicalItemId ?? item.id).filter(Boolean);
  return [annotation.title ?? annotation.label].filter(Boolean);
}

function gitHistoryParentCommits(repository, commit) {
  const byHash = new Map((repository.commits ?? []).map((candidate) => [candidate.hash, candidate]));
  return (commit.parents ?? []).map((parent) => byHash.get(parent)).filter(Boolean);
}

function gitHistoryChildCommits(repository, commit) {
  return (repository.commits ?? []).filter((candidate) => (candidate.parents ?? []).includes(commit.hash));
}

function gitHistoryEventLabel(commit) {
  return [commit.shortHash, commit.subject].filter(Boolean).join(' ');
}

function gitHistoryNodeTooltip(snapshot, repository, commit) {
  const component = repository.componentName ?? repository.componentId ?? 'Workspace';
  const refs = gitCommitBranchNames(commit).slice(0, 2).join(', ');
  const markers = gitHistoryAnnotations(snapshot, repository, commit).map((annotation) => annotation.label).join(', ');
  const authored = [commit.authorName, formatTime(commit.committedAt)].filter(Boolean).join(' · ');
  const source = commit.shortHash ?? commit.hash ?? '';
  return [
    commit.subject,
    [component, source].filter(Boolean).join(' · '),
    refs ? `Refs: ${refs}` : '',
    authored,
    markers ? `Details: ${markers}` : '',
  ].filter(Boolean).join('\n');
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
    ['Type', 'event'],
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
  return { title: commit?.subject ?? 'Event', body: commit?.subject ?? 'Git commit recorded as a history event.', facts, events: [], actions, chat: null };
}

export function renderNexusCockpitEventHistoryClientSource() {
  return [
    `const gitHistoryInlineDetailRows = 9;`,
    `const gitHistoryRowHeight = 26;`,
    isGitHistorySelection,
    renderGitHistory,
    renderGitHistoryBoard,
    normalizeGitHistoryFilter,
    activeGitHistoryFilter,
    gitHistoryFilterProjectId,
    gitHistoryFilterBranchName,
    gitHistoryScopedFilter,
    renderGitHistoryTopBar,
    renderGitHistoryProjectControl,
    renderGitHistoryBranchControl,
    renderGitHistorySearchControls,
    renderGitHistoryToolbarActions,
    gitHistoryBranchNames,
    featureGitBranches,
    normalizeGitBranchName,
    filteredGitHistoryCommits,
    gitHistoryFilterHeadHashes,
    branchHeadHashes,
    collectGitAncestorHashes,
    gitHistoryRows,
    gitHistoryRepositories,
    gitHistoryCommitRowCompare,
    gitHistoryCommitTime,
    gitHistoryEventId,
    renderGitHistorySvg,
    renderGitHistoryGraphDetailEdge,
    renderGitHistoryRows,
    gitHistoryVisualGraph,
    gitHistoryVisualPathPoints,
    gitHistoryPathSegmentCrossesDetailGap,
    appendGitHistoryVisualPoint,
    renderGitHistoryRow,
    renderGitHistoryDetailPanel,
    renderGitHistoryRelationChips,
    renderGitHistoryAnnotationDetails,
    gitHistoryAnnotationItems,
    gitHistoryParentCommits,
    gitHistoryChildCommits,
    gitHistoryEventLabel,
    gitHistoryNodeTooltip,
    gitHistoryAnnotations,
    gitCommitBranchNames,
    featuresForGitBranches,
    threadsForGitBranches,
    trackedWorkForGitBranches,
    trackedWorkMentionsBranch,
    normalizeBranchSearchToken,
    branchSetsIntersect,
    gitHistorySelectId,
    firstGitHistoryCommit,
    gitHistoryCommitBySelectId,
    gitHistoryDetail,
  ]
    .map((part) => typeof part === 'string' ? part : standaloneNexusCockpitEventHistorySource(part))
    .join('\n\n');
}

function standaloneNexusCockpitEventHistorySource(fn) {
  return fn.toString().replace(/\b__vite_ssr_import_\d+__\.([A-Za-z_$][\w$]*)\b/gu, '$1');
}

export {
  featureGitBranches,
  firstGitHistoryCommit,
  gitHistoryCommitBySelectId,
  gitHistoryDetail,
  gitHistoryRows,
  gitHistorySelectId,
  isGitHistorySelection,
  normalizeGitHistoryFilter,
  renderGitHistory,
  threadsForGitBranches,
  trackedWorkForGitBranches,
};
