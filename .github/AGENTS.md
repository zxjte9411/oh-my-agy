<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-21 | Updated: 2026-08-31 -->

# .github

## Purpose

GitHub Actions CI and release automation for `@zxjte9411/oh-my-agy`.

## Key Files

None at this level beyond workflows.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `workflows/` | `ci.yml`, `release.yml` |

## For AI Agents

### Working In This Directory

- Release tags `v*` must equal package/plugin/.claude-plugin versions.
- The fork release channel is GitHub Releases in `zxjte9411/oh-my-agy` with `zxjte9411-oh-my-agy-X.Y.Z.tgz` plus `SHA256SUMS`.
- Release runs deterministic build/unit/package/e2e/smoke gates before creating the GitHub Release and read-backing the exact assets.
- Do not add npmjs or GitHub Packages publication without a separate product decision and registry-safety review.

### Testing Requirements

- Workflows are the source of truth for release gates; do not weaken e2e, checksum, or readback requirements without product approval.

## Dependencies

### External

- GitHub Actions runners and `GITHUB_TOKEN` for the repository-owned GitHub Release.

<!-- MANUAL: -->
