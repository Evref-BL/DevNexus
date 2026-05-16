# DevNexus Context

## Glossary

- DevNexus project: A managed orchestration context containing one or more components, launch policy, shared records, and project-level support files.
- Component: A configured source or support unit inside a DevNexus project, with its own source root, optional Git metadata, worktree root, work-item service, verification hints, publication hints, and relationships.
- Primary component: The component that legacy single-target commands use when a command cannot yet operate across every component.
- Component arity: The number of components configured in a DevNexus project; arity one follows the same model as any larger arity.
- Work-item service: The tracker or issue provider configured for a component, such as a local store, GitHub Issues, GitHub Projects, GitLab issues, or Jira.
- DevNexus user: A human or an agent acting under human instruction that configures DevNexus and asks it to launch agent work.
- Launched agent: The thinking process started by DevNexus that chooses work items, supervises subagents, coordinates worktrees, verifies changes, and reports results.

## Avoided Aliases

- Do not treat "project" as an alias for one repository, one source checkout, one work-item service, or one component.
- Do not describe DevNexus as choosing or supervising implementation work; agents do that after DevNexus launches them with context.
- Prefer "work-item service" or "work tracking provider" over "board" when the provider can be issue-based, project-based, or local.
