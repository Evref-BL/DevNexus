# Contributing

DevNexus is a Node.js 22+ TypeScript project.

## Local setup

```bash
npm install
npm run check
```

For documentation changes:

```bash
npm --prefix website ci
npm --prefix website run build
```

## Change expectations

- Keep changes scoped to one behavior or cleanup slice.
- Preserve public CLI behavior unless the change intentionally updates it.
- Add or update tests for behavior changes.
- Keep generated runtime files, local worktrees, environment files, coverage,
  scanner output, and build output out of Git.
- Do not commit real tokens, private keys, host credentials, or realistic fake
  provider tokens.

## Pull requests

Before asking for review, run the narrowest useful check and then the broader
project check when feasible:

```bash
npm run check
```

For docs-site changes, also run:

```bash
npm --prefix website run build
```

Describe the user-visible change, the verification run, and any known follow-up
work that should stay out of the current pull request.
