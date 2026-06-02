// @ts-nocheck

const themeStorageKey = 'dev-nexus-cockpit-theme';
const legacyThemeStorageKey = 'dev-nexus-dashboard-theme';

export function renderThemeToggle(themeMode) {
  return `<div class="dn-theme-toggle" role="group" aria-label="Color theme"><button type="button" data-theme-mode="system" aria-pressed="${themeMode === 'system' ? 'true' : 'false'}">System</button><button type="button" data-theme-mode="light" aria-pressed="${themeMode === 'light' ? 'true' : 'false'}">Light</button><button type="button" data-theme-mode="dark" aria-pressed="${themeMode === 'dark' ? 'true' : 'false'}">Dark</button></div>`;
}

export function bindThemeControls(container, onSelect) {
  container.querySelectorAll('[data-theme-mode]').forEach((button) => {
    button.addEventListener('click', () => onSelect(button.getAttribute('data-theme-mode')));
  });
}

export function normalizeThemeMode(value) {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function resolveThemeMode(mode) {
  if (mode !== 'system') return mode;
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyThemePreference(mode) {
  const normalized = normalizeThemeMode(mode);
  document.documentElement.dataset.devNexusThemePreference = normalized;
  document.documentElement.dataset.devNexusTheme = resolveThemeMode(normalized);
}

export function readStoredThemeMode() {
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

export function writeStoredThemeMode(mode) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(themeStorageKey, normalizeThemeMode(mode));
  } catch {
    // Storage may be disabled for embedded cockpits.
  }
}
