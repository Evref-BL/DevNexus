# Generic IDE MCP Findings

Date: 2026-05-21

## Question

Could the Pharo MCP idea generalize into a language-neutral IDE MCP that lets
agents inspect, query, refactor, test, and edit code through semantic IDE
capabilities rather than raw file reads?

## Findings

Yes, but the generic layer should be a capability model over existing semantic
engines, not a single universal code model.

The strongest existing generic substrate is the Language Server Protocol (LSP).
LSP already standardizes many editor capabilities that agents need: definitions,
references, implementations, call hierarchy, type hierarchy, diagnostics,
signature help, code actions, rename, document symbols, and workspace symbols.
That makes LSP the right default adapter surface for common navigation and
local refactoring.

LSP falls short when the agent needs broader or more abstract queries, such as
"find all functions whose signatures match this shape" or "find methods that
behave like the Pharo selector pattern `(select|collect)Items`." LSP has
signature help at a call site and symbol search by name or kind, but it does
not define a portable global signature-query language. A generalized IDE MCP
would need its own normalized symbol schema and capability negotiation so each
backend can say which filters are precise, approximate, or unsupported.

Existing MCP work already points in this direction:

- Serena exposes agent-oriented semantic retrieval and editing on top of
  language-server-style project understanding.
- Symbols MCP connects MCP clients to language servers for symbol navigation,
  inspection, references, call hierarchy, rename, diagnostics, and completions.
- JetBrains IDEs expose an integrated MCP server backed by IDE project models,
  run configurations, formatting, problem inspection, symbol info, and rename.
- Tree-sitter and ast-grep are useful for structural matching across languages,
  but they do not provide semantic type information by themselves.
- SCIP and LSIF show how persisted code-intelligence indexes can answer
  definition/reference-style questions without a live language server, which
  matters for large repositories and cross-repository work.
- OpenRewrite is a strong example of deeper automated refactoring over
  semantic, formatting-preserving trees, especially for Java and framework
  migrations. It is not a general LSP replacement, but it is a useful model for
  backend-specific high-confidence rewrite engines.

## Design Direction

Expose high-level agent tools and route them to the best backend for the
language and operation.

Candidate tools:

- `search_symbols`: find classes, functions, methods, variables, or modules by
  name, kind, owner, signature shape, annotation, visibility, or file scope.
- `inspect_symbol`: return signature, declaration, documentation, inferred
  type, implementors, callers, callees, tests, diagnostics, and source range.
- `find_references`: return semantic references with read/write/call context
  where the backend supports it.
- `propose_refactor`: ask the backend for safe rename, extract, move, inline,
  or code-action edits with previewable diffs.
- `apply_refactor`: apply a previously previewed edit set.
- `run_symbol_tests`: map a symbol or package to focused tests and execute the
  backend's test runner.
- `query_structure`: run AST/tree queries for cases where semantic services do
  not expose the desired shape.

Backends should be explicit:

- Pharo uses the live image and IDE model directly.
- TypeScript can use the TypeScript language service or an LSP adapter.
- Go can use `gopls`.
- Rust can use `rust-analyzer`.
- Java and Kotlin can use LSP, JetBrains, JDT, OpenRewrite, or a combination
  depending on the operation.
- Tree-sitter or ast-grep can fill structural-search gaps.
- SCIP, LSIF, or Sourcegraph-style indexes can support offline and cross-repo
  navigation.

The Pharo MCP remains valuable as the reference backend because the image
already has a complete live IDE model: selectors, implementors, senders,
refactorings, test runners, critiques, packages, and runtime objects. The
generic MCP should preserve that richness by advertising backend capabilities
instead of forcing every language into the lowest common LSP subset.

## Implication

A useful product direction is "generic IDE capabilities with pluggable semantic
authorities." LSP should be the default path, but the MCP should let richer
backends expose richer operations and should report confidence, precision, and
previewability for each result or edit.

## Sources

- [Language Server Protocol 3.17 specification](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)
- [Serena MCP toolkit](https://github.com/oraios/serena)
- [Symbols MCP](https://github.com/p1va/symbols)
- [JetBrains MCP Server documentation](https://www.jetbrains.com/help/webstorm/mcp-server.html)
- [Tree-sitter introduction](https://tree-sitter.github.io/tree-sitter/)
- [ast-grep MCP Server](https://github.com/ast-grep/ast-grep-mcp)
- [SCIP Code Intelligence Protocol](https://scip-code.org/)
- [LSIF.dev](https://lsif.dev/)
- [OpenRewrite documentation](https://docs.openrewrite.org/)
