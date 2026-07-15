# Codex Session Diff Viewer

本地网页端工具：查看 **Codex 本次会话编码变更**（编码前基线 vs 改完后）。

> 这不是 `git diff`，也不是工作区相对 HEAD 的变更。  
> 它只对比：**本次 begin 时的文件快照** ↔ **改完后的当前文件**。

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

本 skill 用「会话基线」隔离出 **仅本次 Codex 编码动作**。

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
# 1) 改文件前：拍基线
"$HOME/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh" begin \
  --workspace "/abs/path/to/project" \
  --files "src/a.js,src/b.ts,docs/readme.md"

# 2) 正常编码、改文件...

# 3) 若中途要改未跟踪文件：先 track 再改
"$HOME/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh" track \
  --session latest \
  --files "src/new-file.js"

# 4) 收尾：写概括 + 打开网页
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

页面左侧是本次改动文件，右侧是「编码前 vs 改完后」Diff。

---

## 4. 系统提示词怎么写（AGENTS.md）

目标：让 Codex **每次改代码都自动走 begin → 编码 → summarize/open**。

### 4.1 推荐写入位置

- 全局：`~/.codex/AGENTS.md`（对所有任务生效，推荐）
- 或项目：`<repo>/AGENTS.md`（只对当前仓库生效）

把下面 **4.2** 整段原样粘贴进去即可。

### 4.2 可直接复制的系统提示词（与当前 AGENTS 强制规则一致）

```markdown
## Codex 会话代码变更复查（强制）

只要本回合会创建/修改/删除代码或项目文件，必须使用 skill `codex-session-diff-viewer`，展示**本次会话变更**，禁止用 git 工作区相对仓库的 diff 代替。

### 必须流程
1. **首次改文件前**执行 begin，捕获编码前基线：
   ```bash
   "$HOME/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh" begin \
     --workspace "<绝对工作区路径>" \
     --files "相对路径1,相对路径2"
   ```
2. 正常编码。
3. 若中途要改未跟踪文件：先 `track --session <id|latest> --files ...`，再修改。
4. **编码任务收尾**（最终回复前）执行 summarize + open：
   ```bash
   "$HOME/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh" summarize --session latest
   "$HOME/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh" open --session latest
   ```
   - 若本回合改动点已明确，可用 `--summary "一句话概括"` 写入更准确摘要
   - `open` 也会自动补齐智能概括（时间/项目名/改动点/文件数用于会话下拉）
5. 在最终回复提供可点击地址，例如：
   `[查看本次代码变更](http://127.0.0.1:3847)`
6. 文案必须写明：这是“本次会话编码前 vs 改完后”的变更，不是 git HEAD/工作区 diff。

### 禁止
- 不要用 `git diff`、`git diff HEAD`、`git status` 结果充当“此次 Codex 变更”
- 不要在未 begin 的情况下假装有会话级 diff

### 说明
- skill 详情见：`~/.codex/skills/codex-session-diff-viewer/SKILL.md`
- 基线保存在：`~/.codex/session-diffs/`
```

> 说明：`open` 默认固定 `http://127.0.0.1:3847`。若浏览器标签已打开，会通过 SSE 复用该页并切换到最新会话，不新开标签。

### 4.3 更短版（空间有限时）

```markdown
改代码前必须 session_diff begin；收尾必须 summarize + open；
最终回复给可点击本地地址；只展示本次会话变更，禁止用 git diff 代替。
```

### 4.4 提示词写作要点

| 要点 | 为什么 |
|------|--------|
| 写清「强制」 | 避免模型偷懒直接给 git diff |
| 写清 begin 时机 | 必须在**第一次改文件前** |
| 写清 track | 防止中途新文件无基线 |
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
| `begin` | 编码前拍基线，创建 session |
| `track` | 补充跟踪新文件（先 track 再改） |
| `summarize` | 生成/写入改动概括 |
| `open` | 启动本地 Diff 网页（默认自动刷新概括） |
| `status` | 输出当前会话摘要 JSON |
| `list` | 列出最近会话（时间/项目名/概括/文件数） |
| `url` | 仅打印查看地址 |

### begin

```bash
scripts/session_diff.sh begin \
  --workspace "/abs/path/to/project" \
  --files "a.js,b.ts,path/new.py" \
  --title "可选任务标题"
```

- `--workspace`：工作区绝对路径（项目根）
- `--files`：计划修改/新建的相对路径（逗号或空格分隔）
- 已存在文件：复制当前内容为基线
- 不存在文件：记为缺失，最终显示为「新增」
- stdout 会输出 `sessionId`

### track

```bash
scripts/session_diff.sh track --session latest --files "src/extra.js"
```

中途发现还要改未跟踪文件时使用。**先 track，再修改。**

### summarize

```bash
scripts/session_diff.sh summarize --session latest
scripts/session_diff.sh summarize --session latest --summary "修复登录态过期后的重定向"
```

- 不传 `--summary`：自动根据 diff 智能概括
- 传入 `--summary`：使用你的手动概括（更准确）

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
  1. 若服务已在运行，且浏览器页面在线（SSE 连接存在）：
     - 通知已开页面刷新
     - 自动把会话下拉切到最新 session
     - **不会再打开新的浏览器标签**
  2. 若服务在运行，但没有打开中的页面：才打开浏览器
  3. 若服务不可用：结束旧进程，复用 `3847` 启动新服务
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
    ├── meta.json          # 工作区、文件列表、概括、统计
    └── baseline/**        # 编码前文件快照
```

- 对比源：`baseline/**` vs 工作区当前文件
- 未变化文件不会出现在列表中

---

## 9. 常见问题

### Q1：为什么页面是空的？

常见原因：

1. 改文件前没执行 `begin`
2. `begin --files` 没包含实际改动的文件
3. 中途新文件没 `track`
4. 文件改完后又改回原样（无差异）

### Q2：可以只用 git diff 吗？

可以看，但**不能当作“本次 Codex 变更”**。  
git diff 可能混入更早改动；session diff 才是本次 begin 之后的变更。

### Q3：忘记 begin 了怎么办？

- 不要伪造“本次会话变更”
- 说明缺失基线
- 下一轮从 begin 重新开始

### Q4：端口被占用 / 会不会每次 open 都新开标签？

- 正常情况：地址始终是 `http://127.0.0.1:3847`
- 若页面已打开：只通信刷新并切换最新会话，不新开标签
- 若服务异常、健康检查失败：才会结束旧进程并重启服务
- 手动排查端口：

```bash
lsof -nP -iTCP:3847 -sTCP:LISTEN
```

### Q5：如何只查看历史会话？

```bash
scripts/session_diff.sh list
scripts/session_diff.sh open --session <sessionId>
```

也可在网页左上角会话下拉中切换。

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
  --files "src/main/java/App.java,README.md"

# ... Codex 修改文件 ...

# 中途还要改一个新文件
"$HOME/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh" track \
  --session latest \
  --files "src/main/java/util/DateUtil.java"
# 然后再写 DateUtil.java

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
