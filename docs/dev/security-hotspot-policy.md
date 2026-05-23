# Security Hotspot Policy

This note records how DevNexus handles the remaining local Sonar security
hotspots from the 2026-05-23 source-quality audit. It is for contributors and
future agents making follow-up cleanup slices.

## Quality gate

The local Sonar gate fails on bugs, vulnerabilities, and HIGH-probability
security hotspots. MEDIUM and LOW security hotspots remain review items unless
they expose untrusted data, local privilege boundaries, or command execution.

Do not suppress hotspot findings just to reduce the count. Fix the code when the
replacement is smaller or clearer, and document an accepted risk when the
warning is policy-sensitive.

## Regex DoS

Sonar rule `typescript:S5852` flags regular expressions with super-linear
backtracking risk. DevNexus treats these as real review items because many
inputs come from provider data, repository metadata, workspace config, and
agent-written files.

Preferred handling:

- Replace simple parsing regexes with deterministic string parsing.
- Keep regexes only when they are clearly bounded, easier to read than the
  equivalent parser, and not fed by large untrusted input.
- Add focused tests when replacing a parser.
- Do not add a non-backtracking regex runtime such as RE2 globally unless a
  future slice proves that code clarity and portability are still acceptable.

Triage order:

1. External provider or user-controlled text without strict length limits.
2. Repository or workspace metadata read from local files.
3. Internal/generated strings with bounded length.

References:

- Sonar rule `typescript:S5852`: <https://rules.sonarsource.com/javascript/RSPEC-5852>
- OWASP Regular expression Denial of Service:
  <https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS>
- CWE-1333, Inefficient Regular Expression Complexity:
  <https://cwe.mitre.org/data/definitions/1333.html>

## PATH command lookup

Sonar rule `typescript:S4036` flags command execution that relies on the
process `PATH`. DevNexus cannot globally hard-code `/usr/bin/git` or similar
paths because it runs on macOS, Linux, Windows, CI images, Homebrew, Nix, and
user-managed toolchains.

Preferred handling:

- Route DevNexus-owned OS command execution through one command-resolution
  helper.
- Accept configured absolute executable paths when available.
- Resolve bare commands against an explicit trusted `PATH`.
- Reject empty, relative, current-directory, project-local, temp-directory, or
  writable search-path entries where the host platform exposes enough file mode
  information.
- Report the resolved command path in diagnostics/status surfaces where useful.

Do not fix these hotspots by hard-coding one platform path at each call site.
Do not scatter line-level suppressions before a shared resolver exists.

References:

- Sonar rule `typescript:S4036`: <https://rules.sonarsource.com/typescript/tag/cwe/rspec-4036/>
- CWE-426, Untrusted Search Path:
  <https://cwe.mitre.org/data/definitions/426.html>
- CWE-427, Uncontrolled Search Path Element:
  <https://cwe.mitre.org/data/definitions/427.html>
- Node.js `child_process`: <https://nodejs.org/api/child_process.html>
