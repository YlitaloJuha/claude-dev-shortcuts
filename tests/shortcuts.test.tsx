import { expect, mock, test } from 'claude-code/testing'

import { DONE_MARK, MAX_TURNS, isForbidden, kickoff, nudge } from '../hooks/afk'
import { GROWN } from '../hooks/memory'
import { DILUTE } from '../hooks/methods'
import { AGENT_MESSAGE, CHECKLIST, TURN_NOTICE } from '../hooks/wrap-up'

const BAND = {
  plugin: 'dev-shortcuts',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 60,
    scroll: { offset: 0, bodyRows: 11 },
    view: {},
  },
} as const

const OFFERS = 'develop | Finish the row tests\nSome words of no use\ntest | Cover the parser\ntest | Cover the parser'

const FOLDER = '/home/me/.claude/projects/-demo/memory'
const INDEX_FILE = `${FOLDER}/MEMORY.md`

// A memory folder, which a test may change between turns. `notes`: each note's size in bytes.
type Memory = { notes: number[]; indexBytes?: number; indexLines?: number; others?: { name: string; kind: string; size: number }[]; isUnreadable?: boolean }

const entryOf = (name: string, size: number, kind = 'file') => ({ name, kind, size, mtimeMs: 0, isLink: false })
const listingOf = (memory: Memory) => [
  entryOf('MEMORY.md', memory.indexBytes ?? 1000),
  ...memory.notes.map((size, i) => entryOf(`note-${i}.md`, size)),
  ...(memory.others ?? []).map(other => entryOf(other.name, other.size, other.kind)),
]

// `answer`: what the person picks in the question; null closes it unanswered.
// `fork`: the model's reply to the AFK offer, or why it gave none.
const capture = (
  on: any,
  {
    selected,
    answer = 'Start',
    fork = { text: OFFERS },
    turns = 3,
    percentUsed = 10,
    agents = [],
    memory,
  }: { selected?: string; answer?: string | null; fork?: { text: string } | { reason: string }; turns?: number; percentUsed?: number; agents?: { id: string; status: string }[]; memory?: Memory } = {},
) => {
  const session = mock.session(on)
  const sent: { text: string; methodsBefore: number }[] = []
  const asked: string[] = []
  const options: string[][] = []
  const toasts: string[] = []
  const told: string[] = []
  const ran: string[] = []
  on('session.turns', () => ({ value: turns }))
  const looks = { breakdown: 0, list: [] as string[], read: [] as string[] }
  on('session.usage', (_: unknown, e: any) => {
    if (e.breakdown) looks.breakdown++
    const memoryFiles = [{ path: '/repo/CLAUDE.md', type: 'Project', tokens: 44638 }, ...(memory ? [{ path: INDEX_FILE, type: 'AutoMem', tokens: 1784 }] : [])]

    return { value: { startedAt: 0, context: { window: 1000, ...(e.breakdown ? { breakdown: { memoryFiles } } : {}) }, rateLimits: [{ kind: 'five_hour', percentUsed }] } }
  })
  on('fs.list', (_: unknown, e: any) => {
    looks.list.push(e.path)
    if (!memory || memory.isUnreadable) throw new Error('EACCES')

    return { value: listingOf(memory) }
  })
  on('fs.read', (_: unknown, e: any) => {
    looks.read.push(e.path)

    return { value: 'one line\n'.repeat(memory?.indexLines ?? 10) }
  })
  on('command.register', () => ({ value: { command: 'any' } }))
  const registered: { name: string; tools?: readonly string[] }[] = []
  on('agent.register', (_: unknown, e: any) => {
    registered.push(e)

    return { value: {} }
  })
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('model.fork', () => ({ value: 'text' in fork ? { isAnswered: true, text: fork.text, usage: {} } : { isAnswered: false, ...fork } }))
  on('agent.list', () => ({ value: agents }))
  on('session.send', (_: unknown, e: any) => {
    told.push(e.text)

    return { isDelivered: true }
  })
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('ui.log', () => ({ value: undefined }))
  on('prompt.submit', (_: unknown, e: any) => {
    sent.push({ text: e.text, methodsBefore: session.appended().length })

    return { text: e.text }
  })
  on('ui.selection', () => ({ value: selected === undefined ? undefined : { text: selected } }))
  on('ui.toast', (_: unknown, e: any) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('tool.call', (_: unknown, e: any) => {
    if (e.tool !== 'AskUserQuestion') {
      ran.push(e.tool)

      return { result: {} }
    }
    const question = e.questions[0].question
    asked.push(question)
    options.push(e.questions[0].options.map((o: { label: string }) => o.label))

    return answer === null ? { deny: 'closed' } : { result: { questions: e.questions, answers: { [question]: answer } } }
  })
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>beneath</Text>
  })

  return { sent, asked, options, toasts, told, ran, looks, registered, clock: mock.clock(on), method: () => JSON.stringify(session.appended()[0]?.message.content) }
}

// AFK in test mode, from a press on its row, with Claude idle.
const goAfk = async ($: any, clock: any) => {
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'afk' })
  await clock.advance(5)

  return ui
}

let turnNumber = 0
const turn = (over: Record<string, unknown> = {}) => ({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: `t${++turnNumber}`, reason: 'answer', ...over }) as never
const workedTurn = async ($: any, clock: any, over: Record<string, unknown> = {}) => {
  await $.tool.call({ tool: 'Read', file_path: 'a' })
  await $.turn.complete(turn(over))
  await clock.advance(5)
}
const texts = (sent: { text: string }[]) => sent.map(s => s.text)

test('/challenge challenges the person: a short prompt, the method before it unseen, no question', async ($, on) => {
  const { sent, asked, clock, method } = capture(on)
  await $.command.run({ command: 'challenge', args: 'the cache plan' } as never)
  await clock.advance(1)

  expect(sent[0]?.text).toBe('Challenge the cache plan')
  expect(sent[0]?.methodsBefore).toBe(1)
  expect(method()).toContain('your vision and mine align and we both agree on the solution')
  expect(asked).toEqual([])
})

test('/challenge with nothing given takes the conversation', async ($, on) => {
  const { sent, clock } = capture(on)
  await $.command.run({ command: 'challenge', args: '' } as never)
  await clock.advance(1)

  expect(sent[0]?.text).toBe('Challenge the plan or idea in this conversation')
})

test('/council asks for the council agent, which can spawn more agents', async ($, on) => {
  const { sent, clock, method, registered } = capture(on)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true } as never)
  await $.command.run({ command: 'council', args: 'the cache plan' } as never)
  await clock.advance(1)

  expect(sent[0]?.text).toBe('Have the agent council review the cache plan')
  expect(method()).toContain('dev-shortcuts:council')
  expect(registered.find(agent => agent.name === 'council')?.tools).toContain('Agent')
})

test('/serve asks for a top-level session and keeps the purpose', async ($, on) => {
  const { sent, clock, method } = capture(on)
  await $.command.run({ command: 'serve', args: 'finish the tests' } as never)
  await clock.advance(1)

  expect(sent[0]?.text).toBe("Serve this session's plan to a new session. The next session is for: finish the tests")
  expect(method()).toContain('mcp__ccd_session_mgmt__detach_session')
})

test('selected words become the subject', async ($, on) => {
  const { sent, clock } = capture(on, { selected: 'two caches\nor one' })
  await $.command.run({ command: 'challenge', args: '' } as never)
  await clock.advance(1)

  expect(sent[0]?.text).toBe('Challenge these words:\n\n> two caches\n> or one')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`every row shows at once, and a press asks before it starts, on ${surface}`, async ($, on) => {
    const { sent, asked, clock } = capture(on, { selected: 'one cache' })
    const ui = await $.ui.mount({ ...BAND, surface })

    expect((await ui.find({ type: 'Button', key: 'challenge' }))?.text).toBe('Challenge this')
    expect((await ui.find({ type: 'Button', key: 'council' }))?.text).toBe('Agent council')
    expect(await ui.find({ type: 'Button', key: 'serve' })).toBeDefined()
    await ui.press({ key: 'challenge' })
    await clock.advance(1)

    expect(asked).toEqual(['Start challenging this now?'])
    expect(sent[0]?.text).toBe('Challenge these words:\n\n> one cache')
    await ui.unmount()
  })

  test(`each button's tip stays hidden until a hover on that button, on ${surface}`, async ($, on) => {
    capture(on)
    const ui = await $.ui.mount({ ...BAND, surface })
    const drawn = (element: any): any[] => (typeof element === 'object' ? [element, ...(element.children ?? []).flatMap(drawn)] : [])
    const elements = drawn(await ui.drawn())

    for (const [key, words] of [['challenge', 'you both agree'], ['council', 'more agents'], ['serve', 'handover']] as const) {
      const anchor = elements.find(element => element.props?.key === `tip-${key}` || element.key === `tip-${key}`)
      const tip = drawn(anchor).find(element => element.props?.display === 'none')

      expect(tip?.hover?.display).toBe('flex')
      expect(tip?.props?.position).toBe(surface === 'desktop' ? 'absolute' : undefined)
      expect(JSON.stringify(tip)).toContain(words)
      expect(JSON.stringify(anchor)).toContain(`"key":"${key}"`)
    }
    await ui.unmount()
  })

  test(`Cancel starts nothing, on ${surface}`, async ($, on) => {
    const { sent, asked, clock } = capture(on, { answer: 'Cancel' })
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.press({ key: 'serve' })
    await clock.advance(1)

    expect(asked.length).toBe(1)
    expect(sent).toEqual([])
    await ui.unmount()
  })

  test(`a question closed unanswered starts nothing, on ${surface}`, async ($, on) => {
    const { sent, clock } = capture(on, { answer: null })
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.press({ key: 'serve' })
    await clock.advance(1)

    expect(sent).toEqual([])
    await ui.unmount()
  })

  test(`while Claude works a press only says so, on ${surface}`, async ($, on) => {
    const { sent, asked, toasts, clock } = capture(on)
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: true }, surface })
    await ui.press({ key: 'serve' })
    await clock.advance(1)

    expect(asked).toEqual([])
    expect(sent).toEqual([])
    expect(toasts.length).toBe(1)
    await ui.unmount()
  })
}

const trims = async (ui: any) => (await ui.findAll({ type: 'Box' })).filter((box: any) => box.props.overflow === 'hidden' && typeof box.props.height === 'number')
const narrowed = async (ui: any) => (await ui.findAll({ type: 'Box' })).filter((box: any) => box.props.marginX < 0)

test('on a desktop a box clips each button in height and width, and its button still presses', async ($, on) => {
  const { asked } = capture(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await trims(ui)).length).toBe(5)
  expect((await narrowed(ui)).length).toBe(5)
  await ui.press({ key: 'serve' })
  expect(asked.length).toBe(1)
  await ui.unmount()
})

test('on a desktop each clip is rounded, unseen and adds nothing to the line', async ($, on) => {
  capture(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  for (const box of await trims(ui)) {
    expect(box.props.borderStyle).toBe('single')
    expect(box.props.borderColor).toBe('#0000')
    expect(box.props.padding).toBe(0)
    expect(box.props.marginY).toBe(1 - box.props.height)
  }
  await ui.unmount()
})

test('a terminal draws its buttons untrimmed', async ($, on) => {
  capture(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await trims(ui)).length).toBe(0)
  expect((await narrowed(ui)).length).toBe(0)
  await ui.unmount()
})

test('the row has no label of its own', async ($, on) => {
  capture(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /Ask Claude/ })).toBeUndefined()
  await ui.unmount()
})

test('AFK offers work from the session, and a pick tells Claude the task, then starts the mode', async ($, on) => {
  const { sent, asked, options, clock, method } = capture(on, { answer: 'Cover the parser' })
  const ui = await goAfk($, clock)

  expect(asked).toEqual(['You are walking away. What should Claude work on?'])
  expect(options[0]).toEqual(['Finish the row tests', 'Cover the parser', 'Cancel'])
  expect(sent).toEqual([{ text: kickoff('test'), methodsBefore: 1 }])
  expect(method()).toContain('Cover the parser')
  await ui.unmount()
})

test('AFK takes words typed under Other as the task, in develop mode', async ($, on) => {
  const { sent, clock, method } = capture(on, { answer: 'Read the logs and write up what you find' })
  const ui = await goAfk($, clock)

  expect(texts(sent)).toEqual([kickoff('develop')])
  expect(method()).toContain('Read the logs')
  await ui.unmount()
})

for (const answer of ['Cancel', null]) {
  test(`AFK starts nothing when the question ends in ${answer}`, async ($, on) => {
    const { sent, clock } = capture(on, { answer })
    const ui = await goAfk($, clock)

    expect(sent).toEqual([])
    await ui.unmount()
  })
}

for (const [fork, why] of [
  [{ reason: 'nothing-to-fork' }, /Nothing in this session/],
  [{ reason: 'api-error' }, /Could not get offers: api-error/],
  [{ text: 'NOTHING' }, /nothing to do alone/],
] as const) {
  test(`AFK says so and asks nothing when ${JSON.stringify(fork)}`, async ($, on) => {
    const { sent, asked, toasts, clock } = capture(on, { fork })
    const ui = await goAfk($, clock)

    expect(asked).toEqual([])
    expect(sent).toEqual([])
    expect(toasts.at(-1)).toMatch(why)
    await ui.unmount()
  })
}

test('while Claude works AFK only says so', async ($, on) => {
  const { sent, asked, toasts, clock } = capture(on)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: true }, surface: 'terminal' })
  await ui.press({ key: 'afk' })
  await clock.advance(5)

  expect(asked).toEqual([])
  expect(sent).toEqual([])
  expect(toasts.length).toBe(1)
  await ui.unmount()
})

// AFK, as the afk mod did it.
test('each mode has its own scope, and the rules forbid commits and questions', () => {
  for (const m of ['develop', 'test', 'refactor', 'housekeeping'] as const) {
    expect(kickoff(m)).toContain(`${m} mode`)
    expect(kickoff(m)).toContain('Do not commit, push')
    expect(kickoff(m)).toContain('Ask no questions')
    expect(kickoff(m)).toContain(DONE_MARK)
    expect(nudge(m)).toContain('Do not commit, push')
  }
  expect(kickoff('refactor')).not.toEqual(kickoff('test'))
})

test('the seatbelt catches the risky commands and leaves ordinary ones', () => {
  for (const c of ['git push', 'git push origin main', 'git commit -m x', 'git -C sub push', 'git reset --hard', 'git clean -fd', 'gh pr create', 'npm publish', 'rm -rf build', 'cd a && git push']) {
    expect(isForbidden(c)).toBe(true)
  }
  for (const c of ['git status', 'git diff', 'git log --oneline', 'npm test', 'rm file.txt', 'echo push', 'ls -la']) {
    expect(isForbidden(c)).toBe(false)
  }
})

test('off by default: nothing is sent and nothing is refused', async ($, on) => {
  const { sent, clock } = capture(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'git push' } as never)
  expect(r.deny).toBeUndefined()
  await $.turn.complete(turn())
  await clock.advance(5)
  expect(sent).toEqual([])
})

test('AFK keeps going after each turn', async ($, on) => {
  const { sent, clock } = capture(on, { answer: 'Cover the parser' })
  await goAfk($, clock)
  await workedTurn($, clock)
  await workedTurn($, clock)
  expect(texts(sent)).toEqual([kickoff('test'), nudge('test'), nudge('test')])
})

test('typing a message means you are back', async ($, on) => {
  const { sent, clock } = capture(on, { answer: 'Cover the parser' })
  await goAfk($, clock)
  await $.prompt.submit({ text: 'I am back', wait: false, origin: { kind: 'composer' } } as never)
  await workedTurn($, clock)
  expect(texts(sent)).toEqual([kickoff('test'), 'I am back'])
})

test("another mod's prompt does not end AFK", async ($, on) => {
  const { sent, clock } = capture(on, { answer: 'Cover the parser' })
  await goAfk($, clock)
  await $.prompt.submit({ text: 'other', wait: false, origin: { kind: 'plugin', name: 'other-mod' } } as never)
  await workedTurn($, clock)
  expect(texts(sent)).toEqual([kickoff('test'), 'other', nudge('test')])
})

const AFK_ENDS: [string, Record<string, unknown>][] = [
  ['the done mark', { answer: `All done.\n${DONE_MARK}\n` }],
  ['an interrupt', { isAborted: true, reason: 'aborted' }],
]
for (const [name, over] of AFK_ENDS) {
  test(`${name} ends AFK`, async ($, on) => {
    const { sent, clock } = capture(on, { answer: 'Cover the parser' })
    await goAfk($, clock)
    await workedTurn($, clock, over)
    expect(texts(sent)).toEqual([kickoff('test')])
  })
}

test('two turns without tools end AFK', async ($, on) => {
  const { sent, clock } = capture(on, { answer: 'Cover the parser' })
  await goAfk($, clock)
  await $.turn.complete(turn())
  await clock.advance(5)
  await $.turn.complete(turn())
  await clock.advance(5)
  expect(texts(sent)).toEqual([kickoff('test'), nudge('test')])
})

test('the turn limit ends AFK', async ($, on) => {
  const { sent, clock } = capture(on, { answer: 'Cover the parser' })
  await goAfk($, clock)
  for (let i = 0; i < MAX_TURNS + 5; i++) await workedTurn($, clock)
  expect(sent.length).toBe(MAX_TURNS)
})

test('a plan limit near its end stops AFK', async ($, on) => {
  const { sent, clock } = capture(on, { answer: 'Cover the parser', percentUsed: 95 })
  await goAfk($, clock)
  await workedTurn($, clock)
  expect(texts(sent)).toEqual([kickoff('test')])
})

test('while AFK is on, questions and forbidden commands are refused, in subagents too', async ($, on) => {
  const { ran, clock } = capture(on, { answer: 'Cover the parser' })
  await goAfk($, clock)
  expect((await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)).deny).toContain('AFK')
  expect((await $.tool.call({ tool: 'Bash', command: 'git push' } as never)).deny).toContain('AFK')
  expect((await $.tool.call({ tool: 'Bash', command: 'git push', agentId: 'A1' } as never)).deny).toContain('AFK')
  expect((await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)).deny).toBeUndefined()
  expect(ran).toEqual(['Bash'])
})

test('while AFK is on its button says the mode, and a press turns it off', async ($, on) => {
  const { sent, clock } = capture(on, { answer: 'Cover the parser' })
  const ui = await goAfk($, clock)
  await workedTurn($, clock)
  expect((await ui.find({ type: 'Button', key: 'afk' }))?.text).toBe('AFK test 1')
  await ui.press({ key: 'afk' })
  expect((await ui.find({ type: 'Button', key: 'afk' }))?.text).toBe('AFK')
  await workedTurn($, clock)
  expect(texts(sent)).toEqual([kickoff('test'), nudge('test')])
  await ui.unmount()
})

test('turning AFK off during a turn reaches it on the next tool result, once', async ($, on) => {
  const { clock } = capture(on, { answer: 'Cover the parser' })
  const ui = await goAfk($, clock)
  await $.turn.start({ text: 'working', turnId: 'running' } as never)
  await ui.press({ key: 'afk' })
  const first = await $.tool.call({ tool: 'Read', file_path: 'a' } as never)
  expect(first.context?.[0]).toContain('turned AFK off')
  const second = await $.tool.call({ tool: 'Read', file_path: 'b' } as never)
  expect(second.context).toBeUndefined()
  await ui.unmount()
})

test('while AFK is on, Wrap up starts without a question, which AFK would refuse, and ends AFK', async ($, on) => {
  const { sent, asked, clock } = capture(on, { answer: 'Cover the parser' })
  const ui = await goAfk($, clock)
  await ui.press({ key: 'wrap-up' })
  await clock.advance(5)

  expect(asked.length).toBe(1)
  expect(texts(sent)).toEqual([kickoff('test'), CHECKLIST])
  await workedTurn($, clock)
  expect(sent.length).toBe(2)
  await ui.unmount()
})

// Wrap up, as the wrap-up mod did it.
test('the checklist does docs and handoffs before commits, and never commits or pushes unasked', () => {
  expect(CHECKLIST.indexOf('Docs.')).toBeLessThan(CHECKLIST.indexOf('Commits.'))
  expect(CHECKLIST.indexOf('Handoffs')).toBeLessThan(CHECKLIST.indexOf('Commits.'))
  expect(CHECKLIST).toContain('Ask before committing, then ask before pushing')
})

test('Wrap up asks, then sends the checklist, and says it is wrapping up', async ($, on) => {
  const { sent, asked, clock } = capture(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'wrap-up' })
  await clock.advance(5)

  expect(asked).toEqual(['Wrap up this session now?'])
  expect(texts(sent)).toEqual([CHECKLIST])
  expect(await ui.find({ type: 'Text', text: /Wrapping up/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'wrap-up' })).toBeUndefined()
  await ui.unmount()
})

test('Wrap up tells live subagents only', async ($, on) => {
  const { told, clock } = capture(on, { agents: [{ id: 'A1', status: 'running' }, { id: 'A2', status: 'completed' }, { id: 'A3', status: 'waiting' }] })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'wrap-up' })
  await clock.advance(5)

  expect(told).toEqual([AGENT_MESSAGE, AGENT_MESSAGE])
  await ui.unmount()
})

test('Wrap up comes back once the checklist turn ends, and a subagent ending does not count', async ($, on) => {
  const { clock } = capture(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'wrap-up' })
  await clock.advance(5)
  await $.turn.complete(turn({ agentId: 'A1' }))
  expect(await ui.find({ type: 'Button', key: 'wrap-up' })).toBeUndefined()
  await $.turn.complete(turn())
  expect(await ui.find({ type: 'Button', key: 'wrap-up' })).toBeDefined()
  await ui.unmount()
})

test('pressed during a turn, Wrap up waits for that turn and then the checklist turn', async ($, on) => {
  const { toasts, clock } = capture(on)
  await $.turn.start({ text: 'working', turnId: 'running' } as never)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: true }, surface: 'terminal' })
  await ui.press({ key: 'wrap-up' })
  await clock.advance(5)
  expect(toasts).toEqual([])
  await $.turn.complete(turn())
  expect(await ui.find({ type: 'Button', key: 'wrap-up' })).toBeUndefined()
  await $.turn.complete(turn())
  expect(await ui.find({ type: 'Button', key: 'wrap-up' })).toBeDefined()
  await ui.unmount()
})

test('a running turn hears Wrap up once, on its next tool result, and a subagent call does not use it up', async ($, on) => {
  capture(on)
  await $.turn.start({ text: 'working', turnId: 'running' } as never)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: true }, surface: 'terminal' })
  await ui.press({ key: 'wrap-up' })
  const sub = await $.tool.call({ tool: 'Read', file_path: 'a', agentId: 'A1' } as never)
  expect(sub.context).toBeUndefined()
  const first = await $.tool.call({ tool: 'Read', file_path: 'b' } as never)
  expect(first.context).toEqual([TURN_NOTICE])
  const second = await $.tool.call({ tool: 'Read', file_path: 'c' } as never)
  expect(second.context).toBeUndefined()
  await ui.unmount()
})

test('an idle Wrap up adds nothing to tool results', async ($, on) => {
  capture(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'wrap-up' })
  const result = await $.tool.call({ tool: 'Read', file_path: 'b' } as never)
  expect(result.context).toBeUndefined()
  await ui.unmount()
})

test('Cancel keeps Wrap up from starting', async ($, on) => {
  const { sent, clock } = capture(on, { answer: 'Cancel' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'wrap-up' })
  await clock.advance(5)

  expect(sent).toEqual([])
  expect(await ui.find({ type: 'Button', key: 'wrap-up' })).toBeDefined()
  await ui.unmount()
})

test('AFK and Wrap up wait for the first turn', async ($, on) => {
  capture(on, { turns: 0 })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await ui.find({ type: 'Button', key: 'afk' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'wrap-up' })).toBeUndefined()
  await ui.unmount()
})

// Dilute memory.
const start = ($: any) => $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
const GROWN_MEMORY: Memory = { notes: [100_000, 25_000], indexLines: 31 }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`below the limits the row has no Dilute memory, on ${surface}`, async ($, on) => {
    capture(on, { memory: { notes: [50_000], indexLines: 31 } })
    await start($)
    const ui = await $.ui.mount({ ...BAND, surface })

    expect(await ui.find({ type: 'Button', key: 'dilute' })).toBeUndefined()
    await ui.unmount()
  })

  test(`past the limits the row shows Dilute memory, and a press asks with the size, on ${surface}`, async ($, on) => {
    const { sent, asked, clock, method } = capture(on, { memory: GROWN_MEMORY })
    await start($)
    const ui = await $.ui.mount({ ...BAND, surface })

    expect((await ui.find({ type: 'Button', key: 'dilute' }))?.text).toBe('Dilute memory')
    await ui.press({ key: 'dilute' })
    await clock.advance(1)

    expect(asked).toEqual(["This project's memory has grown to 126 KB in 2 files. Dilute it now?"])
    expect(sent).toEqual([{ text: `Dilute the memory in ${FOLDER}. It holds 126 KB in 2 files, and its MEMORY.md has 31 lines.`, methodsBefore: 1 }])
    expect(method()).toContain('How to dilute memory')
    await ui.unmount()
  })

  for (const answer of ['Cancel', null]) {
    test(`Dilute memory starts nothing when the question ends in ${answer}, on ${surface}`, async ($, on) => {
      const { sent, asked, clock, method } = capture(on, { answer, memory: GROWN_MEMORY })
      await start($)
      const ui = await $.ui.mount({ ...BAND, surface })
      await ui.press({ key: 'dilute' })
      await clock.advance(1)

      expect(asked.length).toBe(1)
      expect(sent).toEqual([])
      expect(method()).toBeUndefined()
      await ui.unmount()
    })
  }

  test(`while Claude works Dilute memory only says so, on ${surface}`, async ($, on) => {
    const { sent, asked, toasts, clock } = capture(on, { memory: GROWN_MEMORY })
    await start($)
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: true }, surface })
    await ui.press({ key: 'dilute' })
    await clock.advance(1)

    expect(asked).toEqual([])
    expect(sent).toEqual([])
    expect(toasts.length).toBe(1)
    await ui.unmount()
  })
}

const LIMIT_CASES: [string, Memory, boolean][] = [
  ['the folder exactly at its limit', { notes: [GROWN.bytes - 1000] }, false],
  ['the folder a byte past it', { notes: [GROWN.bytes - 999] }, true],
  ['the index exactly at its line limit', { notes: [1000], indexLines: GROWN.indexLines }, false],
  ['the index a line past it', { notes: [1000], indexLines: GROWN.indexLines + 1 }, true],
  ['the index exactly at its byte limit', { notes: [1000], indexBytes: GROWN.indexBytes }, false],
  ['the index a byte past it', { notes: [1000], indexBytes: GROWN.indexBytes + 1 }, true],
]
for (const [name, memory, shows] of LIMIT_CASES) {
  test(`${name} ${shows ? 'shows' : 'does not show'} Dilute memory`, async ($, on) => {
    capture(on, { memory })
    await start($)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    expect((await ui.find({ type: 'Button', key: 'dilute' })) !== undefined).toBe(shows)
    await ui.unmount()
  })
}

test('a long CLAUDE.md does not count: with no memory file in the context nothing is read', async ($, on) => {
  const { looks } = capture(on)
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect(await ui.find({ type: 'Button', key: 'dilute' })).toBeUndefined()
  expect(looks.list).toEqual([])
  await ui.unmount()
})

test('only the Markdown files in the memory folder count', async ($, on) => {
  capture(on, { memory: { notes: [1000], others: [{ name: 'big.zip', kind: 'file', size: 900_000 }, { name: 'old', kind: 'dir', size: 900_000 }] } })
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect(await ui.find({ type: 'Button', key: 'dilute' })).toBeUndefined()
  await ui.unmount()
})

test('the engine says where the memory is', async ($, on) => {
  const { looks } = capture(on, { memory: GROWN_MEMORY })
  await start($)

  expect(looks.list).toEqual([FOLDER])
  expect(looks.read).toEqual([INDEX_FILE])
})

test('a folder that cannot be read shows nothing and breaks nothing', async ($, on) => {
  capture(on, { memory: { ...GROWN_MEMORY, isUnreadable: true } })
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect(await ui.find({ type: 'Button', key: 'dilute' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'serve' })).toBeDefined()
  await ui.unmount()
})

test('drawing the row reads no files', async ($, on) => {
  const { looks } = capture(on, { memory: GROWN_MEMORY })
  await start($)
  const before = JSON.stringify(looks)
  for (const surface of ['terminal', 'desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.unmount()
  }

  expect(JSON.stringify(looks)).toBe(before)
})

test('each main turn measures again, so the button comes and goes, and a subagent ending does not count', async ($, on) => {
  const memory: Memory = { notes: [1000] }
  const { looks } = capture(on, { memory })
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', key: 'dilute' })).toBeUndefined()

  memory.notes = [200_000]
  const listed = looks.list.length
  await $.turn.complete(turn({ agentId: 'A1' }))
  expect(looks.list.length).toBe(listed)
  expect(await ui.find({ type: 'Button', key: 'dilute' })).toBeUndefined()

  await $.turn.complete(turn())
  expect(await ui.find({ type: 'Button', key: 'dilute' })).toBeDefined()

  memory.notes = [50_000]
  await $.turn.complete(turn())
  expect(await ui.find({ type: 'Button', key: 'dilute' })).toBeUndefined()
  await ui.unmount()
})

test('Dilute memory steps aside while AFK is on, since its plan waits for a yes', async ($, on) => {
  const { clock } = capture(on, { answer: 'Cover the parser', memory: GROWN_MEMORY })
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', key: 'dilute' })).toBeDefined()
  await ui.press({ key: 'afk' })
  await clock.advance(5)

  expect(await ui.find({ type: 'Button', key: 'dilute' })).toBeUndefined()
  await ui.unmount()
})

test('the desktop clips Dilute memory like the rest of the row', async ($, on) => {
  capture(on, { memory: GROWN_MEMORY })
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await trims(ui)).length).toBe(6)
  await ui.unmount()
})

test('diluting shows its plan and waits for a yes before it changes or deletes anything', () => {
  expect(DILUTE).toContain('Change nothing until I say yes.')
  expect(DILUTE).toContain('which facts go, and why nobody needs them')
  expect(DILUTE).toContain('ask whether to go ahead, and wait')
  expect(DILUTE).toContain('only for what I approved')
  expect(DILUTE.indexOf('Show me the plan')).toBeLessThan(DILUTE.indexOf('After my yes'))
})

test('diluting merges, shortens and fixes, keeps what someone needs, and stays in the folder', () => {
  for (const step of ['Merge:', 'Shorten:', 'Fix:', 'Remove:', 'Keep:']) expect(DILUTE).toContain(step)
  expect(DILUTE).toContain('Never lose these')
  expect(DILUTE).toContain('Age alone is no reason to cut')
  expect(DILUTE).toContain('When unsure, keep it')
  expect(DILUTE).toContain('Never a CLAUDE.md')
  expect(DILUTE).toContain('No commits')
  expect(DILUTE).toContain('with no agents')
})

test('diluting backs the folder up first, and keeps the index true', () => {
  expect(DILUTE.indexOf('memory-backups')).toBeLessThan(DILUTE.indexOf('Make the changes'))
  expect(DILUTE).toContain('no pointer to a file that is gone')
  expect(DILUTE).toContain('Aim under 75 KB')
})

test('what other mods draw above the prompt stays', async ($, on) => {
  capture(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /beneath/ }))?.text).toBe('beneath')
  expect(await ui.find({ type: 'Button', key: 'serve' })).toBeDefined()
  await ui.unmount()
})

test('the row yields to a survey', async ($, on) => {
  capture(on)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'terminal' })

  expect(await ui.find({ type: 'Button', key: 'serve' })).toBeUndefined()
  await ui.unmount()
})
