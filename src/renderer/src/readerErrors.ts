import type { BookFormat } from '../../shared/models'

export function friendlyReaderError(format: BookFormat, reason: unknown): string {
  const message = reason instanceof Error ? reason.message : ''
  if (message.includes('找不到原始电子书')) return '找不到原始电子书。请从文件的新位置重新导入同一本书以更新路径。'
  if (message.includes('书籍不在书架中')) return '书籍不在书架中。'
  if (message.includes('找不到原始 TXT')) return '找不到原始 TXT。请从文件的新位置重新导入同一本书以更新路径。'
  if (format === 'pdf') return '文件内容无法解析、已经损坏或受密码保护。'
  if (format === 'txt') return '无法读取 TXT，请检查文件编码或完整性。'
  return '文件内容无法解析或已经损坏。'
}
