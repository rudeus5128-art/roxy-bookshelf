export interface ReadingActivitySegment { recordedAt: number; activeSeconds: number }

export function splitActivityByLocalDay(recordedAt: number, activeSeconds: number): ReadingActivitySegment[] {
  let remaining = Math.max(0, Math.floor(activeSeconds))
  let segmentEnd = Math.floor(recordedAt)
  const result: ReadingActivitySegment[] = []
  while (remaining > 0) {
    const endDate = new Date(segmentEnd - 1)
    const dayStart = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime()
    const secondsAvailable = Math.max(1, Math.ceil((segmentEnd - dayStart) / 1000))
    const seconds = Math.min(remaining, secondsAvailable)
    result.push({ recordedAt: Math.max(dayStart, segmentEnd - 1), activeSeconds: seconds })
    remaining -= seconds
    segmentEnd -= seconds * 1000
  }
  return result.reverse()
}
