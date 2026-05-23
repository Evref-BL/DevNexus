# Automation Command Execution

DevNexus automation commands run as an executable plus argv, without an
implicit shell.

This applies to configured executor commands, configured verification commands,
agent launch commands, and CLI `--command` overrides. Existing string
configuration remains accepted for compatibility, but the string is parsed as a
small argv expression:

```text
command arg "argument with spaces"
```

Unquoted shell control syntax such as `&&`, `|`, `;`, redirects, and command
groups is rejected. Quoted operator characters are ordinary argument data. If a
workspace truly needs shell behavior, make the shell executable explicit and keep
the shell script fixed and trusted, for example `sh -c "npm test && npm run
check"`, or prefer a checked-in script.

## Rationale

The default runner uses `child_process.spawnSync(command, args, { shell: false
})`. Sonar rule `javascript:S4721` treats implicit shell execution as a command
injection hotspot. Node documents `shell` as the option that chooses a shell for
the command. OWASP command-injection guidance recommends avoiding shell
interpreters and separating command arguments whenever the platform API allows
it.

Do not interpolate provider text, tracker fields, model output, issue titles, or
other untrusted data into command strings. Pass data through environment
variables, files, or fixed argv entries instead.

Sources:

- Sonar rule `javascript:S4721`: <https://rules.sonarsource.com/javascript/RSPEC-4721/>
- Node.js `child_process`: <https://nodejs.org/api/child_process.html>
- OWASP OS command injection defense cheat sheet:
  <https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html>
