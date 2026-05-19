# Nicolas First-User Onboarding Notes

Date: 2026-05-19

## Context

Nicolas tried DevNexus for the first time by asking an agent to read the
GitHub README, install DevNexus, and create a project from existing work
folders. Installation was acceptable: the agent inferred the Node 24+
requirement, upgraded Node, installed `@evref-bl/dev-nexus`, and verified
`dev-nexus --help`.

The project creation path failed. The agent did not know how to choose a
DevNexus home, what directory should be the DevNexus project root, whether the
existing folders were projects or components, whether they should be cloned,
copied, or referenced, which agent target mattered, or what should happen after
project creation.

## Observed Frictions

- The README Quick Start is too sparse for first-time project creation. It
  lists `home init`, `project create`, and `project import`, but does not define
  the product vocabulary before asking the user or agent to choose paths.
- `project import <source-root>` reads like the right command for each existing
  repository. In Nicolas' case that created several independent DevNexus
  projects, but the intended model was one new DevNexus project with several
  components.
- There is no obvious first-class command or setup flow for "make one new
  DevNexus project from these existing component directories".
- The agent had to inspect installed JavaScript files and manually edit
  `dev-nexus.project.json` to build a composite project. That is evidence that
  the public CLI surface is missing the normal workflow.
- The corrected project still felt naked because it did not obviously contain
  `AGENTS.md`, projected skills, target/context/plan files, or agent-specific
  next steps.
- The Codex next step is not explicit enough. DevNexus can generate
  project-local `.codex/config.toml`, but the user must also open or create a
  Codex project rooted at the same DevNexus project directory.
- The installed npm alpha and the online README were not fully aligned; the
  agent probed `--help` and found commands that were documented but unavailable
  in the installed package.
- Running several project imports in one command batch appeared to lose one
  `dev-nexus.home.json` registry entry, requiring manual repair.

## Desired First-Project Flow

A first user should be able to say:

```text
Create a DevNexus project named graphrag-research-suite using these existing
folders as components. Use benchmark-graphrag as primary, the two JSON repos as
dependencies, and the paper folder as an addon. I will use Codex.
```

DevNexus should then guide the agent through:

1. Choose or create a DevNexus home.
2. Choose a DevNexus project root that is not a component checkout.
3. Declare components with ids, names, roles, source paths or remotes, default
   branches, relationships, tracker stores, and worktree roots.
4. Validate the existing component paths without mutating them.
5. Create or update `dev-nexus.project.json` through public commands.
6. Materialize project support: `AGENTS.md`, context/plan/target state,
   `.dev-nexus/skills`, agent-native skill projections, and MCP config.
7. Print concise next steps: `project status`, `setup check`, open/create the
   Codex project at the DevNexus project root, and create the first
   component-scoped work item.

## Tracker Follow-Ups

- `dev-nexus:local-74` (complete): documentation update for README/getting-started,
  vocabulary, project-local component layout, multi-component first-project
  recipe, and Codex app project step.
- `dev-nexus:local-152`: guided first-project setup flow for existing
  components.
- `dev-nexus:local-153`: first-class `project component add` command so agents
  do not manually edit project JSON.
- `dev-nexus:local-154`: project creation should produce or repair
  agent-ready support files and projections.
- `dev-nexus:local-155`: make DevNexus home registry writes safe under
  concurrent project operations.
- `dev-nexus:local-156` (complete): add docs/published-command parity checks for
  onboarding examples.
