<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-21 | Updated: 2026-08-31 -->

# workflows

## Purpose

GitHub Actions workflow definitions.

## Key Files

| File | Description |
|------|-------------|
| `ci.yml` | Node 20/22 build + unit + pack smoke |
| `release.yml` | Tag `v*` → deterministic verification + pack/checksum + fork GitHub Release readback |

## For AI Agents

### Working In This Directory

- Tag version assert: package.json ≡ plugin.json ≡ Claude plugin/marketplace versions.
- Release package identity is `@zxjte9411/oh-my-agy`; tarball identity is `zxjte9411-oh-my-agy-X.Y.Z.tgz`.
- Do not remove e2e, checksum verification, existing-release rejection, or release readback without explicit product approval.
- Do not add npmjs/GitHub Packages publishing here unless separately approved.

<!-- MANUAL: -->
