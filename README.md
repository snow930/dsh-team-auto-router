# dsh-team-auto-router

[DSH](https://github.com/deepseek-ai/deepseek-harness) 宿主端伴生插件：为
[`@nanmicoder/dsh-agent-teams`](https://www.npmjs.com/package/@nanmicoder/dsh-agent-teams)
提供**复杂任务自动触发**能力。监听与 `/agent-teams` gesture boundary 相同的
`agent/pre-step` waterfall，对每条真实用户消息做零成本启发式复杂度评分，
超过阈值后按配置注入两种消息之一——**先确认**（ask）或**直接建队**（auto）。

**默认 `autoTrigger: off`，安装本身不改变任何会话行为。**

## 激活模式

| `autoTrigger` | 行为 |
|---|---|
| `off` | 完全惰性：不注册任何监听器 |
| `ask` | 超阈值后注入指令，要求队长先简述命中信号并用 `ask_user_question` 征求确认；确认才激活 captain 协议，拒绝则单 agent 继续 |
| `auto` | 超阈值后确定性激活协议（与 gesture boundary 同构；`source.kind` 保持 `team-auto-router`，日志可区分来源） |

## 评分规则（`lib/scorer.js`，纯函数可单测）

| 分值 | 信号 |
|---|---|
| +2 | **实施指令**：「确认，开始实施 / 按方案执行 / 照此方案 / proceed with the plan …」命中即触发，且豁免长度下限与问答否决（否定前缀"别/不/没"除外） |
| +2 | 结构：编号/列表项 ≥2、紧凑内联枚举（"1改宽侧边栏 2保持点击切换"），或并列连词分隔的祈使子句 ≥2（并且 / 同时 / 然后 / 另外 …） |
| +2 | 范围：≥2 个不同目标（路径 token 或包名 kebab-token；路径内含的包名不重复计数） |
| +1 | 任务类型词：审计 / 迁移 / 批量 / 全面重构 / 调研并实现 / 从零搭建 / audit / migrate … |
| +1 | 文本 > 200 字符 |

硬否决（一票不触发）：文本短于 `minLength`；问答式消息（问号结尾或疑问词开头，且无结构信号、无祈使提示词——"为什么X没生效？帮我逐项排查并修复"会正常进入评分）。

## 配置

```yaml
- id: team-auto-router        # profile patch 层按 id 字段级合并，只需写要覆盖的键
  config:
    autoTrigger: ask          # off | ask | auto
    scoreThreshold: 2
    cooldownMinutes: 30       # 触发一次后的静默窗口
    minLength: 30             # 短于此长度的消息永不评分
```

## 安装

```bash
# 方式一：CLI（npm 包或本地路径）
dsh plugin --profile web add ~/git/dsh-team-auto-router

# 方式二：手动（本仓库当前采用）
# 1. profiles/web/package.json dependencies 增加
#    "dsh-team-auto-router": "link:~/git/dsh-team-auto-router"
# 2. dsh.profile.bundles 追加 "dsh-team-auto-router"（置于 dsh-agent-teams 之后）
# 3. 在 profiles/web 下 pnpm install
# 4. profiles/web/cordis.patch.yml 追加覆盖行开启 ask/auto
```

## 边界与已知限制

- **不做活跃团队感知**：显式 `/agent-teams` 建队后 router 仍可能就后续新消息触发；
  防线是 cooldown 与 ask 档的用户确认。以 `/agent-teams` 开头的目标消息会被跳过，
  两条激活路径不会叠加在同一条消息上。
- 启发式必然存在误报/漏报；`ask` 档下最终决定权始终在用户。
- 所有评估异常都被捕获并原样放行决策，绝不阻断正常对话。
- 状态仅存于进程内存（冷却时间戳），重启即复位，无磁盘状态。

## 测试

```bash
pnpm test   # node --test，覆盖 scorer / goal / directive 全部纯逻辑
```
