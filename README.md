# dsh-team-auto-router

[DSH](https://github.com/deepseek-ai/deepseek-harness) 宿主端伴生插件：为
[`@nanmicoder/dsh-agent-teams`](https://www.npmjs.com/package/@nanmicoder/dsh-agent-teams)
提供**复杂任务自动触发**能力。监听与 `/agent-teams` gesture boundary 相同的
`agent/pre-step` waterfall，对每条真实用户消息做零成本启发式复杂度评分，
超过阈值后按配置注入两种消息之一——**先确认**（ask）或**直接建队**（auto）。

**默认 `autoTrigger: off`，安装本身不改变任何会话行为。**

## 触发流水线

一条用户消息从进入 waterfall 到最终触发，依次经过六道门；任何一道不放行，
原决策原样通过，会话无感：

```
pre-step 批次
  │
  ├─ 门 1  开关        autoTrigger: off → 未注册监听器，流程根本不到这里
  ├─ 门 2  来源过滤    只认 source.kind === 'user' 的消息；
  │                    取批次中最新一条非空 user 文本作为 goal。
  │                    插件注入、工具结果、外部系统文本一律不触发
  ├─ 门 3  手势避让    goal 以 "/agent-teams" 开头（后接空白或结尾）→ 跳过，
  │                    与手势激活路径永不叠加在同一条消息上
  ├─ 门 4  评分        scoreGoal(goal, config)：
  │                      · 命中硬否决（见下）→ ok=false，放行
  │                      · score < scoreThreshold      → 放行
  ├─ 门 5  冷却        距上次触发不足 cooldownMinutes → 放行；
  │                    冷却期内的高分消息不会顺延冷却窗口
  └─ 门 6  注入        throwIfAborted 后按 autoTrigger 注入指令消息，
                       以 { kind: 'enter', messages: [...原决策, 指令] } 返回
```

## 激活模式

| `autoTrigger` | 行为 |
|---|---|
| `off` | 完全惰性：不注册任何监听器 |
| `ask` | 注入指令，要求队长先简述命中信号并用 `ask_user_question` 征求确认；确认才激活 captain 协议，拒绝则单 agent 继续 |
| `auto` | 确定性激活协议（与 gesture boundary 同构；`source.kind` 保持 `team-auto-router`，日志可区分来源） |

## 评分细则（`lib/scorer.js`，纯函数可单测）

对 goal 文本（trim 后）累加信号分：

### implement(+2) — 显式实施指令

命中任一短语即 +2，**单独即可达到默认阈值**：

> 开始实施 · 按方案实施 · 照方案实施 · 按方案执行 · 照此方案 · 按此方案 ·
> 确认实施 · 同意实施 · 方案通过 · 动手吧 · 开工吧 ·
> start implementing · proceed with the plan · execute the plan ·
> implement the plan · go ahead with the plan

- **否定抑制**：命中位置前 4 字符内出现「别 / 不 / 没 / 莫 / 勿 / 尚未」则该处
  不算（「先别开始实施」是拒绝不是批准）；同一短语多处出现逐处判断
- **双重豁免**：implement 命中同时豁免两项硬否决——这类消息天然很短
  （「确认，开始实施」），却是最明确的意图表达

### structure(+2) — 多子句结构

三个计数器相加 ≥ 2 即命中：

| 计数器 | 判定 | 计数值 |
|---|---|---|
| 列表项 | 行首 `1.` `1、` `1)` `-` `*` `•` + 空格的行数 | 每行计 1 |
| 并列连词 | 含「并且 / 同时 / 然后 / 另外 / 以及 / 此外还要 / 一并 / 顺带把 / 再把 / 还要 / 接着再 / 然后再 / 分别进行 / 然后分别 / 还有就是」之一 | 每词计 1；短词含于长词命中时只计长词（「然后分别」不再重复计「然后」） |
| 紧凑枚举 | 存在连续升序的独立数字对（「1改宽侧边栏 2保持点击切换」中的 1,2） | 命中一次计 2 |

紧凑枚举的排除规则：数字后跟量词（个/位/条/项/次/遍/年/月/日/号/点/分/秒/
页/行/字/层/组/批/份/倍/成/步）是数量不是序号（「3个文件」）；小数（1.5）、
版本尾缀（v12）、百分号、行首列表项同样排除；参与配对的数值限 1–8。

注意：**单个并列连词只计 1，凑不满 structure**——「修复 A 然后 B」不触发；
「嵌套连词」（「然后再分别」，短词含于长词）也只算同一子句。需要两个独立
计数（两个不同连词、列表项+连词等），或一处紧凑枚举。

### scope(+2) — 多目标范围

统计不同目标 token，≥ 2 个即命中：

- **路径形 token**：含 `/` 的串（`src/lib/foo.ts`、`docs/README.zh.md`），
  长度 > 3，剥掉尾部标点后须整体匹配路径形状
- **包名形 token**：无斜杠的 kebab-case 词（`dsh-agent-teams`），长度 > 6；
  已被某条计入的路径包含的同名包不重复计（`/x/git/dsh-foo` 与 `dsh-foo`
  是同一个目标）

### task-type(+1) — 任务类型词

子串命中任一关键词即 +1（可多个，仍只 +1）：

> 审计 · 迁移 · 批量 · 重构 · 全面重构 · 调研并实现 · 调研并 · 从零搭建 ·
> 从零实现 · 整套 · 对比分析 · 逐一检查 · 全面梳理 · 端到端 · 跨仓库 · 跨模块 ·
> audit · migrate · migration · batch · refactor · comprehensive ·
> end-to-end · end to end · across all · research and implement

### length(+1) — 长文本

trim 后长度 > 200 字符即 +1。

## 硬否决（一票否决，得分再高也不触发）

| 否决 | 条件 |
|---|---|
| `too-short` | 长度 < `minLength`（implement 命中时豁免） |
| `qa-shaped` | 问号结尾，或以疑问词开头（什么/为什么/怎么/怎样/如何/是不是/有没有/能否/是否，英文 which/what/why/how/is/are/does/do/can/could/should…），**且**无结构信号、**且**无祈使提示词（帮我/请/麻烦/需要你/给我/动手/修复/排查/检查/清理/迁移/重构/实现/完成/处理/执行/更新/同步） |

问答否决刻意宽松：「为什么X没生效？帮我逐项排查并修复」因含祈使提示词正常
进入评分；纯提问留在单 agent。

## 达到阈值的典型组合（默认阈值 2）

- 「确认，开始实施」→ implement(+2)，最短合法触发（豁免长度门）
- 长反馈末尾带「…1改宽侧边栏 2保持点击切换 3横排卡片式布局」→
  structure(+2)（紧凑枚举；短消息单独发会被 minLength 门拦下）
- 「先把配置备份一份，另外把文档同步成最新步骤，再把版本号改成新标签」→
  structure(+2)（另外 + 再把，两个独立连词）
- 「审计一下 dsh-mneme 和 dsh-agent-teams」→ scope(+2) + task-type(+1)；
  若只提一个包则仅剩 task-type(+1)
- 「请全面重构历史模块的缓存清理逻辑，保持对外行为完全不变，不要引入额外
  复杂度」→ 仅 task-type(+1)，**不足以**触发——这正是设计意图：单一模糊
  信号不建队，需要第二个独立佐证
- 「修复 scorer 里的两处边界情况，然后把测试补齐到全覆盖再跑一遍确认」→
  仅单个连词「然后」（计 1），structure 不成立，不触发

## 配置

```yaml
- id: team-auto-router        # profile patch 层按 id 字段级合并，只需写要覆盖的键
  config:
    autoTrigger: ask          # off | ask | auto（schema 默认 off）
    scoreThreshold: 2         # schema 默认 4；实测真实多项任务通常仅 structure(+2)，推荐 2
    cooldownMinutes: 30       # 触发一次后的静默窗口（schema 默认 30）
    minLength: 30             # 短于此长度的消息永不评分（schema 默认 50）
```

## 安装

**推荐：从 npm 安装**：

```bash
dsh plugin --profile web add dsh-team-auto-router
```

或手动编辑 `profiles/web/package.json`：`dependencies` 增加
`"dsh-team-auto-router": "^0.1.0"`、`dsh.profile.bundles` 追加
`"dsh-team-auto-router"`（置于 dsh-agent-teams 之后），然后在 profiles/web 下
`pnpm install`。

安装后在 `profiles/web/cordis.patch.yml` 追加覆盖行开启 ask/auto（见「配置」）。

**本地开发（维护者迭代）**：link 到本地检出，修改源码后重启 DSH Web 即生效，
无需重新发布 npm：

```bash
# profiles/web/package.json: "dsh-team-auto-router": "link:~/git/dsh-team-auto-router"
dsh plugin --profile web add link:~/git/dsh-team-auto-router
```

运行时依赖已随包声明（仅 `@deepseek-ai/schemastery` `^3.18.1`；消息构造
`createUserMessage` 已内联 `structuredClone + deepFreeze + randomUUID` 语义，
不再依赖宿主已提供的 `@deepseek-ai/dsh-llm`，彻底消除清单层遮蔽警告），
npm 与 link 两种消费方式均无需额外步骤。

## 边界与已知限制

- **不做活跃团队感知**：显式 `/agent-teams` 建队后 router 仍可能就后续新消息触发；
  防线是 cooldown 与 ask 档的用户确认。
- 启发式必然存在误报/漏报；`ask` 档下最终决定权始终在用户。
- 所有评估异常都被捕获并原样放行决策，绝不阻断正常对话。
- 状态仅存于进程内存（冷却时间戳），重启即复位，无磁盘状态。

## 测试

```bash
npm test    # node --test，覆盖 scorer / goal / directive 全部纯逻辑
```

## 更新日志

### 0.1.2

- 新增 **implement(+2)** 强信号：显式实施指令短语（「确认，开始实施」「按方案执行」
  `proceed with the plan` 等）命中即达默认阈值，并豁免 `too-short` 与 `qa-shaped`
  两道硬否决——覆盖「agent 出方案 → 用户短确认实施」这一此前完全无法触发的场景
- 否定守卫：命中位置前 4 字符内出现否定片段（别/不/没/莫/勿/尚未）则不算
- 测试 16 → 20 例，含真实生产措辞回归

### 0.1.1

- 评分器对真实中文表达的校准（此前阈值 4 下真实任务消息最高仅得 1 分）：
  - 新增**紧凑内联枚举**信号（「1改宽侧边栏 2保持点击切换」式连续升序编号，
    排除量词/小数/版本尾缀）
  - 补口语并列连词（然后/另外/还有就是/还要/再把），嵌套命中去重
  - `qa-shaped` 否决放宽：疑问开头但含祈使提示词（帮我/请/修复/排查…）时
    正常进入评分而非一票否决
- 推荐配置调整为 `scoreThreshold: 2`、`minLength: 30`（按真实会话实测校准）
