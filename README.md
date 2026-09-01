# student-app

给一个 2026-09 在厦门上初一的孩子做的本地学习 app。设计与约定见 `AGENTS.md`，依据见 `docs/`。

## 跑起来

```bash
npm install                 # Node 26
npm run load                # 内容池 → data/app.db（逐条核对出处；--vocab 本册新词 只装本册）
npm run load:chapters       # 章节树 + 每节要点 → chapter 表
npm run sim                 # 负荷模拟（内容入库前必跑；--days 150 --seed 1）
npm run deploy              # 停 → build → 起 → 探测；http://127.0.0.1:8787（家长页 /parent）
npm run stop
```

环境变量：`PORT`（8787）、`DATA_DIR`（./data，库、照片、日志都在这里）、`INBOX_DIR`（~/StudyInbox）、`INBOX=off` 关监听、`EXPLAIN=fake` 假讲解（测试用）。
内容启用日 `setting.content_start`（默认 2026-09-07）：`sqlite3 data/app.db "insert or replace into setting values('content_start','2026-09-07')"`。

## 测试

```bash
npm test                    # Vitest：调度 / 负荷 / 核对 / 周报 / 收件箱 / 讲解 / API
npm run test:e2e            # Playwright：真实内容库走完每日闭环、家长页、讲解门控（截图 docs/screenshots/）
npm run review              # Codex 只读审阅工作区 diff（首行 ALLOW:/BLOCK:）；npm run review -- <commit>
npm run typecheck
```

## 目录

```
src/server/   db（schema.sql、迁移、repo）· content（内容池解析、三级出处核对、负荷模拟）· scheduler（FSRS、队列、四档推断）
              loop（每日闭环走法、计时）· report（周报）· inbox（监听、codex 识题、待确认）· explain（作答后讲解）· app.ts（Hono）
src/client/   React：Checkin / Recall / Review（+Explain）/ Reflect / Done / Parent
content/      pools（内容池）· chapters（章节树 + 要点）· audio（录音，不入 git）
textbook/txt/ 7 科教材文本（OCR + 文字层），出处核对用
tests/        Vitest（含 golden）· e2e（Playwright）
tools/        ocr.swift · fetch-textbooks · dual_check（review）
docs/         研究报告 · 计划 · 增补清单 · 待确认 · screenshots · experiments
```
