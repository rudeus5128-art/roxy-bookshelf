import type { BookFormat, BookRecord } from '../../shared/models'

const formatOrder: Record<BookFormat, number> = { epub: 0, txt: 1, pdf: 2 }
const titleCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

function decimalAwareCompare(left: string, right: string): number {
  const numberPattern = /\d+(?:\.\d+)*/g
  const leftNumbers = [...left.matchAll(numberPattern)]
  const rightNumbers = [...right.matchAll(numberPattern)]
  const length = Math.min(leftNumbers.length, rightNumbers.length)
  let leftCursor = 0
  let rightCursor = 0
  for (let index = 0; index < length; index += 1) {
    const leftMatch = leftNumbers[index]
    const rightMatch = rightNumbers[index]
    const prefix = titleCollator.compare(left.slice(leftCursor, leftMatch.index), right.slice(rightCursor, rightMatch.index))
    if (prefix) return prefix
    const numeric = Number(leftMatch[0]) - Number(rightMatch[0])
    if (numeric) return numeric
    leftCursor = leftMatch.index + leftMatch[0].length
    rightCursor = rightMatch.index + rightMatch[0].length
  }
  return titleCollator.compare(left.slice(leftCursor), right.slice(rightCursor)) || titleCollator.compare(left, right)
}

export function smartBookSort(left: BookRecord, right: BookRecord): number {
  return formatOrder[left.format] - formatOrder[right.format] ||
    decimalAwareCompare(left.title, right.title) ||
    decimalAwareCompare(left.fileName, right.fileName) ||
    left.addedAt - right.addedAt
}

export function recentlyOpenedSort(left: BookRecord, right: BookRecord): number {
  return (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0) || smartBookSort(left, right)
}
