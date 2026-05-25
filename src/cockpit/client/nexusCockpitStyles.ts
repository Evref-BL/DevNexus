export const cockpitStyles = `
:root { color-scheme: dark; --dn-bg: #0b100e; --dn-surface: #121915; --dn-surface-raised: #17211c; --dn-surface-muted: rgba(12, 18, 15, 0.76); --dn-weave-bg: rgba(8, 12, 10, 0.58); --dn-text: #eef5ec; --dn-strong: #f3f8f0; --dn-muted: #aebbae; --dn-label: #87998d; --dn-border: rgba(180, 210, 188, 0.18); --dn-border-muted: rgba(180, 210, 188, 0.12); --dn-border-strong: rgba(180, 210, 188, 0.28); --dn-pill-text: #dfe8df; --dn-control-active: #203127; --dn-control-hover: rgba(180, 210, 188, 0.1); --dn-good: #67d29e; --dn-active: #79a7ff; --dn-warn: #e4b15f; --dn-warn-soft: #f2d49b; --dn-danger: #ff8b78; --dn-neutral: #b3c0b5; color: var(--dn-text); background: var(--dn-bg); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-synthesis: none; }
:root[data-dev-nexus-theme='dark'] { color-scheme: dark; --dn-bg: #0b100e; --dn-surface: #121915; --dn-surface-raised: #17211c; --dn-surface-muted: rgba(12, 18, 15, 0.76); --dn-weave-bg: rgba(8, 12, 10, 0.58); --dn-text: #eef5ec; --dn-strong: #f3f8f0; --dn-muted: #aebbae; --dn-label: #87998d; --dn-border: rgba(180, 210, 188, 0.18); --dn-border-muted: rgba(180, 210, 188, 0.12); --dn-border-strong: rgba(180, 210, 188, 0.28); --dn-pill-text: #dfe8df; --dn-control-active: #203127; --dn-control-hover: rgba(180, 210, 188, 0.1); --dn-good: #67d29e; --dn-active: #79a7ff; --dn-warn: #e4b15f; --dn-warn-soft: #f2d49b; --dn-danger: #ff8b78; --dn-neutral: #b3c0b5; }
:root[data-dev-nexus-theme='light'] { color-scheme: light; --dn-bg: #f5f8f6; --dn-surface: #ffffff; --dn-surface-raised: #edf3ef; --dn-surface-muted: rgba(235, 242, 238, 0.86); --dn-weave-bg: rgba(236, 244, 241, 0.9); --dn-text: #16231b; --dn-strong: #0f1813; --dn-muted: #55685d; --dn-label: #687d71; --dn-border: rgba(42, 73, 55, 0.18); --dn-border-muted: rgba(42, 73, 55, 0.12); --dn-border-strong: rgba(42, 73, 55, 0.28); --dn-pill-text: #27372e; --dn-control-active: #dcebe3; --dn-control-hover: rgba(42, 73, 55, 0.08); --dn-good: #167f53; --dn-active: #265dcc; --dn-warn: #d89400; --dn-warn-soft: #8c5b00; --dn-danger: #bc3b2f; --dn-neutral: #526459; }
:root { --dn-grid-line: rgba(180, 210, 188, 0.055); --dn-shadow: 0 22px 60px rgba(0, 0, 0, 0.28); --dn-branch-0: #ff4d4f; --dn-branch-1: #ff9f0a; --dn-branch-2: #f6d64a; --dn-branch-3: #35dd54; --dn-branch-4: #17d6cf; --dn-branch-5: #1aa7ff; --dn-branch-6: #b68cff; --dn-branch-faint: rgba(238, 245, 236, 0.16); }
:root[data-dev-nexus-theme='light'] { --dn-grid-line: rgba(31, 115, 93, 0.085); --dn-shadow: 0 18px 40px rgba(34, 50, 42, 0.1); --dn-branch-0: #d22f2f; --dn-branch-1: #b66100; --dn-branch-2: #9d7600; --dn-branch-3: #168e35; --dn-branch-4: #008a84; --dn-branch-5: #0076c9; --dn-branch-6: #6a3fd6; --dn-branch-faint: rgba(22, 35, 27, 0.14); }
@media (prefers-color-scheme: light) { :root:not([data-dev-nexus-theme]) { color-scheme: light; --dn-bg: #f5f8f6; --dn-surface: #ffffff; --dn-surface-raised: #edf3ef; --dn-surface-muted: rgba(235, 242, 238, 0.86); --dn-weave-bg: rgba(236, 244, 241, 0.9); --dn-text: #16231b; --dn-strong: #0f1813; --dn-muted: #55685d; --dn-label: #687d71; --dn-border: rgba(42, 73, 55, 0.18); --dn-border-muted: rgba(42, 73, 55, 0.12); --dn-border-strong: rgba(42, 73, 55, 0.28); --dn-pill-text: #27372e; --dn-control-active: #dcebe3; --dn-control-hover: rgba(42, 73, 55, 0.08); --dn-good: #167f53; --dn-active: #265dcc; --dn-warn: #d89400; --dn-warn-soft: #8c5b00; --dn-danger: #bc3b2f; --dn-neutral: #526459; } }
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; color: var(--dn-text); background: var(--dn-bg); }
@keyframes dn-spin { to { transform: rotate(360deg); } }
@keyframes dn-shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
@keyframes dn-history-search-flash { 0% { background: color-mix(in srgb, var(--dn-warn) 24%, transparent); } 100% { background: transparent; } }
button, input, select { font: inherit; }
.dn-shell { width: min(1520px, 100%); margin: 0 auto; padding: 24px; }
.dn-header { position: relative; z-index: 2; display: grid; grid-template-columns: minmax(260px, 1fr) minmax(0, 760px); gap: 24px; align-items: end; min-height: 190px; overflow: visible; padding: 32px; border: 1px solid var(--dn-border); border-radius: 8px; background: var(--dn-surface); box-shadow: var(--dn-shadow); }
.dn-header::before { content: ''; position: absolute; inset: 0 0 auto; height: 5px; border-radius: 8px 8px 0 0; background: linear-gradient(90deg, var(--dn-branch-0), var(--dn-branch-1), var(--dn-branch-2), var(--dn-branch-3), var(--dn-branch-4), var(--dn-branch-5), var(--dn-branch-6)); }
.dn-eyebrow { display: block; margin: 0 0 12px; color: var(--dn-good); font-size: 0.76rem; font-weight: 850; text-transform: uppercase; }
.dn-header h1 { margin: 0 0 10px; font-size: clamp(2.1rem, 3vw, 3.25rem); line-height: 1.02; letter-spacing: 0; }
.dn-header p { margin: 0; color: var(--dn-muted); }
.dn-header-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; justify-content: flex-end; min-width: 0; }
.dn-host-header-actions, .dn-project-header-actions { width: min(100%, 760px); }
.dn-header-strip { display: flex; flex: 1 1 520px; flex-wrap: wrap; align-items: stretch; justify-content: flex-end; gap: 8px; min-width: 0; }
.dn-header-pill { display: grid; gap: 3px; min-height: 46px; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--dn-active) 22%, var(--dn-border)); border-radius: 8px; background: var(--dn-surface-raised); }
.dn-header-pill span { color: var(--dn-label); font-size: 0.68rem; font-weight: 850; text-transform: uppercase; }
.dn-header-pill strong { min-width: 0; color: var(--dn-strong); font-size: 0.86rem; line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dn-host-identity { min-width: 108px; }
.dn-header-stamp { min-width: 136px; }
.dn-header-path-menu { flex: 0 1 auto; width: fit-content; min-width: min(100%, 320px); max-width: min(100%, 520px); }
.dn-header-path-control { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; max-width: 100%; min-height: 52px; padding: 8px 8px 8px 10px; border: 1px solid color-mix(in srgb, var(--dn-active) 22%, var(--dn-border)); border-radius: 8px; color: var(--dn-strong); background: var(--dn-surface-raised); cursor: pointer; }
.dn-header-path-control:hover { border-color: color-mix(in srgb, var(--dn-border-strong) 46%, var(--dn-active) 54%); background: var(--dn-control-hover); }
.dn-header-path-copy { display: grid; gap: 3px; min-width: 0; }
.dn-header-path-label { color: var(--dn-label); font-size: 0.68rem; font-weight: 850; line-height: 1; text-transform: uppercase; }
.dn-header-path-value { min-width: 0; color: var(--dn-strong); font-size: 0.86rem; line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dn-meta { display: grid; gap: 6px; min-width: 250px; padding: 12px; border: 1px solid var(--dn-border); border-radius: 8px; background: var(--dn-surface); }
.dn-meta span, .dn-label, .dn-table th { color: var(--dn-label); font-size: 0.76rem; font-weight: 800; text-transform: uppercase; }
.dn-meta strong { color: var(--dn-strong); overflow-wrap: anywhere; }
.dn-action { --dn-action-accent: var(--dn-active); display: inline-flex; align-items: center; justify-content: center; gap: 7px; max-width: 100%; min-height: 34px; padding: 7px 10px; border: 1px solid color-mix(in srgb, var(--dn-action-accent) 42%, var(--dn-border)); border-radius: 8px; color: var(--dn-strong); background: var(--dn-surface-raised); font-size: 0.78rem; font-weight: 850; text-decoration: none; transition: transform 120ms ease, border-color 120ms ease, background 120ms ease; cursor: pointer; }
.dn-action:hover { transform: translateY(-1px); border-color: var(--dn-action-accent); background: var(--dn-control-hover); }
.dn-action.kind-issue { --dn-action-accent: var(--dn-branch-2); }
.dn-action.kind-pull-request { --dn-action-accent: var(--dn-branch-1); }
.dn-action.provider-web { --dn-action-accent: var(--dn-branch-5); }
.dn-local-action { color: var(--dn-strong); border-color: color-mix(in srgb, var(--dn-warn) 44%, var(--dn-border)); background: var(--dn-surface-raised); }
.dn-start-action { color: var(--dn-strong); border-color: color-mix(in srgb, var(--dn-active) 52%, var(--dn-border)); background: var(--dn-surface-raised); }
.dn-local-action[data-copied='true'] { border-color: var(--dn-good); background: var(--dn-control-hover); }
.dn-action:disabled { opacity: 0.72; cursor: wait; transform: none; }
.dn-action:disabled:hover { transform: none; }
.dn-policy-action:disabled { --dn-action-accent: var(--dn-neutral); opacity: 0.78; cursor: not-allowed; background: var(--dn-surface-raised); }
.dn-action svg { flex: 0 0 auto; width: 14px; height: 14px; fill: currentColor; stroke: currentColor; }
.dn-action-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dn-action-strip { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.dn-action-strip.compact { margin-top: 0; }
.dn-action-strip.compact .dn-action { min-height: 28px; padding: 5px 8px; font-size: 0.72rem; }
.dn-open-menu { position: relative; justify-self: end; }
.dn-open-menu summary { list-style: none; }
.dn-open-menu summary::-webkit-details-marker { display: none; }
.dn-open-trigger { --dn-action-accent: var(--dn-active); justify-content: space-between; min-width: 94px; min-height: 38px; gap: 7px; padding: 5px 5px 5px 10px; border-color: color-mix(in srgb, var(--dn-border-strong) 78%, var(--dn-active) 22%); background: var(--dn-surface-raised); box-shadow: none; }
.dn-open-trigger:hover { transform: none; border-color: color-mix(in srgb, var(--dn-border-strong) 46%, var(--dn-active) 54%); background: var(--dn-control-hover); }
.dn-open-menu[open] .dn-open-trigger, .dn-open-menu[open] .dn-header-path-control { border-color: color-mix(in srgb, var(--dn-border-strong) 34%, var(--dn-active) 66%); background: var(--dn-surface-raised); }
.dn-open-chevron-shell { display: inline-grid; place-items: center; width: 28px; height: 28px; margin-left: 2px; border-left: 1px solid color-mix(in srgb, var(--dn-border-strong) 70%, transparent); border-radius: 6px; color: var(--dn-muted); background: color-mix(in srgb, var(--dn-surface-raised) 84%, transparent); }
.dn-open-chevron { opacity: 0.92; transition: transform 140ms ease, color 140ms ease; }
.dn-open-menu[open] .dn-open-chevron { transform: rotate(180deg); color: var(--dn-strong); }
.dn-open-options { position: absolute; right: 0; z-index: 10; display: grid; gap: 4px; min-width: 164px; margin-top: 6px; padding: 7px; border: 1px solid var(--dn-border); border-radius: 8px; background: color-mix(in srgb, var(--dn-surface) 96%, var(--dn-bg) 4%); box-shadow: var(--dn-shadow); }
.dn-open-option { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 8px; border: 0; border-radius: 6px; color: var(--dn-strong); background: transparent; text-align: left; cursor: pointer; }
.dn-open-option:hover { background: var(--dn-control-hover); }
.dn-open-option:disabled { opacity: 0.7; cursor: wait; }
.dn-tooltip { position: fixed; z-index: 1000; max-width: min(420px, calc(100vw - 24px)); padding: 7px 9px; border: 1px solid var(--dn-border-strong); border-radius: 7px; color: var(--dn-strong); background: color-mix(in srgb, var(--dn-surface) 96%, var(--dn-bg) 4%); box-shadow: var(--dn-shadow); font-size: 0.78rem; font-weight: 760; line-height: 1.25; overflow-wrap: anywhere; pointer-events: none; white-space: pre-line; opacity: 0; transform: translate(-50%, -4px); transition: opacity 90ms ease, transform 90ms ease; }
.dn-tooltip.visible { opacity: 1; transform: translate(-50%, -8px); }
.dn-history-popover { --dn-history-popover-accent: var(--dn-good); --dn-history-popover-connector-width: 16px; --dn-history-popover-connector-y: 50%; --dn-history-popover-border-width: 2px; --dn-history-popover-radius: 8px; position: fixed; z-index: 1001; display: grid; gap: 7px; width: min(520px, calc(100vw - 24px)); max-width: calc(100vw - 24px); overflow: visible; padding: 0 0 9px; border: var(--dn-history-popover-border-width) solid var(--dn-history-popover-accent); border-radius: var(--dn-history-popover-radius); color: var(--dn-strong); background: color-mix(in srgb, var(--dn-surface) 94%, #000 6%); box-shadow: 0 18px 48px rgba(0, 0, 0, 0.38); pointer-events: none; opacity: 0; transform: translateY(4px); transition: opacity 90ms ease, transform 90ms ease; }
.dn-history-popover::before { content: ''; position: absolute; z-index: -1; top: var(--dn-history-popover-connector-y); width: var(--dn-history-popover-connector-width); height: var(--dn-history-popover-border-width); border-radius: 999px; background: var(--dn-history-popover-accent); box-shadow: 0 0 10px color-mix(in srgb, var(--dn-history-popover-accent) 34%, transparent); transform: translateY(-50%); }
.dn-history-popover[data-edge-side='left']::before { left: calc(-1 * var(--dn-history-popover-connector-width)); }
.dn-history-popover[data-edge-side='right']::before { right: calc(-1 * var(--dn-history-popover-connector-width)); }
.dn-history-popover.visible { opacity: 1; transform: translateY(0); }
.dn-history-popover-heading { padding: 7px 12px; border-top-left-radius: calc(var(--dn-history-popover-radius) - var(--dn-history-popover-border-width)); border-top-right-radius: calc(var(--dn-history-popover-radius) - var(--dn-history-popover-border-width)); border-bottom: 1px solid color-mix(in srgb, var(--dn-history-popover-accent) 38%, var(--dn-border-strong)); color: var(--dn-strong); background: color-mix(in srgb, var(--dn-surface-raised) 72%, transparent); font-size: 0.9rem; font-weight: 900; text-align: center; }
.dn-history-popover-title { padding: 0 12px; color: var(--dn-strong); font-size: 0.84rem; font-weight: 850; line-height: 1.22; }
.dn-history-popover-meta { display: flex; flex-wrap: wrap; gap: 5px 9px; padding: 0 12px; color: var(--dn-muted); font-size: 0.7rem; font-weight: 780; }
.dn-history-popover-section { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 7px; align-items: start; padding: 7px 12px 0; border-top: 1px solid color-mix(in srgb, var(--dn-border-strong) 56%, transparent); }
.dn-history-popover-label { color: var(--dn-label); font-size: 0.66rem; font-weight: 900; text-transform: uppercase; }
.dn-history-popover-chips { display: flex; flex-wrap: wrap; gap: 5px; min-width: 0; }
.dn-history-popover-chip { max-width: 100%; overflow: hidden; padding: 2px 6px; border: 1px solid var(--dn-border-strong); border-radius: 6px; color: var(--dn-pill-text); background: var(--dn-surface-raised); font-size: 0.72rem; font-weight: 820; text-overflow: ellipsis; white-space: nowrap; }
.dn-history-popover-chip.soft { color: var(--dn-active); border-color: color-mix(in srgb, var(--dn-active) 52%, var(--dn-border)); }
.dn-history-popover-muted { color: var(--dn-muted); font-size: 0.76rem; font-weight: 780; }
.dn-open-option svg, .dn-open-trigger svg, .dn-header-path-control svg { flex: 0 0 auto; width: 16px; height: 16px; }
.dn-open-option svg:not(.dn-app-icon), .dn-open-trigger svg, .dn-header-path-control svg:not(.dn-app-icon) { stroke: currentColor; fill: none; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.dn-app-icon { overflow: visible; } .dn-app-icon path, .dn-app-icon rect { stroke: none; } .dn-app-icon-vscode path { fill: #2f80ed; } .dn-app-icon-finder .finder-left { fill: #5bb6ff; } .dn-app-icon-finder .finder-right { fill: #dbeeff; } .dn-app-icon-finder path { stroke: #123354; stroke-width: 0.75; fill: none; } .dn-app-icon-terminal rect { fill: #24272e; } .dn-app-icon-terminal path { stroke: #d7f7df; stroke-width: 1.35; fill: none; stroke-linecap: round; stroke-linejoin: round; }
.dn-app-icon-shell { display: inline-grid; place-items: center; flex: 0 0 auto; width: 16px; height: 16px; }
.dn-app-icon-shell > * { grid-area: 1 / 1; }
.dn-app-icon-img { position: relative; z-index: 1; width: 16px; height: 16px; border-radius: 3px; object-fit: contain; opacity: 0; }
.dn-open-option .dn-action-label { display: block; }
.dn-theme-toggle { display: flex; gap: 4px; padding: 4px; border: 1px solid var(--dn-border); border-radius: 8px; background: var(--dn-surface); }
.dn-theme-toggle button { min-width: 66px; min-height: 32px; padding: 0 10px; border: 0; border-radius: 6px; color: var(--dn-muted); background: transparent; cursor: pointer; font-size: 0.82rem; font-weight: 800; }
.dn-theme-toggle button:hover { color: var(--dn-text); background: var(--dn-control-hover); }
.dn-theme-toggle button[aria-pressed='true'] { color: var(--dn-strong); background: var(--dn-control-active); box-shadow: 0 0 0 1px var(--dn-border-strong) inset; }
.dn-signals { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; margin: 16px 0; }
.dn-signal, .dn-panel { border: 1px solid var(--dn-border); border-radius: 8px; background: var(--dn-surface); }
.dn-signal { --dn-signal-accent: var(--dn-neutral); position: relative; min-height: 112px; overflow: hidden; padding: 12px; border-color: color-mix(in srgb, var(--dn-signal-accent) 38%, var(--dn-border)); color: inherit; background: var(--dn-surface); text-align: left; cursor: pointer; transition: transform 160ms ease, border-color 160ms ease, background 160ms ease; }
.dn-signal::before { content: ''; position: absolute; inset: 0 0 auto; height: 3px; background: var(--dn-signal-accent); }
.dn-signal.signal-components { --dn-signal-accent: #58d68d; } .dn-signal.signal-automation { --dn-signal-accent: #79a7ff; } .dn-signal.signal-eligible-work { --dn-signal-accent: #35d6c6; } .dn-signal.signal-worktrees { --dn-signal-accent: #e4b15f; } .dn-signal.signal-blockers { --dn-signal-accent: #ff8b78; } .dn-signal.signal-plugins { --dn-signal-accent: #b68cff; }
.dn-signal:hover, .dn-component-card:hover, .dn-event:hover, .dn-blocker:hover { transform: translateY(-1px); }
.dn-signal.selected, .dn-component-card.selected, .dn-event.selected, .dn-blocker.selected, .dn-history-item.selected { border-color: var(--dn-active); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dn-active) 18%, transparent) inset; }
.dn-signal-top, .dn-card-title, .dn-panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }
.dn-host-panel { margin: 16px 0; background: var(--dn-surface); }
.dn-workspace-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; }
.dn-workspace-card { --dn-workspace-accent: var(--dn-neutral); display: grid; gap: 7px; min-width: 0; padding: 11px; border: 1px solid color-mix(in srgb, var(--dn-workspace-accent) 34%, var(--dn-border)); border-left: 5px solid var(--dn-workspace-accent); border-radius: 8px; color: inherit; background: var(--dn-surface); text-align: left; cursor: pointer; transition: transform 160ms ease, border-color 160ms ease, background 160ms ease; }
.dn-workspace-card:hover { transform: translateY(-1px); border-color: var(--dn-workspace-accent); background: var(--dn-control-hover); }
.dn-workspace-card.selected { box-shadow: 0 0 0 2px color-mix(in srgb, var(--dn-workspace-accent) 26%, transparent) inset; }
.dn-workspace-card.current-workspace { border-color: color-mix(in srgb, var(--dn-active) 58%, var(--dn-workspace-accent)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dn-active) 20%, transparent) inset; }
.dn-workspace-card.tone-good { --dn-workspace-accent: var(--dn-good); } .dn-workspace-card.tone-active { --dn-workspace-accent: var(--dn-active); } .dn-workspace-card.tone-warn { --dn-workspace-accent: var(--dn-warn); } .dn-workspace-card.tone-danger { --dn-workspace-accent: var(--dn-danger); }
.dn-workspace-card strong { min-width: 0; overflow: hidden; color: var(--dn-strong); text-overflow: ellipsis; white-space: nowrap; }
.dn-workspace-card p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 0.8rem; }
.dn-workspace-current-badge { flex: 0 0 auto; padding: 4px 7px; border: 1px solid color-mix(in srgb, var(--dn-active) 72%, var(--dn-border)); border-radius: 6px; color: var(--dn-active); background: color-mix(in srgb, var(--dn-active) 14%, transparent); font-size: 0.68rem; font-weight: 900; text-transform: uppercase; white-space: nowrap; }
.dn-workspace-meta { display: flex; flex-wrap: wrap; gap: 6px; }
.dn-workspace-meta span { padding: 3px 6px; border: 1px solid var(--dn-border-muted); border-radius: 6px; color: var(--dn-muted); background: var(--dn-surface-raised); font-size: 0.7rem; font-weight: 800; }
.dn-signal-icon { display: inline-grid; place-items: center; flex: 0 0 auto; width: 34px; height: 34px; border: 1px solid color-mix(in srgb, var(--dn-signal-accent) 36%, var(--dn-border)); border-radius: 8px; background: var(--dn-surface-raised); color: var(--dn-signal-accent); }
.dn-signal-icon svg { width: 18px; height: 18px; stroke: currentColor; stroke-width: 2.2; fill: none; stroke-linecap: round; stroke-linejoin: round; }
.dn-dot { display: inline-block; flex: 0 0 auto; width: 10px; height: 10px; border-radius: 999px; background: currentColor; }
.dn-signal strong { display: block; margin: 6px 0; color: var(--dn-strong); font-size: 1.35rem; line-height: 1; overflow-wrap: anywhere; }
.dn-signal p, .dn-event p, .dn-panel p { margin: 0; color: var(--dn-muted); }
.dn-signal p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 0.92rem; }
.dn-host-signal { width: 100%; }
.dn-grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(340px, 0.9fr); gap: 14px; }
.dn-panel { min-width: 0; padding: 16px; }
.dn-panel h2 { margin: 0 0 12px; color: var(--dn-strong); font-size: 1rem; letter-spacing: 0; }
.dn-pills { display: flex; flex-wrap: wrap; gap: 8px; padding: 0; margin: 0; list-style: none; }
.dn-pill { padding: 7px 9px; border: 1px solid var(--dn-border); border-radius: 999px; color: var(--dn-pill-text); background: var(--dn-surface-muted); font-size: 0.82rem; font-weight: 700; }
.dn-pill.warn { border-color: color-mix(in srgb, var(--dn-warn) 42%, transparent); color: var(--dn-warn-soft); }
.dn-feature-list { display: grid; gap: 10px; }
.dn-feature-card { --dn-feature-accent: var(--dn-active); display: grid; gap: 8px; width: 100%; min-width: 0; padding: 12px; border: 1px solid color-mix(in srgb, var(--dn-feature-accent) 36%, var(--dn-border)); border-left: 5px solid var(--dn-feature-accent); border-radius: 8px; color: inherit; background: var(--dn-surface); text-align: left; cursor: pointer; transition: border-color 140ms ease, background 140ms ease, transform 140ms ease; }
.dn-feature-card:hover { transform: translateY(-1px); border-color: var(--dn-feature-accent); background: var(--dn-control-hover); }
.dn-feature-card.selected { box-shadow: 0 0 0 2px color-mix(in srgb, var(--dn-feature-accent) 20%, transparent) inset; }
.dn-feature-card.tone-good { --dn-feature-accent: var(--dn-good); } .dn-feature-card.tone-active { --dn-feature-accent: var(--dn-active); } .dn-feature-card.tone-warn { --dn-feature-accent: var(--dn-warn); } .dn-feature-card.tone-danger { --dn-feature-accent: var(--dn-danger); } .dn-feature-card.tone-neutral { --dn-feature-accent: var(--dn-neutral); }
.dn-feature-title { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; }
.dn-feature-title strong { min-width: 0; overflow: hidden; color: var(--dn-strong); text-overflow: ellipsis; white-space: nowrap; }
.dn-feature-status { padding: 4px 7px; border: 1px solid color-mix(in srgb, var(--dn-feature-accent) 60%, var(--dn-border)); border-radius: 6px; color: var(--dn-feature-accent); background: transparent; font-size: 0.68rem; font-weight: 900; text-transform: uppercase; white-space: nowrap; }
.dn-feature-card p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 0.84rem; }
.dn-feature-meta { display: flex; flex-wrap: wrap; gap: 6px; }
.dn-feature-meta span { max-width: 100%; overflow: hidden; padding: 4px 7px; border: 1px solid var(--dn-border-muted); border-radius: 6px; color: var(--dn-muted); background: var(--dn-surface-raised); font-size: 0.72rem; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
.dn-feature-more { padding: 8px 10px; border: 1px dashed var(--dn-border-muted); border-radius: 8px; color: var(--dn-muted); background: var(--dn-surface-muted); font-size: 0.78rem; font-weight: 800; }
.dn-git-workflows { display: grid; gap: 8px; margin: 0 0 12px; padding: 10px; border: 1px solid var(--dn-border-muted); border-radius: 8px; background: var(--dn-surface-muted); }
.dn-git-workflows-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: start; }
.dn-git-workflows-head > div { display: grid; gap: 5px; min-width: 0; }
.dn-git-workflows-head strong { min-width: 0; overflow: hidden; color: var(--dn-strong); font-size: 0.9rem; text-overflow: ellipsis; white-space: nowrap; }
.dn-git-workflow-meta, .dn-git-workflow-counts, .dn-git-workflow-run-meta { display: flex; flex-wrap: wrap; gap: 5px; min-width: 0; }
.dn-git-workflow-meta span, .dn-git-workflow-counts span, .dn-git-workflow-run-meta span { max-width: 100%; overflow: hidden; padding: 3px 6px; border: 1px solid var(--dn-border-muted); border-radius: 6px; color: var(--dn-muted); background: var(--dn-surface-raised); font-size: 0.68rem; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
.dn-git-workflow-counts { justify-content: flex-end; }
.dn-git-workflow-counts span strong { color: var(--dn-strong); font-size: inherit; }
.dn-git-workflow-runs { display: grid; gap: 6px; }
.dn-git-workflow-run { --dn-workflow-accent: var(--dn-active); display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; min-width: 0; padding: 7px 8px; border-left: 3px solid var(--dn-workflow-accent); border-radius: 6px; background: var(--dn-surface); }
.dn-git-workflow-run.tone-good { --dn-workflow-accent: var(--dn-good); } .dn-git-workflow-run.tone-active { --dn-workflow-accent: var(--dn-active); } .dn-git-workflow-run.tone-warn { --dn-workflow-accent: var(--dn-warn); } .dn-git-workflow-run.tone-danger { --dn-workflow-accent: var(--dn-danger); }
.dn-git-workflow-run strong { min-width: 0; overflow: hidden; color: var(--dn-strong); font-size: 0.78rem; text-overflow: ellipsis; white-space: nowrap; }
.dn-git-panel { background: var(--dn-surface); }
.dn-git-board { --dn-git-graph-width: 230px; --dn-git-description-width: 360px; --dn-git-date-width: 124px; --dn-git-author-width: 170px; --dn-git-commit-width: 78px; --dn-git-row-height: 26px; --dn-git-table-min-width: calc(var(--dn-git-description-width) + var(--dn-git-date-width) + var(--dn-git-author-width) + var(--dn-git-commit-width) + 12px); display: grid; grid-template-columns: minmax(96px, var(--dn-git-graph-width)) minmax(0, 1fr); gap: 0; width: 100%; overflow: auto; border: 1px solid var(--dn-border-muted); border-radius: 8px; background: var(--dn-weave-bg); }
.dn-git-topbar { display: grid; grid-template-columns: minmax(160px, 0.32fr) minmax(220px, 0.48fr) minmax(260px, 1fr) auto; align-items: end; gap: 8px; margin: 0 0 10px; }
.dn-git-context-control { display: grid; gap: 3px; min-width: 0; color: var(--dn-label); font-size: 0.66rem; font-weight: 900; text-transform: uppercase; }
.dn-git-context-select { min-width: 0; width: 100%; height: 30px; padding: 0 26px 0 9px; border: 1px solid var(--dn-border-muted); border-radius: 7px; color: var(--dn-strong); background: var(--dn-surface-raised); font-size: 0.76rem; font-weight: 820; }
.dn-git-context-select:focus { border-color: var(--dn-active); outline: 2px solid color-mix(in srgb, var(--dn-active) 22%, transparent); outline-offset: 1px; }
.dn-git-search { display: grid; grid-template-columns: auto minmax(160px, 1fr) auto auto auto auto; align-items: center; gap: 6px; min-width: min(100%, 260px); }
.dn-git-search-icon { display: grid; place-items: center; width: 28px; height: 28px; color: var(--dn-label); }
.dn-git-search-icon svg { width: 15px; height: 15px; stroke: currentColor; fill: none; }
.dn-git-search-input { min-width: 0; height: 30px; padding: 0 9px; border: 1px solid var(--dn-border-muted); border-radius: 7px; color: var(--dn-strong); background: var(--dn-surface-raised); font-size: 0.76rem; font-weight: 760; }
.dn-git-search-input:focus { border-color: var(--dn-active); outline: 2px solid color-mix(in srgb, var(--dn-active) 22%, transparent); outline-offset: 1px; }
.dn-git-search-status { min-width: 58px; color: var(--dn-label); font-size: 0.68rem; font-weight: 900; text-align: center; white-space: nowrap; }
.dn-git-search-button { height: 30px; padding: 0 8px; border: 1px solid var(--dn-border-muted); border-radius: 7px; color: var(--dn-muted); background: var(--dn-surface); cursor: pointer; font-size: 0.68rem; font-weight: 900; }
.dn-git-search-button:hover:not(:disabled) { color: var(--dn-strong); border-color: var(--dn-active); background: var(--dn-control-hover); }
.dn-git-search-button:disabled { opacity: 0.45; cursor: default; }
.dn-git-toolbar-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; }
.dn-git-icon-button, .dn-git-column-trigger { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid var(--dn-border-muted); border-radius: 7px; color: var(--dn-muted); background: var(--dn-surface); cursor: pointer; }
.dn-git-icon-button svg, .dn-git-column-trigger svg { width: 16px; height: 16px; stroke: currentColor; fill: none; }
.dn-git-icon-button:hover:not(:disabled), .dn-git-column-menu[open] .dn-git-column-trigger, .dn-git-column-trigger:hover { color: var(--dn-strong); border-color: var(--dn-active); background: var(--dn-control-hover); }
.dn-git-icon-button:disabled { opacity: 0.42; cursor: not-allowed; }
.dn-git-column-menu { position: relative; flex: 0 0 auto; }
.dn-git-column-trigger { list-style: none; }
.dn-git-column-trigger::-webkit-details-marker { display: none; }
.dn-git-column-options { position: absolute; top: calc(100% + 6px); right: 0; z-index: 30; display: grid; gap: 6px; min-width: 150px; padding: 8px; border: 1px solid var(--dn-border-strong); border-radius: 8px; background: var(--dn-surface-raised); box-shadow: 0 14px 32px rgba(0, 0, 0, 0.22); }
.dn-git-column-option { display: flex; align-items: center; gap: 7px; min-width: 0; color: var(--dn-muted); font-size: 0.72rem; font-weight: 820; white-space: nowrap; }
.dn-git-column-option input { accent-color: var(--dn-active); }
.dn-git-graph-column { position: relative; display: grid; grid-template-rows: 30px auto; grid-template-columns: minmax(0, 1fr); min-width: 0; overflow: hidden; border-right: 0; }
.dn-git-graph-detail-edge { position: absolute; right: 0; z-index: 1; width: 1px; background: var(--dn-border-muted); pointer-events: none; }
.dn-git-graph-column > .dn-git-column-header { box-sizing: border-box; width: 100%; max-width: 100%; border-bottom: 0; background: color-mix(in srgb, var(--dn-surface-raised) 72%, transparent); }
.dn-git-table { display: grid; grid-template-rows: 30px auto; min-width: var(--dn-git-table-min-width); overflow: visible; }
.dn-git-column-row, .dn-git-history-row { display: grid; grid-template-columns: minmax(var(--dn-git-description-width), 1fr) var(--dn-git-date-width) var(--dn-git-author-width) var(--dn-git-commit-width); align-items: center; gap: 4px; width: 100%; min-width: var(--dn-git-table-min-width); }
.dn-git-column-row { min-height: 30px; height: 30px; border-bottom: 0; background: color-mix(in srgb, var(--dn-surface-raised) 72%, transparent); }
.dn-git-column-header { position: relative; display: flex; align-items: center; justify-content: center; min-width: 0; min-height: 30px; height: 30px; padding: 0 4px; color: var(--dn-label); font-size: 0.66rem; font-weight: 900; letter-spacing: 0; text-align: center; text-transform: uppercase; white-space: nowrap; }
.dn-git-column-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; text-align: center; }
.dn-git-resize-handle { position: absolute; inset: 0 -5px 0 auto; z-index: 3; width: 10px; border-right: 1px solid transparent; cursor: col-resize; touch-action: none; }
.dn-git-resize-handle::after { content: ''; position: absolute; top: 8px; bottom: 8px; right: 4px; width: 2px; border-radius: 999px; background: var(--dn-border-strong); opacity: 0; transition: opacity 120ms ease, background 120ms ease; }
.dn-git-column-header:hover .dn-git-resize-handle::after, .dn-git-resize-handle:focus-visible::after { opacity: 1; background: var(--dn-active); }
.dn-git-board.resizing { cursor: col-resize; user-select: none; }
.dn-git-board[data-git-column-graph='hidden'] { grid-template-columns: minmax(0, 1fr); }
.dn-git-board[data-git-column-graph='hidden'] .dn-git-graph-column { display: none; }
.dn-git-board[data-git-column-description='hidden'] [data-git-cell='description'],
.dn-git-board[data-git-column-date='hidden'] [data-git-cell='date'],
.dn-git-board[data-git-column-author='hidden'] [data-git-cell='author'],
.dn-git-board[data-git-column-commit='hidden'] [data-git-cell='commit'] { display: none; }
.dn-git-graph { display: block; flex: 0 0 auto; min-width: 118px; min-height: 34px; }
.dn-git-detail-band { fill: color-mix(in srgb, var(--dn-surface-raised) 58%, var(--dn-control-active)); pointer-events: none; }
.dn-git-detail-band-divider { stroke: var(--dn-border-strong); stroke-width: 1; opacity: 0.72; pointer-events: none; shape-rendering: crispEdges; }
.dn-git-graph path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.dn-git-row-hit { fill: transparent; cursor: pointer; pointer-events: all; outline: none; }
.dn-git-row-hit.dn-history-hovered { fill: var(--dn-control-hover); }
.dn-git-row-hit.selected { fill: var(--dn-control-active); }
.dn-git-line-shadow { stroke: var(--dn-bg); stroke-width: 6; opacity: 0.42; }
.dn-git-line { stroke-width: 3; opacity: 0.82; }
.dn-git-line-shadow, .dn-git-line { pointer-events: none; }
.dn-git-node { cursor: pointer; outline: none; transform-box: fill-box; transform-origin: center; vector-effect: non-scaling-stroke; transition: filter 120ms ease, transform 120ms ease; }
.dn-git-node.selected { filter: drop-shadow(0 0 5px color-mix(in srgb, var(--dn-active) 42%, transparent)); stroke-width: 1.8; transform: scale(1.08); }
.dn-git-node.dn-history-hovered { filter: drop-shadow(0 0 5px color-mix(in srgb, var(--dn-active) 42%, transparent)); }
.dn-git-node.dn-history-node-hovered, .dn-git-node:focus-visible { filter: drop-shadow(0 0 7px color-mix(in srgb, var(--dn-active) 55%, transparent)); stroke-width: 1.6; transform: scale(1.24); }
.dn-git-row-hit:focus-visible { fill: color-mix(in srgb, var(--dn-active) 18%, transparent); }
.dn-git-row-hit.dn-history-search-match { fill: color-mix(in srgb, var(--dn-warn) 14%, transparent); }
.dn-git-row-hit.dn-history-search-current { fill: color-mix(in srgb, var(--dn-active) 22%, transparent); }
.dn-git-node.dn-history-search-match { stroke-width: 2.4; }
.dn-git-node.dn-history-search-current { filter: drop-shadow(0 0 7px color-mix(in srgb, var(--dn-warn) 55%, transparent)); stroke-width: 3; }
.dn-git-rows { display: grid; min-width: 0; }
.dn-git-history-row-wrap { position: relative; width: 100%; min-width: var(--dn-git-table-min-width); height: var(--dn-git-row-height); }
.dn-git-history-row { min-height: var(--dn-git-row-height); height: var(--dn-git-row-height); padding: 0 24px 0 4px; border: 0; color: inherit; background: transparent; text-align: left; cursor: pointer; }
.dn-git-history-row:hover, .dn-git-history-row.dn-history-hovered { background: var(--dn-control-hover); }
.dn-git-history-row.selected { background: var(--dn-control-active); box-shadow: none; }
.dn-git-history-row.dn-history-search-match { background: color-mix(in srgb, var(--dn-warn) 9%, transparent); }
.dn-git-history-row.dn-history-search-current { box-shadow: 0 0 0 2px color-mix(in srgb, var(--dn-warn) 42%, transparent) inset; }
.dn-git-history-row.dn-history-search-flash { animation: dn-history-search-flash 900ms ease-out; }
.dn-git-row-menu { position: absolute; top: 2px; right: 2px; z-index: 5; }
.dn-git-row-menu-trigger { display: grid; place-items: center; width: 22px; height: 22px; border: 1px solid transparent; border-radius: 6px; color: var(--dn-label); cursor: pointer; font-size: 0.75rem; font-weight: 900; line-height: 1; list-style: none; opacity: 0.28; }
.dn-git-row-menu-trigger::-webkit-details-marker { display: none; }
.dn-git-history-row-wrap:hover .dn-git-row-menu-trigger, .dn-git-row-menu[open] .dn-git-row-menu-trigger, .dn-git-row-menu-trigger:focus-visible { opacity: 1; border-color: var(--dn-border-strong); background: var(--dn-surface-raised); }
.dn-git-row-menu-options { position: absolute; top: calc(100% + 4px); right: 0; display: grid; gap: 4px; min-width: 132px; padding: 6px; border: 1px solid var(--dn-border-strong); border-radius: 8px; background: var(--dn-surface-raised); box-shadow: 0 14px 32px rgba(0, 0, 0, 0.24); }
.dn-git-row-menu-item { height: 26px; padding: 0 8px; border: 1px solid transparent; border-radius: 6px; color: var(--dn-muted); background: transparent; cursor: pointer; font-size: 0.7rem; font-weight: 820; text-align: left; white-space: nowrap; }
.dn-git-row-menu-item:hover, .dn-git-row-menu-item:focus-visible { color: var(--dn-strong); border-color: var(--dn-active); background: var(--dn-control-hover); outline: none; }
.dn-git-subject { display: flex; align-items: center; gap: 5px; min-width: 0; }
.dn-git-description { min-width: 0; overflow: hidden; color: var(--dn-strong); font-size: 0.82rem; font-weight: 460; text-overflow: ellipsis; white-space: nowrap; }
.dn-git-history-row.merge:not(.selected) .dn-git-description { color: color-mix(in srgb, var(--dn-muted) 68%, var(--dn-bg)); }
.dn-git-refs { display: inline-flex; flex: 0 1 auto; gap: 4px; max-width: 44%; overflow: hidden; }
.dn-git-ref { max-width: 150px; overflow: hidden; padding: 2px 6px; border: 1px solid var(--dn-border-strong); border-left: 5px solid var(--dn-branch-color, var(--dn-active)); border-radius: 6px; color: var(--dn-pill-text); background: var(--dn-surface-raised); font-size: 0.68rem; font-weight: 850; text-overflow: ellipsis; white-space: nowrap; }
.dn-git-badges { display: inline-flex; flex: 0 0 auto; gap: 4px; max-width: 30%; overflow: hidden; }
.dn-git-badge { max-width: 130px; overflow: hidden; padding: 2px 6px; border: 1px solid var(--dn-border-muted); border-radius: 6px; color: var(--dn-muted); background: var(--dn-surface); font-size: 0.66rem; font-weight: 850; text-overflow: ellipsis; white-space: nowrap; }
.dn-git-badge.tone-good { border-color: color-mix(in srgb, var(--dn-good) 48%, var(--dn-border)); color: var(--dn-good); } .dn-git-badge.tone-active { border-color: color-mix(in srgb, var(--dn-active) 48%, var(--dn-border)); color: var(--dn-active); } .dn-git-badge.tone-warn { border-color: color-mix(in srgb, var(--dn-warn) 48%, var(--dn-border)); color: var(--dn-warn-soft); } .dn-git-badge.tone-danger { border-color: color-mix(in srgb, var(--dn-danger) 54%, var(--dn-border)); color: var(--dn-danger-soft); }
.dn-git-date, .dn-git-author, .dn-git-sha { min-width: 0; overflow: hidden; color: var(--dn-muted); font-size: 0.76rem; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.dn-git-sha { color: var(--dn-label); font-weight: 850; }
.dn-git-note { margin: 8px 0 0; color: var(--dn-muted); font-size: 0.8rem; }
.dn-git-detail-panel { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(220px, 0.8fr); gap: 12px; margin: 0 0 10px; padding: 12px; border: 1px solid var(--dn-border-muted); border-radius: 8px; background: color-mix(in srgb, var(--dn-surface-raised) 82%, transparent); }
.dn-git-inline-detail { height: 234px; min-width: var(--dn-git-table-min-width); margin: 0; overflow: auto; border-width: 0 0 1px; border-color: var(--dn-border-strong); border-radius: 0; background: color-mix(in srgb, var(--dn-surface-raised) 58%, var(--dn-control-active)); }
.dn-git-detail-main { display: grid; gap: 7px; min-width: 0; }
.dn-git-detail-main strong { min-width: 0; overflow: hidden; color: var(--dn-strong); text-overflow: ellipsis; white-space: nowrap; }
.dn-git-detail-main p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 0.82rem; }
.dn-git-detail-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
.dn-git-detail-grid div { min-width: 0; padding: 8px; border: 1px solid var(--dn-border-muted); border-radius: 7px; background: var(--dn-surface-muted); }
.dn-git-detail-grid dt { color: var(--dn-label); font-size: 0.66rem; font-weight: 850; text-transform: uppercase; }
.dn-git-detail-grid dd { margin: 3px 0 0; overflow: hidden; color: var(--dn-strong); font-size: 0.78rem; font-weight: 760; text-overflow: ellipsis; white-space: nowrap; }
.dn-git-detail-side { display: grid; gap: 8px; align-content: start; min-width: 0; }
.dn-git-detail-relations { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; min-width: 0; }
.dn-git-detail-chip-list { display: flex; flex-wrap: wrap; gap: 5px; min-width: 0; }
.dn-git-detail-chip { max-width: 100%; overflow: hidden; padding: 2px 6px; border: 1px solid var(--dn-border-strong); border-radius: 6px; color: var(--dn-pill-text); background: var(--dn-surface-raised); font-size: 0.7rem; font-weight: 820; text-overflow: ellipsis; white-space: nowrap; }
.dn-git-detail-muted { margin: 0; color: var(--dn-muted); font-size: 0.74rem; font-weight: 760; }
.dn-git-attached-list { display: grid; gap: 6px; min-width: 0; }
.dn-git-attached-group { display: grid; gap: 5px; min-width: 0; padding: 7px; border: 1px solid var(--dn-border-muted); border-radius: 7px; background: var(--dn-surface-muted); }
.dn-git-attached-group ul { display: grid; gap: 3px; min-width: 0; margin: 0; padding: 0; list-style: none; }
.dn-git-attached-group li { overflow: hidden; color: var(--dn-muted); font-size: 0.72rem; font-weight: 760; text-overflow: ellipsis; white-space: nowrap; }
.dn-history-marker-list { display: flex; flex-wrap: wrap; gap: 5px; min-width: 0; }
.dn-history-marker { max-width: 160px; overflow: hidden; padding: 3px 7px; border: 1px solid var(--dn-border-muted); border-radius: 7px; color: var(--dn-muted); background: var(--dn-surface); font-size: 0.68rem; font-weight: 850; text-overflow: ellipsis; white-space: nowrap; }
.dn-history-marker.tone-good { border-color: color-mix(in srgb, var(--dn-good) 52%, var(--dn-border)); color: var(--dn-good); } .dn-history-marker.tone-active { border-color: color-mix(in srgb, var(--dn-active) 52%, var(--dn-border)); color: var(--dn-active); } .dn-history-marker.tone-warn { border-color: color-mix(in srgb, var(--dn-warn) 52%, var(--dn-border)); color: var(--dn-warn-soft); } .dn-history-marker.tone-danger { border-color: color-mix(in srgb, var(--dn-danger) 52%, var(--dn-border)); color: var(--dn-danger); }
.dn-weave { width: 100%; min-height: 430px; overflow: auto; border-radius: 8px; background: var(--dn-weave-bg); }
.dn-weave svg { min-width: 900px; display: block; }
.dn-lane-label { fill: var(--dn-label); font-size: 12px; font-weight: 800; text-transform: uppercase; }
.dn-edge { stroke: var(--dn-border-strong); stroke-width: 2; fill: none; }
.dn-node rect { fill: var(--dn-surface-raised); stroke: var(--dn-border-strong); stroke-width: 1; rx: 8; }
.dn-node text { fill: var(--dn-text); font-size: 12px; font-weight: 750; }
.dn-node .dn-node-detail { fill: var(--dn-muted); font-size: 10px; font-weight: 600; }
.dn-node.status-ready rect, .dn-node.status-clean rect, .dn-node.status-completed rect { stroke: var(--dn-good); }
.dn-node.status-working rect, .dn-node.status-active rect, .dn-node.status-head rect { stroke: var(--dn-active); }
.dn-node.status-blocked rect, .dn-node.status-failed rect, .dn-node.status-dirty rect { stroke: var(--dn-danger); }
.dn-table { width: 100%; border-collapse: collapse; }
.dn-table th, .dn-table td { padding: 9px 8px; border-bottom: 1px solid var(--dn-border-muted); text-align: left; vertical-align: top; }
.dn-table td { color: var(--dn-pill-text); overflow-wrap: anywhere; }
.dn-main-grid { display: grid; grid-template-columns: 1fr; gap: 14px; align-items: start; }
.dn-work-stack { display: grid; gap: 14px; min-width: 0; }
.dn-secondary-grid { grid-template-columns: minmax(0, 0.9fr) minmax(0, 0.9fr) minmax(300px, 0.8fr); margin-top: 14px; }
.dn-plugin-row { margin-top: 14px; }
.dn-history-panel { min-height: 690px; background: var(--dn-surface); }
.dn-count { color: var(--dn-label); font-size: 0.8rem; font-weight: 800; white-space: nowrap; }
.dn-history-note { margin: 8px 0 0; color: var(--dn-muted); font-size: 0.84rem; }
.dn-map-reader { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; }
.dn-map-reader span { padding: 4px 7px; border: 1px solid var(--dn-border-muted); border-radius: 6px; color: var(--dn-muted); background: var(--dn-surface-raised); font-size: 0.72rem; font-weight: 780; }
.dn-lane-key { display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); gap: 6px; margin: 10px 0 0; }
.dn-lane-key span { display: grid; gap: 1px; min-width: 0; padding: 6px 8px; overflow: hidden; border: 1px solid var(--dn-border-muted); border-left: 5px solid var(--dn-branch-color); border-radius: 6px; color: var(--dn-muted); background: var(--dn-surface-muted); }
.dn-lane-key strong { overflow: hidden; color: var(--dn-strong); font-size: 0.72rem; font-weight: 850; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
.dn-lane-key em { overflow: hidden; font-size: 0.72rem; font-style: normal; font-weight: 720; text-overflow: ellipsis; white-space: nowrap; }
.dn-branch-board { position: relative; min-height: 420px; max-height: 650px; margin-top: 12px; padding-left: 132px; overflow: auto; border: 1px solid var(--dn-border-muted); border-radius: 8px; background: color-mix(in srgb, var(--dn-weave-bg) 84%, transparent); scrollbar-gutter: stable; }
.dn-branch-svg { position: absolute; left: 0; top: 0; width: 122px; pointer-events: none; }
.dn-branch-svg path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.dn-history-rows { display: grid; gap: 0; }
.dn-history-item { position: relative; display: grid; grid-template-columns: minmax(190px, 0.74fr) minmax(140px, 0.46fr) auto; align-items: center; gap: 10px; min-height: 34px; height: 34px; padding: 0 10px 0 10px; border: 0; border-bottom: 1px solid var(--dn-border-muted); border-radius: 0; color: inherit; background: transparent; text-align: left; cursor: pointer; transition: background 120ms ease, box-shadow 120ms ease; }
.dn-history-item:hover { background: var(--dn-control-hover); }
.dn-history-item.selected { background: var(--dn-control-active); border-color: transparent; }
.dn-branch-dot { position: absolute; left: calc(-115px + (var(--dn-lane) * 18px)); top: calc(50% - 5px); width: 10px; height: 10px; border: 2px solid var(--dn-surface); border-radius: 999px; background: var(--dn-branch-color); box-shadow: 0 0 0 1px var(--dn-branch-color), 0 0 12px color-mix(in srgb, var(--dn-branch-color) 54%, transparent); }
.dn-history-main { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dn-history-main strong, .dn-card-title strong { min-width: 0; overflow: hidden; color: var(--dn-strong); text-overflow: ellipsis; white-space: nowrap; }
.dn-history-main strong { font-size: 0.92rem; font-weight: 720; }
.dn-history-status { color: var(--dn-label); font-size: 0.7rem; font-weight: 850; text-transform: uppercase; white-space: nowrap; }
.dn-history-detail, .dn-card-meta { display: block; min-width: 0; overflow: hidden; color: var(--dn-muted); font-size: 0.82rem; text-overflow: ellipsis; white-space: nowrap; }
.dn-more { height: 34px; padding: 9px 10px; border-bottom: 1px solid var(--dn-border-muted); color: var(--dn-label); font-size: 0.78rem; font-weight: 800; }
.dn-selected-panel { margin: 16px 0; background: var(--dn-surface); }
.dn-work-stack > .dn-selected-panel { margin: 0; }
.dn-selected-layout { display: grid; grid-template-columns: minmax(260px, 1fr) minmax(220px, 0.72fr); gap: 12px; align-items: start; }
.dn-selected-section { min-width: 0; padding: 12px; border: 1px solid var(--dn-border-muted); border-radius: 8px; background: var(--dn-surface-muted); }
.dn-selected-section h2 { margin: 6px 0 8px; font-size: 1.18rem; letter-spacing: 0; }
.dn-selected-section p { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.dn-diagnostic-pills { display: flex; flex-wrap: wrap; gap: 6px; }
.dn-diagnostic-pills span { padding: 4px 7px; border: 1px solid var(--dn-border-muted); border-radius: 6px; color: var(--dn-muted); background: var(--dn-surface); font-size: 0.72rem; font-weight: 800; }
.dn-detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 16px 0 0; }
.dn-detail-grid div { min-width: 0; padding: 10px; border: 1px solid var(--dn-border-muted); border-radius: 8px; background: var(--dn-surface-muted); }
.dn-detail-grid dt { color: var(--dn-label); font-size: 0.72rem; font-weight: 850; text-transform: uppercase; }
.dn-detail-grid dd { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; margin: 4px 0 0; overflow: hidden; color: var(--dn-strong); font-weight: 760; overflow-wrap: anywhere; }
.dn-related { display: grid; gap: 8px; margin-top: 16px; }
.dn-related article { padding: 10px; border: 1px solid var(--dn-border-muted); border-radius: 8px; background: var(--dn-surface-muted); }
.dn-related p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.dn-component-grid, .dn-blocker-list, .dn-events, .dn-thread-list, .dn-plugin-list, .dn-tracked-list { display: grid; gap: 10px; max-height: 440px; overflow: auto; }
.dn-thread-list { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.dn-tracked-list { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.dn-plugin-list { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.dn-host-panel, .dn-host-action-panel, .dn-selected-panel, .dn-history-panel, .dn-thread-panel, .dn-tracked-panel, .dn-plugin-panel, .dn-components-panel, .dn-blockers-panel { scroll-margin-top: 18px; }
.dn-host-action-list { display: grid; gap: 10px; }
.dn-host-action-shell { display: grid; gap: 6px; min-width: 0; }
.dn-host-action-card { --dn-project-accent: var(--dn-warn); display: grid; gap: 7px; min-width: 0; padding: 12px; border: 1px solid color-mix(in srgb, var(--dn-project-accent) 34%, var(--dn-border)); border-left: 5px solid var(--dn-project-accent); border-radius: 8px; color: inherit; background: var(--dn-surface); text-align: left; cursor: pointer; transition: transform 160ms ease, border-color 160ms ease, background 160ms ease; }
.dn-host-action-card:hover { border-color: var(--dn-project-accent); background: var(--dn-control-hover); transform: translateY(-1px); }
.dn-host-action-card strong { min-width: 0; overflow: hidden; color: var(--dn-strong); text-overflow: ellipsis; white-space: nowrap; }
.dn-event-card, .dn-blocker-card { display: grid; gap: 6px; min-width: 0; }
.dn-component-card, .dn-event, .dn-blocker { display: grid; gap: 6px; min-width: 0; padding: 11px; border: 1px solid var(--dn-border-muted); border-radius: 8px; color: inherit; background: var(--dn-surface-muted); text-align: left; cursor: pointer; transition: transform 160ms ease, border-color 160ms ease, background 160ms ease; }
.dn-thread-card, .dn-plugin-card, .dn-tracked-card { display: grid; gap: 7px; min-width: 0; padding: 11px; border: 1px solid var(--dn-border-muted); border-radius: 8px; color: inherit; background: var(--dn-surface-muted); }
.dn-thread-card.selected { box-shadow: 0 0 0 2px color-mix(in srgb, var(--dn-active) 22%, transparent) inset; }
.dn-thread-button { display: grid; gap: 7px; min-width: 0; padding: 0; border: 0; color: inherit; background: transparent; text-align: left; cursor: pointer; }
.dn-tracked-card { --dn-tracked-accent: var(--dn-active); border-left: 5px solid var(--dn-tracked-accent); }
.dn-tracked-card.kind-ready { --dn-tracked-accent: var(--dn-active); } .dn-tracked-card.kind-blocked { --dn-tracked-accent: var(--dn-danger); } .dn-tracked-card.kind-import-candidate { --dn-tracked-accent: var(--dn-branch-4); } .dn-tracked-card.kind-stale { --dn-tracked-accent: var(--dn-warn); } .dn-tracked-card.kind-excluded { --dn-tracked-accent: var(--dn-neutral); }
.dn-tracked-card.selected { box-shadow: 0 0 0 2px color-mix(in srgb, var(--dn-tracked-accent) 24%, transparent) inset; }
.dn-tracked-button { display: grid; gap: 7px; min-width: 0; padding: 0; border: 0; color: inherit; background: transparent; text-align: left; cursor: pointer; }
.dn-thread-card-header, .dn-plugin-card-header, .dn-tracked-card-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; min-width: 0; }
.dn-thread-main { display: grid; gap: 4px; min-width: 0; }
.dn-thread-main strong, .dn-plugin-card strong, .dn-tracked-card strong { overflow: hidden; color: var(--dn-strong); text-overflow: ellipsis; white-space: nowrap; }
.dn-thread-card p, .dn-plugin-card p, .dn-tracked-card p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 0.78rem; }
.dn-thread-next { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 7px; align-items: center; width: 100%; min-height: 30px; padding: 5px 8px; border: 1px solid color-mix(in srgb, var(--dn-warn) 28%, var(--dn-border-muted)); border-radius: 6px; background: var(--dn-surface); }
.dn-thread-next span { color: var(--dn-label); font-size: 0.68rem; font-weight: 900; text-transform: uppercase; }
.dn-thread-next strong { min-width: 0; overflow: hidden; color: var(--dn-strong); font-size: 0.76rem; font-weight: 850; text-overflow: ellipsis; white-space: nowrap; }
.dn-thread-decision { padding: 4px 7px; border: 1px solid currentColor; border-radius: 6px; font-size: 0.68rem; font-weight: 900; text-transform: uppercase; white-space: nowrap; }
.dn-thread-decision.decision-continue, .dn-thread-decision.decision-resume { color: var(--dn-active); } .dn-thread-decision.decision-review, .dn-thread-decision.decision-archive, .dn-thread-decision.decision-merged { color: var(--dn-warn); } .dn-thread-decision.decision-rescue, .dn-thread-decision.decision-blocked { color: var(--dn-danger); } .dn-thread-decision.decision-forget { color: var(--dn-good); }
.dn-plugin-pills { display: flex; flex-wrap: wrap; gap: 5px; }
.dn-plugin-pills span { max-width: 100%; padding: 3px 6px; overflow: hidden; border: 1px solid var(--dn-border-muted); border-radius: 6px; color: var(--dn-muted); background: var(--dn-surface); font-size: 0.7rem; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
.dn-plugin-note, .dn-panel-note { margin-top: 10px; font-size: 0.78rem; }
.dn-panel-note { color: var(--dn-muted); }
.dn-event strong { color: var(--dn-strong); }
.dn-event p, .dn-blocker strong { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.tone-good { color: var(--dn-good); } .tone-active { color: var(--dn-active); } .tone-warn { color: var(--dn-warn); } .tone-danger { color: var(--dn-danger); } .tone-neutral { color: var(--dn-neutral); }
.dn-loading-panel { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 14px; align-items: start; margin-top: 16px; overflow: hidden; }
.dn-loader { width: 34px; height: 34px; border: 3px solid color-mix(in srgb, var(--dn-active) 22%, var(--dn-border)); border-top-color: var(--dn-active); border-radius: 999px; animation: dn-spin 820ms linear infinite; }
.dn-loading-copy { display: grid; gap: 8px; min-width: 0; }
.dn-inline-loading { display: flex; gap: 9px; align-items: center; min-width: 0; color: var(--dn-muted); font-weight: 760; }
.dn-inline-loading::before { content: ''; width: 12px; height: 12px; border: 2px solid color-mix(in srgb, var(--dn-active) 24%, var(--dn-border)); border-top-color: var(--dn-active); border-radius: 999px; animation: dn-spin 820ms linear infinite; }
.dn-skeleton-stack { display: grid; gap: 8px; margin-top: 4px; }
.dn-skeleton { position: relative; height: 12px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--dn-surface-raised) 80%, var(--dn-active) 20%); }
.dn-skeleton::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--dn-active) 24%, transparent), transparent); animation: dn-shimmer 1.35s ease-in-out infinite; }
@media (max-width: 1120px) { .dn-signals { grid-template-columns: repeat(3, minmax(0, 1fr)); } .dn-grid, .dn-main-grid, .dn-secondary-grid, .dn-selected-layout { grid-template-columns: 1fr; } }
@media (max-width: 860px) { .dn-header { grid-template-columns: 1fr; } .dn-header-actions { justify-content: flex-end; width: 100%; } .dn-header-strip { width: 100%; } .dn-git-topbar { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .dn-git-search { grid-column: 1 / -1; } .dn-git-toolbar-actions { grid-column: 1 / -1; justify-content: flex-start; } }
@media (max-width: 680px) { .dn-shell { padding: 12px; } .dn-header { padding: 20px; } .dn-meta { min-width: 0; } .dn-open-menu { justify-self: stretch; } .dn-open-trigger { width: 100%; } .dn-open-options { left: 0; right: auto; } .dn-theme-toggle button { min-width: 0; flex: 1; } .dn-signals { grid-template-columns: 1fr; } .dn-panel-heading { align-items: flex-start; flex-direction: column; } .dn-git-topbar { grid-template-columns: 1fr; } .dn-git-search { grid-template-columns: auto minmax(0, 1fr) auto auto auto auto; } .dn-history-item { grid-template-columns: minmax(0, 1fr) auto; } .dn-history-detail { display: none; } .dn-detail-grid, .dn-git-detail-grid, .dn-git-detail-panel { grid-template-columns: 1fr; } }
@media (max-width: 560px) { .dn-header-actions { justify-content: stretch; } .dn-header-strip { justify-content: stretch; } .dn-header-path-menu { width: 100%; max-width: 100%; } }
`;

export function renderNexusCockpitStylesClientSource(): string {
  return `const cockpitStyles = ${JSON.stringify(cockpitStyles)};`;
}
