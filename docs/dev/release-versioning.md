---
id: release-versioning
title: Release Versioning
---

# Release Versioning

DevNexus uses [Semantic Versioning](https://semver.org/). Treat that page as the
versioning reference instead of restating the rules here.

## Current Stage

The package is still in the `0.1.0-alpha.x` line. Keep the alpha label while
these surfaces can still change without compatibility guarantees:

- public package exports
- CLI command names, arguments, and JSON output
- workspace and home configuration shapes
- generated agent files and plugin contracts
- dashboard data contracts and embedding boundaries

## Release Labels

Use `0.y.z-alpha.x` while compatibility is still being discovered. Use a plain
`0.y.z` release only when the current behavior is useful enough to publish
without the alpha warning, while still accepting that `0.y.z` is not a stable
public API.

Use `1.0.0-beta.x` only for a declared 1.0 candidate. At that point, remaining
work should be stabilization, documentation, migration notes, and compatibility
checks.

Use `1.0.0` only after the public API is declared and the project is ready to
treat breaking changes as major-version work.

## Release Notes

Release notes should name user-visible features separately from maintenance
work. Do not hide a feature such as the dashboard inside a quality or hygiene
release note.
