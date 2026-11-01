export type AfkMode = 'develop' | 'test' | 'refactor' | 'housekeeping'
export type AfkState = 'off' | AfkMode
/** idle: the button shows. asked: from the press until the checklist's turn ends. */
export type WrapUpPhase = 'idle' | 'asked'
/** A project's memory, once it has grown past the row's limits. `files` leaves out MEMORY.md. */
export type MemoryGrowth = { folder: string; bytes: number; files: number; indexLines: number }

declare module 'claude-code' {
  interface PluginState {
    'dev-shortcuts': {
      afkMode: AfkState
      /** Turns taken since the mode was chosen. */
      afkTaken: number
      /** Turns in a row that called no tool. */
      afkIdleTurns: number
      afkToolCalls: number
      isAfkNoticeDue: boolean
      wrapUpPhase: WrapUpPhase
      isWrapUpNoticeDue: boolean
      turnsBeforeChecklist: number
      /** Null below the limits, so the row's button stays away. */
      memoryGrown: MemoryGrowth | null
    }
  }
}
