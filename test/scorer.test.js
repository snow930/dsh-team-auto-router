import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreGoal } from '../lib/scorer.js';

const OPTS = { minLength: 50 };

test('too-short messages are hard-vetoed', () => {
    const result = scoreGoal('帮我看看这个报错', OPTS);
    assert.equal(result.ok, false);
    assert.equal(result.veto, 'too-short');
});

test('plain Q&A is vetoed even when long', () => {
    const text = '我想问一下 dsh 的插件加载顺序是怎么决定的？'.repeat(4);
    const result = scoreGoal(text, OPTS);
    assert.equal(text.length > 50, true);
    assert.equal(result.ok, false);
    assert.equal(result.veto, 'qa-shaped');
});

test('interrogative opening without structure is vetoed', () => {
    const text = '为什么 dsh-agent-teams 需要显式激活，而普通对话不会触发它，这里面有什么机制上的原因吗，能展开讲讲整个链路吗';
    const result = scoreGoal(text, OPTS);
    assert.equal(result.ok, false);
    assert.equal(result.veto, 'qa-shaped');
});

test('complex multi-part task with paths scores high', () => {
    const text = [
        '请对 ~/git/TVBoxNG 和 ~/.dsh/profiles/web/cordis.patch.yml 做一次全面审计：',
        '1. 审计配置源加载链路；',
        '2. 同时迁移 docs/ 下的全部文档到新目录结构；',
        '3. 然后分别给出修复补丁并推送 GitHub。',
    ].join('\n');
    const result = scoreGoal(text, OPTS);
    assert.equal(result.ok, true);
    assert.ok(result.score >= 4, `score=${result.score}, signals=${result.signals}`);
});

test('single focused request stays below threshold', () => {
    const text = '帮我把 dsh-self-upgrade 仓库 README.md 里的安装命令从 npm 换成 pnpm，并保持其余内容与措辞完全不变，改完之后跑一遍现有测试确认没有破坏任何东西，最后提交这次改动。';
    const result = scoreGoal(text, OPTS);
    assert.equal(result.ok, true);
    assert.ok(result.score < 4, `score=${result.score}, signals=${result.signals}`);
});

test('structure signal fires on numbered list alone', () => {
    const text = '请依次完成以下三件小事，都是常规维护工作：\n1. 检查所有单元测试是否通过，有失败的就地修复\n2. 把这一轮的变更补充到更新日志里\n3. 打一个 patch 版本标签并推送';
    const result = scoreGoal(text, OPTS);
    assert.equal(result.ok, true);
    assert.ok(result.signals.some((s) => s.startsWith('structure')));
});

test('scope signal needs two distinct targets', () => {
    const single = '请把 ~/git/dsh-self-upgrade 这个仓库里的所有 TODO 注释清理干净并逐条确认处理方式，这是一项需要细致对待的整理工作。';
    const resultSingle = scoreGoal(single, OPTS);
    assert.ok(!resultSingle.signals.some((s) => s.startsWith('scope')), resultSingle.signals.join(';'));
});

test('compact inline enumeration counts as structure (real-world message)', () => {
    const text = 'ng浅色模式字幕搜索的文字是黑色背景无法分辨，播放器应该统一为深色，没必要应用浅色。弹幕字体太小看不清，默认字号调大一档并保存设置。播放器面板弹出选项和侧边栏时不要自动隐藏。1改宽侧边栏 2保持点击切换 3横排卡片式布局 4保持现有动画效果不变';
    const result = scoreGoal(text, OPTS);
    assert.equal(result.ok, true);
    assert.ok(result.signals.some((s) => s.includes('inline-enum')), result.signals.join(';'));
    // Pairs with the profile's scoreThreshold: 2 — real-world multi-part UI
    // tasks rarely carry path tokens or task-type keywords on top of structure.
    assert.ok(result.score >= 2, `score=${result.score}, signals=${result.signals}`);
});

test('quantity digits are not enumerations', () => {
    const text = '这次更新需要下载2个依赖包和3个字体资源，请确认磁盘空间充足后再继续操作，避免中途失败导致缓存损坏问题出现，整体流程保持简单可靠不要引入额外复杂度，完成后输出简要说明即可';
    const result = scoreGoal(text, OPTS);
    assert.equal(result.veto, null);
    assert.ok(!result.signals.some((s) => s.startsWith('structure')), result.signals.join(';'));
});

test('spoken coordinators split clauses', () => {
    const text = '先把当前配置完整备份一份，另外把文档里的安装说明同步成最新步骤，再把版本号统一改成新标签，三处都改完后一起提交推送';
    const result = scoreGoal(text, OPTS);
    assert.ok(result.signals.some((s) => s.startsWith('structure')), result.signals.join(';'));
});

test('nested coordinator pair does not fake two clauses', () => {
    const text = '请按顺序执行迁移然后再分别核对每个步骤的输出结果与预期是否完全一致，有任何偏差都要当场停下来记录清楚原因';
    const result = scoreGoal(text, OPTS);
    assert.ok(!result.signals.some((s) => s.startsWith('structure')), result.signals.join(';'));
});

test('interrogative opening with imperative hint is scored, not vetoed', () => {
    const text = '为什么 agent-teams 没有自动启用？请帮我检查 profiles/web 下的全部插件配置并逐项排查问题根源，最后给出修复方案';
    const result = scoreGoal(text, OPTS);
    assert.equal(result.veto, null);
    assert.equal(result.ok, true);
});
