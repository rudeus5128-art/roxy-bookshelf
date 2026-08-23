import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  ArrowLeft, BookOpenText, ChevronLeft, ChevronRight, Minus, Moon,
  Plus, Search, Sun, X
} from 'lucide-react'
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { BookAnnotation, BookRecord, PdfReadingState, PdfViewMode, PdfZoomMode } from '../../shared/models'
import ReadingSessionStatus from './ReadingSessionStatus'
import { AnnotationPanel, SelectionHighlightAction, useBookAnnotations } from './AnnotationsPanel'
import { loadPdfPreferences, savePdfPreferences } from './readerPreferences'
import { friendlyReaderError } from './readerErrors'

GlobalWorkerOptions.workerSrc = workerUrl

interface Props {
  bookRecord: BookRecord
  theme: 'light' | 'dark'
  onThemeChange(): void
  onClose(): void
}

interface OutlineItem {
  title: string
  dest: string | unknown[] | null
  items?: OutlineItem[]
}

interface SearchHit { page: number; count: number }
interface PageSize { width: number; height: number }
interface PdfHighlightRect { x: number; y: number; width: number; height: number }
interface PdfHighlightLocator { type: 'pdf-range'; page: number; rects: PdfHighlightRect[] }

function parsePdfHighlight(locator: string): PdfHighlightLocator | null {
  try {
    const value = JSON.parse(locator) as Partial<PdfHighlightLocator>
    return value.type === 'pdf-range' && Number.isFinite(value.page) && Array.isArray(value.rects)
      ? value as PdfHighlightLocator : null
  } catch { return null }
}

function PdfPage({ document, pageNumber, scale, fallbackSize, scrollRoot, highlights, onSelection, eager = false }: {
  document: PDFDocumentProxy
  pageNumber: number
  scale: number
  fallbackSize: PageSize
  scrollRoot: HTMLElement | null
  highlights: BookAnnotation[]
  onSelection(selection: { locator: string; text: string; x: number; y: number }): void
  eager?: boolean
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(eager)
  const [size, setSize] = useState({ width: fallbackSize.width * scale, height: fallbackSize.height * scale })
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (eager || !frameRef.current || !scrollRoot) { setVisible(true); return }
    const observer = new IntersectionObserver((entries) => {
      setVisible(entries.some((entry) => entry.isIntersecting))
    }, { root: scrollRoot, rootMargin: '900px 0px' })
    observer.observe(frameRef.current)
    return () => observer.disconnect()
  }, [eager, scrollRoot])

  useEffect(() => {
    let disposed = false
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
    let textLayer: TextLayer | undefined
    let textLayerPromise: Promise<unknown> | undefined
    if (!visible || !canvasRef.current || !textLayerRef.current) return
    async function render() {
      try {
        const page = await document.getPage(pageNumber)
        if (disposed || !canvasRef.current || !textLayerRef.current) return
        const viewport = page.getViewport({ scale })
        const canvas = canvasRef.current
        const textContainer = textLayerRef.current
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
        setSize({ width: viewport.width, height: viewport.height })
        canvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio))
        canvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio))
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        renderTask = page.render({ canvas, viewport, transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0] })
        textContainer.replaceChildren()
        textLayer = new TextLayer({ textContentSource: await page.getTextContent(), container: textContainer, viewport })
        textLayerPromise = textLayer.render()
        await Promise.all([renderTask.promise, textLayerPromise])
        if (!disposed) setFailed(false)
      } catch (reason) {
        if (!disposed && !(reason instanceof Error && reason.name === 'RenderingCancelledException')) setFailed(true)
      }
    }
    render()
    return () => {
      disposed = true
      renderTask?.promise.catch(() => {})
      textLayerPromise?.catch(() => {})
      renderTask?.cancel()
      textLayer?.cancel()
    }
  }, [document, pageNumber, scale, visible])

  function selectText() {
    const frame = frameRef.current
    const layer = textLayerRef.current
    const selected = window.getSelection()
    if (!frame || !layer || !selected || selected.isCollapsed || !selected.rangeCount ||
      !selected.anchorNode || !selected.focusNode || !layer.contains(selected.anchorNode) || !layer.contains(selected.focusNode)) return
    const range = selected.getRangeAt(0)
    const frameRect = frame.getBoundingClientRect()
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0).slice(0, 64).map((rect) => ({
      x: Math.max(0, (rect.left - frameRect.left) / frameRect.width),
      y: Math.max(0, (rect.top - frameRect.top) / frameRect.height),
      width: Math.min(1, rect.width / frameRect.width),
      height: Math.min(1, rect.height / frameRect.height)
    }))
    const text = selected.toString().trim().replace(/\s+/g, ' ')
    if (!rects.length || !text) return
    const visual = range.getBoundingClientRect()
    onSelection({
      locator: JSON.stringify({ type: 'pdf-range', page: pageNumber, rects } satisfies PdfHighlightLocator),
      text: text.slice(0, 500),
      x: Math.max(70, Math.min(window.innerWidth - 70, visual.left + visual.width / 2)),
      y: Math.max(68, visual.top - 8)
    })
  }

  return <div
    ref={frameRef}
    className="pdf-page-frame"
    data-pdf-page={pageNumber}
    style={{ width: size.width, height: size.height, '--total-scale-factor': scale } as CSSProperties}
    onMouseUp={selectText}
  >
    {visible && <canvas ref={canvasRef} aria-label={`第 ${pageNumber} 页`} />}
    {visible && <div className="pdf-highlight-layer" aria-hidden="true">{highlights.flatMap((annotation) => parsePdfHighlight(annotation.locator)?.rects ?? []).map((rect, index) => <i key={index} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }} />)}</div>}
    {visible && <div ref={textLayerRef} className="textLayer pdf-text-layer" />}
    {failed && <span className="pdf-page-error">第 {pageNumber} 页渲染失败</span>}
  </div>
}

const DEFAULT_PDF_STATE: Omit<PdfReadingState, 'bookId' | 'totalPages' | 'updatedAt'> = {
  page: 1,
  zoom: 1,
  zoomMode: 'fit-width',
  viewMode: 'continuous',
  scrollOffset: 0
}

export default function PDFReader({ bookRecord, theme, onThemeChange, onClose }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const documentRef = useRef<PDFDocumentProxy | null>(null)
  const stateRef = useRef<PdfReadingState | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const restoredRef = useRef(false)
  const preferencesReadyRef = useRef(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [pageSize, setPageSize] = useState<PageSize>({ width: 612, height: 792 })
  const [containerSize, setContainerSize] = useState({ width: 900, height: 700 })
  const [page, setPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [viewMode, setViewMode] = useState<PdfViewMode>('continuous')
  const [zoom, setZoom] = useState(1)
  const [zoomMode, setZoomMode] = useState<PdfZoomMode>('fit-width')
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [tocOpen, setTocOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [hitIndex, setHitIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selection, setSelection] = useState<{ locator: string; text: string; x: number; y: number } | null>(null)
  const annotationStore = useBookAnnotations(bookRecord.id)

  const totalPages = document?.numPages ?? 0
  const effectiveScale = useMemo(() => {
    if (zoomMode === 'custom') return zoom
    const horizontalPadding = 48
    const verticalPadding = 40
    const pageGap = viewMode === 'double' ? 18 : 0
    const availableWidth = Math.max(160, containerSize.width - horizontalPadding - pageGap)
    const widthScale = availableWidth / (pageSize.width * (viewMode === 'double' ? 2 : 1))
    if (zoomMode === 'fit-width') return Math.max(.1, widthScale)
    const heightScale = Math.max(.1, (containerSize.height - verticalPadding) / pageSize.height)
    return Math.max(.1, Math.min(widthScale, heightScale))
  }, [containerSize, pageSize, viewMode, zoom, zoomMode])

  function scheduleSave(next?: Partial<PdfReadingState>) {
    if (!stateRef.current) return
    stateRef.current = { ...stateRef.current, ...next, totalPages, updatedAt: Date.now() }
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => stateRef.current && window.roxy.savePdfReadingState(stateRef.current), 180)
  }

  useEffect(() => {
    let disposed = false
    let loadingTask: ReturnType<typeof getDocument> | null = null
    async function initialize() {
      try {
        const [buffer, saved] = await Promise.all([
          window.roxy.readBook(bookRecord.id),
          window.roxy.getPdfReadingState(bookRecord.id)
        ])
        if (disposed) return
        loadingTask = getDocument({ data: new Uint8Array(buffer) })
        const pdf = await loadingTask.promise
        if (disposed) { await loadingTask.destroy(); return }
        documentRef.current = pdf
        const firstPage = await pdf.getPage(1)
        const firstViewport = firstPage.getViewport({ scale: 1 })
        const current = saved ?? {
          ...DEFAULT_PDF_STATE, bookId: bookRecord.id, totalPages: pdf.numPages, updatedAt: Date.now()
        }
        const restoredPage = Math.min(pdf.numPages, Math.max(1, current.page))
        const preferred = loadPdfPreferences({ zoom: current.zoom, zoomMode: current.zoomMode, viewMode: current.viewMode })
        stateRef.current = { ...current, ...preferred, page: restoredPage, totalPages: pdf.numPages }
        setPage(restoredPage)
        setPageInput(String(restoredPage))
        setViewMode(preferred.viewMode)
        setZoom(preferred.zoom)
        setZoomMode(preferred.zoomMode)
        preferencesReadyRef.current = true
        setPageSize({ width: firstViewport.width, height: firstViewport.height })
        setDocument(pdf)
        const pdfOutline = await pdf.getOutline()
        if (!disposed) setOutline((pdfOutline ?? []) as OutlineItem[])
        await window.roxy.setLastOpened(bookRecord.id)
        if (!disposed) setLoading(false)
      } catch (reason) {
        if (!disposed) {
          setError(friendlyReaderError('pdf', reason))
          setLoading(false)
        }
      }
    }
    initialize()
    return () => {
      disposed = true
      clearTimeout(saveTimerRef.current)
      if (stateRef.current) window.roxy.savePdfReadingState(stateRef.current)
      documentRef.current = null
      if (loadingTask) loadingTask.destroy().catch(() => {})
    }
  }, [bookRecord.id])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(([entry]) => setContainerSize({
      width: entry.contentRect.width,
      height: entry.contentRect.height
    }))
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [document])

  useEffect(() => {
    if (!document || restoredRef.current || !viewportRef.current) return
    restoredRef.current = true
    const saved = stateRef.current
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (viewMode === 'continuous') {
        const target = viewportRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${page}"]`)
        if (target && viewportRef.current) viewportRef.current.scrollTop = target.offsetTop + (saved?.scrollOffset ?? 0)
      }
    }))
  }, [document, page, viewMode, effectiveScale])

  useEffect(() => {
    scheduleSave({ page, zoom, zoomMode, viewMode })
    if (preferencesReadyRef.current) savePdfPreferences({ zoom, zoomMode, viewMode })
  }, [page, zoom, zoomMode, viewMode])

  function jumpTo(targetPage: number, closeDrawer = false) {
    if (!document) return
    const next = Math.max(1, Math.min(document.numPages, Math.round(targetPage)))
    setPage(next)
    setPageInput(String(next))
    if (viewMode === 'continuous') {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const viewport = viewportRef.current
        const target = viewport?.querySelector<HTMLElement>(`[data-pdf-page="${next}"]`)
        if (viewport && target) viewport.scrollTop = target.offsetTop
      }))
    }
    scheduleSave({ page: next, scrollOffset: 0 })
    if (closeDrawer) setTocOpen(false)
  }

  function onScroll() {
    if (viewMode !== 'continuous' || !viewportRef.current) return
    const viewport = viewportRef.current
    const frames = Array.from(viewport.querySelectorAll<HTMLElement>('[data-pdf-page]'))
    let current = frames[0]
    let distance = Number.POSITIVE_INFINITY
    for (const frame of frames) {
      const value = Math.abs(frame.offsetTop - viewport.scrollTop - 16)
      if (value < distance) { current = frame; distance = value }
    }
    const nextPage = Number(current?.dataset.pdfPage ?? 1)
    if (nextPage !== page) { setPage(nextPage); setPageInput(String(nextPage)) }
    scheduleSave({ page: nextPage, scrollOffset: viewport.scrollTop - (current?.offsetTop ?? 0) })
    setSelection(null)
  }

  function changeZoom(delta: number) {
    setZoomMode('custom')
    setZoom((current) => Math.max(.25, Math.min(4, Math.round((current + delta) * 10) / 10)))
  }

  async function outlinePage(item: OutlineItem): Promise<number | null> {
    if (!document || !item.dest) return null
    try {
      const destination = typeof item.dest === 'string' ? await document.getDestination(item.dest) : item.dest
      if (!destination?.length) return null
      const reference = destination[0]
      if (typeof reference === 'number') return reference + 1
      return (await document.getPageIndex(reference as Parameters<PDFDocumentProxy['getPageIndex']>[0])) + 1
    } catch { return null }
  }

  function renderOutline(items: OutlineItem[]) {
    return items.map((item, index) => <li key={`${item.title}-${index}`}>
      <button onClick={async () => { const target = await outlinePage(item); if (target) jumpTo(target, true) }}>{item.title || '未命名章节'}</button>
      {item.items?.length ? <ul>{renderOutline(item.items)}</ul> : null}
    </li>)
  }

  async function searchPdf() {
    const term = query.trim().toLocaleLowerCase()
    if (!document || !term || searching) return
    setSearching(true)
    setHits([])
    setHitIndex(0)
    const found: SearchHit[] = []
    try {
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const pdfPage = await document.getPage(pageNumber)
        const content = await pdfPage.getTextContent()
        const text = content.items.map((item) => 'str' in item ? item.str : '').join(' ').toLocaleLowerCase()
        let count = 0
        let offset = 0
        while ((offset = text.indexOf(term, offset)) >= 0) { count += 1; offset += term.length }
        if (count) found.push({ page: pageNumber, count })
        if (pageNumber % 8 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      setHits(found)
      if (found.length) jumpTo(found[0].page)
    } finally { setSearching(false) }
  }

  function moveSearch(direction: 1 | -1) {
    if (!hits.length) return
    const next = (hitIndex + direction + hits.length) % hits.length
    setHitIndex(next)
    jumpTo(hits[next].page)
  }

  async function addBookmark() {
    if (page > 0) await annotationStore.add('bookmark', `pdf:${page}`, `第 ${page} 页`)
  }

  async function jumpAnnotation(annotation: BookAnnotation) {
    const highlight = parsePdfHighlight(annotation.locator)
    const target = highlight?.page ?? Number(annotation.locator.match(/^pdf:(\d+)$/)?.[1])
    if (Number.isFinite(target)) jumpTo(target)
  }

  async function addSelectionHighlight() {
    if (!selection) return
    await annotationStore.add('highlight', selection.locator, selection.text)
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  const highlightsByPage = useMemo(() => {
    const grouped = new Map<number, BookAnnotation[]>()
    for (const annotation of annotationStore.annotations) {
      if (annotation.kind !== 'highlight') continue
      const locator = parsePdfHighlight(annotation.locator)
      if (!locator) continue
      grouped.set(locator.page, [...(grouped.get(locator.page) ?? []), annotation])
    }
    return grouped
  }, [annotationStore.annotations])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey && event.key.toLowerCase() === 'f') {
        event.preventDefault(); setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 0); return
      }
      if (event.key === 'Escape') {
        if (searchOpen) { setSearchOpen(false); return }
        if (tocOpen) { setTocOpen(false); return }
        if (globalThis.document.fullscreenElement) globalThis.document.exitFullscreen().catch(() => {})
      }
      if (event.key === 'F11') { event.preventDefault(); globalThis.document.documentElement.requestFullscreen().catch(() => {}) }
      if (['ArrowRight', 'PageDown'].includes(event.key) && viewMode !== 'continuous') { event.preventDefault(); jumpTo(page + (viewMode === 'double' ? 2 : 1)) }
      if (['ArrowLeft', 'PageUp'].includes(event.key) && viewMode !== 'continuous') { event.preventDefault(); jumpTo(page - (viewMode === 'double' ? 2 : 1)) }
      if (event.key === 'Home') { event.preventDefault(); jumpTo(1) }
      if (event.key === 'End' && documentRef.current) { event.preventDefault(); jumpTo(documentRef.current.numPages) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [page, viewMode, tocOpen, searchOpen, document])

  const displayedPages = viewMode === 'continuous'
    ? Array.from({ length: totalPages }, (_, index) => index + 1)
    : viewMode === 'double' ? [page, page + 1].filter((item) => item <= totalPages) : [page]
  const progress = totalPages ? page / totalPages : 0

  return <main className="reader-shell pdf-reader-shell">
    <header className="reader-bar pdf-reader-bar">
      <button className="icon-button" onClick={onClose} aria-label="返回书架"><ArrowLeft size={19} /></button>
      <div className="reader-title"><strong>{bookRecord.title}</strong><ReadingSessionStatus bookId={bookRecord.id} progress={progress} /></div>
      <div className="reader-controls">
        <button className="icon-button" onClick={() => setTocOpen(true)} aria-label="PDF 目录"><BookOpenText size={19} /></button>
        <AnnotationPanel annotations={annotationStore.annotations} onAddBookmark={addBookmark} onJump={jumpAnnotation} onRemove={(annotation) => annotationStore.remove(annotation.id)} />
        <button className="icon-button" onClick={() => { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 0) }} aria-label="搜索 PDF"><Search size={18} /></button>
        <label className="compact-control">显示<select value={viewMode} onChange={(event) => setViewMode(event.target.value as PdfViewMode)}>
          <option value="continuous">连续</option><option value="single">单页</option><option value="double">双页</option>
        </select></label>
        <label className="compact-control">缩放<select value={zoomMode} onChange={(event) => setZoomMode(event.target.value as PdfZoomMode)}>
          <option value="fit-width">适应宽度</option><option value="fit-page">适应页面</option><option value="custom">自定义</option>
        </select></label>
        <div className="setting-group" title="页面缩放">
          <button onClick={() => changeZoom(-.1)} aria-label="缩小"><Minus size={14} /></button>
          <span>{Math.round(effectiveScale * 100)}%</span>
          <button onClick={() => changeZoom(.1)} aria-label="放大"><Plus size={14} /></button>
        </div>
        <form className="pdf-page-jump" onSubmit={(event) => { event.preventDefault(); jumpTo(Number(pageInput)) }}>
          <input aria-label="页码" inputMode="numeric" value={pageInput} onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ''))} />
          <span>/ {totalPages || '—'}</span>
        </form>
        <button className="icon-button" onClick={onThemeChange} aria-label="切换主题">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
      </div>
    </header>
    <section className="pdf-stage">
      {document && viewMode !== 'continuous' && <button className="page-hit left" onClick={() => jumpTo(page - (viewMode === 'double' ? 2 : 1))} aria-label="上一页"><ChevronLeft /></button>}
      <div ref={viewportRef} className={`pdf-viewport mode-${viewMode}`} onScroll={onScroll}>
        {document && <div className="pdf-pages">
          {displayedPages.map((pageNumber) => <PdfPage key={pageNumber} document={document} pageNumber={pageNumber} scale={effectiveScale} fallbackSize={pageSize} scrollRoot={viewportRef.current} highlights={highlightsByPage.get(pageNumber) ?? []} onSelection={setSelection} eager={viewMode !== 'continuous' || pageNumber === page} />)}
        </div>}
      </div>
      {document && viewMode !== 'continuous' && <button className="page-hit right" onClick={() => jumpTo(page + (viewMode === 'double' ? 2 : 1))} aria-label="下一页"><ChevronRight /></button>}
      {loading && <div className="reader-message">正在打开 PDF…</div>}
      {error && <div className="reader-message error"><strong>无法打开 PDF</strong><span>{error}</span></div>}
      {searchOpen && <form className="pdf-search-bar" onSubmit={(event) => { event.preventDefault(); searchPdf() }}>
        <Search size={16} />
        <input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文本型 PDF" aria-label="PDF 搜索词" />
        <span>{searching ? '搜索中…' : hits.length ? `${hitIndex + 1} / ${hits.length} 页` : query ? '无结果' : ''}</span>
        <button type="button" onClick={() => moveSearch(-1)} disabled={!hits.length} aria-label="上一个结果"><ChevronLeft size={16} /></button>
        <button type="button" onClick={() => moveSearch(1)} disabled={!hits.length} aria-label="下一个结果"><ChevronRight size={16} /></button>
        <button type="button" onClick={() => setSearchOpen(false)} aria-label="关闭搜索"><X size={16} /></button>
      </form>}
      {selection && <SelectionHighlightAction x={selection.x} y={selection.y} onAdd={addSelectionHighlight} />}
    </section>
    <div className="progress-track"><i style={{ width: `${progress * 100}%` }} /></div>
    {tocOpen && <div className="drawer-backdrop" onMouseDown={() => setTocOpen(false)}><aside className="toc-drawer" onMouseDown={(event) => event.stopPropagation()}>
      <div className="drawer-head"><strong>PDF 目录</strong><button className="icon-button" onClick={() => setTocOpen(false)}><X size={18} /></button></div>
      {outline.length ? <ol className="toc-list">{renderOutline(outline)}</ol> : <p className="muted">此 PDF 没有内置目录</p>}
    </aside></div>}
  </main>
}
