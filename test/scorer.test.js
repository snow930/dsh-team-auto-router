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
