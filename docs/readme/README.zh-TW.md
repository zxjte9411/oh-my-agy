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

## 疑難排解

OMA 的失敗模式通常是刻意的 **fail-closed** 或 **靜默 fail-open**。先執行 `oma doctor`。本發行版 **沒有** `oma hooks status` 診斷指令，不要把它當成可執行命令。

| 症狀 | 診斷 | 修法 |
|------|------|------|
| hooks 沒有觸發 | `oma doctor`（plugin 已安裝且啟用）。檢查 `DISABLE_OMA` / `OMA_SKIP_HOOKS`。在 `OMA_HOOK_DEBUG=1` 且已設 `OMA_STATE_ROOT` 時查看 `<state-root>/logs/hook-debug.jsonl`。 | `oma setup`，然後 **重啟 host**。取消 kill-switch 環境變數。可選專案級 `.agents/hooks.json`。 |
| `E_PLUGIN_NOT_ACTIVE` | `oma doctor` / `oma doctor --json`，檢查 plugin registry。 | `oma setup`，再用 `oma doctor` 確認。僅 slash 的 host 可用 `oma doctor --no-strict-plugin`。 |
| `oma setup` 後 slash skill 沒出現 | `oma skill list`；`oma doctor` 檢查 `slash_skills` 與 `slash_collision`。 | 重啟 host session。Claude/Grok 使用 `/oh-my-agy:autopilot`。 |
| Legacy magic 只印模式橫幅然後沒輸出 | 非 TTY（CI）會忽略子程序 stdio，除非 `OMA_LEGACY_STDIO=inherit`。 | 優先用 managed `oma ralph -- "task"`；可顯式設定 `OMA_LEGACY_STDIO=inherit` 或 `ignore`。 |

### 環境變數

只列出操作者會設的變數。Binding env 由 managed launch 注入，不要手設。沒有 `OMA_STATE_DIR`；出貨名稱是 `OMA_STATE_ROOT`。

| 變數 | 預設值 | 作用 |
|------|--------|------|
| `DISABLE_OMA` | 未設定（關） | `1` 或 `true` 關閉全部 Antigravity hook。 |
| `OMA_SKIP_HOOKS` | 未設定 | 逗號分隔要跳過的邏輯 hook 名。 |
| `OMA_HOOK_DEBUG` | 未設定（關） | 把已脫敏診斷追加到 `<OMA_STATE_ROOT>/logs/hook-debug.jsonl`；未設 state root 時不寫。 |
| `OMA_LEGACY_STDIO` | TTY 閘門 | Legacy magic spawn 的 stdio；顯式 `inherit` 或 `ignore` 可覆寫。 |
| `OMA_TIMEOUT_MS` | 依路徑 | 正的毫秒數；用於有界 headless / managed 路徑。 |
| `OMA_LAUNCH_POLICY` | `auto` | 裸 host-launch 傳輸：`auto`、`direct`、`tmux` 或 `detached-tmux`。 |
| `OMA_STATE_ROOT` | 平台預設 | 持久 state root。 |

完整發布與驗證規則請看 [`../RELEASE.zh-TW.md`](../RELEASE.zh-TW.md)，完整功能說明請看 [`../../README.md`](../../README.md)。
