// Wrap up, from the row's button. It tells running subagents to finish, tells a running
// turn through its next tool result, and queues the checklist as a prompt of its own,
// which runs once the session is idle.
// A module has one hook per event, so `register.tsx` calls these from the hooks it shares with AFK.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, TurnCompleteInput } from 'claude-code'

import type { AfkState, WrapUpPhase } from '../types'
import { isTurnRunning, stopAfk } from './afk.ts'

const LIVE = new Set(['pending', 'running', 'waiting', 'idle'])

export const AGENT_MESSAGE = 'The user pressed Wrap up. Finish the step you are on, start nothing new, and report what you did and what is left.'

export const TURN_NOTICE = 'The user pressed the Wrap up button. Finish the step you are on and start nothing new. End this turn at the next suitable moment; the wrap-up checklist follows as its own message.'

export const CHECKLIST = `The user pressed the Wrap up button. Close this session out cleanly, in this order:

1. Stop. Start no new work, and finish only the step in progress. Running subagents have been told the same: wait for them and read what they report. Stop background processes you started that are no longer needed.
2. Verify. Run the checks that fit what changed and report the real results. List new problems instead of fixing them.
3. Docs. Bring up to date what this work changed: the project's CLAUDE.md, its docs and memory.
4. Handoffs and tracking. Update whatever tracks progress here (plan files, task lists, issues, pull requests, spec tools). For anything unfinished, leave a handoff a fresh session can start from, and report to any session waiting on this one.
5. Commits. In each repository this session touched, check for uncommitted work and unpushed commits. Show what you find. Ask before committing, then ask before pushing. Do neither without a yes to that question.
6. Report. Say briefly what is done, what is not, where it was committed, and the next step.

Skip a step that does not apply and say so.`

const afkMode = atom({ plugin: 'dev-shortcuts', key: 'afkMode' } as const, 'off' as AfkState)
const wrapUpPhase = atom({ plugin: 'dev-shortcuts', key: 'wrapUpPhase' } as const, 'idle' as WrapUpPhase)
const isNoticeDue = atom({ plugin: 'dev-shortcuts', key: 'isWrapUpNoticeDue' } as const, false)
const turnsBeforeChecklist = atom({ plugin: 'dev-shortcuts', key: 'turnsBeforeChecklist' } as const, 0)

export async function wrapUp($: EngineInterface) {
  if ((await read($, wrapUpPhase)) !== 'idle') return
  await update($, wrapUpPhase, () => 'asked')
  // The checklist asks before committing, which AFK would refuse.
  if ((await read($, afkMode)) !== 'off') await stopAfk($, 'wrapping up')
  await update($, isNoticeDue, () => isTurnRunning())
  await update($, turnsBeforeChecklist, () => (isTurnRunning() ? 1 : 0))
  const live = (await $.agent.list()).filter(a => LIVE.has(a.status))
  const sent = await Promise.all(live.map(a => $.session.send({ to: { agentId: a.id }, text: AGENT_MESSAGE }).then(r => r.isDelivered, () => false)))
  const told = sent.filter(Boolean).length
  if (live.length > 0) $.ui.toast(`Wrap up: told ${told} of ${live.length} subagents`)
  // Work a press starts ends with the press; a timer gives the prompt its own dispatch.
  $.clock.after(1, () => $.prompt.submit({ text: CHECKLIST }))
}

// Reaches a turn already running, which a queued prompt would only follow.
export async function wrapUpNotice($: EngineInterface) {
  if (!(await read($, isNoticeDue))) return undefined
  await update($, isNoticeDue, () => false)

  return TURN_NOTICE
}

// The turn running at the press ends first; the checklist's own turn ends next.
export async function afterWrapUpTurn($: EngineInterface, e: TurnCompleteInput) {
  if (e.agentId !== undefined || (await read($, wrapUpPhase)) === 'idle') return
  await update($, isNoticeDue, () => false)
  if ((await read($, turnsBeforeChecklist)) > 0) await update($, turnsBeforeChecklist, n => n - 1)
  else await update($, wrapUpPhase, () => 'idle')
}

export async function resetWrapUp($: EngineInterface) {
  await update($, wrapUpPhase, () => 'idle')
}
