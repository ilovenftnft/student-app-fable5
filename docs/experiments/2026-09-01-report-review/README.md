# 实验：Codex 对研究报告的对抗式审阅（2026-09-01）

- 引擎：`codex exec --sandbox read-only --json -c model_reasoning_effort=high --output-schema review_schema.json`，耗时 239 s，exit 0
- 提示词：`review_prompt.txt`（含 provenance disclosure 与 delegation boundary，6 个审阅维度，首字段判决 ALLOW/BLOCK）
- 输出：`review_out.json`（9 条 findings：2 high / 4 medium / 3 low，判决 BLOCK）
- 裁决与修正：见 `docs/研究报告-app方案.md` 第十一节；化学卷面/折算率错误同步修正到 `docs/research/03`
- 值得记录：Codex 自行联网核对了 3 处（市教育局政策解读、OpenAI 帮助页、npm），这是它发现化学分值错误的方式——审阅提示词没有要求它上网。
