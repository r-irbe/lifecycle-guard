# Security policy

## Reporting

Report suspected vulnerabilities privately through GitHub Security Advisories on
this repository. Do not open a public issue for a suspected vulnerability.

Include: affected version or commit, a minimal reproduction, the impact you
believe it has, and any mitigations you have already tried.

## Scope

This package runs inside an agent harness with the operator's full filesystem
permissions. Two areas matter most:

1. **Policy bypass.** Any input that makes the guard return `allow` for an
   action the policy should block is a security issue. Bypasses are in scope,
   including shell quoting tricks, command substitution, and encodings.
2. **Secret handling.** Secret scanning must never write a raw secret value to
   the audit log, a report, or stdout. Leaks through logs are in scope.

## Threat model boundaries

The guard is an accident-prevention layer, not a sandbox. It does not try to
contain a determined adversary who already has code execution; it prevents the
common destructive mistakes that measured agent runs actually made.

## Response

Maintainers acknowledge reports within five working days and aim to ship a fix
or a documented mitigation within thirty days for confirmed issues.
