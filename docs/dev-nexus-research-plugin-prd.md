# DevNexus-Research Plugin Product Requirements Document (PRD)

## Problem

DevNexus currently presents strongest as an engineering system: components,
source roots, worktrees, work items, verification commands, publication policy,
and developer-oriented plugin projections. That is a valuable first domain, but
it can accidentally make DevNexus feel like a developer tool rather than a
general coordination substrate.

Agent orchestration is useful for other knowledge-work domains where the same
core needs appear: durable project state, scoped work items, artifact
provenance, setup checks, human decision gates, agent briefing, verification,
and reproducible handoff. Academic research and paper writing are a strong
candidate domain because the work has explicit phases, many external sources,
high integrity risk, and a natural need for human-in-the-loop review.

The Academic Research Skills (ARS) project is a useful reference point. It
organizes academic work into research, writing, review, revision, finalization,
and experiment-support workflows; it emphasizes human checkpoints, citation and
claim integrity, source provenance, and adapter packaging for Codex. DevNexus
should learn from those product ideas without turning DevNexus core into an
academic-writing tool or copying license-restricted content into a commercial
or redistribution path by default.

## Goals

- Expand DevNexus dogfood direction beyond software engineering by defining a
  first non-engineering domain plugin: DevNexus-Research.
- Make DevNexus-Research an additive plugin that contributes research skills,
  setup checks, artifact conventions, and optional Model Context Protocol (MCP)
  tools without replacing generic DevNexus orchestration.
- Support academic workflows such as research-question scoping, literature
  review, systematic review planning, paper outline and drafting support,
  manuscript review, revision planning, citation checks, disclosure statements,
  experiment planning, and reproducibility validation.
- Preserve the human researcher as the decision owner. Agents may assist with
  source discovery, synthesis, critique, formatting, and verification, but must
  not fabricate evidence, hide uncertainty, or make authorship decisions.
- Make research artifacts durable: material passports, source manifests,
  bibliography state, claim-audit reports, review reports, revision matrices,
  and final export decisions should be project-owned artifacts rather than
  chat-only memory.
- Use ARS and its Codex sibling distribution as inspiration and optional
  integration candidates, with explicit attribution and license review.
- Keep DevNexus core generic; research-specific behavior belongs in the
  DevNexus-Research plugin or lower-level research tool integrations.

## Non-Goals

- Do not make DevNexus core know academic, citation, journal, or LaTeX-specific
  concepts.
- Do not silently vendor or adapt ARS content into DevNexus source without a
  license decision. ARS is published under Creative Commons
  Attribution-NonCommercial 4.0 International (CC BY-NC 4.0).
- Do not build an autonomous paper writer that bypasses researcher judgment.
- Do not help users disguise artificial intelligence assistance or evade venue
  disclosure requirements.
- Do not guarantee that a model can prove truth, citation support, novelty, or
  reproducibility. The plugin should expose evidence state and uncertainty.
- Do not require live paid APIs, Pandoc, LaTeX, Zotero, or external search
  services for the baseline plugin to load.
- Do not make domain plugins choose work or supervise implementation. The
  coordinator or human still chooses work; DevNexus records facts and supplies
  domain affordances.

## Source Inspiration

Academic Research Skills for Claude Code describes a complete academic pipeline
from research to publication, with separate Deep Research, Academic Paper,
Academic Paper Reviewer, and Academic Pipeline workflows. Its documented design
emphasizes user checkpoints, integrity gates, source verification, citation
audits, data-access-level metadata, reproducibility declarations, style
calibration, peer-review simulation, and a companion experiment agent.

The Codex-native ARS sibling packages the same workflow content as one
`academic-research-suite` skill with a router that selects a workflow on demand.
That packaging shape is especially relevant to DevNexus-Research because it
keeps large domain guidance behind a small entrypoint and avoids loading an
entire research suite into every context.

The useful DevNexus lessons are:

- A domain plugin can be a staged pipeline without becoming the project runner.
- Human checkpoints should be first-class and explicit.
- Integrity gates should be named, repeatable, and recorded as artifacts.
- Skills should have narrow routing and progressive disclosure.
- Source provenance and claim support need structured state, not just prose.
- Optional heavyweight tools should be setup-checked and reported, not assumed.
- License and attribution status are product requirements, not afterthoughts.

## Users

- A computer scientist writing a research paper, workshop submission, thesis
  chapter, grant proposal, or literature review.
- A researcher who wants help narrowing a topic into a research question before
  drafting.
- A student or academic who needs citation, structure, and revision support
  while staying responsible for claims and authorship.
- A reviewer or advisor using DevNexus to organize manuscript critique and
  revision follow-up.
- A DevNexus plugin author proving that DevNexus can support a non-engineering
  domain cleanly.

## User Stories

- As a researcher, I can create a DevNexus project for a paper and see research
  phases, artifacts, and next actions without pretending the work is a software
  repository.
- As a researcher with only a broad topic, I can use a Socratic scoping skill
  to converge on candidate research questions before outline or drafting work
  begins.
- As a literature-review author, I can maintain a source manifest and
  bibliography state that agents use read-only and cite explicitly.
- As an author, I can ask for outline, abstract, revision, or disclosure support
  with the plugin routing to the relevant workflow.
- As a reviewer, I can run a read-only manuscript review that produces a
  decision letter, issue matrix, and revision roadmap without adding new claims.
- As a coordinator, I can see whether Pandoc, LaTeX, PDF text extraction,
  Zotero, Semantic Scholar, Crossref, OpenAlex, or other optional tools are
  available before assigning research work.
- As a project owner, I can opt into using the existing ARS Codex skill or use
  DevNexus-native research skills, with attribution and license status clear.

## Product Model

DevNexus-Research should initially be a DevNexus plugin package and optional
project component, similar in relationship to DevNexus-Pharo and
DevNexus-TypeScript.

The plugin contributes:

- Projected skills:
  - `research-question-scope`
  - `literature-review`
  - `systematic-review-protocol`
  - `academic-paper-planning`
  - `academic-paper-revision`
  - `manuscript-review`
  - `citation-integrity`
  - `research-artifact-handoff`
  - `experiment-planning`
- Worker context fragments:
  - human-in-the-loop authorship policy
  - evidence and citation integrity policy
  - artifact and source provenance policy
  - venue disclosure policy
- Setup obligations:
  - optional bibliography/source tooling check
  - optional document export tooling check
  - optional external-index API readiness check
  - license/attribution mode check when upstream ARS content is used
- Environment hints:
  - paths for source corpus, draft manuscript, bibliography files, material
    passport, and export output
  - optional API keys or profiles by name only, never secret values
- Optional MCP servers:
  - a research corpus/status surface for source manifests and bibliography
    facts
  - a citation/source verification surface using provider adapters when
    configured
  - a document export/status surface when Pandoc or LaTeX tooling is present

The plugin should work in a minimal mode with skills and artifact conventions
only. MCP-backed integrations can be added after the baseline package proves
useful.

## Artifact Model

Research work needs explicit artifacts because chat memory is not enough.
DevNexus-Research should define artifact conventions that can live inside a
research project or a configured artifacts directory:

- `research-brief.md`: project topic, research question candidates, scope,
  methodology assumptions, and unresolved decisions.
- `source-manifest.yaml`: source records, identifiers, retrieval dates,
  verification state, and source pointers.
- `material-passport.yaml`: declared corpus, data provenance, constraints,
  reproducibility notes, and integrity-gate status.
- `claim-register.yaml`: claims, citation anchors, support status, and
  unresolved warnings.
- `review-package.md`: reviewer reports, editorial decision, critique matrix,
  and revision priorities.
- `revision-matrix.yaml`: reviewer concern, author response, changed artifact,
  and verification result.
- `export-decision.md`: target venue/style, output formats, disclosure
  statement, and final unresolved warnings.

These files are conventions, not mandatory fixed paths. The plugin should let a
project choose names and storage locations through configuration.

## Pipeline Direction

The baseline DevNexus-Research pipeline should be staged but not monolithic:

1. Scope: clarify research question, contribution, venue or audience, methods,
   and available materials.
2. Research: build source manifest, literature map, inclusion/exclusion notes,
   and gaps.
3. Plan: produce paper architecture, argument map, evidence gaps, and output
   constraints.
4. Draft support: help draft sections only from declared materials and mark
   unsupported claims as gaps.
5. Integrity check: inspect citations, claims, dates, data provenance, and
   unsupported assertions.
6. Review: simulate editorial and peer-review critique in read-only mode.
7. Revise: turn critique into a revision matrix and update declared artifacts.
8. Finalize: prepare output format, citation style, disclosure, and unresolved
   warning report.
9. Process summary: record what the human decided, what agents assisted with,
   what remains uncertain, and which artifacts are final.

Every stage should be resumable. Human checkpoints should be recorded as
decisions in the project or work-item trail, not only as chat text.

## Integration With Existing ARS

There are three possible integration levels:

- Inspiration only: DevNexus-Research implements its own skills and artifact
  model using ARS as an attributed product reference.
- Optional external skill projection: DevNexus-Research detects or documents
  installation of the ARS Codex `academic-research-suite` skill, then projects
  DevNexus context and artifact paths around it.
- Bundled/adapted content: DevNexus-Research vendors adapted ARS content. This
  requires an explicit license and publication decision before implementation,
  especially for any commercial, company, or broader redistribution use.

The recommended first slice is inspiration plus optional external-skill
projection. That proves the DevNexus domain-plugin model and avoids a premature
license trap.

## Implementation Decisions

- Implement DevNexus-Research as a plugin package with no generic DevNexus
  behavior in its source.
- Start with projected skills, setup checks, artifact conventions, and worker
  briefing fragments before adding live MCP services.
- Keep the skill router small. The default projected skill should select a
  research workflow and load only the workflow-specific guidance needed for the
  current stage.
- Treat source ingestion and bibliography mutation as explicit operations.
  Research agents should not silently mutate source manifests while writing.
- Use data zones inspired by ARS: raw sources, redacted/draft material, and
  verified-only review or integrity material.
- Keep review workflows read-only unless the user explicitly enters a revision
  stage.
- Report unresolved evidence, citation, date, or venue-policy uncertainty in a
  structured artifact.
- Make upstream ARS installation an optional setup path, not a hidden
  dependency.
- Add a dogfood example project only after the baseline plugin skeleton and
  license posture are clear.

## Testing Decisions

- Unit-test plugin capability projection with fake research skills and setup
  checks.
- Unit-test setup output when optional tools are present, missing, or explicitly
  not configured.
- Unit-test active-agent target filtering so research skills project only to
  selected providers.
- Unit-test artifact path rendering and worker briefing text without requiring
  Pandoc, LaTeX, Zotero, or network APIs.
- Unit-test license-mode reporting for inspiration-only, optional external ARS,
  and bundled-content modes.
- Add smoke tests for a minimal research project that can create a research
  brief and source manifest with no external services.
- Keep live external API checks opt-in and mocked by default.

## Acceptance Criteria

- A DevNexus-Research PRD exists and is linked from local dogfood work items.
- The dogfood plan recognizes research as the first non-engineering plugin
  direction.
- Work items exist for license/integration posture, plugin skeleton, projected
  skills, setup/artifact conventions, optional ARS Codex integration, and a
  dogfood paper-project smoke.
- The baseline plugin can be installed or configured in a DevNexus project
  without adding research-specific behavior to DevNexus core.
- Worker context for a research project exposes research workflows, artifact
  paths, human checkpoint policy, and optional tool readiness.
- The plugin can run in a no-network, no-LaTeX baseline mode.
- Any ARS-derived or ARS-adapted content has explicit attribution and a clear
  license posture before publication.

## Open Questions

- Should DevNexus-Research be a repository under the same organization as
  DevNexus-Pharo and DevNexus-TypeScript, or begin as a dogfood-local plugin
  prototype?
- Is the intended distribution strictly personal/noncommercial, or should the
  plugin be safe for commercial DevNexus use from the start?
- Should the first dogfood example be a real computer-science paper project, a
  synthetic fixture, or a public open-source research note?
- Which bibliography/source integrations matter first: Zotero, BibTeX, folder
  of PDFs, Semantic Scholar, Crossref, OpenAlex, arXiv, or Obsidian?
- How should DevNexus represent human checkpoint approvals: work-item comments,
  target-cycle decisions, artifact frontmatter, or a dedicated decision ledger?

## References

- Academic Research Skills for Claude Code:
  https://github.com/Imbad0202/academic-research-skills
- Academic Research Skills architecture:
  https://github.com/Imbad0202/academic-research-skills/blob/main/docs/ARCHITECTURE.md
- Academic Research Skills for Codex:
  https://github.com/Imbad0202/academic-research-skills-codex
- ARS Codex adapter entrypoint:
  https://github.com/Imbad0202/academic-research-skills-codex/blob/main/skills/academic-research-suite/SKILL.md
- ARS license:
  https://github.com/Imbad0202/academic-research-skills/blob/main/LICENSE
