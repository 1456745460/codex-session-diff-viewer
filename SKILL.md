---
name: codex-session-diff-viewer
description: 按“一轮对话一个 session”捕获编码前基线、监听工作区变更并打开本地 Diff 网页，只展示本回合改动（编码前 vs 改完后），不是 git HEAD/工作区 diff，也不是整条聊天累计 diff。用于每轮编码任务收尾、代码变更复查、打开变更链接、自动打开浏览器查看 session diff。
---

# Codex Session Diff Viewer

只展示**本回合（一轮对话）编码变更**，不要用 `git diff` / 工作区相对 HEAD 的 diff 代替，也不要展示整条聊天线程的累计改动。

## 核心原则：一轮对话 = 一个 session

- **一轮对话 / 本回合** = 用户的一次请求 + 为完成该请求所做的编码，直到本轮最终回复
- 每一轮只要会改文件，都必须 **重新 `begin`**，生成**新的** `sessionId`
- **禁止**把整条聊天从头到尾复用同一个 session
- **不必预列 `--files`，也不必中途 `track`**：`begin` 会快照工作区并监听变更，收尾按监听结果 + 扫描发现本回合改过的文件
- `latest` 仅表示“最近一次 begin 的 session”，只应在**同一回合内**使用
- 跨多轮累计对比仅当用户明确要求时才可做，且需单独说明

## 核心命令

脚本入口（优先）：

```bash
"$CODEX_HOME/skills/codex-session-diff-viewer/scripts/session_diff.sh" <cmd> ...
```

若 `CODEX_HOME` 未设置，使用：

```bash
"$HOME/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh" <cmd> ...
```

### 1) 本回合编码前：新建 session 并捕获基线（必须）

在**本回合第一次修改/创建文件之前**执行：

```bash
scripts/session_diff.sh begin \
  --workspace "<repo_or_workspace_abs_path>" \
  --title "本回合任务标题"
```

- `--workspace`：项目根目录，不要用 `$HOME`
- `--title`：建议写本回合任务一句话，便于会话下拉区分各轮
- 不必传 `--files`。begin 会：
  1. 把工作区可跟踪文件快照为「本回合编码前」
  2. 启动文件监听，记录随后的创建/修改/删除
- `--files` 可选，只用于强制纳入被 ignore 的路径，或尚未创建、希望先占位的文件
- 若上一轮还没有 after 快照，会顺手用当时工作区把它冻成「上一轮改完后」
- 命令 stdout 输出**新的** `sessionId`（保存备用；本回合收尾优先用它）

> 注意：即使同一聊天线程里上一轮已经 begin 过，本回合也要重新 begin。

### 2) 本回合编码完成后：生成概括并打开本回合变更

```bash
scripts/session_diff.sh summarize --session <本回合sessionId|latest>
# 也可手动指定概括
scripts/session_diff.sh summarize --session <本回合sessionId|latest> --summary "本回合改动一句话"

scripts/session_diff.sh open --session <本回合sessionId|latest>
```

- `summarize` / `open` 会合并监听脏路径与工作区扫描，把当前内容冻成该 session 的 **after 快照**
- 之后查看该会话（含切换历史下拉）始终对比 **baseline vs after**，不会再读工作区最新文件
- 同一回合对 latest 再次 summarize/open 会刷新 after；一旦开始了新 session，上一轮 after 冻结不再覆盖
- `open` 会先基于**本回合** session diff 生成智能改动概括并写入 `meta.json`
- 启动本地网页并自动打开浏览器
- stdout 打印可点击 URL，例如 `http://127.0.0.1:3847`
- **单实例端口策略**：默认端口 `3847`；优先复用已运行且协议兼容的服务
- **浏览器标签复用**：若页面已打开并通过 SSE 在线，则只通知该页刷新并切换到**最新/本回合**会话下拉项，**不新开标签**
- 仅当检测不到已打开页面时，才自动打开浏览器
- 若端口被脏占用、健康检查失败，或已运行服务缺少 `after` 快照协议 / 代码指纹不匹配，则结束旧进程并复用同一端口（不递增）
- 页面左右分别为 **本回合编码前 / 本回合改完后**
- 会话下拉展示：`时间 · 项目名 · 改动概括 · N 个文件`（每个下拉项对应历史某一轮）

`track` 仍可用，但监听模式下通常不必再调。

仅查看状态：

```bash
scripts/session_diff.sh status --session <本回合sessionId|latest>
```

## 编码任务强制工作流

只要本回合会改代码文件，必须：

1. **本回合改文件前重新 `begin --workspace`**（不要复用上一轮 session，不必预列文件）
2. 本回合编码、验证
3. **本回合收尾**执行 `summarize` + `open`（优先本回合 sessionId）
4. 在最终回复中给出可点击链接：`[查看本回合代码变更](http://127.0.0.1:3847)`（端口固定，不因多次 open 递增）
5. 明确说明：这是**本回合**变更，不是 git 仓库 diff，也不是整条聊天累计 diff

若本回合未执行 begin 就已改文件：

- 不能伪造成“本回合会话变更”
- 应说明缺失基线；仅当用户同意时，才可退化为普通 git diff（本 skill 默认不做）

## 错误示例 / 正确示例

错误：

```text
用户第1轮：做功能A → begin session-1 → 改代码 → open session-1
用户第2轮：修 bug → 继续用 session-1 → open session-1   ❌ 累计混进两轮
```

正确：

```text
用户第1轮：做功能A → begin session-1 → 改代码 → open session-1
用户第2轮：修 bug → begin session-2 → 改代码 → open session-2   ✅ 每轮独立
```

## 关键约束

- 对比源：`~/.codex/session-diffs/<sessionId>/baseline` vs `after`（本回合收尾冻结的改完后快照）
- 切换历史会话时必须看到「当时版本 1 vs 当时版本 2」，禁止拿历史 baseline 对工作区最新文件做 diff
- 回合尚未 summarize/open 时，才允许临时对比 baseline vs 工作区当前（未冻结）
- 不要用 `git diff HEAD`、`git diff --staged` 充当“此次变更”
- 不要把上一轮 session 的累计变更当作本回合 diff
- 仅本机 `127.0.0.1`，适合本地自用
- 始终保持单实例：`open` 固定 `3847`；优先 SSE 复用已开标签，失败再重启服务
- 前端支持：并排/统一、同步滚动、收起未更改、行号、路径、字体/字号、上一个/下一个差异

## 输出模板（本回合收尾）

```markdown
本回合代码变更已生成：
- 会话：`<本回合sessionId>`
- 查看：[打开本回合变更 Diff](http://127.0.0.1:3847)

说明：这是本回合编码前 vs 改完后的变更，不是 git HEAD/工作区 diff，也不是整条聊天累计 diff。
```
