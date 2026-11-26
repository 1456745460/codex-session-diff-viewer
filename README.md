# Codex Session Diff Viewer

本地网页端工具：查看 **Codex 本回合（一轮对话）编码变更**（编码前基线 vs 改完后）。

> 这不是 `git diff`，也不是工作区相对 HEAD 的变更。  
> 也不是整条聊天线程的累计 diff。  
> 它只对比：**本回合 begin 时的文件快照** ↔ **本回合收尾时冻结的改完后快照**。  
> 切换历史会话时看到的是当时那一轮的两个版本，不会变成「当时 vs 工作区最新」。  
> **规则：一轮对话 = 一个 session；每轮改代码前必须重新 begin。**

默认查看地址：`http://127.0.0.1:3847`（**单实例 + 标签复用**：已开页面则 SSE 切到最新会话，不新开标签）

---

## 1. 它解决什么问题

Codex 改完代码后，你需要快速复查：

- 这一轮到底改了哪些文件？
- 每个文件「改前 / 改后」差异是什么？
- 能否一键回滚到编码前？

普通 `git diff` 会混入：

- 更早未提交改动
- 手工改动
- 其他会话遗留改动

本 skill 用「会话基线」隔离出 **仅本回合 Codex 编码动作**。

默认策略是 **一轮对话一个 session**：
- 用户第 1 次请求 → session A
- 用户第 2 次请求 → session B（新 begin）
- 不要把整条聊天累计进同一个 session

想让 Codex 自动执行这套流程：把 **第 4 节系统提示词** 写入 `~/.codex/AGENTS.md`。

---

## 2. 安装

### 方式 A：作为 Codex Skill（推荐）

1. 把本仓库放到：

```bash
~/.codex/skills/codex-session-diff-viewer
```

2. 安装运行依赖：

```bash
cd ~/.codex/skills/codex-session-diff-viewer/assets/app
npm install
```

3. 确认脚本可执行：

```bash
chmod +x ~/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh
```

4. 在 Codex 中启用/识别 skill（确保 `SKILL.md` 在 skill 目录内）。

### 方式 B：直接当 CLI 用

即使不走 skill 系统，也可手动调用：

```bash
"$HOME/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh" begin \
  --workspace "/path/to/project" \
  --files "src/a.js,src/b.ts"
```

---

## 3. 最短使用流程（必会）

```bash
# 1) 本回合改文件前：新建 session、快照工作区并开始监听（每轮都要重新 begin）
"$HOME/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh" begin \
  --workspace "/abs/path/to/project" \
  --title "本回合任务一句话"

# 2) 正常编码、改文件...（不必再 track）

# 3) 收尾：写概括 + 打开网页
"$HOME/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh" summarize \
  --session latest \
  --summary "一句话概括本次改动"
"$HOME/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh" open \
  --session latest
```

浏览器会打开类似：

```text
http://127.0.0.1:3847
```

页面左侧是本回合改动文件，右侧是「本回合编码前 vs 改完后」Diff。会话下拉可切换历史各轮。

---

## 4. 系统提示词怎么写（AGENTS.md）

目标：让 Codex **每次改代码都自动走 begin → 编码 → summarize/open**。

### 4.1 推荐写入位置

- 全局：`~/.codex/AGENTS.md`（对所有任务生效，推荐）
- 或项目：`<repo>/AGENTS.md`（只对当前仓库生效）

把下面 **4.2** 整段原样粘贴进去即可。

### 4.2 可直接复制的系统提示词（与当前 AGENTS 强制规则一致）

目标：让 Codex **每一轮对话单独 begin**，只展示本回合变更。

```markdown
## Codex 会话代码变更复查（强制）

只要**本回合**会创建/修改/删除代码或项目文件，必须使用 skill `codex-session-diff-viewer`，展示**本回合**变更，禁止用 git 工作区相对仓库的 diff 代替。

### 关键定义：一轮对话 = 一个 session

- **一轮对话 / 本回合**：用户的一次请求 + 你为完成该请求进行的编码，直到本轮最终回复。
- **禁止**把整条聊天线程从头到尾复用同一个 session。
- 不必预列 `--files`，也不必中途 `track`：begin 会快照并监听工作区，收尾自动发现本回合改过的文件。
- 每一轮只要会改文件，都必须 **重新 `begin` 新建 sessionId**。
- 旧 session 仅用于历史下拉查看，不得作为新一轮改动的默认容器。

### 必须流程（每一轮独立）
1. **本回合首次改文件前**执行 begin，捕获**本回合编码前**基线并开始监听：
   ```bash
   "$HOME/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh" begin \
     --workspace "<绝对工作区路径>" \
     --title "<本回合任务一句话>"
   ```
2. 正常编码（只改本回合需要的文件）。
3. **本回合收尾**（最终回复前）执行 summarize + open（优先使用本回合 sessionId）：
   ```bash
   "$HOME/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh" summarize \
     --session <本回合sessionId|latest> \
     --summary "<本回合改动一句话>"
   "$HOME/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh" open \
     --session <本回合sessionId|latest>
   ```
4. 在最终回复提供可点击地址，例如：
   `[查看本回合代码变更](http://127.0.0.1:3847)`
5. 文案必须写明：这是“**本回合**编码前 vs 改完后”的变更，不是 git HEAD/工作区 diff，也不是整条聊天的累计 diff。

### 禁止
- 不要用 `git diff`、`git diff HEAD`、`git status` 结果充当“此次 Codex 变更”
- 不要在未 begin 的情况下假装有会话级 diff
- 不要把上一轮 session 的累计变更当作本回合 diff
- 不要在新的用户请求中默认沿用旧 session

### 说明
- skill 详情见：`~/.codex/skills/codex-session-diff-viewer/SKILL.md`
- 基线保存在：`~/.codex/session-diffs/`
- 页面会话下拉中的多个 session 分别对应历史各轮；本回合应切换到最新新建的 sessionId
```

### 4.3 更短版（空间有限时）

```markdown
改代码前必须 session_diff begin --workspace；收尾必须 summarize + open；
最终回复给可点击本地地址；只展示本次会话变更，禁止用 git diff 代替。不必预列 --files。
```

### 4.4 提示词写作要点

| 要点 | 为什么 |
|------|--------|
| 写清「强制」 | 避免模型偷懒直接给 git diff |
| 写清 begin 时机 | 必须在**第一次改文件前** |
| 写清不必 --files | 监听 + 扫描自动发现，避免漏 track |
| 写清 summarize + open | 收尾自动出概括和网页 |
| 写清文案约束 | 明确告诉用户“不是 git HEAD diff” |
| 固定本地地址 | 方便点击复查，且可复用已开标签页 |

---

## 5. 命令说明

脚本入口：

```bash
"$HOME/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh" <命令> [参数]
```

| 命令 | 作用 |
|------|------|
| `begin` | 编码前快照工作区、启动监听、创建 session |
| `track` | 可选：强制纳入未被监听/ignore 的文件 |
| `summarize` | 按监听/扫描结果冻结 after 并生成概括 |
| `open` | 启动本地 Diff 网页（默认自动刷新概括） |
| `status` | 输出当前会话摘要 JSON |
| `list` | 列出最近会话（时间/项目名/概括/文件数） |
| `url` | 仅打印查看地址 |

### begin

```bash
scripts/session_diff.sh begin \
  --workspace "/abs/path/to/project" \
  --title "可选任务标题"
```

- `--workspace`：工作区绝对路径（项目根）
- 不必 `--files`：会快照可跟踪文件并监听随后变更
- `--files` 可选，强制纳入被 ignore 的路径或尚未创建的文件
- 已存在文件：复制当前内容为基线（APFS 上优先 clonefile）
- 不存在文件：记为缺失，最终显示为「新增」
- stdout 会输出 `sessionId`

### track

```bash
scripts/session_diff.sh track --session latest --files "src/extra.js"
```

监听模式下通常不必再调。仅当文件被 ignore、或必须在写入前强制占位时使用。

### summarize

```bash
scripts/session_diff.sh summarize --session latest
scripts/session_diff.sh summarize --session latest --summary "修复登录态过期后的重定向"
```

- 不传 `--summary`：自动根据 diff 智能概括
- 传入 `--summary`：使用你的手动概括（更准确）
- 若该 session 仍是当前回合（latest），会同时把工作区内容冻成 `after/**`

### open

```bash
scripts/session_diff.sh open --session latest
scripts/session_diff.sh open --session latest --port 3847
scripts/session_diff.sh open --session latest --no-open   # 只启动服务，不自动开浏览器
```

**单实例 + 浏览器标签复用（重要）**

- 默认固定使用 `3847`
- 本地始终只保留 **一个** 查看器服务进程
- 再次 `open` 时的智能行为：
  1. 若服务已在运行、协议兼容，且浏览器页面在线（SSE 连接存在）：
     - 通知已开页面刷新
     - 自动把会话下拉切到最新 session
     - **不会再打开新的浏览器标签**
  2. 若服务在运行且协议兼容，但没有打开中的页面：才打开浏览器
  3. 若服务不可用，或健康检查缺少 `after` 快照协议 / 代码指纹与当前 skill 不一致：结束旧进程，复用 `3847` 启动新服务
- **不会**自动 `3847 → 3848 → 3849...`

---

## 6. Codex 在任务里应如何回复（模板）

收尾时建议这样写：

```markdown
本次代码变更已生成（本次会话编码前 vs 改完后，不是 git HEAD/工作区 diff）：
- 会话：`20260715-133014-1e9df5`
- 查看：[打开本次变更 Diff](http://127.0.0.1:3847)
```

---

## 7. 页面功能

- 左侧：本次会话改动文件（新增 / 删除 / 修改）
- 右侧：编码前 vs 改完后 Diff（并排 / 统一）
- 同步滚动、收起未更改片段
- 上一个差异 / 下一个差异（按代码块）
- 差异块连线辅助
- 语法高亮（多语言）
- 字体 / 字号选择
- 侧栏宽度拖拽
- 会话下拉切换历史变更
- 撤销当前文件 / 撤销全部（回滚到 begin 基线）

会话下拉展示格式：

```text
时间 · 项目名 · 改动概括 · N 个文件
```

### 项目名规则

取 `--workspace` 路径，去掉当前用户主目录前缀，保留剩余路径形态。

示例：

- `/Users/wangbingbing/javaProject/traceback/backend` → `/javaProject/traceback/backend`
- `/Users/you/demo/app` → `/demo/app`

不使用 `--title` 任务标题，避免临时标题混进项目名。

---

## 8. 数据存哪里

```text
~/.codex/session-diffs/
├── latest.json
└── <sessionId>/
    ├── meta.json          # 工作区、文件列表、概括、统计、afterCapturedAt、watch
    ├── inventory.json     # begin 时的工作区索引
    ├── dirty.json         # 监听到的脏路径
    ├── baseline/**        # 编码前文件快照（版本 1）
    └── after/**           # 本回合改完后快照（版本 2）
```

- 对比源：`baseline/**` vs `after/**`
- 尚未 summarize/open（也还没被下一轮 begin 冻结）时，才临时对比工作区当前文件
- 未变化文件不会出现在列表中

---

## 9. 常见问题

### Q1：为什么页面是空的？

常见原因：

1. 改文件前没执行 `begin`
2. 文件改完后又改回原样（无差异）
3. 改动落在默认 ignore 里（如 `node_modules/`、`target/`、图片/压缩包）
4. `--workspace` 指错了目录

### Q2：可以只用 git diff 吗？

可以看，但**不能当作“本次 Codex 变更”**。  
git diff 可能混入更早改动；session diff 才是本次 begin 之后的变更。

### Q3：忘记 begin 了怎么办？

- 不要伪造“本次会话变更”
- 说明缺失基线
- 下一轮从 begin 重新开始

### Q4：端口被占用 / 会不会每次 open 都新开标签？

- 正常情况：地址始终是 `http://127.0.0.1:3847`
- 若页面已打开且服务协议兼容：只通信刷新并切换最新会话，不新开标签
- 若服务异常、健康检查失败，或旧进程仍按「baseline vs 工作区最新」对比：结束旧进程并重启服务
- 手动排查端口：

```bash
lsof -nP -iTCP:3847 -sTCP:LISTEN
```

### Q5：如何只查看历史会话？

```bash
scripts/session_diff.sh list
scripts/session_diff.sh open --session <sessionId>
```

也可在网页左上角会话下拉中切换。每个历史会话显示的是该轮自己的 baseline vs after，同一文件后来再改也不会串进旧会话。

### Q6：为什么以前切换会话会看到「当时 vs 最新」？

旧实现右侧读的是工作区当前文件。现在 summarize/open（以及下一轮 begin）会冻结 `after/**`，历史会话不再跟随最新文件变化。升级前已经存在、且从未冻结过 after 的旧会话，仍可能回退到工作区当前；新产生的会话不会。

如果磁盘上的 `after/**` 已经正确，但网页仍把后续回合的改动叠进旧会话，通常是 3847 上还挂着升级前的查看器进程。`open` 会识别缺少 `session-watch-v1` 协议的旧服务并重启。

---

## 10. 目录结构

```text
codex-session-diff-viewer/
├── SKILL.md                 # Codex skill 定义（给模型读）
├── README.md                # 本说明（给人读）
├── scripts/session_diff.sh  # CLI 入口
├── agents/
├── references/workflow.md
└── assets/app/              # Node 服务 + 前端
    ├── bin/cli.js
    ├── lib/
    ├── public/
    └── server.js
```

---

## 11. 完整示例

假设项目：`/Users/you/javaProject/demo`

```bash
# 编码前
"$HOME/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh" begin \
  --workspace "/Users/you/javaProject/demo" \
  --title "补充日期工具"

# ... Codex 修改/新建文件，不必 track ...

# 收尾
"$HOME/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh" summarize \
  --session latest \
  --summary "补充日期工具并修复 App 启动参数"
"$HOME/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh" open \
  --session latest
```

最终回复：

```markdown
[查看本次代码变更](http://127.0.0.1:3847)

说明：以上为本次会话编码前 vs 改完后的变更，不是 git HEAD/工作区 diff。
```

---

## License

MIT
