/**
 * dsh-team-auto-router
 *
 * A host-plane companion plugin for @nanmicoder/dsh-agent-teams. It listens
 * on the same `agent/pre-step` waterfall the /agent-teams gesture boundary
 * uses, scores each genuine user message with a zero-cost heuristic, and —
 * past the configured threshold — injects either:
 *
 *   - `ask`  : a directive telling the captain to explain the complexity
 *              signals and confirm via ask_user_question BEFORE activating;
 *   - `auto` : a deterministic activation directive (same contract as the
 *              gesture boundary, distinct source.kind).
 *
 * Fully inert by default (`autoTrigger: 'off'` registers nothing), never
 * modifies or rejects the step's own messages, and never lets an evaluation
 * error break the conversation: every failure path falls through to the
 * untouched decision.
 *
 * Known limits (documented in README):
 *   - No live-team awareness: an explicitly activated team plus this router
 *     can coexist; the cooldown and the ask-confirmation gate are the guards.
 *   - A leading "/agent-teams" goal is skipped so the two activation paths
 *     never stack on one message.
 *
 * @module dsh-team-auto-router
 */
import z from '@deepseek-ai/schemastery';
import { scoreGoal } from './scorer.js';
import { buildAskDirective, buildAutoDirective } from './directive.js';
import { extractUserGoal } from './goal.js';

// 本地消息工厂：内联自 @deepseek-ai/dsh-llm@0.1.1-rc.2 的
// freezeMessage/createMessage 语义（structuredClone + deepFreeze + randomUUID），
// 避免对宿主已提供的 dsh-llm 产生清单层重复依赖与遮蔽警告。
function deepFreeze(value) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
}

function createUserMessage({ content, source }) {
    return deepFreeze(structuredClone({
        id: crypto.randomUUID(),
        role: 'user',
        content,
        source,
    }));
}

export const name = 'team-auto-router';

const TRIGGER_MODES = ['off', 'ask', 'auto'];

export const Config = z.object({
    autoTrigger: z.union(TRIGGER_MODES).default('off'),
    scoreThreshold: z.natural().default(4),
    cooldownMinutes: z.natural().default(30),
    minLength: z.natural().default(50),
});

/** The gesture token owned by dsh-agent-teams; goals starting with it are skipped. */
const GESTURE = /^\/agent-teams(?=$|[\t\n\r ])/u;

/**
 * @param {object} ctx - host context providing the `agent/pre-step` waterfall.
 * @param {{ autoTrigger: string, scoreThreshold: number, cooldownMinutes: number, minLength: number }} config
 */
export function apply(ctx, config) {
    // Normalize defensively in case a profile layer wrote an unexpected value.
    const mode = TRIGGER_MODES.includes(config.autoTrigger) ? config.autoTrigger : 'off';
    if (mode === 'off') return; // Inert: no listener, zero behavior change.

    let lastFiredAt = 0;

    ctx.on('agent/pre-step', async ({ messages, signal }, next) => {
        const decision = await next();
        if (decision.kind === 'reject') return decision;
        try {
            const goal = extractUserGoal(messages);
            if (goal === undefined || GESTURE.test(goal)) return decision;

            const result = scoreGoal(goal, config);
            if (!result.ok || result.score < config.scoreThreshold) return decision;

            const now = Date.now();
            if (now - lastFiredAt < config.cooldownMinutes * 60_000) return decision;
            lastFiredAt = now;

            ctx.logger.info(
                `team-auto-router: fired (mode=${mode}, score=${result.score}`
                + `>=${config.scoreThreshold}; ${result.signals.join('; ')})`,
            );
            signal.throwIfAborted();

            const text = mode === 'auto'
                ? buildAutoDirective(goal, result)
                : buildAskDirective(goal, result, config);
            const activation = createUserMessage({
                content: [{ type: 'text', text }],
                source: { kind: 'team-auto-router', score: result.score },
            });
            return { kind: 'enter', messages: [...decision.messages, activation] };
        }
        catch (error) {
            // Never break the conversation because of an evaluation bug.
            ctx.logger.warn(`team-auto-router: evaluation failed, passing through: ${String(error)}`);
            return decision;
        }
    });
}
