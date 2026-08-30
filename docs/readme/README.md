# oh-my-agy (OMA / OMY)

English | [简体中文](README.zh.md) | [繁體中文](README.zh-TW.md)

This is the documentation mirror for the maintained fork **`zxjte9411/oh-my-agy`**. The canonical English README is [`../../README.md`](../../README.md).

OMA keeps Google Antigravity CLI (`agy`) as the execution host and adds session skills, durable orchestration, Team/worktree safety, and seven native custom agents: `orchestrator`, `explorer`, `librarian`, `oracle`, `fixer`, `designer`, and `observer`.

The project originated from [`ImL1s/oh-my-agy`](https://github.com/ImL1s/oh-my-agy). Upstream is credited as lineage; installation and release assets for this fork come only from `zxjte9411/oh-my-agy`.

## Install

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

The release asset is `zxjte9411-oh-my-agy-X.Y.Z.tgz` with `SHA256SUMS`. npmjs and GitHub Packages publication are intentionally disabled.

## Native agents

```bash
oma native probe --live
oma agents list
oma agents install --scope user
oma agents doctor --scope user
```

For repository-local installation, use `oma agents install --scope project`.

Restart Antigravity and use `/agents` to verify discovery.

See [`../RELEASE.md`](../RELEASE.md) for release verification and [`../../README.md`](../../README.md) for the full command/reference guide.
