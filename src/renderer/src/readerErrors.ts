import type { BookFormat } from '../../shared/models'
import type { AppLanguage } from '../../shared/models'
import { localizeError } from '../../shared/i18n'

export function friendlyReaderError(format: BookFormat, reason: unknown, language: AppLanguage = 'zh-CN'): string {
  return localizeError(language, reason, format === 'pdf' ? 'pdfUnreadable' : format === 'txt' ? 'txtUnreadable' : 'bookUnreadable')
}
