import { atom, read } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AfkMode, AfkState, MemoryGrowth, WrapUpPhase } from '../types'
import { afkNotice, afkRefuses, afterAfkTurn, chooseAfk, countAfkTool, registerAfk, resetAfk, setWorking } from './afk.ts'
import { measureMemory, memoryText } from './memory.ts'
import { AFK_OFFER, afkTask, CHALLENGE, COUNCIL, COUNCIL_AGENT, DILUTE, dilutePrompt, SERVE } from './methods.ts'
import { afterWrapUpTurn, resetWrapUp, wrapUp, wrapUpNotice } from './wrap-up.ts'

// The engine reads a state reference only from a const in the same file, so each file names its own.
const afkMode = atom({ plugin: 'dev-shortcuts', key: 'afkMode' } as const, 'off' as AfkState)
const afkTaken = atom({ plugin: 'dev-shortcuts', key: 'afkTaken' } as const, 0)
const wrapUpPhase = atom({ plugin: 'dev-shortcuts', key: 'wrapUpPhase' } as const, 'idle' as WrapUpPhase)
const memoryGrown = atom({ plugin: 'dev-shortcuts', key: 'memoryGrown' } as const, null as MemoryGrowth | null)

type Kind = 'challenge' | 'council' | 'serve'
type Method = Kind | 'dilute'
type Row = { kind: Kind; label: string; question: string; tip: string }
type Offer = { mode: AfkMode; task: string }

const CONVERSATION = 'the plan or idea in this conversation'
const HEADER = 'Shortcuts'
const CANCEL = 'Cancel'
const MAX_OFFERS = 3
const MAX_TASK = 90
// A desktop button's hover highlight: its height in lines, and what comes off each side in characters.
const HIGHLIGHT_HEIGHT = 1.3
const HIGHLIGHT_TRIM = 0.5
const TIP_COLUMNS = 48

const METHODS: Record<Method, string> = { challenge: CHALLENGE, council: COUNCIL, serve: SERVE, dilute: DILUTE }

// Lucide icons (ISC), 24 × 24.
const ICONS: Record<Method | 'afk' | 'wrap-up', string> = {
  afk: '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/>',
  'wrap-up': '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
  challenge: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  council: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  serve: '<path d="M3 20a1 1 0 0 1-1-1v-1a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1Z"/><path d="M20 16a8 8 0 1 0-16 0"/><path d="M12 4v4"/><path d="M10 4h4"/>',
  dilute: '<path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/>',
}

const ROWS: readonly Row[] = [
  { kind: 'challenge', label: 'Challenge this', question: 'Start challenging this now?', tip: 'Talk this through with Claude, back and forth, until you both agree on the solution.' },
  { kind: 'council', label: 'Agent council', question: 'Send this plan to the agent council now?', tip: 'A fresh agent reviews the plan, using more agents to verify it where needed, and reports back.' },
  { kind: 'serve', label: 'Serve a new session', question: "Hand this session's plan to a new session now?", tip: "Writes a handover from this session's plan and continues it in a new session." },
]

const AFK_TIP = 'Pick work for Claude to do alone while you are away.'
const AFK_ON_TIP = 'AFK is on. Press to turn it off.'
const WRAP_UP_TIP = 'Finishes the current step, verifies, updates the docs and leaves a handoff. Asks before it commits or pushes.'
const DILUTE_TIP = "Thins out this project's memory folder. Shows a plan first and changes nothing until you say yes."

let isAsking = false

const iconSvg = (kind: keyof typeof ICONS) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8b8b8b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind]}</svg>`

const tipScope = (key: keyof typeof ICONS) => `tip-${key}`

const quoted = (words: string) => `these words:\n\n> ${words.trim().replace(/\n/g, '\n> ')}`

const subjectOf = async ($: EngineInterface, given: string) => {
  if (given) return given
  const selected = await $.ui.selection()

  return selected?.text.trim() ? quoted(selected.text) : CONVERSATION
}

const promptOf = async ($: EngineInterface, kind: Kind, given: string) => {
  if (kind === 'serve') return `Serve this session's plan to a new session${given ? `. The next session is for: ${given}` : ''}`
  const subject = await subjectOf($, given)

  return kind === 'challenge' ? `Challenge ${subject}` : `Have the agent council review ${subject}`
}

// The method goes in as a row the person doesn't see; the short prompt is what they read.
const send = async ($: EngineInterface, kind: Method, text: string) => {
  await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: METHODS[kind] }] } })
  await $.prompt.submit({ text, asUser: true })
}

// A command's hook holds the turn, so the rest goes from a timer, once it's let go.
const sendSoon = ($: EngineInterface, kind: Method, text: string) => {
  $.clock.after(1, () => void send($, kind, text))
}

// One press at a time: a second press while a question is up does nothing.
const oneAtATime = async (work: () => Promise<void>) => {
  if (isAsking) return
  isAsking = true
  try {
    await work()
  } finally {
    isAsking = false
  }
}

const confirmed = async ($: EngineInterface, question: string) =>
  (await $.ui.ask(question, { options: ['Start', CANCEL], header: HEADER }).catch(() => CANCEL)) === 'Start'

// A row is one click away, so it asks first. A typed command doesn't need to.
const startAfterAsking = ($: EngineInterface, row: Row) =>
  oneAtATime(async () => {
    const text = await promptOf($, row.kind, '')
    if (await confirmed($, row.question)) sendSoon($, row.kind, text)
  })

// The question gives the size, since that is why the button is there.
const diluteAfterAsking = ($: EngineInterface, grown: MemoryGrowth) =>
  oneAtATime(async () => {
    if (await confirmed($, `This project's memory has grown to ${memoryText(grown)}. Dilute it now?`)) sendSoon($, 'dilute', dilutePrompt(grown))
  })

// AFK refuses every question while a mode is on, so there the press itself decides.
const wrapUpAfterAsking = ($: EngineInterface, isAfkOn: boolean) =>
  oneAtATime(async () => {
    if (isAfkOn || (await confirmed($, 'Wrap up this session now?'))) await wrapUp($)
  })

// `<mode> | <task>` lines; anything else in the reply is left out.
export const parseOffers = (reply: string): Offer[] => {
  const offers: Offer[] = []
  for (const line of reply.split('\n')) {
    const [, mode, task] = /^\W*(develop|test|refactor|housekeeping)\s*\|\s*(.+?)\s*$/i.exec(line) ?? []
    if (!mode || !task || task === CANCEL || offers.some(o => o.task === task)) continue
    offers.push({ mode: mode.toLowerCase() as AfkMode, task: task.slice(0, MAX_TASK) })
  }

  return offers.slice(0, MAX_OFFERS)
}

// Asks before a mode goes on, since AFK refuses questions after. The offers are the misclick prompt too.
const offerAfk = ($: EngineInterface) =>
  oneAtATime(async () => {
    $.ui.toast('Looking for work Claude can do alone…')
    const reply = await $.model.fork({ prompt: AFK_OFFER })
    if (!reply.isAnswered) {
      $.ui.toast(reply.reason === 'nothing-to-fork' ? 'Nothing in this session to work from yet.' : `Could not get offers: ${reply.reason}`)

      return
    }
    const offers = parseOffers(reply.text)
    if (!offers.length) {
      $.ui.toast('Claude found nothing to do alone here.')

      return
    }
    const answer = await $.ui.ask('You are walking away. What should Claude work on?', { options: [...offers.map(o => o.task), CANCEL], header: HEADER }).catch(() => CANCEL)
    if (answer === CANCEL) return
    // Words typed under Other are a task of the person's own, and develop's scope fits those best.
    const task = answer.trim()
    if (!task) return
    await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: afkTask(task) }] } })
    await chooseAfk($, offers.find(o => o.task === answer)?.mode ?? 'develop')
  })

export const register: Register = on => {
  registerAfk(on)

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) setWorking(true)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const refused = await afkRefuses($, e.tool, e.tool === 'Bash' ? String(e.command ?? '') : '')
    if (refused !== undefined) return { deny: refused }
    if (e.agentId === undefined) await countAfkTool($)
    const result = await next(e)
    if (e.agentId !== undefined || result.deny !== undefined) return result
    const notices = [await afkNotice($), await wrapUpNotice($)].filter(notice => notice !== undefined)

    return notices.length === 0 ? result : { ...result, context: [...(result.context ?? []), ...notices] }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) setWorking(false)
    await afterAfkTurn($, e)
    await afterWrapUpTurn($, e)
    if (e.agentId === undefined) await measureMemory($)

    return result
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      await resetAfk($)
      await resetWrapUp($)
    }

    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'challenge', description: 'Talk this through with Claude until you both agree on the solution.', argumentHint: '[topic]' })
    await $.command.register({ name: 'council', description: 'Have a fresh agent review the plan, using more agents to verify it.', argumentHint: '[what to review]' })
    await $.command.register({ name: 'serve', description: "Hand this session's plan to a new top-level session.", argumentHint: '[what the next session is for]' })
    await $.agent.register({
      name: 'council',
      description: 'Reviews a plan it has never seen and can spawn subagents to verify it. Use only when the person runs /council.',
      prompt: COUNCIL_AGENT,
      tools: ['Read', 'Bash', 'Agent'],
      model: 'inherit',
    })
    const started = await next(e)
    await measureMemory($)

    return started
  })

  on('command.run', { command: 'challenge' }, async ($, e) => {
    sendSoon($, 'challenge', await promptOf($, 'challenge', e.args.trim()))

    return {}
  })

  on('command.run', { command: 'council' }, async ($, e) => {
    sendSoon($, 'council', await promptOf($, 'council', e.args.trim()))

    return {}
  })

  on('command.run', { command: 'serve' }, async ($, e) => {
    sendSoon($, 'serve', await promptOf($, 'serve', e.args.trim()))

    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    if (e.props.hasSurvey) return rest

    const { Box, Button, Text } = $.ui.resolve(e)
    const iconOf = (kind: keyof typeof ICONS, label: string) => {
      if (e.surface !== 'desktop') return null
      const { Svg } = $.ui.resolve(e)

      return <Svg source={iconSvg(kind)} alt={label} width={15} height={15} />
    }
    const isTerminal = e.surface === 'terminal'
    // A terminal's gap is a whole blank line, so it gets none.
    const between = isTerminal ? 0 : 1
    // Except above a row with nothing over it: a tip paints on the line above, and the band clips what falls outside it.
    const above = isTerminal && rest?.type !== 'engine' ? 0 : 1
    const isDesktop = e.surface === 'desktop'
    const hasTurns = e.props.isWorking || (await $.session.turns()) > 0
    const mode = await read($, afkMode)
    const isAfkOn = mode !== 'off'
    const phase = await read($, wrapUpPhase)
    const grown = await read($, memoryGrown)
    // The hidden rows would land in the running turn, so these wait for an idle session.
    const whenIdle = (work: () => Promise<void>) => () => {
      if (e.props.isWorking) $.ui.toast('Claude is working. Try again when it stops.')
      else void work()
    }
    const shortcuts: { key: keyof typeof ICONS; label: string; tip: string; isDim: boolean; onPress: () => void }[] = [
      ...ROWS.map(row => ({ key: row.kind, label: row.label, tip: row.tip, isDim: e.props.isWorking, onPress: whenIdle(() => startAfterAsking($, row)) })),
      ...(isAfkOn
        ? [{ key: 'afk' as const, label: `AFK ${mode} ${await read($, afkTaken)}`, tip: AFK_ON_TIP, isDim: false, onPress: () => void chooseAfk($, 'off') }]
        : hasTurns
          ? [{ key: 'afk' as const, label: 'AFK', tip: AFK_TIP, isDim: e.props.isWorking, onPress: whenIdle(() => offerAfk($)) }]
          : []),
      ...(phase === 'idle' && hasTurns ? [{ key: 'wrap-up' as const, label: 'Wrap up', tip: WRAP_UP_TIP, isDim: false, onPress: () => void wrapUpAfterAsking($, isAfkOn) }] : []),
      // Its plan waits for a yes, which AFK would refuse.
      ...(grown && !isAfkOn ? [{ key: 'dilute' as const, label: 'Dilute memory', tip: DILUTE_TIP, isDim: e.props.isWorking, onPress: whenIdle(() => diluteAfterAsking($, grown)) }] : []),
    ]

    const buttonOf = (shortcut: (typeof shortcuts)[number]) => {
      const button = <Button key={shortcut.key} plain dimColor={shortcut.isDim} label={shortcut.label} onPress={shortcut.onPress} />
      if (e.surface !== 'desktop') return button

      // A desktop button has no size props, so a box clips its highlight: shorter than the button, and narrower by the negative margins inside it.
      // Only a border rounds a box, so this one has a see-through border. Its own margins give the line back what its height adds.
      return (
        <Box flexDirection="row" alignItems="center" flexShrink={0} height={HIGHLIGHT_HEIGHT} marginX={0.25} marginY={1 - HIGHLIGHT_HEIGHT} padding={0} borderStyle="single" borderColor="#0000" overflow="hidden">
          <Box flexDirection="row" alignItems="center" marginX={-HIGHLIGHT_TRIM}>
            {button}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {rest}
        <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={isTerminal ? 1 : 2} rowGap={between} marginTop={above} paddingX={1}>
          {shortcuts.map((shortcut, index) => (
            <Box key={`tip-${shortcut.key}`} flexDirection="row" alignItems="center" {...(isTerminal ? { hover: { scope: tipScope(shortcut.key) } } : {})}>
              {/* A terminal draws a plain button as bare words, so without these the row reads as one line of text. */}
              {isTerminal && index > 0 && <Text dimColor>{'│ '}</Text>}
              {iconOf(shortcut.key, shortcut.label)}
              {buttonOf(shortcut)}
              {/* A button has no tooltip of its own, so a hover over this keyed box opens a card. */}
              {isDesktop && (
                <Box position="absolute" width={TIP_COLUMNS} display="none" hover={{ display: 'flex' }}>
                  <Text dimColor>{shortcut.tip}</Text>
                </Box>
              )}
            </Box>
          ))}
          {phase !== 'idle' && <Text dimColor>Wrapping up</Text>}
          {/* In a terminal a tip in the row would push the next buttons away from the pointer, so each paints over the row above instead. */}
          {isTerminal &&
            shortcuts.map(shortcut => (
              <Box key={`card-${shortcut.key}`} position="absolute" top={-1} left={1} display="none" hover={{ scope: tipScope(shortcut.key), display: 'flex' }}>
                <Text dimColor>{shortcut.tip.padEnd(e.props.bodyColumns - 2)}</Text>
              </Box>
            ))}
        </Box>
      </Box>
    )
  })
}
