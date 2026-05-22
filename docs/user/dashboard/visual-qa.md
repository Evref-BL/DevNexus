# Dashboard Visual QA

The cockpit has two layers of visual QA.

## Static Audit

`auditNexusDashboardClientVisuals()` checks the generated dashboard client for
layout guardrails that are easy to regress while iterating quickly:

| Check | Guards |
| --- | --- |
| Theme modes | System, light, and dark mode controls and tokens. |
| Signal accents | Distinct colors for the top signal cards. |
| Branch accents | Distinct colors for work-map lanes and graph rails. |
| Text fitting | Ellipsis, line clamp, and overflow wrapping on dense labels. |
| Lane labels | Compact lane key, row height, and centered row dots. |
| Selected details | Summary, actions, evidence, and diagnostics sections. |
| Action buttons | Provider icons, external-link icon, and new-tab behavior. |
| Plugin cards | Installed plugin cards and compact capability pills. |
| Responsive layout | Desktop and narrow viewport breakpoints. |

The audit is deterministic and runs inside the normal dashboard test suite.

## Human Review

The static audit is not a pixel renderer. A browser screenshot pass is still
needed before claiming the cockpit is visually polished. Review both host and
workspace views in light and dark modes, with attention to:

- text clipping in cards and buttons
- lane label readability
- selected-item details above the work map
- provider chips and chat actions
- plugin cards
- empty states

Do not treat a green static audit as final visual approval.
