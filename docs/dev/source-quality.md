---
id: source-quality
title: Source Quality
---

# Source Quality

DevNexus uses normal build/test checks plus optional SonarQube analysis.

## Local Checks

Run the standard check before handing off source changes:

```bash
npm run check
```

For Sonar-driven quality work, run:

```bash
npm run quality:sonar-local
```

The local command starts a temporary Docker SonarQube Community Build server,
runs coverage and the Sonar scanner, evaluates a lenient local gate, then
removes the container, network, and `.scannerwork` output. It is intentionally
not part of `npm run check` because it requires Docker and is slower than the
normal development loop.

The local gate fails on Sonar bugs, vulnerabilities, missing/low coverage, or
high duplication. Security hotspots and critical/blocker code smells are
reported for review; existing complexity debt is not a local merge blocker by
itself.

## CI SonarQube

`.github/workflows/sonar.yml` runs the official SonarQube scan action when a
`SONAR_TOKEN` repository secret is configured. Without the secret, the workflow
exits successfully with a notice so the repository can merge before Sonar is
set up.

For SonarQube Cloud, create a public/open-source project, add the repository
secret `SONAR_TOKEN`, and set repository variable `SONAR_ORGANIZATION` when the
organization key is not already in `sonar-project.properties`.

For self-managed SonarQube Community Build, add `SONAR_TOKEN` and set
repository variable `SONAR_HOST_URL` to a server that GitHub Actions can reach.
Do not set `SONAR_HOST_URL` for SonarQube Cloud; the official action uses the
cloud service by default.

The token is a GitHub Actions repository secret, not a checked-in value. Until a
maintainer adds it under repository settings, the workflow will skip analysis.
Pull requests from forks also do not receive repository secrets under the normal
`pull_request` event, so those scans skip unless a maintainer reruns them from a
trusted branch.

The shared CI gate should stay Clean-as-You-Code oriented: block new bugs,
vulnerabilities, and failed official quality gates, but do not block solely on
pre-existing complexity debt.

## Agent Instructions

Repository-wide agent instructions live in `AGENTS.md`. Keep the root file
short and practical: repository map, working rules, commands, quality checks,
documentation expectations, and publication boundaries. Add nested `AGENTS.md`
files only when a subtree has different rules; closer instruction files override
broader ones for agents that support hierarchical discovery.

References:

- [OpenAI Codex AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md)
- [AGENTS.md format site](https://agents.md/)
- [SonarQube Cloud GitHub Actions setup](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/ci-based-analysis/github-actions-for-sonarcloud)
- [GitHub Actions forked pull request secret behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflows-in-forked-repositories)
