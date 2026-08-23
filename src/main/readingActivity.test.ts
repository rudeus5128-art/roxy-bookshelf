import { describe, expect, it } from 'vitest'
import { splitActivityByLocalDay } from './readingActivity'

describe('reading activity day boundaries', () => {
  it('keeps a normal checkpoint in one local day', () => {
    const end = new Date(2026, 7, 23, 14, 30, 0).getTime()
    expect(splitActivityByLocalDay(end, 30)).toEqual([{ recordedAt: end - 1, activeSeconds: 30 }])
  })

  it('splits an active checkpoint across local midnight without losing seconds', () => {
    const end = new Date(2026, 7, 24, 0, 0, 10).getTime()
    const segments = splitActivityByLocalDay(end, 30)
    expect(segments.map((item) => item.activeSeconds)).toEqual([20, 10])
    expect(new Date(segments[0].recordedAt).getDate()).toBe(23)
    expect(new Date(segments[1].recordedAt).getDate()).toBe(24)
    expect(segments.reduce((sum, item) => sum + item.activeSeconds, 0)).toBe(30)
  })
})
