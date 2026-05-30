// @ts-nocheck
import {
  compactBranchName,
  countLabel,
  displayBody,
  displayTitle,
  escapeAttribute,
  escapeHtml,
  formatDisplayText,
  formatTime,
  toneForStatus,
} from "../nexusCockpitFormat.js";

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

export {
  historyRows,
  renderBranchGraph,
  renderLaneKey,
  renderWorkHistory,
  timelineLanes,
};
