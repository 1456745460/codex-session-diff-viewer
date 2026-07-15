---
name: codex-session-diff-viewer
description: 在编码前后捕获“本次会话”文件基线并打开本地 Diff 网页，只展示此次 Codex 改动（编码前 vs 改完后），不是 git HEAD/工作区 diff。用于编码任务收尾、代码变更复查、打开变更链接、自动打开浏览器查看 session diff。
---

# Codex Session Diff Viewer

只展示**本次会话编码变更**，不要用 `git diff` / 工作区相对 HEAD 的 diff 代替。

## 核心命令

脚本入口（优先）：

```bash
"$CODEX_HOME/skills/codex-session-diff-viewer/scripts/session_diff.sh" <cmd> ...
```

若 `CODEX_HOME` 未设置，使用：

```bash
"$HOME/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh" <cmd> ...
```

### 1) 编码前：捕获基线（必须）

在**第一次修改/创建文件之前**执行：

```bash
scripts/session_diff.sh begin \
  --workspace "<repo_or_workspace_abs_path>" \
  --files "path/a.js,path/b.ts,path/new-file.py" \
  --title "optional-task-title"
```

- `--files`：计划修改或新建的相对路径（逗号/空格分隔）
- 已存在文件：复制当前内容作为“编码前”
- 尚不存在文件：基线记为缺失，最终会显示为“新增”
- 命令 stdout 输出 `sessionId`（保存备用）

### 2) 中途发现新文件

若编码中途要改未跟踪文件，先 track 再改：

```bash
scripts/session_diff.sh track --session <sessionId|latest> --files "path/extra.js"
```

### 3) 编码完成后：生成概括并打开本次变更

```bash
# 可选：先生成/刷新改动概括（open 时也会自动执行）
scripts/session_diff.sh summarize --session latest
# 也可手动指定概括
scripts/session_diff.sh summarize --session latest --summary "实现会话下拉与撤销回滚"

scripts/session_diff.sh open --session latest
# 或
scripts/session_diff.sh open --session <sessionId>
```

- `open` 会先基于本次会话 diff 生成智能改动概括并写入 `meta.json`
- 启动本地网页并自动打开浏览器
- stdout 打印可点击 URL，例如 `http://127.0.0.1:3847`
- **单实例端口策略**：默认端口 `3847`；优先复用已运行服务
- **浏览器标签复用**：若页面已打开并通过 SSE 在线，则只通知该页刷新并切换到最新会话下拉项，**不新开标签**
- 仅当检测不到已打开页面时，才自动打开浏览器
- 若端口被脏占用且健康检查失败，才结束旧进程并复用同一端口（不递增）
- 页面左右分别为 **编码前 / 本次后**
- 会话下拉展示：`时间 · 项目名 · 改动概括 · N 个文件`

仅查看状态：

```bash
scripts/session_diff.sh status --session latest
```

## 编码任务强制工作流

只要本回合会改代码文件，必须：

1. **改文件前** `begin`（或对新增目标先 `track`）
2. 正常编码、验证
3. **任务收尾**执行 `open --session latest`（或对应 sessionId）
4. 在最终回复中给出可点击链接：`[查看本次代码变更](http://127.0.0.1:3847)`（端口固定，不因多次 open 递增）
5. 明确说明：这是**本次会话变更**，不是 git 仓库 diff

若未执行 begin 就已改文件：

- 不能伪造成“本次会话变更”
- 应说明缺失基线；仅当用户同意时，才可退化为普通 git diff（本 skill 默认不做）

## 关键约束

- 对比源：`~/.codex/session-diffs/<sessionId>/baseline` vs 工作区当前文件
- 不要用 `git diff HEAD`、`git diff --staged` 充当“此次变更”
- 仅本机 `127.0.0.1`，适合本地自用
- 始终保持单实例：`open` 固定 `3847`；优先 SSE 复用已开标签，失败再重启服务
- 前端支持：并排/统一、同步滚动、收起未更改、行号、路径、字体/字号、上一个/下一个差异

## 输出模板（收尾）

```markdown
本次代码变更已生成：
- 会话：`<sessionId>`
- 查看：[打开本次变更 Diff](http://127.0.0.1:3847)
```
