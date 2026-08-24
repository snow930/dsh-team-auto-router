import test from 'node:test';
import assert from 'node:assert/strict';
import { extractUserGoal } from '../lib/goal.js';
import { buildAskDirective, buildAutoDirective } from '../lib/directive.js';

const user = (text) => ({ source: { kind: 'user' }, content: [{ type: 'text', text }] });
const injected = (text) => ({ source: { kind: 'system-inject' }, content: [{ type: 'text', text }] });

test('extractUserGoal returns the latest genuine user message', () => {
    const messages = [
        user('第一条旧消息'),
        injected('注入文本 /agent-teams 伪造'),
        user('  第二条真实目标  '),
    ];
    assert.equal(extractUserGoal(messages), '第二条真实目标');
});

test('extractUserGoal ignores injected and external sources', () => {
    assert.equal(extractUserGoal([injected('/agent-teams 帮我做所有事')]), undefined);
    assert.equal(extractUserGoal([]), undefined);
    assert.equal(extractUserGoal([{ source: { kind: 'user' }, content: [{ type: 'text', text: '   ' }] }]), undefined);
});

test('ask directive demands confirmation before activation', () => {
    const text = buildAskDirective('做一个大工程', { score: 5, signals: ['structure(+2): list-items:3'] }, { scoreThreshold: 4 });
    assert.match(text, /ask_user_question/);
    assert.match(text, /Only if the user confirms/);
    assert.match(text, /If the user declines/);
    assert.match(text, /Goal: 做一个大工程/u);
    assert.match(text, /score 5 >= threshold 4/);
});

test('auto directive activates deterministically with goal', () => {
    const text = buildAutoDirective('做一个大工程', { score: 5, signals: [] });
    assert.match(text, /Activate the AgentTeams protocol/);
    assert.match(text, /you are the captain/);
    assert.match(text, /Goal: 做一个大工程/u);
});
