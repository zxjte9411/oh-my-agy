# Package registry policy

The maintained fork uses **GitHub Releases**, not a package registry, as its binary distribution channel.

## Canonical identities

| Surface | Identity |
|---|---|
| Repository | `zxjte9411/oh-my-agy` |
| Package metadata | `@zxjte9411/oh-my-agy` |
| Release tarball | `zxjte9411-oh-my-agy-X.Y.Z.tgz` |
| Checksum | `SHA256SUMS` |

`@zxjte9411/oh-my-agy` is the package identity used by manifests and `npm pack`; it is **not** a claim that the package currently exists on npmjs or GitHub Packages.

## Disabled channels

Do not add any of the following without a separate product/security decision:

```text
npm publish
npm dist-tag
GitHub Packages publication
OIDC trusted publishing
registry write tokens/secrets
```

The release workflow should require only repository `contents: write` for the GitHub Release path. It must not require `packages: write` or `id-token: write` for the current distribution model.

## Supported installation sources

Verified GitHub Release:

```bash
curl -fsSLo /tmp/oma-install.sh \
  https://raw.githubusercontent.com/zxjte9411/oh-my-agy/main/scripts/install.sh
bash /tmp/oma-install.sh --github --tag v0.7.0
```

Source/development checkout:

```bash
git clone https://github.com/zxjte9411/oh-my-agy.git
cd oh-my-agy
bash scripts/install.sh --local-dev .
```

Do not instruct users to install the unrelated unscoped `oh-my-agy` package from npmjs.org. Do not use upstream `ImL1s/oh-my-agy` release assets as the distribution source for this fork.

## If registry publication is added later

Treat that as a new release architecture change. It must define namespace ownership, authentication, provenance/signing, overwrite policy, rollback/revocation, registry-vs-GitHub Release source of truth, installer behavior, and migration of existing receipts before any publish credential is introduced.
