# oh-my-agy (OMA / OMY)

[English](README.md) | 简体中文 | [繁體中文](README.zh-TW.md)

这是维护分支 **`zxjte9411/oh-my-agy`** 的简体中文入口。英文主文档位于 [`../../README.md`](../../README.md)。

OMA 保留 Google Antigravity CLI (`agy`) 作为执行宿主，并加入 session skills、持久化编排、Team/worktree 安全机制，以及七个原生 custom agents：`orchestrator`、`explorer`、`librarian`、`oracle`、`fixer`、`designer`、`observer`。

本项目源自 [`ImL1s/oh-my-agy`](https://github.com/ImL1s/oh-my-agy)。上游仅作为项目沿革与署名来源；本 fork 的安装、Issue 与 Release 均以 `zxjte9411/oh-my-agy` 为准。

## 安装

验证过的 GitHub Release：

```bash
curl -fsSLo /tmp/oma-install.sh \
  https://raw.githubusercontent.com/zxjte9411/oh-my-agy/main/scripts/install.sh
bash /tmp/oma-install.sh --github --tag v0.7.0
```

源码 / 开发版本：

```bash
git clone https://github.com/zxjte9411/oh-my-agy.git
cd oh-my-agy
bash scripts/install.sh --local-dev .
```

正式 Release 资产名称为 `zxjte9411-oh-my-agy-X.Y.Z.tgz`，并附带 `SHA256SUMS`。目前不会发布到 npmjs 或 GitHub Packages。

## 安装原生 Agents

```bash
oma native probe --live
oma agents list
oma agents install --scope user
oma agents doctor --scope user
```

若只想安装到当前项目，请使用 `oma agents install --scope project`。

完成后重启 Antigravity，并使用 `/agents` 确认七个 canonical agents 已被发现。

完整发布与校验规则请看 [`../RELEASE.zh.md`](../RELEASE.zh.md)，完整功能说明请看 [`../../README.md`](../../README.md)。
