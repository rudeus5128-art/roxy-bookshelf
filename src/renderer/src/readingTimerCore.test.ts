import { describe, expect, it } from 'vitest'
import {
  formatReadingDuration, isReadingKey, READING_IDLE_LIMIT_MS, shouldAccumulateReading
} from './readingTimerCore'

describe('reading timer rules', () => {
  it('counts only focused, visible and recently active reading', () => {
    const active = { visible: true, focused: true, now: 100_000, lastActivityAt: 90_000 }
    expect(shouldAccumulateReading(active)).toBe(true)
    expect(shouldAccumulateReading({ ...active, focused: false })).toBe(false)
    expect(shouldAccumulateReading({ ...active, visible: false })).toBe(false)
    expect(shouldAccumulateReading({ ...active, lastActivityAt: null })).toBe(false)
    expect(shouldAccumulateReading({ ...active, now: 90_000 + READING_IDLE_LIMIT_MS + 1 })).toBe(false)
  })

  it('recognizes reading keys without counting application shortcuts', () => {
    expect(isReadingKey({ key: 'PageDown', ctrlKey: false, altKey: false, metaKey: false })).toBe(true)
    expect(isReadingKey({ key: ' ', ctrlKey: false, altKey: false, metaKey: false })).toBe(true)
    expect(isReadingKey({ key: 'f', ctrlKey: true, altKey: false, metaKey: false })).toBe(false)
  })

  it('formats compact durations for the reader header', () => {
    expect(formatReadingDuration(59)).toBe('0m')
    expect(formatReadingDuration(12 * 3600 + 37 * 60)).toBe('12h 37m')
  })
})
