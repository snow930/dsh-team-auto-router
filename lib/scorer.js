/**
 * Heuristic complexity scorer for genuine user goal messages.
 *
 * Pure functions only: no host context, no LLM calls, fully unit-testable.
 * The score is deliberately coarse — its job is to gate a confirmation
 * prompt, not to make an irreversible decision (that remains the user's).
 *
 * Signals (additive):
 *   +2  structure  — a numbered/bulleted list with >=2 items, or >=2
 *                    imperative clauses separated by coordination markers
 *                    ("并且", "同时", "然后分别", ";", line breaks, ...)
 *   +2  scope      — >=2 distinct path-like or module-like tokens
 *                    ("/home/x/y", "src/**", "repo-a", "dsh-agent-teams", ...)
 *   +1  task-type  — batch/migration/audit/refactor/research-and-build style
 *                    keywords (zh + en)
 *   +1  length     — text longer than 200 chars
 *
 * Hard vetoes (score is irrelevant when one fires):
 *   - shorter than `minLength` chars
 *   - Q&A-shaped: ends with a question mark, or opens with an interrogative,
 *     and shows no structural signal (plain questions stay single-agent)
 *
 * @module dsh-team-auto-router/scorer
 */

/** Coordination / sequencing markers that split imperative clauses. */
const COORDINATORS = [
    '并且', '同时', '然后分别', '分别进行', '以及', '此外还要',
    '一并', '顺带把', '然后再', '接着再',
];

/** Task-type keyword list (substring match, zh + en). */
const TASK_TYPE_WORDS = [
    '审计', '迁移', '批量', '全面重构', '重构', '调研并实现', '调研并',
    '从零搭建', '从零实现', '整套', '对比分析', '逐一检查', '全面梳理',
    '端到端', '跨仓库', '跨模块',
    'audit', 'migrate', 'migration', 'batch', 'refactor', 'comprehensive',
    'end-to-end', 'end to end', 'across all', 'research and implement',
];

/** Path-like token: contains a "/" and path-ish characters. */
const PATH_TOKEN = /[A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)+/g;

/**
 * Interrogative openings that suggest a plain question rather than a task.
 * Chinese prefixes use startsWith (word-boundary `\b` does not exist around
 * CJK chars); English ones keep the regex form.
 */
const INTERROGATIVE_ZH = [
    '什么', '为什么', '怎么', '怎样', '如何',
    '是不是', '有没有', '能否', '是否',
];
const INTERROGATIVE_EN = /^(which|what|why|how|is|are|does|do|can|could|should)\b/iu;
const QUESTION_END = /[？?]\s*$/u;

/** @param {string} trimmed */
function looksLikeQuestion(trimmed) {
    return QUESTION_END.test(trimmed)
        || INTERROGATIVE_ZH.some((word) => trimmed.startsWith(word))
        || INTERROGATIVE_EN.test(trimmed);
}

/** Numbered/bulleted list item at line start (1. 1、 1) - * …). */
const LIST_ITEM = /^\s*(?:\d+[.、)]|[-*•])\s+/mu;

/** Path-shape probe (non-global: safe for repeated .test calls). */
const PATH_SHAPE = /^[A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)+$/u;
const PACKAGE_SHAPE = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/giu;

/**
 * Score one goal text.
 * @param {string} text - the trimmed user message text.
 * @param {{ minLength?: number }} [options]
 * @returns {{ ok: boolean, score: number, signals: string[], veto: string | null }}
 *   `ok` is false whenever the message must not trigger anything.
 */
export function scoreGoal(text, options = {}) {
    const minLength = options.minLength ?? 50;
    const trimmed = String(text ?? '').trim();
    const signals = [];

    if (trimmed.length < minLength) {
        return { ok: false, score: 0, signals, veto: 'too-short' };
    }

    // --- structure -----------------------------------------------------------
    const listItems = trimmed.split('\n').filter((line) => LIST_ITEM.test(line)).length;
    const coordinatorHits = COORDINATORS.filter((word) => trimmed.includes(word));
    const clauseCount = listItems + coordinatorHits.length;
    const hasStructure = clauseCount >= 2;
    if (hasStructure) {
        const parts = [];
        if (listItems > 0) parts.push(`list-items:${listItems}`);
        if (coordinatorHits.length > 0) parts.push(`coordinators:${coordinatorHits.join('|')}`);
        signals.push(`structure(+2): ${parts.join(', ')}`);
    }

    // --- scope ---------------------------------------------------------------
    // Path-like tokens ("/home/x/y", "src/lib/foo.ts", "docs/README.zh.md").
    const scopeTokens = new Set(
        (trimmed.match(PATH_TOKEN) ?? [])
            .map((token) => token.replace(/[.,;、。;！!）)]+$/u, ''))
            .filter((token) => token.length > 3 && PATH_SHAPE.test(token)),
    );
    // Package-style tokens without slashes still indicate multi-module scope
    // (e.g. "dsh-agent-teams 和 dsh-mneme") — unless they are already part of
    // a counted path ("/x/git/dsh-foo" and "dsh-foo" are ONE target).
    for (const token of trimmed.match(PACKAGE_SHAPE) ?? []) {
        const normalized = token.toLowerCase();
        if (normalized.length <= 6) continue;
        const covered = [...scopeTokens].some(
            (existing) => existing.toLowerCase().includes(normalized),
        );
        if (!covered) scopeTokens.add(normalized);
    }
    if (scopeTokens.size >= 2) {
        signals.push(`scope(+2): ${scopeTokens.size} distinct targets`);
    }

    // --- task type -----------------------------------------------------------
    const lower = trimmed.toLowerCase();
    const typeHits = TASK_TYPE_WORDS.filter((word) => lower.includes(word));
    if (typeHits.length > 0) {
        signals.push(`task-type(+1): ${typeHits.join('|')}`);
    }

    // --- length --------------------------------------------------------------
    if (trimmed.length > 200) {
        signals.push(`length(+1): ${trimmed.length} chars`);
    }

    // --- vetoes --------------------------------------------------------------
    if (looksLikeQuestion(trimmed) && !hasStructure) {
        return { ok: false, score: 0, signals, veto: 'qa-shaped' };
    }

    let score = 0;
    if (hasStructure) score += 2;
    if (scopeTokens.size >= 2) score += 2;
    if (typeHits.length > 0) score += 1;
    if (trimmed.length > 200) score += 1;

    return { ok: true, score, signals, veto: null };
}
