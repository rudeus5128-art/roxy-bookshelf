import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, BookOpenText, ChevronLeft, ChevronRight, Minus, Moon, Plus, Search, Sun, X } from 'lucide-react'
import { ePub, installArchiveImageFallback } from './epub'
import type { BookAnnotation, BookRecord, ReadingState } from '../../shared/models'
import ReadingSettings, { DEFAULT_READING_SETTINGS, fontFamilies, type TextReadingSettings } from './ReadingSettings'
import ReadingSessionStatus from './ReadingSessionStatus'
import { AnnotationPanel, SelectionHighlightAction, useBookAnnotations } from './AnnotationsPanel'
import { loadTextPreferences, saveTextPreferences } from './readerPreferences'
import { friendlyReaderError } from './readerErrors'
import { useI18n } from './I18nContext'

interface TocItem { label: string; href: string; subitems?: TocItem[] }
interface SearchResult { cfi: string; excerpt: string; chapter: string }
interface ReaderProps { bookRecord: BookRecord; theme: 'light' | 'dark'; onThemeChange(): void; onClose(): void }
interface ImagePreview { src: string; alt: string; zoom: number; offsetX: number; offsetY: number }

const EPUB_OPEN_TIMEOUT_MS = 12_000
const MINIMUM_DOUBLE_PAGE_WIDTH = 1_220

function shouldShowDoublePage(settings: TextReadingSettings, availableWidth: number): boolean {
  if (settings.readingMode !== 'paginated' || settings.pageLayout !== 'double') return false
  const breakpoint = Math.max(MINIMUM_DOUBLE_PAGE_WIDTH, Math.min(1_500, settings.contentWidth + 500))
  return availableWidth >= breakpoint
}

function withTimeout<T>(operation: Promise<T>, milliseconds = EPUB_OPEN_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    let elapsedVisible = 0
    let lastTick = performance.now()
    let finished = false
    const timer = window.setInterval(() => {
      const now = performance.now()
      if (document.visibilityState === 'visible') elapsedVisible += Math.min(500, Math.max(0, now - lastTick))
      lastTick = now
      if (elapsedVisible < milliseconds || finished) return
      finished = true; clearInterval(timer); reject(new Error('EPUB open timed out'))
    }, 250)
    operation.then((value) => {
      if (finished) return
      finished = true; clearInterval(timer); resolve(value)
    }, (error) => {
      if (finished) return
      finished = true; clearInterval(timer); reject(error)
    })
  })
}

export default function Reader({ bookRecord, theme, onThemeChange, onClose }: ReaderProps) {
  const { language, t } = useI18n()
  const stageRef = useRef<HTMLElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<{ book: any; rendition: any } | null>(null)
  const wheelTimeRef = useRef(0)
  const stateRef = useRef<ReadingState | null>(null)
  const settingsRef = useRef<TextReadingSettings>(DEFAULT_READING_SETTINGS)
  const spreadRef = useRef<boolean | null>(null)
  const layoutRevisionRef = useRef(0)
  const highlightsRevisionRef = useRef(0)
  const highlightReanchorRevisionRef = useRef(0)
  const highlightLayoutTimerRef = useRef<number | null>(null)
  const imageDragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const themeRef = useRef(theme)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [settings, setSettings] = useState(DEFAULT_READING_SETTINGS)
  const [availableWidth, setAvailableWidth] = useState(() => window.innerWidth)
  const [toc, setToc] = useState<TocItem[]>([])
  const [tocOpen, setTocOpen] = useState(false)
  const [progress, setProgress] = useState(bookRecord.progress || 0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [resultIndex, setResultIndex] = useState(0)
  const [selection, setSelection] = useState<{ cfiRange: string; text: string; x: number; y: number } | null>(null)
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null)
  const annotationStore = useBookAnnotations(bookRecord.id)
  const appliedHighlightsRef = useRef(new Set<string>())
  const useDoublePage = shouldShowDoublePage(settings, availableWidth)

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(Math.round(entry.contentRect.width)))
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  function applyStyles(rendition = engineRef.current?.rendition) {
    if (!rendition) return
    const current = settingsRef.current
    const dark = themeRef.current === 'dark'
    const background = dark ? '#17191e' : '#ffffff'
    const foreground = dark ? '#dfe3eb' : '#20242c'
    rendition.themes.fontSize(`${current.fontSize}px`)
    rendition.themes.override('line-height', String(current.lineHeight))
    rendition.themes.override('font-family', fontFamilies[current.fontFamily] ?? fontFamilies.system)
    rendition.themes.override('color', foreground, true)
    rendition.themes.override('background-color', background, true)
    for (const contents of rendition.getContents?.() ?? []) {
      contents.addStylesheetRules?.({
        'html, body': { color: `${foreground} !important`, background: `${background} !important` },
        'body *': { 'background-color': 'transparent !important' },
        body: { padding: `0 ${current.pageMargin}px !important` },
        p: { margin: `0 0 ${current.paragraphSpacing}em !important` },
        'img, image': { cursor: 'zoom-in !important' }
      })
      const contentDocument = contents.document as Document | undefined
      contentDocument?.documentElement.style.setProperty('background-color', background, 'important')
      contentDocument?.body?.style.setProperty('background-color', background, 'important')
      contentDocument?.body?.style.setProperty('color', foreground, 'important')
      const frame = contentDocument?.defaultView?.frameElement as HTMLElement | null | undefined
      frame?.style.setProperty('background-color', background)
    }
  }

  function installImageViewer(rendition = engineRef.current?.rendition) {
    if (!rendition) return
    for (const contents of rendition.getContents?.() ?? []) {
      const contentDocument = contents.document as Document | undefined
      const contentWindow = contentDocument?.defaultView
      if (!contentDocument || !contentWindow || contentDocument.documentElement.dataset.roxyImageViewer === 'true') continue
      contentDocument.documentElement.dataset.roxyImageViewer = 'true'
      contentDocument.addEventListener('click', (event) => {
        const target = event.target
        if (!(target instanceof contentWindow.Element)) return
        const image = target.closest('img, image')
        if (!image) return
        const source = image.localName.toLowerCase() === 'img'
          ? ((image as HTMLImageElement).currentSrc || (image as HTMLImageElement).src || image.getAttribute('src'))
          : (image.getAttribute('href') || image.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || image.getAttribute('xlink:href'))
        if (!source) return
        event.preventDefault()
        event.stopPropagation()
        setSelection(null)
        setImagePreview({ src: source, alt: image.getAttribute('alt') || image.getAttribute('aria-label') || t('epubIllustration'), zoom: 1, offsetX: 0, offsetY: 0 })
      }, true)
    }
  }

  function syncHighlights(rendition = engineRef.current?.rendition) {
    if (!rendition) return
    const current = new Map(annotationStore.annotations.filter((item) => item.kind === 'highlight').map((item) => [item.locator, item]))
    for (const locator of appliedHighlightsRef.current) {
      if (!current.has(locator)) { try { rendition.annotations.remove(locator, 'highlight') } catch {} }
    }
    for (const [locator, annotation] of current) {
      if (!appliedHighlightsRef.current.has(locator)) {
        try { rendition.annotations.highlight(locator, {}, () => { annotationStore.remove(annotation.id).catch(() => {}) }, 'roxy-highlight', { fill: '#1769ff', 'fill-opacity': '0.28' }) } catch {}
      }
    }
    appliedHighlightsRef.current = new Set(current.keys())
  }

  function scheduleHighlightReanchor(rendition: any, layoutRevision: number, delay = 100) {
    const reanchorRevision = ++highlightReanchorRevisionRef.current
    const annotationsRevision = highlightsRevisionRef.current
    if (highlightLayoutTimerRef.current !== null) window.clearTimeout(highlightLayoutTimerRef.current)
    highlightLayoutTimerRef.current = window.setTimeout(() => {
      if (reanchorRevision !== highlightReanchorRevisionRef.current || layoutRevision !== layoutRevisionRef.current || annotationsRevision !== highlightsRevisionRef.current) return
      for (const locator of appliedHighlightsRef.current) {
        try { rendition.annotations.remove(locator, 'highlight') } catch {}
      }
      appliedHighlightsRef.current.clear()
      syncHighlights(rendition)
    }, delay)
  }

  function refreshPageLayout(rendition: any, revision: number, restoreLocation = false, location = stateRef.current?.location) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (revision !== layoutRevisionRef.current) return
      const viewport = viewportRef.current
      rendition.resize?.(viewport?.clientWidth, viewport?.clientHeight)
      if (restoreLocation) rendition.display(location || undefined).catch(() => {})
      scheduleHighlightReanchor(rendition, revision, restoreLocation ? 240 : 100)
    }))
  }

  useEffect(() => {
    let disposed = false
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    async function initialize() {
      try {
        const [buffer, saved] = await Promise.all([window.roxy.readBook(bookRecord.id), window.roxy.getReadingState(bookRecord.id)])
        if (disposed || !viewportRef.current) return
        const book = ePub(buffer)
        installArchiveImageFallback(book)
        await withTimeout(book.ready)
        const navigation = await book.loaded.navigation.catch(() => null)
        if (disposed || !viewportRef.current) { book.destroy(); return }
        const current: ReadingState = {
          bookId: bookRecord.id, location: null, progress: 0, ...DEFAULT_READING_SETTINGS,
          updatedAt: Date.now(), ...saved
        }
        const preferred = loadTextPreferences('epub', {
          fontSize: current.fontSize, lineHeight: current.lineHeight, contentWidth: current.contentWidth,
          fontFamily: current.fontFamily, paragraphSpacing: current.paragraphSpacing,
          pageMargin: current.pageMargin, readingMode: current.readingMode, pageLayout: current.pageLayout
        })
        Object.assign(current, preferred)
        stateRef.current = current
        const currentSettings = {
          fontSize: current.fontSize, lineHeight: current.lineHeight, contentWidth: current.contentWidth,
          fontFamily: current.fontFamily, paragraphSpacing: current.paragraphSpacing,
          pageMargin: current.pageMargin, readingMode: current.readingMode, pageLayout: current.pageLayout
        }
        settingsRef.current = currentSettings; setSettings(currentSettings); setProgress(current.progress)
        const continuous = current.readingMode === 'continuous'
        const initialSpread = shouldShowDoublePage(currentSettings, window.innerWidth)
        const rendition = book.renderTo(viewportRef.current, {
          width: '100%', height: '100%', flow: continuous ? 'scrolled-doc' : 'paginated',
          manager: continuous ? 'continuous' : 'default', spread: initialSpread ? 'always' : 'none'
        })
        spreadRef.current = initialSpread
        engineRef.current = { book, rendition }
        rendition.themes.register('roxy-light', { body: { color: '#20242c', background: '#ffffff' }, a: { color: '#1769ff' } })
        rendition.themes.register('roxy-dark', { body: { color: '#dfe3eb', background: '#17191e' }, a: { color: '#5590ff' } })
        rendition.themes.select(theme === 'dark' ? 'roxy-dark' : 'roxy-light')
        rendition.on('rendered', () => { applyStyles(rendition); installImageViewer(rendition) })
        rendition.on('selected', (cfiRange: string, contents: any) => {
          const selected = String(contents?.window?.getSelection?.()?.toString() ?? '').trim().replace(/\s+/g, ' ')
          if (!selected) return
          try {
            const range = contents.window.getSelection().getRangeAt(0)
            const rect = range.getBoundingClientRect()
            const frameRect = contents.document.defaultView.frameElement.getBoundingClientRect()
            setSelection({ cfiRange, text: selected.slice(0, 500), x: Math.min(window.innerWidth - 90, frameRect.left + rect.left + rect.width / 2), y: Math.max(68, frameRect.top + rect.top - 8) })
          } catch { setSelection({ cfiRange, text: selected.slice(0, 500), x: window.innerWidth / 2, y: 80 }) }
        })
        applyStyles(rendition)
        await withTimeout(rendition.display(current.location || undefined))
        if (disposed) return
        setToc(navigation?.toc || [])
        let locationsReady = false
        const updateLocation = (location: any) => {
          const cfi = location?.start?.cfi ?? null
          const spineItems = book.spine?.spineItems ?? []
          const spineItem = (location?.start?.href ? book.spine.get(location.start.href) : null) ??
            (cfi ? book.spine.get(cfi) : null)
          const cfiBase = cfi?.match(/^epubcfi\(\/\d+\/(\d+)/)
          const cfiSpineIndex = cfiBase ? Math.max(0, Math.floor(Number(cfiBase[1]) / 2) - 1) : 0
          let spineIndex = Number(spineItem?.index ?? location?.start?.index ?? 0)
          if (spineIndex <= 0 && cfiSpineIndex > 0) spineIndex = cfiSpineIndex
          const displayedPage = Number(location?.start?.displayed?.page ?? 1)
          const displayedTotal = Math.max(1, Number(location?.start?.displayed?.total ?? 1))
          const spinePercentage = spineItems.length
            ? (spineIndex + Math.max(0, displayedPage - 1) / displayedTotal) / spineItems.length
            : 0
          let rawPercentage = spinePercentage
          try {
            const generatedLocationCount = Number(book.locations.total ?? 0)
            if (cfi && locationsReady && generatedLocationCount >= spineItems.length) {
              const generatedPercentage = book.locations.percentageFromCfi(cfi)
              if (Number.isFinite(generatedPercentage)) rawPercentage = generatedPercentage
            }
          } catch {}
          if (location?.atEnd && (!spineItems.length || spineIndex >= spineItems.length - 1)) rawPercentage = 1
          const percentage = Math.max(0, Math.min(1, rawPercentage))
          setProgress(percentage)
          if (stateRef.current) {
            stateRef.current = { ...stateRef.current, location: cfi, progress: percentage, updatedAt: Date.now() }
            clearTimeout(saveTimer)
            saveTimer = setTimeout(() => stateRef.current && window.roxy.saveReadingState(stateRef.current), 200)
          }
        }
        rendition.on('relocated', updateLocation)
        if (!disposed) {
          book.locations.generate(1200).then(() => {
            locationsReady = true
            if (!disposed) updateLocation(rendition.currentLocation())
          }).catch(() => {})
        }
        await window.roxy.setLastOpened(bookRecord.id)
        if (!disposed) setLoading(false)
      } catch (reason) {
        engineRef.current?.book.destroy(); engineRef.current = null
        if (!disposed) { setError(friendlyReaderError('epub', reason, language)); setLoading(false) }
      }
    }
    initialize()
    return () => {
      disposed = true; clearTimeout(saveTimer)
      if (stateRef.current) window.roxy.saveReadingState(stateRef.current)
      engineRef.current?.book.destroy(); engineRef.current = null
    }
  }, [bookRecord.id])

  useEffect(() => {
    themeRef.current = theme
    const rendition = engineRef.current?.rendition
    if (rendition) {
      rendition.themes.select(theme === 'dark' ? 'roxy-dark' : 'roxy-light')
      applyStyles(rendition)
    }
  }, [theme, loading])

  useEffect(() => {
    const rendition = engineRef.current?.rendition
    if (!rendition) return
    const revision = ++layoutRevisionRef.current
    const spreadChanged = spreadRef.current !== useDoublePage
    if (spreadChanged) {
      spreadRef.current = useDoublePage
      rendition.spread(useDoublePage ? 'always' : 'none')
    }
    const timer = window.setTimeout(() => refreshPageLayout(rendition, revision, spreadChanged), 160)
    return () => window.clearTimeout(timer)
  }, [availableWidth, useDoublePage])

  useEffect(() => {
    const rendition = engineRef.current?.rendition
    if (!rendition) return
    highlightsRevisionRef.current += 1
    syncHighlights(rendition)
  }, [annotationStore.annotations, loading])

  useEffect(() => () => {
    if (highlightLayoutTimerRef.current !== null) window.clearTimeout(highlightLayoutTimerRef.current)
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey && event.key.toLowerCase() === 'f') { event.preventDefault(); setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 0); return }
      if (event.key === 'Escape') {
      if (searchOpen) { setSearchOpen(false); return }
      if (tocOpen) { setTocOpen(false); return }
      if (imagePreview) { setImagePreview(null); return }
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
      }
      if (['ArrowLeft', 'PageUp'].includes(event.key)) { event.preventDefault(); engineRef.current?.rendition.prev() }
      if (['ArrowRight', 'PageDown'].includes(event.key)) { event.preventDefault(); engineRef.current?.rendition.next() }
      if (event.key === 'Home') { event.preventDefault(); engineRef.current?.rendition.display(0) }
      if (event.key === 'End') { event.preventDefault(); engineRef.current?.rendition.display(engineRef.current?.book.spine.last().href) }
      if (event.key === 'F11') { event.preventDefault(); document.documentElement.requestFullscreen().catch(() => {}) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [tocOpen, searchOpen, imagePreview])

  function updateSetting<K extends keyof TextReadingSettings>(key: K, value: TextReadingSettings[K]) {
    const next = { ...settingsRef.current, [key]: value }
    settingsRef.current = next; setSettings(next)
    saveTextPreferences('epub', next)
    if (stateRef.current) { stateRef.current = { ...stateRef.current, ...next, updatedAt: Date.now() }; window.roxy.saveReadingState(stateRef.current) }
    if (key === 'readingMode') engineRef.current?.rendition.flow(value === 'continuous' ? 'scrolled-doc' : 'paginated')
    if (key === 'readingMode' || key === 'pageLayout' || key === 'contentWidth') {
      const rendition = engineRef.current?.rendition
      const revision = ++layoutRevisionRef.current
      const nextSpread = shouldShowDoublePage(next, availableWidth)
      spreadRef.current = nextSpread
      rendition?.spread(nextSpread ? 'always' : 'none')
      if (rendition) refreshPageLayout(rendition, revision, true)
    }
    applyStyles()
  }

  async function searchBook() {
    const term = query.trim()
    const book = engineRef.current?.book
    if (!book || !term || searching) return
    setSearching(true); setResults([]); setResultIndex(0)
    const found: SearchResult[] = []
    try {
      const spineItems = book.spine?.spineItems ?? []
      for (let index = 0; index < spineItems.length && found.length < 200; index += 1) {
        const item = spineItems[index]
        await item.load(book.load.bind(book))
        const matches = item.find(term) ?? []
        for (const match of matches) found.push({ cfi: match.cfi, excerpt: String(match.excerpt ?? term), chapter: item.href })
        item.unload?.()
        if (index % 4 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      setResults(found)
      if (found[0]) engineRef.current?.rendition.display(found[0].cfi)
    } finally { setSearching(false) }
  }

  function moveResult(direction: 1 | -1) {
    if (!results.length) return
    const next = (resultIndex + direction + results.length) % results.length
    setResultIndex(next); engineRef.current?.rendition.display(results[next].cfi)
  }

  function renderToc(items: TocItem[]) {
    return items.map((item) => <li key={item.href}><button onClick={() => { engineRef.current?.rendition.display(item.href); setTocOpen(false) }}>{item.label.trim()}</button>{item.subitems?.length ? <ul>{renderToc(item.subitems)}</ul> : null}</li>)
  }

  function onWheel(event: React.WheelEvent) {
    if (settings.readingMode === 'continuous') return
    const now = Date.now()
    if (Math.abs(event.deltaY) < 12 || now - wheelTimeRef.current < 280) return
    wheelTimeRef.current = now
    if (event.deltaY > 0) engineRef.current?.rendition.next(); else engineRef.current?.rendition.prev()
  }

  async function addBookmark() {
    const locator = stateRef.current?.location
    if (locator) await annotationStore.add('bookmark', locator, t('readingProgress', { percent: Math.round(progress * 100) }))
  }

  async function jumpAnnotation(annotation: BookAnnotation) {
    await engineRef.current?.rendition.display(annotation.locator)
  }

  async function removeAnnotation(annotation: BookAnnotation) {
    if (annotation.kind === 'highlight') {
      highlightsRevisionRef.current += 1
      try { engineRef.current?.rendition.annotations.remove(annotation.locator, 'highlight') } catch {}
      appliedHighlightsRef.current.delete(annotation.locator)
    }
    await annotationStore.remove(annotation.id)
  }

  async function addSelectionHighlight() {
    if (!selection) return
    await annotationStore.add('highlight', selection.cfiRange, selection.text)
    for (const contents of engineRef.current?.rendition.getContents?.() ?? []) contents.window?.getSelection?.()?.removeAllRanges?.()
    setSelection(null)
  }

  function updateImageZoom(change: number | 'reset') {
    setImagePreview((current) => {
      if (!current) return null
      return change === 'reset'
        ? { ...current, zoom: 1, offsetX: 0, offsetY: 0 }
        : { ...current, zoom: Math.max(.5, Math.min(4, Number((current.zoom + change).toFixed(2)))) }
    })
  }

  function onImageWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault()
    setImagePreview((current) => {
      if (!current) return null
      const factor = Math.exp(-event.deltaY * .0015)
      return { ...current, zoom: Math.max(.5, Math.min(4, Number((current.zoom * factor).toFixed(3)))) }
    })
  }

  function onImagePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    imageDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
  }

  function onImagePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = imageDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const x = event.clientX; const y = event.clientY
    imageDragRef.current = { ...drag, x, y }
    setImagePreview((current) => current ? { ...current, offsetX: current.offsetX + x - drag.x, offsetY: current.offsetY + y - drag.y } : null)
  }

  function onImagePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (imageDragRef.current?.pointerId !== event.pointerId) return
    imageDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return <main className="reader-shell">
    <header className="reader-bar"><button className="icon-button" onClick={onClose} aria-label={t('backToLibrary')}><ArrowLeft size={19} /></button><div className="reader-title"><strong>{bookRecord.title}</strong><ReadingSessionStatus bookId={bookRecord.id} progress={progress} /></div><div className="reader-controls"><button className="icon-button" onClick={() => setTocOpen(true)} aria-label={t('contents')}><BookOpenText size={19} /></button><AnnotationPanel annotations={annotationStore.annotations} onAddBookmark={addBookmark} onJump={jumpAnnotation} onRemove={removeAnnotation} /><button className="icon-button" onClick={() => { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 0) }} aria-label={t('searchEpub')}><Search size={18} /></button><div className="setting-group" title={t('fontSize')}><button onClick={() => updateSetting('fontSize', Math.max(12, settings.fontSize - 1))}><Minus size={14} /></button><span>{settings.fontSize}</span><button onClick={() => updateSetting('fontSize', Math.min(36, settings.fontSize + 1))}><Plus size={14} /></button></div><ReadingSettings settings={settings} onChange={updateSetting} /><button className="icon-button" onClick={onThemeChange} aria-label={t('toggleTheme')}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button></div></header>
    <section ref={stageRef} className="reading-stage" onWheel={onWheel}>{settings.readingMode === 'paginated' && <button className="page-hit left" onClick={() => engineRef.current?.rendition.prev()} aria-label={t('previousPage')}><ChevronLeft /></button>}<div className="epub-wrap" style={{ maxWidth: useDoublePage ? settings.contentWidth * 2 + 120 : settings.contentWidth + 120 }}><div ref={viewportRef} className="epub-viewport" /></div>{settings.readingMode === 'paginated' && <button className="page-hit right" onClick={() => engineRef.current?.rendition.next()} aria-label={t('nextPage')}><ChevronRight /></button>}{loading && <div className="reader-message">{t('opening')}</div>}{error && <div className="reader-message error"><strong>{t('cannotOpenEpub')}</strong><span>{error}</span></div>}{searchOpen && <form className="pdf-search-bar" onSubmit={(event) => { event.preventDefault(); searchBook() }}><Search size={16} /><input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchEpubBody')} /><span>{searching ? t('searching') : results.length ? `${resultIndex + 1} / ${results.length}` : query ? t('noResults') : ''}</span><button type="button" onClick={() => moveResult(-1)} disabled={!results.length} aria-label={t('previousResult')}><ChevronLeft size={16} /></button><button type="button" onClick={() => moveResult(1)} disabled={!results.length} aria-label={t('nextResult')}><ChevronRight size={16} /></button><button type="button" onClick={() => setSearchOpen(false)} aria-label={t('closeSearch')}><X size={16} /></button></form>}</section>
    <div className="progress-track"><i style={{ width: `${progress * 100}%` }} /></div>
    {tocOpen && <div className="drawer-backdrop" onMouseDown={() => setTocOpen(false)}><aside className="toc-drawer" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><strong>{t('contents')}</strong><button className="icon-button" onClick={() => setTocOpen(false)} aria-label={t('close')}><X size={18} /></button></div>{toc.length ? <ol className="toc-list">{renderToc(toc)}</ol> : <p className="muted">{t('noContents')}</p>}</aside></div>}
    {imagePreview && <div className="image-preview-backdrop" role="presentation" onMouseDown={() => setImagePreview(null)}><div className="image-preview" role="dialog" aria-modal="true" aria-label={t('viewIllustration')} onMouseDown={(event) => event.stopPropagation()}><div className="image-preview-toolbar"><button className="icon-button" onClick={() => updateImageZoom(-.25)} aria-label={t('zoomOutIllustration')} disabled={imagePreview.zoom <= .5}><Minus size={18} /></button><button className="image-preview-zoom" onClick={() => updateImageZoom('reset')} aria-label={t('fitWindow')}>{Math.round(imagePreview.zoom * 100)}%</button><button className="icon-button" onClick={() => updateImageZoom(.25)} aria-label={t('zoomInIllustration')} disabled={imagePreview.zoom >= 4}><Plus size={18} /></button><button className="icon-button image-preview-close" onClick={() => setImagePreview(null)} aria-label={t('closeIllustration')}><X size={20} /></button></div><div className="image-preview-stage" onWheel={onImageWheel} onPointerDown={onImagePointerDown} onPointerMove={onImagePointerMove} onPointerUp={onImagePointerEnd} onPointerCancel={onImagePointerEnd}><img src={imagePreview.src} alt={imagePreview.alt} style={{ transform: `translate(${imagePreview.offsetX}px, ${imagePreview.offsetY}px) scale(${imagePreview.zoom})` }} /></div></div></div>}
    {selection && <SelectionHighlightAction x={selection.x} y={selection.y} onAdd={addSelectionHighlight} />}
  </main>
}
