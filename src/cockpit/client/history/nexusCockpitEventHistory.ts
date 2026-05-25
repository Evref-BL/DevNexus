// @ts-nocheck
import { buildNexusDashboardHistoryLayout } from "../../../dashboard/nexusDashboardHistoryLayout.js";
import { renderActionStrip, uniqueActions } from "../nexusCockpitActions.js";
import {
  compactBranchName,
  countLabel,
  escapeAttribute,
  escapeHtml,
  formatTime,
  toneForStatus,
} from "../nexusCockpitFormat.js";
import {
  gitHistoryColumnStyle,
  readStoredGitHistoryColumnWidths,
  renderGitHistoryColumnHeader,
} from "./nexusCockpitHistoryColumns.js";
import { renderNexusCockpitHistoryGraphSvg } from "./nexusCockpitHistoryGraphSvg.js";

const gitHistoryInlineDetailRows = 7;

function isGitHistorySelection(selectedId) {
  return String(selectedId ?? '').startsWith('history:');
}

function renderGitHistory(snapshot, selectedId, filter = 'all') {
  const activeFilter = normalizeGitHistoryFilter(filter);
  const repositories = gitHistoryRepositories(snapshot);
  const graph = gitHistoryRows(snapshot, activeFilter);
  if (!graph) return `<div class="dn-panel dn-git-panel" id="project-git-history"><div class="dn-panel-heading"><div><span class="dn-eyebrow">Event history</span><h2>Project Events</h2></div><span class="dn-count">0 events</span></div><p>No events loaded.</p></div>`;
  const branchCount = gitHistoryBranchNames(graph.repositories).length;
  const count = `${countLabel(graph.rows.length, 'event')} · ${countLabel(graph.repositories.length, 'repo')} · ${countLabel(branchCount, 'branch', 'branches')}`;
  const cappedRepositories = graph.repositories.filter((repository) => repository.moreAvailable);
  const note = cappedRepositories.length ? `<p class="dn-git-note">Showing the newest loaded events for ${countLabel(cappedRepositories.length, 'repo')}. Branch filters use each loaded history window.</p>` : '';
  return `<div class="dn-panel dn-git-panel" id="project-git-history"><div class="dn-panel-heading"><div><span class="dn-eyebrow">Event history</span><h2>Project Events</h2><p class="dn-history-note">Git commits are events; parent edges define the graph topology.</p></div><span class="dn-count">${escapeHtml(count)}</span></div>${renderGitHistoryFilters(snapshot, repositories, activeFilter)}${renderGitHistoryBoard(snapshot, graph, selectedId)}${note}</div>`;
}

function renderGitHistoryBoard(snapshot, graph, selectedId) {
  const widths = readStoredGitHistoryColumnWidths();
  const visualGraph = gitHistoryVisualGraph(graph, selectedId);
  return `<div class="dn-git-board" data-git-board style="${escapeHtml(gitHistoryColumnStyle(widths))}"><div class="dn-git-graph-column">${renderGitHistoryColumnHeader('graph', 'Graph', widths)}${renderGitHistorySvg(visualGraph)}</div><div class="dn-git-table"><div class="dn-git-column-row">${renderGitHistoryColumnHeader('description', 'Description', widths)}${renderGitHistoryColumnHeader('date', 'Date', widths)}${renderGitHistoryColumnHeader('author', 'Author', widths)}${renderGitHistoryColumnHeader('commit', 'Commit', widths)}</div><div class="dn-git-rows">${renderGitHistoryRows(snapshot, graph, selectedId)}</div></div></div>`;
}

function normalizeGitHistoryFilter(value) {
  const text = String(value ?? '').trim();
  if (!text || text === 'all') return 'all';
  if (text.startsWith('component:') && text.slice('component:'.length).trim()) return `component:${text.slice('component:'.length).trim()}`;
  if (text.startsWith('branch:') && text.slice('branch:'.length).trim()) return `branch:${text.slice('branch:'.length).trim()}`;
  if (text.startsWith('feature:') && text.slice('feature:'.length).trim()) return `feature:${text.slice('feature:'.length).trim()}`;
  return 'all';
}

function renderGitHistoryFilters(snapshot, repositories, activeFilter) {
  const filters = gitHistoryFilters(snapshot, repositories);
  if (filters.length <= 1) return '';
  return `<div class="dn-git-filters" aria-label="Event history filters">${filters.map((filter) => `<button class="dn-git-filter" type="button" data-git-history-filter="${escapeHtml(filter.id)}" aria-pressed="${filter.id === activeFilter ? 'true' : 'false'}" title="${escapeHtml(filter.title ?? filter.label)}">${escapeHtml(filter.label)}</button>`).join('')}</div>`;
}

function gitHistoryFilters(snapshot, repositories) {
  const filters = [{ id: 'all', label: 'All events', title: 'Show all loaded project events' }];
  const seen = new Set(filters.map((filter) => filter.id));
  const push = (id, label, title = label) => {
    const normalized = normalizeGitHistoryFilter(id);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    filters.push({ id: normalized, label, title });
  };
  const loadedRepositories = repositories ?? [];
  if (loadedRepositories.length > 1) {
    for (const repository of loadedRepositories) {
      push(`component:${repository.componentId}`, repository.componentName ?? repository.componentId, `Show ${repository.componentName ?? repository.componentId} events`);
    }
  }
  const defaultBranches = [...new Set(loadedRepositories.map((repository) => repository.defaultBranch).filter(Boolean))];
  for (const branch of defaultBranches) push(`branch:${branch}`, branch, `Show ${branch} and its loaded ancestors`);
  for (const feature of snapshot.features?.records ?? []) {
    const branches = featureGitBranches(feature);
    if (!branches.length) continue;
    push(`feature:${feature.id}`, feature.title, `Show events reachable from ${feature.title}`);
  }
  const branchNames = gitHistoryBranchNames(loadedRepositories);
  for (const branch of branchNames) push(`branch:${branch}`, compactBranchName(branch), `Show ${branch} and its loaded ancestors`);
  return filters.slice(0, 18);
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
  if (filter.startsWith('component:')) return repository.componentId === filter.slice('component:'.length) ? commits : [];
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
  const repositories = gitHistoryRepositories(snapshot);
  if (!repositories.length) return null;
  const normalizedFilter = normalizeGitHistoryFilter(filter);
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
    rows: graph.rows.map((row) => ({
      ...row,
      index: shiftIndex(row.index),
      selected: row.selectId === selectedId,
    })),
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
  const componentLabel = row.repository.componentName ?? row.repository.componentId ?? 'Workspace';
  const componentChip = `<span class="dn-git-component" title="${escapeHtml([componentLabel, row.repository.repositoryPath].filter(Boolean).join(' · '))}">${escapeHtml(componentLabel)}</span>`;
  const refChips = refs.map((ref) => `<span class="dn-git-ref" style="--dn-branch-color:var(--dn-branch-${(row.colorLane ?? row.lane) % 7});" title="${escapeHtml(ref.name)}">${escapeHtml(ref.name)}</span>`).join('');
  const badges = gitHistoryAnnotations(snapshot, row.repository, row.commit).slice(0, 3).map((annotation) => `<span class="dn-git-badge tone-${escapeAttribute(annotation.tone)}" title="${escapeHtml(annotation.title ?? annotation.label)}">${escapeHtml(annotation.label)}</span>`).join('');
  const date = formatTime(row.commit.committedAt);
  const author = row.commit.authorName ?? '';
  const authorTitle = [row.commit.authorName, row.commit.authorEmail].filter(Boolean).join(' · ');
  return `<button class="dn-git-history-row${selected}" type="button" data-select-id="${escapeHtml(row.selectId)}"><span class="dn-git-subject">${componentChip}<span class="dn-git-refs">${refChips}</span><strong title="${escapeHtml(row.commit.subject)}">${escapeHtml(row.commit.subject)}</strong><span class="dn-git-badges">${badges}</span></span><span class="dn-git-date" title="${escapeHtml(row.commit.committedAt)}">${escapeHtml(date)}</span><span class="dn-git-author" title="${escapeHtml(authorTitle || author)}">${escapeHtml(author)}</span><span class="dn-git-sha" title="${escapeHtml(row.commit.hash ?? row.commit.shortHash)}">${escapeHtml(row.commit.shortHash)}</span></button>`;
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
  const actionStrip = actions.length ? renderActionStrip(actions, 'compact') : '<p>No direct action for this event.</p>';
  const facts = [
    ['Component', row.repository.componentName ?? row.repository.componentId ?? 'Workspace'],
    ['Parents', parents.length ? parents.map(gitHistoryEventLabel).join(', ') : 'none'],
    ['Children', children.length ? children.map(gitHistoryEventLabel).join(', ') : 'none'],
    ['Source', commit.shortHash ?? commit.hash],
  ];
  return `<section class="dn-git-detail-panel dn-git-inline-detail" data-history-detail-for="${escapeHtml(row.selectId)}"><article class="dn-git-detail-main"><span class="dn-label">Selected event</span><strong title="${escapeHtml(commit.subject)}">${escapeHtml(commit.subject)}</strong><p>${escapeHtml([commit.authorName, formatTime(commit.committedAt)].filter(Boolean).join(' · ') || 'Git commit event')}</p><dl class="dn-git-detail-grid">${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd title="${escapeHtml(value)}">${escapeHtml(value)}</dd></div>`).join('')}</dl></article><aside class="dn-git-detail-side"><span class="dn-label">Attached details</span>${markers}<span class="dn-label">Actions</span>${actionStrip}</aside></section>`;
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
    `const gitHistoryInlineDetailRows = 7;`,
    isGitHistorySelection,
    renderGitHistory,
    renderGitHistoryBoard,
    normalizeGitHistoryFilter,
    renderGitHistoryFilters,
    gitHistoryFilters,
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
    renderGitHistoryRows,
    gitHistoryVisualGraph,
    renderGitHistoryRow,
    renderGitHistoryDetailPanel,
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
