# DevNexus README And First-Project Onboarding Product Requirements Document (PRD)

Date: 2026-05-20

## Problem Statement

First-time readers still do not understand DevNexus from the README. The
current README contains many correct facts, but it reads like generated
reference material: it introduces abstract terms, setup variants, authentication
profiles, hosting handoffs, Model Context Protocol (MCP), automation commands,
and worktree workflows before the reader has a stable mental model.

The practical explanation that works in conversation is simpler:

DevNexus is infrastructure for working with agents on a project. It creates a
project folder, a bit like a Maven or Gradle project root, that contains agent
instructions, skills, context files, project metadata, and work tracking. The
project points at one or more components, which are the repositories, papers,
spreadsheets, or other things the user wants to work on. A human then works with
an agent from that DevNexus project root.

The README should teach that model before naming advanced machinery. Humans
should understand what DevNexus is in a few minutes. Agents should be able to
follow the quick start without inventing paths, creating several projects when
the user wanted one project with several components, or manually editing JSON.

## Goals

- Make the README human-first and short enough to read.
- Define every product term before using it in commands or examples.
- Make the quick start a true fast path for humans and agents.
- Keep advanced details in deeper documentation.
- Make the first-project path default to safe, boring choices.
- Make the generated `AGENTS.md` carry agent workflow details after project
  creation, so the README does not need to teach every agent workflow.

## Non-Goals

- Do not explain every DevNexus command in the README.
- Do not teach full automation, publication policy, branch policy, hosting
  provisioning, provider sync, or MCP internals in the quick start.
- Do not require users to understand DevNexus home paths, auth profiles, or
  hosting before creating a local first project.
- Do not position DevNexus as the agent, the supervisor, or a replacement for
  GitHub, GitLab, Jira, Codex, Claude, or a human maintainer.

## Product Vocabulary

Use these definitions consistently and introduce them in this order:

- DevNexus: infrastructure for working with agents on one project.
- DevNexus project: the directory the user creates and opens in their agent
  tool. It contains project metadata, generated agent instructions, skills,
  local work tracking, and coordination state.
- Component: something the project works on, such as a source repository,
  plugin, paper, dataset, spreadsheet, or documentation folder.
- Component source root: the actual folder for a component.
- Work item: a task or issue for a component. It can live in DevNexus' local
  tracker or in a provider such as GitHub Issues, GitLab issues, or Jira.
- DevNexus home: user-local registry and host setup state. It defaults to
  `~/.dev-nexus` and most first-time users should not need to choose it.
- Agent files: generated files such as `AGENTS.md`, projected skills, and MCP
  config that tell tools like Codex how to work in the project.
- Worktree: an isolated Git checkout for agent implementation work. This is a
  later workflow concept, not a first-minute concept.
- Plugin: an optional package that contributes domain-specific setup, skills,
  and tools.

Avoid using these terms before defining them: home, project root, component,
source root, tracker, MCP, worktree, target, automation, profile, publication,
handoff, coordination, plugin.

## Proposed README Shape

1. What DevNexus is.
2. What DevNexus creates.
3. A small terminology block.
4. Install.
5. Quick start: create one project, add components, open the project in Codex.
6. What to do next.
7. Links to detailed docs.

The README should not be a complete command reference. A new reader should be
able to stop after the quick start and have a useful project.

## Proposed Opening

DevNexus helps you work with coding agents on real projects.

You create a DevNexus project directory and open that directory in Codex,
Claude, or another supported agent. The project stores the instructions,
skills, local task list, and configuration that agents need. The project points
at one or more components: the repositories, documents, papers, or datasets you
want to work on.

DevNexus does not replace the agent or choose the work for you. You still tell
the agent what you want. DevNexus gives the agent a consistent project map,
safe work areas, task tracking, and generated instructions.

## Quick Start Requirements

The fast path should be:

1. Install the command-line interface (CLI).
2. Create a first project.
3. Add or select component folders.
4. Generate agent files.
5. Open the DevNexus project directory in Codex.
6. Ask the agent to inspect the project and create the first work items.

Preferred shape:

```text
npm install -g @evref-bl/dev-nexus
dev-nexus project setup ~/dev-nexus/my-project
```

When run in a terminal, `project setup` should be interactive by default. It
should ask for only the minimum first-project answers:

- project name
- component folders or repository URLs
- primary component when there is more than one component
- agent target, such as Codex
- local work tracking enabled by default

It should default the DevNexus home to `~/.dev-nexus`, initialize it when
needed, and explain that the user usually does not care about it.

For agents and non-interactive use, answer files remain useful, but they should
be an automation path, not the first human-facing quick start.

## First-Project Behavior

After setup, the project should be immediately understandable:

- The project directory is a Git repository unless disabled.
- The project contains `dev-nexus.project.json`.
- The project contains generated `AGENTS.md`.
- The project contains projected skills for the selected agent target.
- The project contains local work tracking unless the user opted out.
- The project status command says whether the project is ready.
- The final message tells the user to open the DevNexus project directory in
  Codex, not one of the component repositories.

The setup output should end with short next steps:

```text
Next:
1. Open ~/dev-nexus/my-project in Codex.
2. Ask: "Inspect this DevNexus project and tell me if it is ready."
3. Create a first work item or ask the agent to triage the components.
```

## Documentation Structure

Keep README as the front door.

Move depth to focused documents:

- Getting started: interactive setup, answer-file setup, existing components,
  and first work item.
- Concepts: project, component, work item, home, worktree, plugin, agent files.
- Agent workflows: generated `AGENTS.md`, skills, worktrees, subagents,
  coordination, and handoffs.
- Providers: GitHub, GitLab, Jira, auth profiles, human and bot accounts.
- Hosting: whether and where to push the DevNexus meta-project.
- Automation: target loops, scheduler, coordinator behavior, result files.
- Command reference: complete CLI details.

## User Stories

- As a new human user, I can read the README and explain DevNexus in one minute.
- As a new human user, I can create a first local DevNexus project without
  understanding `~/.dev-nexus`, MCP, hosting, auth profiles, or worktrees.
- As a human with several existing repositories, I can create one DevNexus
  project with several components instead of accidentally creating several
  DevNexus projects.
- As an agent reading the README, I can guide a first-time user through setup
  without manually editing project JSON.
- As a maintainer, I can point advanced users to deeper docs without bloating
  the README.

## Implementation Decisions

- The README should introduce terms before commands.
- The README should use a conversational product explanation before any
  reference-style details.
- The quick start should not mention `project create` or `project import`
  except as advanced alternatives after the recommended setup path.
- The DevNexus home should have a default and be optional in first-project
  instructions.
- Interactive setup should be the human default; answer files should remain the
  agent, continuous integration, and reproducible setup path.
- The first setup flow should not perform provider mutations. GitHub, GitLab,
  Jira, and hosting setup remain explicit later steps.
- Generated `AGENTS.md` should explain agent behavior after setup, including
  skills, worktrees, and coordination.

## Testing And Review

- Add or update tests that keep README quick-start commands aligned with the
  installed command-line interface (CLI).
- Add a smoke test for `project setup <project-root>` interactive or
  prompt-driven defaults when no answer file is supplied.
- Add a non-interactive answer-file smoke test for agents.
- Keep continuous integration (CI) checks for the documentation examples.
- Add documentation checks or review rules that reject README usage of core
  terms before they are defined.
- Run a human read-through review: a reader should be able to answer "what is
  DevNexus?", "where do I open Codex?", and "what is a component?" without
  reading deeper docs.

## Open Questions

- Should `dev-nexus project setup <project-root>` become interactive by default
  when stdin is a terminal?
- Should the README include one tiny example with existing component paths, or
  should that live only in Getting Started?
- Should the generated `AGENTS.md` include a first-run checklist for agents,
  such as `project status`, readiness check, and first work-item triage?
- Should DevNexus create a starter local work item during setup, or should it
  only tell the user how to create one?
