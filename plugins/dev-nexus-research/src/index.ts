export const devNexusResearchSkillIds = [
  "research-workflow-router",
] as const;

export const devNexusResearchArtifactHints = [
  {
    id: "research-brief",
    defaultPath: "research-brief.md",
    description:
      "Research question, scope, methodology assumptions, and unresolved decisions.",
  },
  {
    id: "source-manifest",
    defaultPath: "source-manifest.yaml",
    description:
      "Source records, retrieval dates, verification state, and stable source pointers.",
  },
  {
    id: "claim-register",
    defaultPath: "claim-register.yaml",
    description:
      "Claims, citation anchors, support status, and unresolved evidence warnings.",
  },
] as const;

export const devNexusResearchPlugin = {
  id: "dev-nexus-research",
  name: "DevNexus Research",
  version: "0.1.0-alpha.0",
  enabled: true,
  capabilities: [
    {
      kind: "projected_skill",
      id: "skill-research-workflow-router",
      skillId: "research-workflow-router",
      description:
        "Project the placeholder research workflow router into research-capable agents.",
      targetAgents: ["codex", "claude"],
    },
    {
      kind: "setup_obligation",
      id: "confirm-research-source-policy",
      description:
        "Confirm the project has a declared source and citation policy before assigning research synthesis work.",
      required: true,
    },
    {
      kind: "environment_hint",
      id: "env-research-artifacts-dir",
      variable: "DEV_NEXUS_RESEARCH_ARTIFACTS_DIR",
      description:
        "Optional project-relative directory for research briefs, source manifests, and claim registers.",
      valueHint: "research",
      required: false,
    },
    {
      kind: "environment_hint",
      id: "env-research-source-manifest",
      variable: "DEV_NEXUS_RESEARCH_SOURCE_MANIFEST",
      description:
        "Optional project-relative source manifest path used by research agents.",
      valueHint: "research/source-manifest.yaml",
      required: false,
    },
    {
      kind: "worker_context_fragment",
      id: "context-human-research-boundary",
      title: "Human Research Boundary",
      body:
        "DevNexus Research is an additive domain plugin. It contributes research setup context and artifact conventions while DevNexus core keeps owning generic project, tracker, worktree, coordination, and target-cycle behavior. The human researcher remains responsible for research questions, claims, authorship, venue decisions, and final submissions.",
      targetAgents: ["codex", "claude"],
      targetComponents: ["research-project"],
      provenance: "DevNexus Research plugin skeleton",
    },
    {
      kind: "worker_context_fragment",
      id: "context-evidence-integrity",
      title: "Evidence Integrity",
      body:
        "Treat source manifests and bibliography state as declared project artifacts. Do not invent citations, silently change source records, or hide uncertainty. Mark unsupported claims as gaps and record unresolved evidence, date, methodology, or venue-policy warnings.",
      targetAgents: ["codex", "claude"],
      targetComponents: ["research-project"],
      provenance: "DevNexus Research plugin skeleton",
    },
    {
      kind: "worker_briefing_fragment",
      id: "briefing-research-artifacts",
      title: "Research Artifacts",
      body:
        "Use research-brief.md, source-manifest.yaml, and claim-register.yaml as baseline artifact conventions when the project has not chosen custom paths. Keep the no-network baseline useful; optional citation, export, or index integrations must be setup-checked before use.",
      targetAgents: ["codex", "claude"],
      targetComponents: ["research-project"],
      provenance: "DevNexus Research plugin skeleton",
    },
  ],
} as const;

export type DevNexusResearchPlugin = typeof devNexusResearchPlugin;
export type DevNexusResearchArtifactHint =
  (typeof devNexusResearchArtifactHints)[number];
