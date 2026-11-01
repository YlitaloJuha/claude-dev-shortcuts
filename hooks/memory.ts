// How far this project's memory has grown, for the row's Dilute memory button.
// Measured when the session starts and after each main turn, never while drawing.
// A CLAUDE.md doesn't count: it is checked in, and diluting leaves it alone.
import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { MemoryGrowth } from '../types'

// Past any of these the button shows. The index's are half of what the engine loads of MEMORY.md.
export const GROWN = { bytes: 100_000, indexLines: 100, indexBytes: 12_500 }
// Where diluting aims, so the button doesn't come straight back.
export const AIM_BYTES = 75_000

const INDEX = 'MEMORY.md'
const INDEX_PATH = /[\\/]MEMORY\.md$/

const memoryGrown = atom({ plugin: 'dev-shortcuts', key: 'memoryGrown' } as const, null as MemoryGrowth | null)

export const kilobytes = (bytes: number) => `${Math.round(bytes / 1000)} KB`

export const memoryText = (grown: MemoryGrowth) => `${kilobytes(grown.bytes)} in ${grown.files} file${grown.files === 1 ? '' : 's'}`

async function grownMemory($: EngineInterface): Promise<MemoryGrowth | null> {
  // The engine's word for where the memory is, since a worktree or a setting can move it.
  const { context } = await $.session.usage({ breakdown: 'summary' })
  const index = context.breakdown?.memoryFiles.find(file => file.type === 'AutoMem' && INDEX_PATH.test(file.path))
  if (index === undefined) return null
  const folder = index.path.replace(INDEX_PATH, '')
  const notes = (await $.fs.list(folder)).filter(entry => entry.kind === 'file' && entry.name.endsWith('.md'))
  const bytes = notes.reduce((sum, entry) => sum + entry.size, 0)
  const indexBytes = notes.find(entry => entry.name === INDEX)?.size ?? 0
  // A read over 4 MiB rejects, and the listing's size already says enough then.
  const indexLines = (await $.fs.read(index.path).catch(() => '')).trim().split('\n').length
  const isGrown = bytes > GROWN.bytes || indexBytes > GROWN.indexBytes || indexLines > GROWN.indexLines

  return isGrown ? { folder, bytes, files: notes.length - 1, indexLines } : null
}

export async function measureMemory($: EngineInterface) {
  const grown = await grownMemory($).catch(() => null)
  await update($, memoryGrown, () => grown)
}
