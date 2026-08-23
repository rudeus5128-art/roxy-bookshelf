import type { PdfViewMode, PdfZoomMode } from '../../shared/models'
import type { TextReadingSettings } from './ReadingSettings'

export interface PdfReaderPreferences {
  zoom: number
  zoomMode: PdfZoomMode
  viewMode: PdfViewMode
}

function storedObject(key: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null')
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
  } catch { return null }
}

export function loadTextPreferences(format: 'epub' | 'txt', fallback: TextReadingSettings): TextReadingSettings {
  const value = storedObject(`roxy-reader-preferences-${format}`)
  if (!value) return fallback
  const number = (key: keyof TextReadingSettings, current: number) =>
    typeof value[key] === 'number' && Number.isFinite(value[key]) ? value[key] as number : current
  return {
    fontSize: Math.max(12, Math.min(36, number('fontSize', fallback.fontSize))),
    lineHeight: Math.max(1.2, Math.min(2.4, number('lineHeight', fallback.lineHeight))),
    contentWidth: Math.max(480, Math.min(1200, number('contentWidth', fallback.contentWidth))),
    fontFamily: typeof value.fontFamily === 'string' ? value.fontFamily : fallback.fontFamily,
    paragraphSpacing: Math.max(0, Math.min(2, number('paragraphSpacing', fallback.paragraphSpacing))),
    pageMargin: Math.max(8, Math.min(100, number('pageMargin', fallback.pageMargin))),
    readingMode: value.readingMode === 'continuous' || value.readingMode === 'paginated' ? value.readingMode : fallback.readingMode,
    pageLayout: value.pageLayout === 'single' || value.pageLayout === 'double' ? value.pageLayout : fallback.pageLayout
  }
}

export function saveTextPreferences(format: 'epub' | 'txt', settings: TextReadingSettings): void {
  localStorage.setItem(`roxy-reader-preferences-${format}`, JSON.stringify(settings))
}

export function loadPdfPreferences(fallback: PdfReaderPreferences): PdfReaderPreferences {
  const value = storedObject('roxy-reader-preferences-pdf')
  if (!value) return fallback
  return {
    zoom: typeof value.zoom === 'number' && Number.isFinite(value.zoom) ? Math.max(.25, Math.min(4, value.zoom)) : fallback.zoom,
    zoomMode: value.zoomMode === 'custom' || value.zoomMode === 'fit-width' || value.zoomMode === 'fit-page' ? value.zoomMode : fallback.zoomMode,
    viewMode: value.viewMode === 'continuous' || value.viewMode === 'single' || value.viewMode === 'double' ? value.viewMode : fallback.viewMode
  }
}

export function savePdfPreferences(settings: PdfReaderPreferences): void {
  localStorage.setItem('roxy-reader-preferences-pdf', JSON.stringify(settings))
}
