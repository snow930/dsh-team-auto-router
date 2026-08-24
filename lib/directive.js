/**
 * Activation directive builders for the two non-off trigger modes.
 *
 * The system-prompt usage section owned by dsh-agent-teams holds the full
 * captain protocol; these messages only switch it on (or gate it behind one
 * confirmation). Text stays English to match the protocol language; the
 * quoted goal and signal list are verbatim from the user message.
 *
 * @module dsh-team-auto-router/directive
 */

/**
 * `ask` mode: do NOT activate yet — surface the signals, confirm first.
 * @param {string} goal - the user's goal text.
 * @param {{ score: number, signals: string[] }} result - scorer output.
 * @param {{ scoreThreshold: number }} config
 */
export function buildAskDirective(goal, result, config) {
    return [
        'The team-auto-router scored this request above the complexity threshold '
        + `(score ${result.score} >= threshold ${config.scoreThreshold}; signals: `
        + `${result.signals.join('; ') || 'n/a'}), but the user did not explicitly request AgentTeams.`,
        'Before doing anything else: explain in at most three sentences why this task '
        + 'would benefit from a multi-agent team, then call ask_user_question with a single '
        + 'confirm/decline question. Only if the user confirms, activate the AgentTeams '
        + 'protocol from your instructions now with this request as the team goal. '
        + 'If the user declines, continue normally as a single agent and do not mention the router again.',
        `Goal: ${goal}`,
    ].join('\n');
}

/**
 * `auto` mode: deterministic activation, same contract as the /agent-teams
 * gesture boundary's buildActivationDirective — but this message is only ever
 * injected with source.kind 'team-auto-router', never forged as the gesture.
 * @param {string} goal - the user's goal text.
 * @param {{ score: number, signals: string[] }} result - scorer output.
 */
export function buildAutoDirective(goal, result) {
    return [
        'The team-auto-router determined this request meets the complexity threshold '
        + `(score ${result.score}). Activate the AgentTeams protocol from your instructions now: `
        + 'you are the captain of a multi-agent team.',
        `Goal: ${goal}`,
    ].join('\n');
}
