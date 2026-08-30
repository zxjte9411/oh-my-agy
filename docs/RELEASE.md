# Release and installation

English | [简体中文](RELEASE.zh.md) | [繁體中文](RELEASE.zh-TW.md)

This document defines the release contract for the maintained fork **`zxjte9411/oh-my-agy`**.

## Distribution identity

- Repository: `zxjte9411/oh-my-agy`
- Package metadata: `@zxjte9411/oh-my-agy`
- GitHub tag: `vX.Y.Z`
- GitHub Release tarball: `zxjte9411-oh-my-agy-X.Y.Z.tgz`
- Checksum manifest: `SHA256SUMS`
- npmjs: not published
- GitHub Packages: not published

The project originated from `ImL1s/oh-my-agy`, but upstream releases are not a supported installation source for this fork.

## Version synchronization

Before a release, the exact version must agree across:

```text
package.json
plugin.json
.claude-plugin/plugin.json
.claude-plugin/marketplace.json
.claude-plugin/marketplace.json plugins[name=oh-my-agy]
```

For a tag workflow, `vX.Y.Z` must equal the manifest version `X.Y.Z`.

## Publication boundary

Pushing a matching `vX.Y.Z` tag is the privileged publication decision. The release workflow may publish only when the tag is in `zxjte9411/oh-my-agy`.

Before pushing the tag, the operator must run the live production evidence gate against the exact candidate Git OID with a real authenticated Antigravity host. CI intentionally cannot manufacture that evidence.

Recommended pre-tag gates:

```bash
npm ci
npm run build
npm run test:unit
TEST_DIST=true npm run test:e2e
npm run test:package
npm run smoke
npm run test:production
```

`npm run test:production` is a live gate and should fail closed when fresh evidence is absent.

## GitHub Release workflow

`.github/workflows/release.yml` runs on `v*` tags and can also be dispatched manually for verification. The tag path performs these steps in one verified workspace:

1. `npm ci`
2. build
3. unit tests
4. package tests
5. compiled CLI E2E (`TEST_DIST=true`)
6. smoke tests
7. package/tag/manifest identity verification
8. package readback verification
9. confirmation that the production gate does not false-green without live evidence
10. `npm pack --json --ignore-scripts`
11. exact tarball-name verification
12. `SHA256SUMS` creation and local checksum verification
13. fail if the GitHub Release already exists
14. create the GitHub Release with the tarball and `SHA256SUMS`
15. download both published assets back
16. byte-compare and re-check SHA-256

The workflow does not publish to npmjs or GitHub Packages.

## Verified GitHub Release installation

Download the installer from this fork:

```bash
curl -fsSLo /tmp/oma-install.sh \
  https://raw.githubusercontent.com/zxjte9411/oh-my-agy/main/scripts/install.sh
```

Install the latest GitHub Release:

```bash
bash /tmp/oma-install.sh --github
```

Install an exact tag:

```bash
bash /tmp/oma-install.sh --github --tag v0.7.0
```

GitHub mode resolves only `zxjte9411/oh-my-agy` and expects the fork-owned release asset name.

## Offline installation

Using the release checksum manifest:

```bash
bash /tmp/oma-install.sh \
  --asset ./zxjte9411-oh-my-agy-0.7.0.tgz \
  --checksums ./SHA256SUMS
```

Or with an explicitly trusted SHA-256 digest:

```bash
bash /tmp/oma-install.sh \
  --asset ./zxjte9411-oh-my-agy-0.7.0.tgz \
  --asset-sha256 <64-hex-sha256>
```

Offline mode performs no network or npm/build step.

## Source/development installation

```bash
git clone https://github.com/zxjte9411/oh-my-agy.git
cd oh-my-agy
bash scripts/install.sh --local-dev .
```

Local-dev is the only installer mode allowed to install dependencies and build candidate source.

## Installer safety contract

Release installation preserves these invariants:

- release bytes are SHA-256 verified before extraction or execution;
- release archives reject traversal, symlinks, and special entries;
- extraction and staging use owner-only directories;
- required runnable surfaces are checked before host mutation;
- immutable package identity is computed before activation;
- Antigravity plugin switching is performed through the existing transaction path;
- doctor/readback failures cannot be hidden by auxiliary host success;
- ownership receipts record the exact installed package/source identity;
- soft advisory warnings do not erase the successful primary receipt;
- update/uninstall ownership logic remains receipt-aware.

Do not weaken these rules merely to make a release pass.

## Native agents after install

Once `oma` is installed and on `PATH`:

```bash
oma native probe --live
oma agents install --scope user
oma agents doctor --scope user
```

For a repository-local installation:

```bash
oma agents install --scope project
oma agents doctor --scope project
```

Restart Antigravity and use `/agents` to verify discovery.

## Registry policy

Registry publication is intentionally disabled. The package name in `package.json` defines package/release identity and packed layout; it does not claim that `@zxjte9411/oh-my-agy` is available from npmjs or GitHub Packages.

See [`npm-publishing.md`](npm-publishing.md) for the registry boundary.
