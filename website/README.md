# DevNexus Website

This directory contains the Docusaurus app that publishes the DevNexus
documentation site.

The Markdown source of truth stays in `../docs` so agents, npm package users,
and GitHub readers can consume the docs without running the website build.

```bash
npm ci
npm run start
npm run build
```
