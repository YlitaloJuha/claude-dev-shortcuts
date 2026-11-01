// What each shortcut tells the model. Parts come from mattpocock/skills: see THIRD_PARTY_LICENSES.md.
import type { MemoryGrowth } from '../types'
import { AIM_BYTES, kilobytes, memoryText } from './memory.ts'

const ROUNDS = `Map the subject as a tree of decisions: each decision hangs off the ones it depends on.
A round asks every decision whose prerequisites are settled, and nothing that hinges on an answer still open. Each answer changes what can be asked, so work that out again before the next round.
Write each question like this, worded so that "yes" accepts your recommendation:

❓ 1. Short title
The question, in a sentence or two, and why it matters.
➡ The answer you recommend, alone on its line.`

export const AFK_OFFER = `I am about to walk away and leave you working alone, with nobody to answer. From this session only, offer up to three things you could do without me, most useful first. Each must be real work this session points to: unfinished steps, open follow-ups, tests it lacks, docs it left behind. Nothing that needs my decision, a commit, a push or anything hard to undo.

Reply with one line per offer and nothing else:

<mode> | <what you would do, in at most ten words>

<mode> is the one that fits: develop (build what is planned), test (tests only), refactor (no change in behaviour), housekeeping (docs and tidying). If nothing fits, reply with the one word NOTHING.`

export const afkTask = (task: string) => `I am walking away. Work on this first: ${task}

The rules that follow still hold. When it is done, go on with whatever else they allow.`

export const CHALLENGE_ME = `How to run this challenge: argue with me until we share one understanding.

Change nothing while challenging: no edits, commits, sessions or implementation.

${ROUNDS}

After a round, stop and wait. I answer by number.

Argue:
- Say where you think I'm wrong, and why.
- Recommend what you would really do, even when it goes against my plan.
- Push back on a weak reason. When I convince you, say what did it.
- Never agree just to move on. No praise.

Facts and decisions:
- Look up what the code, the docs or the web can settle. Never ask me those. Say what you found.
- Decisions are mine. Never answer one for me.
- If an answer changes an earlier one, reopen that branch next round.

Keep sentences short.

When every branch is visited and nothing is left silently assumed, or I say wrap up: list what we decided and what stays open. Ask whether that is our shared understanding, and wait. Even then, don't act until I tell you to.`

export const CHALLENGE_AGENT = `How to run this challenge: the plan argues with a fresh agent, and I come in at the end. I ran this shortcut, so it is my request for this agent.

Change nothing while challenging: no edits, commits or implementation.

1. Spawn one agent with the Agent tool, subagent_type "dev-shortcuts:challenger". Not a fork: it must not see this conversation.
2. Brief it with the subject as written, the goal, the limits I stated and the paths that matter. Leave out your reasons, so it isn't anchored.
3. It answers with a round of questions. Reply to each round with SendMessage (load it through ToolSearch if it is deferred):
   - Answer from what I said, or from what you checked. Say which.
   - If its point holds, give way and say how the plan changes.
   - If it doesn't, show why.
   - A decision I never made is not yours to make. Answer "open: the owner's call" and go on.
4. After each round, write me one line: the sharpest point, and who gave way.
5. Stop when it says NOTHING LEFT, or after 6 rounds.

Then tell me, in short lines:
- What changed in the plan.
- What it got wrong, and why.
- What needs me, as questions worded so that "yes" accepts your recommendation:

❓ 1. Short title
The question, in a sentence or two, and why it matters.
➡ The answer you recommend, alone on its line.

Wait for my answers. Don't act until I tell you to.`

export const CHALLENGER = `You are a challenger. You get a plan or idea with no history of how it came about, and you have no stake in it. Find where it is wrong before anyone builds it.

Argue with its owner in rounds.

${ROUNDS}

Rules:
- Every question must be able to change the plan. No nitpicks.
- Go after assumptions, scope, order, failure cases, and the simpler plan that was skipped.
- Look facts up yourself with Read and Bash, and cite paths. Bash is for reading only: change nothing.
- Say where you think the owner is wrong, and why. Never agree just to move on. No praise.
- When the owner answers "open: the owner's call", leave that branch and go on.
- A later answer that changes an earlier one reopens that branch.

Each message is one round and nothing else. When every branch is visited and nothing is left silently assumed, write NOTHING LEFT on its own line, then the weakest points that remain, if any.`

export const SERVE = `How to serve: write a handover from this session's plan, then start a new top-level session from it. I ran this shortcut, so it is my request for that session, now.

1. Find the plan: the accepted plan-mode plan, else what we agreed in this conversation, plus the task list. If this session made no plan, say so in one line and stop. Don't make one up.

2. Write the handover to ~/.claude/handovers/<date>-<short-name>.md. Write it for a reader who has seen nothing. Keep it a small fraction of this conversation. Keep these sections:
   - Goal: what the next session is for. If I named a purpose, tailor the whole handover to it.
   - Plan: the steps left, in order. Done steps in one line.
   - State: branch, uncommitted files, anything running, what was verified and how.
   - Decisions: what was settled, why, and who decided.
   - Assumed: everything nobody checked. Never word a guess as a fact, such as "X isn't built" or "Y is done".
   - Limits: what was ruled out, and the rules I gave in this session.
   - Read first: specs, plans, decision records, issues, commits and diffs, by path or URL. Point at them; don't copy them.
   - Suggested skills: which skills the next session should call.
   No keys, passwords, tokens or personal data.

3. Read it back as the next session will. That session will trust it without re-checking, so move anything you only assumed under Assumed.

4. Start the session:
   - In the desktop app: load mcp__ccd_session__start_session and mcp__ccd_session_mgmt__detach_session through ToolSearch. Call start_session with initiation "user_asked", context "fresh", a title, a one-paragraph background, and this prompt: "Read <the file's full path>, then continue the plan. Check anything under Assumed before you rely on it." Then call detach_session with its id, so it is a top-level session and not nested under this one. If detaching is refused, tell me why.
   - With no such tools, as in a terminal: give me one command to run in its own bash block: claude "Read <the file's full path>, then continue the plan. Check anything under Assumed before you rely on it." Point at the file; never paste the summary into a shell command.
   - Never use the Agent tool or hand_off_to_session for this. They don't make a top-level session.

5. Do no more work on this plan here, so two sessions never write the same files. End with the handover's path and a link to the new session.`

export const dilutePrompt = (grown: MemoryGrowth) => `Dilute the memory in ${grown.folder}. It holds ${memoryText(grown)}, and its MEMORY.md has ${grown.indexLines} lines.`

export const DILUTE = `How to dilute memory: thin out the memory folder named in my message, so a later session finds what it needs fast, and nothing it needs is gone. I ran this shortcut, so it is my request, now.

Only that folder changes. Never a CLAUDE.md, the repository or its docs. No commits. Do it yourself, with no agents.

Change nothing until I say yes.

1. Read it all: MEMORY.md and the whole of every file in the folder. List which files cover one subject and which facts may be out of date.

2. Decide for each file:
   - Merge: files on one subject become one, named after the file that says more.
   - Shorten: keep the facts and their reasons, cut the story. Aim under 4 KB a file: the engine cuts a recalled file at 4,096 bytes or 200 lines.
   - Fix: correct a stale fact once you have checked it against the code, the docs or git. Turn relative dates into absolute ones.
   - Remove: only what is finished and left no lesson, what proved wrong, or what the repository already records.
   - Keep: everything else.

3. Never lose these: my rules and preferences, what I ruled out, why something was decided and who decided it, how to avoid a past incident, work still open, anything that can't be found again. Age alone is no reason to cut. If you can't check whether something still holds, keep it and say so. When unsure, keep it.

4. Show me the plan, as a numbered list:
   - Every file you would remove, merge or shorten, one line each.
   - For a removal or a merge: which facts go, and why nobody needs them.
   - The folder's size now and after. Aim under ${kilobytes(AIM_BYTES)}, so this suggestion stays away a while. A fact someone needs beats the number: if you can't get there, say so.
   If nothing can go, say that and stop. Otherwise ask whether to go ahead, and wait. I can strike items by number.

5. After my yes, and only for what I approved:
   - First copy the folder to ~/.claude/memory-backups/<project folder's name>-<date>/, since it is not in git.
   - Make the changes, in the memory format your system prompt gives.
   - Keep MEMORY.md true: one line per memory, under about 150 characters, no pointer to a file that is gone. The engine loads only its first 200 lines or 25,000 bytes.
   - Fix any [[link]] to a name that changed.

6. Report in short lines: the size before and after, the files changed, merged and removed, and where the backup is.`
