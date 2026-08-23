import type { BookFormat } from './models'

const supportedExtensions: Record<string, BookFormat> = {
  '.epub': 'epub',
  '.txt': 'txt',
  '.pdf': 'pdf'
}

export function formatFromFileName(fileName: string): BookFormat | null {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return null
  return supportedExtensions[fileName.slice(dot).toLowerCase()] ?? null
}

export function isPhaseOneBook(fileName: string): boolean {
  return formatFromFileName(fileName) === 'epub'
}
