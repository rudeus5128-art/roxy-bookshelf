import { describe, expect, it } from 'vitest'
import { localizeError, normalizeLanguage, translate } from './i18n'

describe('i18n', () => {
  it('formats both supported languages', () => {
    expect(translate('zh-CN', 'localBooks', { count: 2 })).toBe('2 本本地书籍')
    expect(translate('en-US', 'localBooks', { count: 2 })).toBe('2 local books')
  })

  it('preserves Chinese as the compatibility default', () => {
    expect(normalizeLanguage(undefined)).toBe('zh-CN')
    expect(normalizeLanguage('en-US')).toBe('en-US')
  })

  it('localizes known main-process errors without exposing IPC details', () => {
    const error = new Error("Error invoking remote method: 找不到原始电子书。请从文件的新位置重新导入同一本书以更新路径。")
    expect(localizeError('en-US', error, 'operationFailed')).toContain('Re-import the same book')
  })
})
