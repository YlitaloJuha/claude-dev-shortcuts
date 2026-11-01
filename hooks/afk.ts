// AFK: chosen from the row's button. A mode sends the session its rules and keeps it going
// turn after turn until the work runs out, a limit is reached or the person types again.
// The rules travel in the prompts, not the system prompt, so choosing a mode does not break the prompt cache.
// A module has one hook per event, so `register.tsx` calls these from the hooks it shares with Wrap up.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, TurnCompleteInput } from 'claude-code'

import type { AfkMode, AfkState } from '../types'

export const MAX_TURNS = 30
export const MAX_IDLE_TURNS = 2
export const MAX_LIMIT_PERCENT = 90
export const DONE_MARK = 'AFK-DONE'

const SCOPES: Record<AfkMode, string> = {
  develop: 'Build what is already planned: take the next item from this project\'s plan, task list, specs or TODOs and implement it, with tests. Do not invent features or change the design.',
  test: 'Improve the tests: run the suite, add tests for what is uncovered, and repair failing tests. Change production code only to fix a real bug a test exposed, and report each one.',
  refactor: 'Improve the code without changing behaviour: small steps, tests green before and after each. Change no public interface and add no features.',
  housekeeping: 'Tidy up: bring docs, CLAUDE.md and comments in line with the code, remove dead code and stale TODOs, fix lint warnings. List outdated dependencies without upgrading them.',
}

const RULES = `The user is away and nobody will answer until they return.

Rules:
- Stay in this project and follow its CLAUDE.md and the user's own instructions.
- Do not commit, push, open pull requests, publish, deploy or message anyone. Leave changes in the working tree.
- Do nothing destructive or hard to undo, and do not touch credentials.
- Ask no questions. Note a decision that is the user's, then take the reversible option or move on.
- Work in small steps and run the relevant tests after each. Keep the project's progress tracker current if it has one.
- If a step fails twice, note it and move on.
- When nothing useful is left in this mode, or you are blocked, report what changed, what you left and every open question. End that reply with a last line of exactly ${DONE_MARK}.`

export function kickoff(mode: AfkMode): string {
  return `The user pressed the AFK button in ${mode} mode. Start now.\n\nThis mode: ${SCOPES[mode]}\n\n${RULES}`
}

export function nudge(mode: AfkMode): string {
  return `AFK ${mode} mode continues. Take the next step.\n\nThis mode: ${SCOPES[mode]}\n\n${RULES}`
}

// Commands the rules forbid, refused here since a permission dialog would wait for
// someone who is away. A seatbelt: a command can be spelled past these patterns.
const FORBIDDEN = [
  /\bgit\b[^;&|]*\s(push|commit|clean)\b/,
  /\bgit\b[^;&|]*\sreset\b[^;&|]*--hard/,
  /\bgh\s+(pr\s+(create|merge)|release)\b/,
  /\b(npm|pnpm|yarn|cargo)\s+publish\b/,
  /\brm\s+-[a-zA-Z]*[rf]/,
]

export const isForbidden = (command: string) => FORBIDDEN.some(pattern => pattern.test(command))

// Prompts no person sent; any other origin means someone is back.
const UNATTENDED = new Set(['plugin', 'task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay', 'coordinator', 'observer', 'observer-activity'])

const afkMode = atom({ plugin: 'dev-shortcuts', key: 'afkMode' } as const, 'off' as AfkState)
const afkTaken = atom({ plugin: 'dev-shortcuts', key: 'afkTaken' } as const, 0)
const idleTurns = atom({ plugin: 'dev-shortcuts', key: 'afkIdleTurns' } as const, 0)
const toolCalls = atom({ plugin: 'dev-shortcuts', key: 'afkToolCalls' } as const, 0)
const isNoticeDue = atom({ plugin: 'dev-shortcuts', key: 'isAfkNoticeDue' } as const, false)

// Whether the main thread is in a turn, for AFK and Wrap up.
let isWorking = false
export const setWorking = (working: boolean) => {
  isWorking = working
}
export const isTurnRunning = () => isWorking

export async function stopAfk($: EngineInterface, why: string) {
  await update($, afkMode, () => 'off')
  await update($, isNoticeDue, () => false)
  $.ui.toast(`AFK off: ${why}`)
  $.ui.log(`AFK off: ${why}`)
}

export async function chooseAfk($: EngineInterface, chosen: AfkState) {
  await update($, afkMode, () => chosen)
  await update($, afkTaken, () => 0)
  await update($, idleTurns, () => 0)
  await update($, toolCalls, () => 0)
  await update($, isNoticeDue, () => isWorking)
  // A running turn hears it on its next tool result and goes on from turn.complete.
  if (chosen !== 'off' && !isWorking) $.clock.after(1, () => $.prompt.submit({ text: kickoff(chosen) }))
}

// Why a tool call is refused while a mode is on; nothing when it isn't.
export async function afkRefuses($: EngineInterface, tool: string, command: string) {
  if ((await read($, afkMode)) === 'off') return undefined
  if (tool === 'AskUserQuestion') return 'AFK: the user is away. Note the question for your final report, then take the reversible option or move on.'
  if (tool === 'Bash' && isForbidden(command)) return 'AFK: this command is not allowed while the user is away. Leave it for their return and note it in your report.'

  return undefined
}

export async function countAfkTool($: EngineInterface) {
  await update($, toolCalls, n => n + 1)
}

// What a running turn is told on its next tool result, once.
export async function afkNotice($: EngineInterface) {
  if (!(await read($, isNoticeDue))) return undefined
  await update($, isNoticeDue, () => false)
  const current = await read($, afkMode)

  return current === 'off' ? 'The user turned AFK off. Their usual instructions apply again.' : `The user pressed the AFK button in ${current} mode.\n\nThis mode: ${SCOPES[current]}\n\n${RULES}`
}

export async function afterAfkTurn($: EngineInterface, e: TurnCompleteInput) {
  const current = await read($, afkMode)
  if (e.agentId !== undefined || current === 'off') return
  if (e.isAborted || e.reason !== 'answer') return stopAfk($, e.isAborted ? 'interrupted' : `the turn ended with ${e.reason}`)
  if (e.answer.trimEnd().endsWith(DONE_MARK)) return stopAfk($, 'the session says it is finished or blocked')
  const called = await read($, toolCalls)
  await update($, toolCalls, () => 0)
  const idle = called === 0 ? (await read($, idleTurns)) + 1 : 0
  await update($, idleTurns, () => idle)
  if (idle >= MAX_IDLE_TURNS) return stopAfk($, 'two turns in a row did no work')
  const count = (await read($, afkTaken)) + 1
  await update($, afkTaken, () => count)
  if (count >= MAX_TURNS) return stopAfk($, `reached the limit of ${MAX_TURNS} turns`)
  const usage = await $.session.usage()
  const spent = usage.rateLimits.find(l => l.percentUsed >= MAX_LIMIT_PERCENT)
  if (spent !== undefined) return stopAfk($, `${spent.kind} plan limit is at ${Math.round(spent.percentUsed)}%`)
  $.clock.after(1, () => $.prompt.submit({ text: nudge(current) }))
}

export async function resetAfk($: EngineInterface) {
  await update($, afkMode, () => 'off')
}

export const registerAfk = (on: On) => {
  on('prompt.submit', async ($, e, next) => {
    if ((await read($, afkMode)) !== 'off') {
      const isWrapUp = e.origin.kind === 'plugin' && e.origin.name === 'wrap-up'
      if (isWrapUp) await stopAfk($, 'wrapping up')
      else if (!UNATTENDED.has(e.origin.kind)) await stopAfk($, 'you are back')
    }

    return next(e)
  })
}
