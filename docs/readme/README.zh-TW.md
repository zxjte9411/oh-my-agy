# oh-my-agy (OMA / OMY)

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

這是維護分支 **`zxjte9411/oh-my-agy`** 的繁體中文入口。英文主文件位於 [`../../README.md`](../../README.md)。

OMA 保留 Google Antigravity CLI (`agy`) 作為執行宿主，並加入 session skills、持久化編排、Team/worktree 安全機制，以及七個原生 custom agents：`orchestrator`、`explorer`、`librarian`、`oracle`、`fixer`、`designer`、`observer`。

本專案源自 [`ImL1s/oh-my-agy`](https://github.com/ImL1s/oh-my-agy)。上游只保留作為專案沿革與署名來源；本 fork 的安裝、Issue 與 Release 都以 `zxjte9411/oh-my-agy` 為準。

## 安裝

驗證過的 GitHub Release：

```bash
curl -fsSLo /tmp/oma-install.sh \
  https://raw.githubusercontent.com/zxjte9411/oh-my-agy/main/scripts/install.sh
bash /tmp/oma-install.sh --github --tag v0.7.0
```

原始碼 / 開發版本：

```bash
git clone https://github.com/zxjte9411/oh-my-agy.git
cd oh-my-agy
bash scripts/install.sh --local-dev .
```

正式 Release 資產名稱為 `zxjte9411-oh-my-agy-X.Y.Z.tgz`，並附帶 `SHA256SUMS`。目前不發布到 npmjs 或 GitHub Packages。

## 安裝原生 Agents

```bash
oma native probe --live
oma agents list
oma agents install --scope user
oma agents doctor --scope user
```

如果只想安裝到目前專案，請使用 `oma agents install --scope project`。

完成後重新啟動 Antigravity，並使用 `/agents` 確認七個 canonical agents 已被發現。

完整發布與驗證規則請看 [`../RELEASE.zh-TW.md`](../RELEASE.zh-TW.md)，完整功能說明請看 [`../../README.md`](../../README.md)。
