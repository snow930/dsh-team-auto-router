/**
 * Genuine-user-message extraction, shared shape with
 * dsh-agent-teams/command.js `invokedAgentTeamsGoal`: only
 * `source.kind === 'user'` messages are scanned, so injected or external
 * text cannot trigger the router. Zero host dependencies — unit-testable.
 *
 * @module dsh-team-auto-router/goal
 */

/**
 * Extract the latest genuine user message text from the claimed batch.
 * @param {Array<{ source?: { kind?: string }, content?: Array<{ type: string, text?: string }> }>} messages
 * @returns {string | undefined} the trimmed concatenated text, or undefined.
 */
export function extractUserGoal(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message === undefined || message?.source?.kind !== 'user') continue;
        const text = (message.content ?? [])
            .filter((block) => block.type === 'text' && typeof block.text === 'string')
            .map((block) => block.text)
            .join('\n')
            .trim();
        if (text !== '') return text;
    }
    return undefined;
}
