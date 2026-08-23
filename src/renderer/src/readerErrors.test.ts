import { describe, expect, it } from 'vitest'
import { friendlyReaderError } from './readerErrors'

describe('reader error messages', () => {
  it('keeps missing-file guidance without Electron IPC internals', () => {
    const error = new Error("Error invoking remote method 'book:read': Error: 找不到原始电子书。请从文件的新位置重新导入同一本书以更新路径。")
    expect(friendlyReaderError('epub', error)).toBe('找不到原始电子书。请从文件的新位置重新导入同一本书以更新路径。')
  })

  it('normalizes parser errors by format', () => {
    expect(friendlyReaderError('epub', new Error('Invalid ZIP'))).toBe('文件内容无法解析或已经损坏。')
    expect(friendlyReaderError('pdf', new Error('Invalid PDF'))).toBe('文件内容无法解析、已经损坏或受密码保护。')
  })
})
