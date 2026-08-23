import { describe, expect, it } from 'vitest'
import type { BookFormat, BookRecord } from '../../shared/models'
import { recentlyOpenedSort, smartBookSort } from './shelfSort'

function book(title: string, format: BookFormat): BookRecord {
  return { id: `${format}-${title}`, format, filePath: title, fileName: `${title}.${format}`, fileHash: title,
    title, author: '作者', coverUrl: null, addedAt: 1, lastOpenedAt: null, progress: 0 }
}

describe('smartBookSort', () => {
  it('groups formats and compares numeric names naturally', () => {
    const books = [book('系列 1.10', 'txt'), book('系列 1.2', 'epub'), book('系列 1.10', 'epub'), book('系列 1.1', 'pdf')]
    expect(books.sort(smartBookSort).map((item) => `${item.format}:${item.title}`)).toEqual([
      'epub:系列 1.10', 'epub:系列 1.2', 'txt:系列 1.10', 'pdf:系列 1.1'
    ])
  })

  it('sorts recently opened books from newest to oldest', () => {
    const older = { ...book('较早打开', 'txt'), lastOpenedAt: 100 }
    const newest = { ...book('最近打开', 'pdf'), lastOpenedAt: 300 }
    const middle = { ...book('中间打开', 'epub'), lastOpenedAt: 200 }
    expect([older, newest, middle].sort(recentlyOpenedSort).map((item) => item.title)).toEqual([
      '最近打开', '中间打开', '较早打开'
    ])
  })
})
