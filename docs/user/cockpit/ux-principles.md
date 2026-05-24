# Cockpit UX Principles

Here, "richer" means stronger grouping, clearer actions, better links, and more
useful details on request. It does not mean longer default text.

## Design Bar

- Show host status first: workspaces, approvals, blockers, dirty components, and
  active threads.
- Make blocked work actionable: each blocking card needs a clear next step and,
  when possible, a provider link or resume action.
- Keep text short in the default view. Use compact labels, counts, status chips,
  and recognizable provider icons.
- Put deeper evidence behind click, drawer, popover, or diagnostics mode.
- Do not show raw ISO dates, raw ids, stack-like strings, or JSON-shaped text in
  the primary cockpit.

## Source Notes

| Source | Useful pattern | DevNexus implication |
| --- | --- | --- |
| [Shneiderman, _The Eyes Have It_](https://www.cs.umd.edu/~ben/papers/Shneiderman1996eyes.pdf) | Overview first, zoom/filter, details on demand. | Host cockpit first, workspace drill-down second, raw evidence only on demand. |
| [NN/g usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) | System status, familiar language, recognition over recall, minimalist design. | Use words like `approval`, `issue`, `PR`, or `thread` instead of internal labels. |
| [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | Show the most important options first; defer rare detail. | Cards should answer "what needs me?" before they expose diagnostics. |
| [OpenAI Agents SDK HITL](https://openai.github.io/openai-agents-python/human_in_the_loop/) | Agent runs can pause for approval, store state, and resume. | Model approval as an interrupt with approve, reject, resume, and inspect actions. |
| [Git Graph for VS Code](https://github.com/mhutchie/vscode-git-graph) | Dense branch graph, compact refs, click-to-open commit detail and file changes. | Work history should be compact and clickable; labels should clarify topology. |
| [GitHub Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects) | Multiple views over issues and PRs, with filters, fields, and automation. | Provider records should stay linked in place, such as `#42: title` with a provider icon. |
| [GitHub issue and PR dashboards](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/viewing-all-of-your-issues-and-pull-requests) | Cross-repository views for assigned, mentioned, stale, and review-needed work. | A host cockpit should summarize all registered workspaces, not only switch between them. |
| [Linear triage](https://linear.app/docs/triage?tabs=36dbc0f97e0d) | A dedicated inbox for work from integrations or other teams. | Use a host action queue for approvals, review, rescue, archive, and forget decisions. |
| [Linear display options](https://linear.app/docs/display-options) | Views can group, order, switch layouts, and persist personal defaults. | Let users change grouping without creating several permanent dashboards. |
| [Sentry issue status](https://docs.sentry.io/product/issues/states-triage/) | Issue status drives triage, archive, resolve, and regression flow. | Thread cleanup should use explicit states: continue, archive, forget, rescue, merged, or blocked. |
| [Sentry issue details](https://docs.sentry.io/product/issues/issue-details/) | High-level issue actions stay in the header; heavy evidence lives below. | Keep summary and actions at top, with evidence and diagnostics lower down. |
| [Backstage catalog](https://backstage.io/docs/features/software-catalog/) | A host portal organizes components and plugins around catalog entities. | Components and plugins belong in the host cockpit, with workspace pages as drill-downs. |
| [Grafana dashboard practices](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/) | Dashboards should answer a question, reduce cognitive load, and use drill-down links. | Each cockpit region needs one job: "what needs me?", "what changed?", or "where do I go?" |
| [Grafana dashboard links](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/manage-dashboard-links/) | Links preserve context and can open specific dashboards or external systems. | Provider buttons should carry context and signal external navigation with an icon. |
| [Argo CD overview](https://argo-cd.readthedocs.io/en/stable/) | Health, sync, drift, and manual sync are exposed as compact operational state. | Components need simple health language: clean, dirty, blocked, stale, unknown. |
| [Ray Dashboard](https://docs.ray.io/en/latest/ray-observability/getting-started.html) | Overview panes show cluster status, recent jobs, events, and links to logs. | Separate host overview, recent threads, work map, and diagnostics. |

## Product Principles

1. The host cockpit is the control room.
2. The first question is "what needs a human now?"
3. Every blocked item needs a primary action, not just an explanation.
4. Details open in place and preserve context.
5. Provider links show the provider, short id, title, and external-link affordance.
6. Work history should show shape and movement, not every field.
7. Threads are first-class work artifacts.
8. Plugins are part of the cockpit.
9. Diagnostics are a mode, not the default cockpit.

## Anti-Patterns

- Long explanations in cards.
- Raw timestamps such as `2026-05-20T19:36:20.769Z`.
- Raw ids without a human label.
- Lane labels that overlap or only make sense after selecting a row.
- Repeating a lane name inside every row label.
- Hiding the only useful action in a separate card far below the selected item.
- Treating advisory leases as the main source of truth for active work.
