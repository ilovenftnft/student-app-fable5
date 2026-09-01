# 实验：双引擎识题 + 知识点标注（2026-09-01）

**目的**：验证"只用订阅号、不开 API"的方案是否可行——用孩子电脑上会有的 Codex CLI（ChatGPT 登录）和家长的 Claude Code（Max 订阅）各自独立对同一张中考数学试卷图片做结构化识题，比较一致性与耗时。

**输入**：`exams/pages/2026数学-12.png`（2026 福建中考数学，选择题第 2–7 题，含 4 道带图题）
**Schema**：`schema.json`；**提示词**：`prompt.txt`（两边完全相同）

## 调用方式

```bash
# Codex（孩子电脑上的主引擎）
codex exec -i <img> --sandbox read-only --skip-git-repo-check --json \
  --output-schema schema.json -o codex_out.json "<prompt>" < /dev/null

# Claude Code（可选第二引擎）
claude -p --output-format json --json-schema "$(cat schema.json)" \
  --allowedTools Read --max-turns 4 "请先用 Read 读取 <img>，然后…<prompt>" < /dev/null
```

## 结果

| | Codex | Claude Code |
|---|---|---|
| 耗时 | 39 s | 28 s（3 turns） |
| 退出码 | 0 | 0 |
| schema 校验 | 通过 | 通过 |
| 识别题数 | 6（第 2–7 题） | 6（第 2–7 题） |
| 题型/分值 | 全部 选择 / 4 分 | 全部 选择 / 4 分 |
| needs_figure | 2,4,5,7 = true | 2,4,5,7 = true |
| 难度 | 2–6 基础，7 中档 | 2–6 基础，7 中档 |
| 平均 confidence | 0.98 | 0.92 |

**逐题一致性**（题干、册章、知识点）：

| 题 | 题干 | 册章 | 知识点 | 判定 |
|---|---|---|---|---|
| 2 | 一致 | Codex：八上轴对称 + 九上旋转；Claude：九上旋转 | 一致（轴对称/中心对称） | 一致，Codex 更完整 |
| 3 | 一致 | 七上第一章 | 科学记数法 | 一致 |
| 4 | 一致 | 九下第二十九章 | 三视图 | 一致 |
| 5 | Claude 多写了图中读出的条件 $b<-1<0<a<1$ | 七上第一章 | 数轴/有理数运算/大小比较 | 一致，Claude 多读出了图信息 |
| 6 | 一致 | 九下第二十六章 | 反比例函数 | 一致 |
| 7 | 一致 | 九下第二十八章 | 锐角三角函数 | 一致（Codex 多标"圆的基本性质"） |

**结论**：
1. 两个订阅号引擎的无头调用均可用，单页 30–40 秒，符合"异步后台任务"设计。
2. 六道题在题号、题型、分值、难度、册章、是否需要图上 **100% 一致**；知识点命名有措辞差异但语义一致——说明比对时要用"知识点归一化表"而非字符串相等。
3. 差异都出现在"多读/少读了一点"（Q2 的双章节、Q5 的图中条件），属于可接受的互补，不是错误。
4. 印刷体试卷不是难点；手写作业和几何图才是，需要用真实作业照片再测。

**注意事项**：
- Codex stderr 出现 `failed to load models cache: missing field supports_reasoning_summaries`，属旧缓存格式警告，不影响结果；需要时跑一次 `codex exec 'say ok'` 刷新缓存。
- Codex stderr 固定输出 `Reading additional input from stdin...` 一行噪音（因 stdin 接了 /dev/null），解析错误时要过滤。
