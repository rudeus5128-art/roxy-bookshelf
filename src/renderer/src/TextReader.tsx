import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, BookOpenText, ChevronLeft, ChevronRight, Minus, Moon, Plus, Search, Sun, X } from 'lucide-react'
import type { BookAnnotation, BookRecord, ReadingState, TextChunk, TextDocumentInfo, TextEncoding, TextSearchResult } from '../../shared/models'
import ReadingSettings, { DEFAULT_READING_SETTINGS, fontFamilies, type TextReadingSettings } from './ReadingSettings'
import ReadingSessionStatus from './ReadingSessionStatus'
import { AnnotationPanel, SelectionHighlightAction, useBookAnnotations } from './AnnotationsPanel'
import { loadTextPreferences, saveTextPreferences } from './readerPreferences'
import { friendlyReaderError } from './readerErrors'

interface Props { bookRecord: BookRecord; theme: 'light' | 'dark'; onThemeChange(): void; onClose(): void }
const TXT_DEFAULTS: TextReadingSettings = { ...DEFAULT_READING_SETTINGS }
const MINIMUM_DOUBLE_PAGE_WIDTH = 1_220
const encodings: Array<{ value: TextEncoding; label: string }> = [
  { value: 'utf8', label: 'UTF-8' }, { value: 'utf16le', label: 'UTF-16 LE' },
  { value: 'utf16be', label: 'UTF-16 BE' }, { value: 'gbk', label: 'GBK' },
  { value: 'gb18030', label: 'GB18030' }
]

interface TextLine { text: string; start: number }
interface TextHighlightLocator { type: 'txt-range'; chunkStart: number; start: number; end: number }
interface RenderedTextHighlightLocator extends TextHighlightLocator { annotationId: string }

function shouldShowDoublePage(settings: TextReadingSettings, availableWidth: number): boolean {
  if (settings.readingMode !== 'paginated' || settings.pageLayout !== 'double') return false
  const breakpoint = Math.max(MINIMUM_DOUBLE_PAGE_WIDTH, Math.min(1_500, settings.contentWidth + 500))
  return availableWidth >= breakpoint
}

function textLines(value: string): TextLine[] {
  const lines: TextLine[] = []
  let start = 0
  for (const match of value.matchAll(/\r\n|\r|\n/g)) {
    lines.push({ text: value.slice(start, match.index), start })
    start = match.index + match[0].length
  }
  lines.push({ text: value.slice(start), start })
  return lines
}

function parseTextHighlight(locator: string): TextHighlightLocator | null {
  try {
    const value = JSON.parse(locator) as Partial<TextHighlightLocator>
    return value.type === 'txt-range' && Number.isFinite(value.chunkStart) && Number.isFinite(value.start) && Number.isFinite(value.end)
      ? value as TextHighlightLocator : null
  } catch { return null }
}

function highlightedLine(text: string, lineStart: number, ranges: RenderedTextHighlightLocator[], onErase: (annotationId: string) => void) {
  const intervals = ranges.map((range) => ({
    start: Math.max(0, range.start - lineStart),
    end: Math.min(text.length, range.end - lineStart),
    annotationId: range.annotationId
  })).filter((range) => range.end > range.start).sort((left, right) => left.start - right.start)
  const merged: Array<{ start: number; end: number; annotationId?: string }> = []
  for (const interval of intervals) {
    const previous = merged[merged.length - 1]
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end)
    else merged.push({ ...interval })
  }
  if (!merged.length) return text || '\u00a0'
  const output: React.ReactNode[] = []
  let cursor = 0
  for (const interval of merged) {
    if (interval.start > cursor) output.push(text.slice(cursor, interval.start))
    output.push(<mark className="text-highlight" key={`${interval.start}-${interval.end}`} title="点击擦除高亮" onClick={() => interval.annotationId && onErase(interval.annotationId)}>{text.slice(interval.start, interval.end)}</mark>)
    cursor = interval.end
  }
  if (cursor < text.length) output.push(text.slice(cursor))
  return output
}

export default function TextReader({ bookRecord, theme, onThemeChange, onClose }: Props) {
  const stageRef = useRef<HTMLElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<ReadingState | null>(null)
  const settingsRef = useRef<TextReadingSettings>(TXT_DEFAULTS)
  const loadingMore = useRef(false)
  const wheelTimeRef = useRef(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const restoreRatioRef = useRef(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [info, setInfo] = useState<TextDocumentInfo | null>(null)
  const [chunks, setChunks] = useState<TextChunk[]>([])
  const [settings, setSettings] = useState(TXT_DEFAULTS)
  const [availableWidth, setAvailableWidth] = useState(() => window.innerWidth)
  const [progress, setProgress] = useState(bookRecord.progress || 0)
  const [tocOpen, setTocOpen] = useState(false)
  const [error, setError] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<TextSearchResult[]>([])
  const [resultIndex, setResultIndex] = useState(0)
  const [selection, setSelection] = useState<{ locator: string; text: string; x: number; y: number } | null>(null)
  const annotationStore = useBookAnnotations(bookRecord.id)

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(Math.round(entry.contentRect.width)))
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  function scrollToChunkPosition(start: number, ratio: number) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const viewport = viewportRef.current
      const section = viewport?.querySelector<HTMLElement>(`[data-text-start="${start}"]`)
      if (!viewport || !section) return
      if (settingsRef.current.readingMode === 'paginated') {
        const viewportRect = viewport.getBoundingClientRect()
        const fragments = Array.from(section.getClientRects())
        if (!fragments.length) return
        const left = Math.min(...fragments.map((rect) => rect.left - viewportRect.left + viewport.scrollLeft))
        const right = Math.max(...fragments.map((rect) => rect.right - viewportRect.left + viewport.scrollLeft))
        const target = Math.max(0, left + Math.max(0, right - left) * ratio)
        viewport.scrollLeft = Math.round(target / Math.max(1, viewport.clientWidth)) * viewport.clientWidth
      } else viewport.scrollTop = section.offsetTop + section.offsetHeight * ratio
    }))
  }

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const current = await window.roxy.getTextInfo(bookRecord.id)
        if (disposed) return
        setInfo(current)
        if (current.status === 'ready') {
          const saved = await window.roxy.getReadingState(bookRecord.id)
          const state: ReadingState = {
            bookId: bookRecord.id, location: 'txt:0:0', progress: 0, ...TXT_DEFAULTS,
            updatedAt: Date.now(), ...saved
          }
          Object.assign(state, loadTextPreferences('txt', {
            fontSize: state.fontSize, lineHeight: state.lineHeight, contentWidth: state.contentWidth,
            fontFamily: state.fontFamily, paragraphSpacing: state.paragraphSpacing,
            pageMargin: state.pageMargin, readingMode: state.readingMode, pageLayout: state.pageLayout
          }))
          stateRef.current = state
          const currentSettings = { fontSize: state.fontSize, lineHeight: state.lineHeight, contentWidth: state.contentWidth, fontFamily: state.fontFamily, paragraphSpacing: state.paragraphSpacing, pageMargin: state.pageMargin, readingMode: state.readingMode, pageLayout: state.pageLayout }
          settingsRef.current = currentSettings; setSettings(currentSettings); setProgress(state.progress)
          const locationMatch = state.location?.match(/^txt:(\d+)(?::([\d.]+))?/)
          const offset = Number(locationMatch?.[1] ?? 0)
          restoreRatioRef.current = Math.max(0, Math.min(1, Number(locationMatch?.[2] ?? 0)))
          const chunk = await window.roxy.readTextChunk(bookRecord.id, offset)
          if (!disposed) {
            setChunks([chunk])
            scrollToChunkPosition(chunk.start, restoreRatioRef.current)
            await window.roxy.setLastOpened(bookRecord.id)
          }
          return
        }
        if (current.status === 'error') { setError(current.error || 'TXT 索引失败'); return }
        timer = setTimeout(poll, 250)
      } catch (reason) { if (!disposed) setError(friendlyReaderError('txt', reason)) }
    }
    poll()
    return () => {
      disposed = true
      clearTimeout(timer)
      clearTimeout(saveTimerRef.current)
      if (stateRef.current) window.roxy.saveReadingState(stateRef.current)
    }
  }, [bookRecord.id])

  async function loadAt(start: number, replace = true) {
    if (loadingMore.current) return
    loadingMore.current = true
    try {
      const chunk = await window.roxy.readTextChunk(bookRecord.id, start)
      if (replace) {
        setChunks([chunk])
        if (stateRef.current && info?.totalBytes) {
          const nextProgress = Math.max(0, Math.min(1, chunk.start / info.totalBytes))
          setProgress(nextProgress)
          stateRef.current = { ...stateRef.current, location: `txt:${chunk.start}:0`, progress: nextProgress, ...settingsRef.current, updatedAt: Date.now() }
          await window.roxy.saveReadingState(stateRef.current)
        }
        requestAnimationFrame(() => viewportRef.current?.scrollTo({ left: 0, top: 0 }))
      } else setChunks((current) => current.some((item) => item.start === chunk.start) ? current : [...current, chunk])
    } finally { loadingMore.current = false }
  }

  function savePosition() {
    const viewport = viewportRef.current
    if (!viewport || !chunks.length || !stateRef.current || !info?.totalBytes) return
    const paginated = settingsRef.current.readingMode === 'paginated'
    const sections = Array.from(viewport.querySelectorAll<HTMLElement>('[data-text-start]'))
    const viewportRect = viewport.getBoundingClientRect()
    const visible = paginated
      ? sections.find((section) => Array.from(section.getClientRects()).some((rect) => rect.right > viewportRect.left + 8 && rect.left < viewportRect.right - 8)) ?? sections[0]
      : sections.find((section) => section.offsetTop + section.offsetHeight > viewport.scrollTop + 8) ?? sections[0]
    const start = Number(visible?.dataset.textStart ?? chunks[0].start)
    const chunk = chunks.find((item) => item.start === start) ?? chunks[0]
    const fragments = visible ? Array.from(visible.getClientRects()) : []
    const left = fragments.length ? Math.min(...fragments.map((rect) => rect.left - viewportRect.left + viewport.scrollLeft)) : 0
    const right = fragments.length ? Math.max(...fragments.map((rect) => rect.right - viewportRect.left + viewport.scrollLeft)) : 0
    const ratio = paginated
      ? Math.max(0, Math.min(1, (viewport.scrollLeft + 8 - left) / Math.max(1, right - left)))
      : Math.max(0, Math.min(1, (viewport.scrollTop + 8 - (visible?.offsetTop ?? 0)) / Math.max(1, visible?.offsetHeight ?? 1)))
    const atDocumentEnd = !chunks[chunks.length - 1].hasMore && (paginated
      ? viewport.scrollWidth - viewport.scrollLeft - viewport.clientWidth < 24
      : viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 24)
    const estimatedOffset = atDocumentEnd ? info.totalBytes : start + (chunk.nextOffset - start) * ratio
    const nextProgress = Math.max(0, Math.min(1, estimatedOffset / info.totalBytes))
    setProgress(nextProgress)
    stateRef.current = { ...stateRef.current, location: `txt:${start}:${ratio.toFixed(6)}`, progress: nextProgress, ...settingsRef.current, updatedAt: Date.now() }
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => stateRef.current && window.roxy.saveReadingState(stateRef.current), 200)
  }

  function onScroll() {
    const viewport = viewportRef.current
    if (!viewport || !chunks.length) return
    const nearEnd = settingsRef.current.readingMode === 'paginated'
      ? viewport.scrollWidth - viewport.scrollLeft - viewport.clientWidth < 900
      : viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 900
    if (nearEnd) {
      const last = chunks[chunks.length - 1]
      if (last.hasMore) loadAt(last.nextOffset, false)
    }
    savePosition()
    setSelection(null)
  }

  async function rebuild(encoding: TextEncoding, detectChapters = info?.detectChapters ?? true) {
    setChunks([]); setError(''); setProgress(0)
    if (stateRef.current) { stateRef.current = { ...stateRef.current, location: 'txt:0:0', progress: 0, updatedAt: Date.now() }; await window.roxy.saveReadingState(stateRef.current) }
    await window.roxy.rebuildTextIndex(bookRecord.id, encoding, detectChapters)
    setInfo({ bookId: bookRecord.id, encoding, detectChapters, status: 'indexing', progress: 0, totalBytes: 0, chapters: [] })
    setTimeout(async function poll() {
      const current = await window.roxy.getTextInfo(bookRecord.id); setInfo(current)
      if (current.status === 'ready') { await loadAt(0); return }
      if (current.status !== 'error') setTimeout(poll, 250)
    }, 250)
  }

  function updateSetting<K extends keyof TextReadingSettings>(key: K, value: TextReadingSettings[K]) {
    savePosition()
    const next = { ...settingsRef.current, [key]: value }
    settingsRef.current = next; setSettings(next)
    saveTextPreferences('txt', next)
    if (stateRef.current) { stateRef.current = { ...stateRef.current, ...next, updatedAt: Date.now() }; window.roxy.saveReadingState(stateRef.current) }
    if (key === 'readingMode' || key === 'pageLayout') {
      const match = stateRef.current?.location?.match(/^txt:(\d+)(?::([\d.]+))?/)
      if (match) scrollToChunkPosition(Number(match[1]), Number(match[2] ?? 0))
    }
  }

  async function searchBook() {
    if (!query.trim() || searching) return
    setSearching(true); setResults([]); setResultIndex(0)
    try {
      const found = await window.roxy.searchText(bookRecord.id, query)
      setResults(found)
      if (found[0]) await loadAt(found[0].byteOffset)
    } finally { setSearching(false) }
  }

  async function moveResult(direction: 1 | -1) {
    if (!results.length) return
    const next = (resultIndex + direction + results.length) % results.length
    setResultIndex(next); await loadAt(results[next].byteOffset)
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const viewport = viewportRef.current
      if (!viewport) return
      if (event.ctrlKey && event.key.toLowerCase() === 'f') { event.preventDefault(); setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 0); return }
      if (event.key === 'Escape') {
        if (searchOpen) { setSearchOpen(false); return }
        if (tocOpen) { setTocOpen(false); return }
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
      }
      if (event.key === 'PageDown' || event.key === 'ArrowRight') { event.preventDefault(); turnPage(1) }
      if (event.key === 'PageUp' || event.key === 'ArrowLeft') { event.preventDefault(); turnPage(-1) }
      if (event.key === 'Home') { event.preventDefault(); loadAt(0) }
      if (event.key === 'End' && info) { event.preventDefault(); loadAt(Math.max(0, info.totalBytes - 40 * 1024)) }
      if (event.key === 'F11') { event.preventDefault(); document.documentElement.requestFullscreen().catch(() => {}) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tocOpen, searchOpen, info])

  function onWheel(event: React.WheelEvent) {
    if (settings.readingMode !== 'paginated' || !viewportRef.current) return
    const now = Date.now()
    if (Math.abs(event.deltaY) < 12 || now - wheelTimeRef.current < 280) return
    event.preventDefault(); wheelTimeRef.current = now
    turnPage(Math.sign(event.deltaY))
  }

  function turnPage(direction: number) {
    const viewport = viewportRef.current
    if (!viewport) return
    if (settingsRef.current.readingMode === 'paginated') viewport.scrollBy({ left: direction * viewport.clientWidth, behavior: 'smooth' })
    else viewport.scrollBy({ top: direction * viewport.clientHeight * .9, behavior: 'smooth' })
  }

  function onTextSelection() {
    const selected = window.getSelection()
    if (!selected || selected.isCollapsed || !selected.rangeCount) { setSelection(null); return }
    const range = selected.getRangeAt(0)
    const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement
    const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer as Element : range.endContainer.parentElement
    const startLine = startElement?.closest<HTMLElement>('[data-line-start]')
    const endLine = endElement?.closest<HTMLElement>('[data-line-start]')
    const section = startLine?.closest<HTMLElement>('[data-text-start]')
    if (!startLine || !endLine || !section || endLine.closest('[data-text-start]') !== section) { setSelection(null); return }
    try {
      const offsetIn = (line: HTMLElement, node: Node, offset: number) => {
        const measure = globalThis.document.createRange()
        measure.selectNodeContents(line)
        measure.setEnd(node, offset)
        return measure.toString().length
      }
      const start = Number(startLine.dataset.lineStart) + offsetIn(startLine, range.startContainer, range.startOffset)
      const end = Number(endLine.dataset.lineStart) + offsetIn(endLine, range.endContainer, range.endOffset)
      const text = selected.toString().trim().replace(/\s+/g, ' ')
      if (!text || end <= start) { setSelection(null); return }
      const rect = range.getBoundingClientRect()
      const locator = JSON.stringify({ type: 'txt-range', chunkStart: Number(section.dataset.textStart), start, end } satisfies TextHighlightLocator)
      setSelection({ locator, text: text.slice(0, 500), x: Math.max(70, Math.min(window.innerWidth - 70, rect.left + rect.width / 2)), y: Math.max(68, rect.top - 8) })
    } catch { setSelection(null) }
  }

  async function addBookmark() {
    const locator = stateRef.current?.location
    if (locator) await annotationStore.add('bookmark', locator, `阅读进度 ${Math.round(progress * 100)}%`)
  }

  async function jumpAnnotation(annotation: BookAnnotation) {
    const highlight = parseTextHighlight(annotation.locator)
    const offset = highlight?.chunkStart ?? Number(annotation.locator.match(/^txt:(\d+)/)?.[1])
    if (Number.isFinite(offset)) await loadAt(offset)
  }

  async function addSelectionHighlight() {
    if (!selection) return
    await annotationStore.add('highlight', selection.locator, selection.text)
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  const highlightsForChunk = (chunkStart: number) => annotationStore.annotations
    .filter((item) => item.kind === 'highlight').map((item) => {
      const locator = parseTextHighlight(item.locator)
      return locator ? { ...locator, annotationId: item.id } : null
    })
    .filter((item): item is RenderedTextHighlightLocator => item?.chunkStart === chunkStart)

  const paginated = settings.readingMode === 'paginated'
  const useDoublePage = shouldShowDoublePage(settings, availableWidth)
  const effectivePageLayout = useDoublePage ? 'double' : 'single'
  const pageViewportWidth = useDoublePage
    ? settings.contentWidth * 2 + settings.pageMargin * 4
    : settings.contentWidth + settings.pageMargin * 2

  useEffect(() => {
    const match = stateRef.current?.location?.match(/^txt:(\d+)(?::([\d.]+))?/)
    if (match) scrollToChunkPosition(Number(match[1]), Number(match[2] ?? 0))
  }, [effectivePageLayout, pageViewportWidth, settings.readingMode])

  return <main className="reader-shell text-reader-shell">
    <header className="reader-bar"><button className="icon-button" onClick={onClose} aria-label="返回书架"><ArrowLeft size={19} /></button><div className="reader-title"><strong>{bookRecord.title}</strong><ReadingSessionStatus bookId={bookRecord.id} progress={progress} /></div><div className="reader-controls"><button className="icon-button" onClick={() => setTocOpen(true)} aria-label="目录"><BookOpenText size={19} /></button><AnnotationPanel annotations={annotationStore.annotations} onAddBookmark={addBookmark} onJump={jumpAnnotation} onRemove={(annotation) => annotationStore.remove(annotation.id)} /><button className="icon-button" onClick={() => { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 0) }} aria-label="搜索 TXT"><Search size={18} /></button><label className="compact-control">编码<select value={info?.encoding ?? 'utf8'} onChange={(event) => rebuild(event.target.value as TextEncoding)}>{encodings.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><div className="setting-group"><button onClick={() => updateSetting('fontSize', Math.max(12, settings.fontSize - 1))}><Minus size={14} /></button><span>{settings.fontSize}</span><button onClick={() => updateSetting('fontSize', Math.min(36, settings.fontSize + 1))}><Plus size={14} /></button></div><ReadingSettings settings={settings} onChange={updateSetting} /><button className="icon-button" onClick={onThemeChange}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button></div></header>
    <section ref={stageRef} className="text-stage">{info?.status === 'ready' && chunks.length ? <>{paginated && <button className="page-hit left" onClick={() => turnPage(-1)} aria-label="上一页"><ChevronLeft /></button>}<div ref={viewportRef} className={`text-viewport mode-${settings.readingMode} layout-${effectivePageLayout}`} style={paginated ? { maxWidth: pageViewportWidth } : undefined} onScroll={onScroll} onWheel={onWheel} onMouseUp={onTextSelection}><article className="text-content" style={{ maxWidth: paginated ? undefined : settings.contentWidth, fontSize: settings.fontSize, lineHeight: settings.lineHeight, fontFamily: fontFamilies[settings.fontFamily], paddingLeft: settings.pageMargin, paddingRight: settings.pageMargin, columnGap: paginated ? settings.pageMargin * 2 : undefined }}>{chunks.map((chunk) => { const ranges = highlightsForChunk(chunk.start); return <section key={chunk.start} data-text-start={chunk.start}>{textLines(chunk.text).map((line, index) => <p key={index} data-line-start={line.start} style={{ margin: `0 0 ${line.text ? settings.paragraphSpacing : Math.max(.25, settings.paragraphSpacing)}em` }}>{highlightedLine(line.text, line.start, ranges, (annotationId) => annotationStore.remove(annotationId))}</p>)}</section> })}</article></div>{paginated && <button className="page-hit right" onClick={() => turnPage(1)} aria-label="下一页"><ChevronRight /></button>}</> : <div className={`reader-message ${error ? 'error' : ''}`}><strong>{error || '正在建立 TXT 索引…'}</strong>{!error && <span>{Math.round((info?.progress ?? 0) * 100)}%</span>}</div>}{searchOpen && <form className="pdf-search-bar" onSubmit={(event) => { event.preventDefault(); searchBook() }}><Search size={16} /><input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 TXT 正文" /><span>{searching ? '搜索中…' : results.length ? `${resultIndex + 1} / ${results.length}` : query ? '无结果' : ''}</span><button type="button" onClick={() => moveResult(-1)} disabled={!results.length}><ChevronLeft size={16} /></button><button type="button" onClick={() => moveResult(1)} disabled={!results.length}><ChevronRight size={16} /></button><button type="button" onClick={() => setSearchOpen(false)}><X size={16} /></button></form>}</section>
    <div className="progress-track"><i style={{ width: `${progress * 100}%` }} /></div>
    {tocOpen && <div className="drawer-backdrop" onMouseDown={() => setTocOpen(false)}><aside className="toc-drawer" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><strong>目录</strong><button className="icon-button" onClick={() => setTocOpen(false)}><X size={18} /></button></div><label className="chapter-toggle"><input type="checkbox" checked={info?.detectChapters ?? true} onChange={(event) => info && rebuild(info.encoding, event.target.checked)} />自动识别章节</label>{info?.chapters.length ? <ol className="toc-list">{info.chapters.map((chapter) => <li key={`${chapter.byteOffset}-${chapter.title}`}><button onClick={() => { loadAt(chapter.byteOffset); setTocOpen(false) }}>{chapter.title}</button></li>)}</ol> : <p className="muted">没有识别到章节，可关闭自动识别后正常阅读。</p>}</aside></div>}
    {selection && <SelectionHighlightAction x={selection.x} y={selection.y} onAdd={addSelectionHighlight} />}
  </main>
}
