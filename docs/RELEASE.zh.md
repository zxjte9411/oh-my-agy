# 发布与安装

[English](RELEASE.md) | 简体中文 | [繁體中文](RELEASE.zh-TW.md)

本文定义维护分支 **`zxjte9411/oh-my-agy`** 的正式发布契约。

## 发布身份

- Repository：`zxjte9411/oh-my-agy`
- Package metadata：`@zxjte9411/oh-my-agy`
- Tag：`vX.Y.Z`
- Release 资产：`zxjte9411-oh-my-agy-X.Y.Z.tgz`
- 校验文件：`SHA256SUMS`
- npmjs / GitHub Packages：目前不发布

项目源自 `ImL1s/oh-my-agy`，但上游 Release 不是本 fork 的安装来源。

## 版本同步

`package.json`、`plugin.json`、`.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json` 以及 marketplace 中的 `oh-my-agy` 条目必须使用同一版本。Tag `vX.Y.Z` 必须对应版本 `X.Y.Z`。

## 发布边界

推送匹配的 `vX.Y.Z` tag 即代表正式发布决策。推 tag 前，维护者必须在该候选 Git OID 上使用真实且已认证的 Antigravity 环境完成 live production evidence gate；CI 不会伪造 live evidence。

建议发布前执行：

```bash
npm ci
npm run build
npm run test:unit
TEST_DIST=true npm run test:e2e
npm run test:package
npm run smoke
npm run test:production
```

Release workflow 会再次执行 deterministic gates，确认 manifest/tag 一致，pack 出 `zxjte9411-oh-my-agy-X.Y.Z.tgz`，产生 `SHA256SUMS`，拒绝覆盖已存在的 Release，然后建立 GitHub Release，并将发布后的两个资产下载回来做 byte compare 与 SHA-256 校验。

## 安装 GitHub Release

```bash
curl -fsSLo /tmp/oma-install.sh \
  https://raw.githubusercontent.com/zxjte9411/oh-my-agy/main/scripts/install.sh
bash /tmp/oma-install.sh --github --tag v0.7.0
```

若省略 `--tag`，installer 会从 `zxjte9411/oh-my-agy` 解析最新 GitHub Release。

## 离线安装

```bash
bash /tmp/oma-install.sh \
  --asset ./zxjte9411-oh-my-agy-0.7.0.tgz \
  --checksums ./SHA256SUMS
```

Release bytes 必须在解压或执行前完成 SHA-256 校验。Installer 仍保留 archive traversal/symlink 检查、0700 staging、candidate preflight、transactional plugin switch、doctor/readback 与 ownership receipt。

## 源码 / 开发安装

```bash
git clone https://github.com/zxjte9411/oh-my-agy.git
cd oh-my-agy
bash scripts/install.sh --local-dev .
```

只有 local-dev 模式允许安装依赖与执行 build。

## 安装 Native Agents

```bash
oma native probe --live
oma agents install --scope user
oma agents doctor --scope user
```

项目范围则使用 `--scope project`。完成后重启 Antigravity，并通过 `/agents` 验证发现结果。

详细 registry 边界请参考 [`npm-publishing.md`](npm-publishing.md)。
