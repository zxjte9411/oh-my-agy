# 發布與安裝

[English](RELEASE.md) | [简体中文](RELEASE.zh.md) | 繁體中文

本文定義維護分支 **`zxjte9411/oh-my-agy`** 的正式發布契約。

## 發布身分

- Repository：`zxjte9411/oh-my-agy`
- Package metadata：`@zxjte9411/oh-my-agy`
- Tag：`vX.Y.Z`
- Release 資產：`zxjte9411-oh-my-agy-X.Y.Z.tgz`
- 驗證檔：`SHA256SUMS`
- npmjs / GitHub Packages：目前不發布

本專案源自 `ImL1s/oh-my-agy`，但上游 Release 不是本 fork 的安裝來源。

## 版本同步

`package.json`、`plugin.json`、`.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json`，以及 marketplace 中的 `oh-my-agy` 條目必須使用相同版本。Tag `vX.Y.Z` 必須對應版本 `X.Y.Z`。

## 發布邊界

推送相符的 `vX.Y.Z` tag 就代表正式發布決策。推 tag 前，維護者必須在該候選 Git OID 上使用真實且已驗證登入的 Antigravity 環境完成 live production evidence gate；CI 不會偽造 live evidence。

建議發布前執行：

```bash
npm ci
npm run build
npm run test:unit
TEST_DIST=true npm run test:e2e
npm run test:package
npm run smoke
npm run test:production
```

Release workflow 會再次執行 deterministic gates、確認 manifest/tag 一致、pack 出 `zxjte9411-oh-my-agy-X.Y.Z.tgz`、產生 `SHA256SUMS`、拒絕覆蓋已存在的 Release，接著建立 GitHub Release，並把發布後的兩個資產下載回來進行 byte compare 與 SHA-256 驗證。

## 安裝 GitHub Release

```bash
curl -fsSLo /tmp/oma-install.sh \
  https://raw.githubusercontent.com/zxjte9411/oh-my-agy/main/scripts/install.sh
bash /tmp/oma-install.sh --github --tag v0.7.0
```

省略 `--tag` 時，installer 會從 `zxjte9411/oh-my-agy` 解析最新 GitHub Release。

## 離線安裝

```bash
bash /tmp/oma-install.sh \
  --asset ./zxjte9411-oh-my-agy-0.7.0.tgz \
  --checksums ./SHA256SUMS
```

Release bytes 必須在解壓或執行前完成 SHA-256 驗證。Installer 仍保留 archive traversal/symlink 檢查、0700 staging、candidate preflight、transactional plugin switch、doctor/readback 與 ownership receipt。

## 原始碼 / 開發安裝

```bash
git clone https://github.com/zxjte9411/oh-my-agy.git
cd oh-my-agy
bash scripts/install.sh --local-dev .
```

只有 local-dev 模式允許安裝依賴與執行 build。

## 安裝 Native Agents

```bash
oma native probe --live
oma agents install --scope user
oma agents doctor --scope user
```

專案範圍則使用 `--scope project`。完成後重新啟動 Antigravity，並透過 `/agents` 驗證發現結果。

詳細 registry 邊界請參考 [`npm-publishing.md`](npm-publishing.md)。
