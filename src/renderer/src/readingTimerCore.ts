export const READING_IDLE_LIMIT_MS = 4 * 60 * 1000
export const READING_CHECKPOINT_SECONDS = 30

export function isReadingKey(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'>): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey) return false
  return ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)
}

export function shouldAccumulateReading(input: {
  visible: boolean
  focused: boolean
  now: number
  lastActivityAt: number | null
}): boolean {
  return input.visible && input.focused && input.lastActivityAt !== null &&
    input.now - input.lastActivityAt <= READING_IDLE_LIMIT_MS
}

export function formatReadingDuration(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}
