// @ts-nocheck

export function mergeDashboardSnapshot(snapshot, patch) {
  if (!snapshot) return patch ?? null;
  if (!patch) return snapshot;
  const loaded = new Set([...(snapshot.loadedSections ?? []), ...(patch.loadedSections ?? [])]);
  return { ...snapshot, ...patch, loadedSections: [...loaded], partial: snapshot.partial === true && patch.partial !== false ? true : patch.partial };
}

export function dashboardRenderSignature(value) {
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

export function dashboardErrorMessage(error) {
  return error instanceof Error ? error.message : String(error ?? '');
}

export function sectionLoaded(snapshot, section) {
  return snapshot?.partial !== true || (snapshot.loadedSections ?? []).includes(section);
}
