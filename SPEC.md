---
id: session-diff-viewer
type: goal-and-requirements
status: draft
title: Codex 本回合变更复查
tags: [session-diff]
---

## Goal

让人只复查 **这一轮对话** 里编码前 vs 改完后的文件差异，而不是 git 工作区相对 HEAD 的 diff，也不是整条聊天的累计改动。

## Audience

本机使用 Codex / 同类编码助手的人：助手按 skill 自动 begin / summarize / open，人在本地网页上看 Diff。

## Capabilities

- 每轮改代码前捕获工作区基线，收尾冻结 after，页面左右对比这两份快照。
- 自动发现本回合改过的文件（监听 + 扫描），不必预列路径。
- 忽略构建产物和可配置的目录，使它们不进 Diff、也不进入文件监听。
- 文件头路径与统一 Diff 标题显示工作区绝对路径，便于对照磁盘位置；侧栏文件列表与并排模式标题仍用相对路径。

## Non-goals

- 不做 git 客户端，不替代 `git diff`。
- 不在多台机器间同步会话。
- 不为每个被监听项目再维护一份独立 ignore 文件（项目 `.gitignore` 仍然生效）。

## Principles

- 一轮对话 = 一个 session；禁止把整条聊天复用同一个 session。
- 历史会话永远看当时的 baseline vs after，不跟工作区最新文件跑。
