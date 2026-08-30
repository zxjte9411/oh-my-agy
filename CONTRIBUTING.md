# Contributing

Thanks for your interest in **oh-my-agy** — an Antigravity orchestration layer with session skills, native agents, and the local `oma` CLI.

This fork is developed and released from `zxjte9411/oh-my-agy`. The upstream `ImL1s/oh-my-agy` repository is project lineage, not the operational issue/release target for this fork.

## Dev setup

```bash
git clone https://github.com/zxjte9411/oh-my-agy.git
cd oh-my-agy
npm ci
npm run build
```

`agy` is required only for live/native production gates. Unit/package tests and mock-host E2E do not require authenticated Antigravity.

## Tests and local gates

```bash
npm run build
npm run test:unit
TEST_DIST=true npm run test:e2e
npm run test:package
npm run smoke
npx tsx scripts/check-parity.ts
npx tsx scripts/check-traceability.ts
npx tsx scripts/check-writer-ownership.ts
```

`npm run test:production` is a separate live gate. It accepts only fresh schema-bound evidence tied to the exact candidate Git OID and requires a real authenticated `agy`. See [`docs/RELEASE.md`](docs/RELEASE.md).

## Ground rules

- Keep the smallest reversible change with an evidence-backed stop condition.
- Do not weaken fail-closed paths to make tests pass.
- Redact secrets, tokens, credentials, and private content from logs and diagnostics.
- Version bumps must keep `package.json`, `plugin.json`, `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json` synchronized.
- Release/install code must keep checksum-before-execution, immutable staging, readback, and ownership receipts intact.
- Do not add npmjs or GitHub Packages publishing without a separate product decision.
- Run the local gates above before opening a PR.

## Release ownership

The fork package identity is `@zxjte9411/oh-my-agy`. GitHub Releases in this repository are the only supported binary distribution channel. A release tag is a privileged publication decision: complete required live production evidence before pushing the matching `vX.Y.Z` tag.

## Locale / translations

Canonical product docs are English (`README.md`, `docs/*.md`). Localized README copies live under [`docs/readme/`](docs/readme/README.md); translated topic docs use sibling `.zh.md` / `.zh-TW.md` files. Preserve identifiers (`oma`, `omy`, `agy`, capability names) and scope honesty in every locale.

## Reporting security issues

See [`SECURITY.md`](SECURITY.md). Use a private advisory rather than a public issue for vulnerabilities.
