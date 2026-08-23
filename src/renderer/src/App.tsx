// tai and codex
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3, BookOpen, CheckCircle2, Download, Ellipsis, FolderInput, FolderOpen, FolderPlus, Image,
  LayoutGrid, Library, List, Moon, Pencil, Plus, Search, Settings, Sun, Trash2, X
} from 'lucide-react'
import type { AppSettings, BookRecord, CustomShelf } from '../../shared/models'
import { localizeError, type TranslationKey } from '../../shared/i18n'
import { readEpubMetadata } from './epub'
import Reader from './Reader'
import TextReader from './TextReader'
import PDFReader from './PDFReader'
import StatisticsView from './StatisticsView'
import { recentlyOpenedSort, smartBookSort } from './shelfSort'
import { useI18n } from './I18nContext'

type Theme = 'light' | 'dark'
type ShelfFilter = 'all' | 'recent' | 'unread' | 'reading' | 'finished'
type ShelfView = 'grid' | 'list'
type ShelfDragKind = 'files' | 'books' | null
type ImportDetail = { title: string; size: number }
type ShelfNotice = { message: string; importDetails?: ImportDetail[] }
const appIconUrl = new URL('../../../build/roxy-app-icon-character-v9-large.png', import.meta.url).href

const filters: Array<{ value: ShelfFilter; labelKey: TranslationKey }> = [
  { value: 'all', labelKey: 'filterAll' }, { value: 'recent', labelKey: 'filterRecent' },
  { value: 'unread', labelKey: 'filterUnread' }, { value: 'reading', labelKey: 'filterReading' },
  { value: 'finished', labelKey: 'filterFinished' }
]

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('roxy-theme')
    if (stored === 'light' || stored === 'dark') return stored
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('roxy-theme', theme)
  }, [theme])
  return [theme, () => setTheme((current) => current === 'dark' ? 'light' : 'dark')]
}

function DefaultCover({ title }: { title: string }) {
  return <div className="default-cover"><BookOpen size={30} /><span>{title.slice(0, 18)}</span><small>ROXY</small></div>
}

function BookCover({ book, pdfCoversEnabled, shelfDots }: { book: BookRecord; pdfCoversEnabled: boolean; shelfDots: CustomShelf[] }) {
  const { t } = useI18n()
  const showCover = Boolean(book.coverUrl) && (book.format !== 'pdf' || pdfCoversEnabled)
  return <div className="cover-frame">
    {showCover ? <img src={book.coverUrl!} alt="" /> : <DefaultCover title={book.title} />}
    {shelfDots.length > 0 && <span className="book-shelf-dots" title={shelfDots.map((shelf) => shelf.name).join(' · ')} aria-label={t('shelfMembership', { names: shelfDots.map((shelf) => shelf.name).join(' · ') })}>{shelfDots.slice(0, 5).map((shelf) => <i key={shelf.id} style={{ backgroundColor: shelf.color }} />)}</span>}
    {book.progress > 0 && <div className="cover-progress"><i style={{ width: `${Math.min(100, book.progress * 100)}%` }} /></div>}
  </div>
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB']
  let value = size / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

export default function App() {
  const { language, setLanguage, t } = useI18n()
  const [theme, toggleTheme] = useTheme()
  const [books, setBooks] = useState<BookRecord[]>([])
  const [shelves, setShelves] = useState<CustomShelf[]>([])
  const [appSettings, setAppSettings] = useState<AppSettings>({ pdfFirstPageCovers: false, language: 'zh-CN' })
  const [appVersion, setAppVersion] = useState('—')
  const [activeBook, setActiveBook] = useState<BookRecord | null>(null)
  const [showStatistics, setShowStatistics] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [dragKind, setDragKind] = useState<ShelfDragKind>(null)
  const [notice, setNoticeState] = useState<ShelfNotice | null>(null)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [filter, setFilter] = useState<ShelfFilter>('all')
  const [activeShelfId, setActiveShelfId] = useState<string | null>(null)
  const [view, setView] = useState<ShelfView>(() => localStorage.getItem('roxy-shelf-view') === 'list' ? 'list' : 'grid')
  const [menu, setMenu] = useState<{ book: BookRecord; x: number; y: number } | null>(null)
  const [editBook, setEditBook] = useState<BookRecord | null>(null)
  const [removeCandidate, setRemoveCandidate] = useState<BookRecord | null>(null)
  const [createShelfOpen, setCreateShelfOpen] = useState(false)
  const [manageShelfOpen, setManageShelfOpen] = useState(false)
  const [organizeBook, setOrganizeBook] = useState<BookRecord | null>(null)
  const [organizeShelfIds, setOrganizeShelfIds] = useState<string[]>([])
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedBookIds, setSelectedBookIds] = useState<string[]>([])
  const [batchOrganizeOpen, setBatchOrganizeOpen] = useState(false)
  const [batchShelfValues, setBatchShelfValues] = useState<Record<string, boolean>>({})
  const [batchMixedShelfIds, setBatchMixedShelfIds] = useState<string[]>([])
  const [batchTouchedShelfIds, setBatchTouchedShelfIds] = useState<string[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const [dragOverShelfId, setDragOverShelfId] = useState<string | null>(null)
  const dragResetTimer = useRef<number | null>(null)
  const importingPathKeys = useRef(new Set<string>())

  const setNotice = useCallback((message: string, importDetails?: ImportDetail[]) => {
    setNoticeState(message ? { message, importDetails } : null)
  }, [])

  const errorNotice = useCallback((error: unknown, fallback: TranslationKey) => localizeError(language, error, fallback), [language])
  const progressLabel = useCallback((progress: number) => progress >= .995
    ? t('read') : progress > 0 ? t('readPercent', { percent: Math.round(progress * 100) }) : t('notStarted'), [t])
  const bookCountLabel = useCallback((count: number) => t(count === 1 ? 'oneBook' : 'booksCount', { count }), [t])

  const clearDragState = useCallback(() => {
    if (dragResetTimer.current !== null) window.clearTimeout(dragResetTimer.current)
    dragResetTimer.current = null
    setDragKind(null)
    setDragOverShelfId(null)
  }, [])

  const keepFileDragActive = useCallback(() => {
    setDragKind('files')
    if (dragResetTimer.current !== null) window.clearTimeout(dragResetTimer.current)
    dragResetTimer.current = window.setTimeout(clearDragState, 700)
  }, [clearDragState])

  const refresh = useCallback(async () => {
    const [nextBooks, nextShelves, nextSettings] = await Promise.all([
      window.roxy.listBooks(), window.roxy.listShelves(), window.roxy.getAppSettings()
    ])
    setBooks(nextBooks); setShelves(nextShelves); setAppSettings(nextSettings); setLoading(false)
  }, [])

  const importFiles = useCallback(async (paths: string[]): Promise<{ books: BookRecord[]; summary: string; details: ImportDetail[] }> => {
    const pathKeys = new Set<string>()
    const uniquePaths = paths.filter((item) => {
      const key = item.trim().toLocaleLowerCase()
      if (!key || pathKeys.has(key) || importingPathKeys.current.has(key)) return false
      pathKeys.add(key)
      return true
    })
    const epubPaths = uniquePaths.filter((item) => item.toLowerCase().endsWith('.epub'))
    const textPaths = uniquePaths.filter((item) => item.toLowerCase().endsWith('.txt'))
    const pdfPaths = uniquePaths.filter((item) => item.toLowerCase().endsWith('.pdf'))
    if (!epubPaths.length && !textPaths.length && !pdfPaths.length) return { books: [], summary: '', details: [] }
    for (const key of pathKeys) importingPathKeys.current.add(key)
    setBusy(true); setNotice('')
    const books: BookRecord[] = []
    const details: ImportDetail[] = []
    let added = 0; let duplicates = 0; let relinked = 0; let failed = 0
    try {
      for (const candidate of await window.roxy.prepareImports(epubPaths)) {
        try {
          const result = await window.roxy.addBook(await readEpubMetadata(candidate))
          books.push(result.book)
          details.push({ title: result.book.title, size: candidate.size })
          if (result.relinked) relinked += 1; else if (result.duplicate) duplicates += 1; else added += 1
        } catch (error) { console.error('EPUB import failed', candidate.fileName, error); failed += 1 }
      }
      for (const candidate of await window.roxy.prepareTextImports(textPaths)) {
        try {
          const result = await window.roxy.addBook({ format: 'txt', filePath: candidate.filePath, fileName: candidate.fileName, fileHash: candidate.fileHash, title: candidate.title, author: candidate.author, coverDataUrl: null })
          await window.roxy.initializeTextBook(result.book.id, candidate.encoding)
          books.push(result.book)
          details.push({ title: result.book.title, size: candidate.size })
          if (result.relinked) relinked += 1; else if (result.duplicate) duplicates += 1; else added += 1
        } catch (error) { console.error('TXT import failed', candidate.fileName, error); failed += 1 }
      }
      for (const candidate of await window.roxy.preparePdfImports(pdfPaths)) {
        try {
          const result = await window.roxy.addBook({ format: 'pdf', filePath: candidate.filePath, fileName: candidate.fileName, fileHash: candidate.fileHash, title: candidate.title, author: candidate.author, coverDataUrl: null })
          books.push(result.book)
          details.push({ title: result.book.title, size: candidate.size })
          if (result.relinked) relinked += 1; else if (result.duplicate) duplicates += 1; else added += 1
        } catch (error) { console.error('PDF import failed', candidate.fileName, error); failed += 1 }
      }
      await refresh()
      const summary = [added ? t('imported', { count: added }) : '', relinked ? t('relinked', { count: relinked }) : '', duplicates ? t('duplicates', { count: duplicates }) : '', failed ? t('importFailedCount', { count: failed }) : ''].filter(Boolean).join(' · ') || t('noImportableBooks')
      return { books, summary, details }
    } catch (error) {
      return { books, summary: errorNotice(error, 'importFailed'), details }
    } finally {
      for (const key of pathKeys) importingPathKeys.current.delete(key)
      setBusy(false)
    }
  }, [errorNotice, refresh, t])

  const importPaths = useCallback(async (paths: string[], openAfterImport = false) => {
    const { books, summary, details } = await importFiles(paths)
    if (summary) setNotice(summary, details)
    if (openAfterImport && books[0]) setActiveBook(books[0])
  }, [importFiles])

  useEffect(() => {
    refresh().catch(() => { setLoading(false); setNotice(t('libraryLoadFailed')) })
    window.roxy.getAppVersion().then(setAppVersion).catch(() => {})
    window.roxy.takeStartupNotice().then((value) => { if (value) setNotice(errorNotice(new Error(value), 'databaseRecovered')) }).catch(() => {})
    window.roxy.takePendingOpenFiles().then((paths) => { if (paths.length) importPaths(paths, true) }).catch(() => {})
    const stopOpening = window.roxy.onOpenFiles((paths) => importPaths(paths, true))
    const stopLibraryUpdates = window.roxy.onLibraryChanged(() => refresh().catch(() => {}))
    return () => { stopOpening(); stopLibraryUpdates() }
  }, [errorNotice, refresh, importPaths, t])

  useEffect(() => {
    const reset = () => clearDragState()
    window.addEventListener('drop', reset)
    window.addEventListener('dragend', reset)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('drop', reset)
      window.removeEventListener('dragend', reset)
      window.removeEventListener('blur', reset)
      if (dragResetTimer.current !== null) window.clearTimeout(dragResetTimer.current)
    }
  }, [clearDragState])

  useEffect(() => { localStorage.setItem('roxy-shelf-view', view) }, [view])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (activeBook || showStatistics) return
      if (event.ctrlKey && event.key.toLowerCase() === 'f') { event.preventDefault(); searchRef.current?.focus() }
      if (event.ctrlKey && event.key.toLowerCase() === 'o') { event.preventDefault(); chooseFiles() }
      if (event.key === 'Escape') {
        setMenu(null); setEditBook(null); setRemoveCandidate(null); setCreateShelfOpen(false)
        setManageShelfOpen(false); setOrganizeBook(null); setSettingsOpen(false); setBatchOrganizeOpen(false)
        if (selectionMode) { setSelectionMode(false); setSelectedBookIds([]) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeBook, selectionMode, showStatistics])

  const counts = useMemo(() => ({
    all: books.length,
    recent: books.filter((book) => book.lastOpenedAt).length,
    unread: books.filter((book) => book.progress <= 0).length,
    reading: books.filter((book) => book.progress > 0 && book.progress < .995).length,
    finished: books.filter((book) => book.progress >= .995).length
  }), [books])

  const activeShelf = shelves.find((shelf) => shelf.id === activeShelfId) ?? null
  const sortByLastOpened = filter === 'recent' || filter === 'reading'
  const visibleBooks = useMemo(() => {
    const normalized = deferredQuery.trim().toLocaleLowerCase()
    const shelfIds = activeShelf ? new Set(activeShelf.bookIds) : null
    return books.filter((book) => {
      if (shelfIds && !shelfIds.has(book.id)) return false
      const categoryMatch = filter === 'all' || (filter === 'recent' && Boolean(book.lastOpenedAt)) ||
        (filter === 'unread' && book.progress <= 0) || (filter === 'reading' && book.progress > 0 && book.progress < .995) ||
        (filter === 'finished' && book.progress >= .995)
      if (!categoryMatch) return false
      return !normalized || [book.title, book.author, book.fileName].some((value) => value.toLocaleLowerCase().includes(normalized))
    }).sort(sortByLastOpened ? recentlyOpenedSort : smartBookSort)
  }, [activeShelf, books, deferredQuery, filter, sortByLastOpened])

  if (activeBook) {
    const props = { bookRecord: activeBook, theme, onThemeChange: toggleTheme, onClose: async () => { setActiveBook(null); await refresh() } }
    const readerKey = `${activeBook.id}:${activeBook.filePath}`
    if (activeBook.format === 'txt') return <TextReader key={readerKey} {...props} />
    if (activeBook.format === 'pdf') return <PDFReader key={readerKey} {...props} />
    return <Reader key={readerKey} {...props} />
  }

  if (showStatistics) return <StatisticsView theme={theme} onThemeChange={toggleTheme} onClose={() => setShowStatistics(false)} />

  async function chooseFiles() { await importPaths(await window.roxy.chooseBookFiles()) }
  function isFileDrag(event: React.DragEvent) {
    return Array.from(event.dataTransfer.types).includes('Files')
  }
  function isBookDrag(event: React.DragEvent) {
    return Array.from(event.dataTransfer.types).includes('application/x-roxy-book-ids')
  }
  function setNeutralDragImage(event: React.DragEvent) {
    const image = document.createElement('span')
    image.className = 'drag-ghost'
    image.setAttribute('aria-hidden', 'true')
    document.body.append(image)
    event.dataTransfer.setDragImage(image, 0, 0)
    window.setTimeout(() => image.remove(), 0)
  }
  function startBookDrag(event: React.DragEvent, book: BookRecord) {
    const ids = selectionMode && selectedBookIds.includes(book.id) ? selectedBookIds : [book.id]
    event.dataTransfer.setData('application/x-roxy-book-ids', JSON.stringify(ids))
    event.dataTransfer.effectAllowed = 'move'
    setNeutralDragImage(event)
    setDragKind('books')
  }
  async function onShelfDrop(event: React.DragEvent, shelf: CustomShelf) {
    event.preventDefault(); event.stopPropagation(); clearDragState()
    const files = Array.from(event.dataTransfer.files)
    if (files.length) {
      const paths = files.map((file) => window.roxy.getDroppedFilePath(file)).filter(Boolean)
      const { books, summary, details } = await importFiles(paths)
      if (books.length) {
        try {
          await window.roxy.setBooksShelves(books.map((book) => ({ bookId: book.id, shelfIds: [shelf.id] })))
          await refresh()
          setNotice([summary, t('addedToShelf', { name: shelf.name })].filter(Boolean).join(' · '), details)
        } catch (error) { setNotice(errorNotice(error, 'shelfMoveFailed')) }
      } else if (summary) setNotice(summary, details)
      return
    }
    const raw = event.dataTransfer.getData('application/x-roxy-book-ids')
    if (!raw) return
    try {
      const ids = JSON.parse(raw) as string[]
      if (ids.length) {
        await window.roxy.setBooksShelves(ids.map((id) => ({ bookId: id, shelfIds: [shelf.id] })))
        await refresh()
        setNotice(t('movedToShelf', { count: ids.length, name: shelf.name }))
      }
    } catch { /* 忽略无效的拖动数据 */ }
  }
  function onDrop(event: React.DragEvent) {
    event.preventDefault(); clearDragState()
    if (isFileDrag(event)) {
      importPaths(Array.from(event.dataTransfer.files).map((file) => window.roxy.getDroppedFilePath(file)).filter(Boolean))
    }
  }
  function shelfDropHandlers(shelf: CustomShelf) {
    return {
      onDragEnter: (event: React.DragEvent<HTMLButtonElement>) => { event.preventDefault(); setDragOverShelfId(shelf.id) },
      onDragLeave: (event: React.DragEvent<HTMLButtonElement>) => { if (event.currentTarget === event.target) setDragOverShelfId(null) },
      onDragOver: (event: React.DragEvent<HTMLButtonElement>) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = isFileDrag(event) ? 'copy' : 'move'
        setDragOverShelfId(shelf.id)
        if (isFileDrag(event)) keepFileDragActive()
      },
      onDrop: (event: React.DragEvent<HTMLButtonElement>) => { void onShelfDrop(event, shelf) }
    }
  }
  function clearSelection() { setSelectionMode(false); setSelectedBookIds([]); setBatchOrganizeOpen(false) }
  function selectBuiltInFilter(value: ShelfFilter) { clearSelection(); setFilter(value); setActiveShelfId(null) }
  function selectCustomShelf(shelfId: string) { clearSelection(); setActiveShelfId(shelfId); setFilter('all') }
  function openMenu(book: BookRecord, x: number, y: number) {
    setMenu({ book, x: Math.min(x, window.innerWidth - 220), y: Math.min(y, window.innerHeight - 315) })
  }
  async function perform(action: () => Promise<unknown>, success?: string) {
    setMenu(null)
    try { await action(); await refresh(); if (success) setNotice(success) }
    catch (error) { setNotice(errorNotice(error, 'operationFailed')) }
  }
  async function chooseCover(book: BookRecord) {
    setMenu(null)
    try {
      const updated = await window.roxy.chooseBookCover(book.id)
      if (!updated) return
      await refresh(); setNotice(t('coverUpdated'))
    } catch (error) { setNotice(errorNotice(error, 'coverUpdateFailed')) }
  }
  function beginOrganize(book: BookRecord) {
    setOrganizeBook(book)
    setOrganizeShelfIds(shelves.filter((shelf) => shelf.bookIds.includes(book.id)).map((shelf) => shelf.id))
    setMenu(null)
  }
  function toggleBookSelection(bookId: string) {
    setSelectedBookIds((current) => current.includes(bookId) ? current.filter((id) => id !== bookId) : [...current, bookId])
  }
  function toggleAllVisibleBooks() {
    const visibleIds = new Set(visibleBooks.map((book) => book.id))
    const allVisibleSelected = visibleBooks.length > 0 && visibleBooks.every((book) => selectedBookIds.includes(book.id))
    setSelectedBookIds((current) => allVisibleSelected
      ? current.filter((id) => !visibleIds.has(id))
      : [...new Set([...current, ...visibleIds])])
  }
  function beginBatchOrganize() {
    if (!selectedBookIds.length) return
    const values: Record<string, boolean> = {}
    const mixed: string[] = []
    for (const shelf of shelves) {
      const count = selectedBookIds.filter((bookId) => shelf.bookIds.includes(bookId)).length
      values[shelf.id] = count === selectedBookIds.length
      if (count > 0 && count < selectedBookIds.length) mixed.push(shelf.id)
    }
    setBatchShelfValues(values); setBatchMixedShelfIds(mixed); setBatchTouchedShelfIds([]); setBatchOrganizeOpen(true)
  }
  async function saveBatchOrganize() {
    const touched = new Set(batchTouchedShelfIds)
    const assignments = selectedBookIds.map((bookId) => {
      const next = new Set(shelves.filter((shelf) => shelf.bookIds.includes(bookId)).map((shelf) => shelf.id))
      for (const shelfId of touched) {
        if (batchShelfValues[shelfId]) next.add(shelfId); else next.delete(shelfId)
      }
      return { bookId, shelfIds: [...next] }
    })
    try {
      await window.roxy.setBooksShelves(assignments)
      await refresh(); setNotice(t('organizedBooks', { count: assignments.length })); clearSelection()
    } catch (error) { setNotice(errorNotice(error, 'batchOrganizeFailed')) }
  }
  function renderBook(book: BookRecord) {
    const assignedShelves = shelves.filter((shelf) => shelf.bookIds.includes(book.id))
    const selected = selectedBookIds.includes(book.id)
    const cover = <BookCover book={book} pdfCoversEnabled={appSettings.pdfFirstPageCovers} shelfDots={assignedShelves} />
    const author = book.author === '未知作者' ? t('unknownAuthor') : book.author
    const activate = () => selectionMode ? toggleBookSelection(book.id) : setActiveBook(book)
    if (view === 'list') return <article className={`book-row${selected ? ' selected' : ''}`} key={book.id} draggable onDragStart={(event) => startBookDrag(event, book)} onDragEnd={clearDragState} onContextMenu={(event) => { event.preventDefault(); if (!selectionMode) openMenu(book, event.clientX, event.clientY) }}>
      <button className="book-row-open" onClick={activate} aria-pressed={selectionMode ? selected : undefined}><div className="list-cover">{cover}</div><div className="book-row-main"><strong>{book.title}</strong><span>{author}</span><small>{book.fileName}</small></div><span className="format-badge">{book.format.toUpperCase()}</span><div className="row-progress"><span>{progressLabel(book.progress)}</span><i><b style={{ width: `${Math.min(100, book.progress * 100)}%` }} /></i></div></button>
      {selectionMode ? <span className="book-selection-mark">{selected && <CheckCircle2 size={17} />}</span> : <button className="book-menu-trigger" onClick={(event) => { event.stopPropagation(); openMenu(book, event.clientX, event.clientY) }} aria-label={t('manageBook', { title: book.title })}><Ellipsis size={18} /></button>}
    </article>
    return <article className={`book-tile${selected ? ' selected' : ''}`} key={book.id} draggable onDragStart={(event) => startBookDrag(event, book)} onDragEnd={clearDragState} onContextMenu={(event) => { event.preventDefault(); if (!selectionMode) openMenu(book, event.clientX, event.clientY) }}><button className="book-open-button" onClick={activate} aria-pressed={selectionMode ? selected : undefined}>{cover}<strong title={book.title}>{book.title}</strong><span title={author}>{author}</span><small>{progressLabel(book.progress)}</small></button>{selectionMode ? <span className="book-selection-mark">{selected && <CheckCircle2 size={17} />}</span> : <button className="book-menu-trigger" onClick={(event) => { event.stopPropagation(); openMenu(book, event.clientX, event.clientY) }} aria-label={t('manageBook', { title: book.title })}><Ellipsis size={18} /></button>}</article>
  }

  return <div className="app-shell" onClick={() => setMenu(null)} onDragEnter={(event) => { if (isFileDrag(event)) keepFileDragActive() }} onDragOver={(event) => { event.preventDefault(); if (isFileDrag(event)) { event.dataTransfer.dropEffect = 'copy'; keepFileDragActive() } else if (isBookDrag(event)) { event.dataTransfer.dropEffect = 'move'; setDragKind('books') } }} onDragLeave={(event) => { if (event.currentTarget === event.target) clearDragState() }} onDrop={onDrop}>
    <header className="shelf-header"><div className="brand-mark"><img src={appIconUrl} alt="" /></div><div className="brand-copy"><h1>{t('appName')}</h1><p>{books.length ? t(books.length === 1 ? 'localBook' : 'localBooks', { count: books.length }) : t('appDescription')}</p></div><div className="header-actions"><button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label={t('settings')}><Settings size={19} /></button><button className="icon-button" onClick={toggleTheme} aria-label={t('toggleTheme')}>{theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}</button><button className="primary-button" onClick={chooseFiles} disabled={busy}><Plus size={18} />{busy ? t('importing') : t('importBooks')}</button></div></header>
    <main className="shelf-content">
      <div className="library-toolbar"><nav className="shelf-filters" aria-label={t('filterAll')}>{filters.map((item) => <button key={item.value} className={!activeShelfId && filter === item.value ? 'active' : ''} onClick={() => selectBuiltInFilter(item.value)}>{t(item.labelKey)}<span>{counts[item.value]}</span></button>)}</nav><div className="library-tools"><button className="statistics-entry" onClick={() => setShowStatistics(true)}><BarChart3 size={15} />{t('statistics')}</button><label className="library-search"><Search size={16} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchLibrary')} /><kbd>Ctrl F</kbd>{query && <button onClick={() => setQuery('')} aria-label={t('clearSearch')}><X size={14} /></button>}</label><div className="view-switch" aria-label={t('libraryView')}><button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} aria-label={t('gridView')}><LayoutGrid size={17} /></button><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label={t('listView')}><List size={18} /></button></div></div></div>
      <div className="custom-shelves"><span>{t('customShelves')}</span><div>{shelves.map((shelf) => <button key={shelf.id} className={`${activeShelfId === shelf.id ? 'active' : ''}${dragOverShelfId === shelf.id ? ' drag-over' : ''}`} onClick={() => selectCustomShelf(shelf.id)} {...shelfDropHandlers(shelf)} title={t('shelfDropHint')}><i className="shelf-color-dot" style={{ backgroundColor: shelf.color }} />{shelf.name}<small>{shelf.bookIds.length}</small></button>)}<button className="add-shelf" onClick={() => setCreateShelfOpen(true)}><FolderPlus size={14} />{t('newShelf')}</button></div></div>
      <div className="section-title"><div><h2>{activeShelf?.name ?? t(filters.find((item) => item.value === filter)?.labelKey ?? 'filterAll')}</h2><p>{bookCountLabel(visibleBooks.length)}{deferredQuery ? ` · ${t('searchFor', { query: deferredQuery })}` : ''} · {t(sortByLastOpened ? 'sortedRecent' : 'sortedSmart')}</p></div><div className="section-actions">{selectionMode ? <><span>{t('selectedBooks', { count: selectedBookIds.length })}</span><button className="secondary-button" onClick={toggleAllVisibleBooks}>{t(visibleBooks.length > 0 && visibleBooks.every((book) => selectedBookIds.includes(book.id)) ? 'clearSelection' : 'selectVisible')}</button><button className="primary-button" onClick={beginBatchOrganize} disabled={!selectedBookIds.length}><FolderInput size={14} />{t('organize')}</button><button className="secondary-button" onClick={clearSelection}>{t('cancel')}</button></> : <button className="secondary-button" onClick={() => setSelectionMode(true)} disabled={!visibleBooks.length}>{t('select')}</button>}{activeShelf && !selectionMode && <button className="secondary-button shelf-manage-button" onClick={() => setManageShelfOpen(true)}><Pencil size={14} />{t('manageShelf')}</button>}</div></div>
      {notice && <div className="notice" role="status"><div><span>{notice.message}</span>{notice.importDetails?.length ? <details className="import-details"><summary>{t('importDetails', { count: notice.importDetails.length })}</summary><ul>{notice.importDetails.map((item, index) => <li key={`${item.title}-${index}`}><span title={item.title}>{item.title}</span><small>{formatFileSize(item.size)}</small></li>)}</ul></details> : null}</div><button onClick={() => setNotice('')}>{t('close')}</button></div>}
      {loading ? <section className="empty-state compact"><span className="loading-line" /><p>{t('loadingLibrary')}</p></section> : visibleBooks.length ? <section className={view === 'grid' ? 'book-grid' : 'book-list'}>{visibleBooks.map(renderBook)}</section> : <section className="empty-state">{books.length ? <><Search size={38} strokeWidth={1.4} /><h2>{t('noMatchingBooks')}</h2><p>{t(activeShelf ? 'emptyShelfHint' : 'emptyFilterHint')}</p><button className="secondary-button" onClick={() => { setQuery(''); selectBuiltInFilter('all') }}>{t('viewAllBooks')}</button></> : <><Library size={42} strokeWidth={1.4} /><h2>{t('emptyLibrary')}</h2><p>{t('emptyLibraryHint')}</p><button className="primary-button" onClick={chooseFiles} disabled={busy}><Download size={18} />{t('chooseBooks')}</button></>}</section>}
    </main>
    {menu && <div className="context-menu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}><button onClick={() => setActiveBook(menu.book)}><BookOpen size={16} />{t('open')}</button><button onClick={() => beginOrganize(menu.book)}><FolderInput size={16} />{t('organizeToShelf')}</button><button onClick={() => perform(() => window.roxy.revealBook(menu.book.id))}><FolderOpen size={16} />{t('revealFile')}</button><button onClick={() => { setEditBook(menu.book); setMenu(null) }}><Pencil size={16} />{t('editMetadata')}</button><button onClick={() => chooseCover(menu.book)}><Image size={16} />{t('changeCover')}</button>{menu.book.progress < .995 && <button onClick={() => perform(() => window.roxy.markBookRead(menu.book.id), t('markedRead'))}><CheckCircle2 size={16} />{t('markRead')}</button>}<div className="menu-separator" /><button className="danger" onClick={() => { setRemoveCandidate(menu.book); setMenu(null) }}><Trash2 size={16} />{t('removeFromLibrary')}</button></div>}
    {createShelfOpen && <div className="modal-backdrop" onMouseDown={() => setCreateShelfOpen(false)}><form className="dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); try { const shelf = await window.roxy.createShelf(String(data.get('name')), String(data.get('color'))); await refresh(); setActiveShelfId(shelf.id); setFilter('all'); setCreateShelfOpen(false) } catch (error) { setNotice(errorNotice(error, 'createShelfFailed')) } }}><div className="dialog-head"><strong>{t('createShelf')}</strong><button type="button" className="icon-button" onClick={() => setCreateShelfOpen(false)} aria-label={t('close')}><X size={18} /></button></div><label>{t('name')}<input name="name" maxLength={40} autoFocus placeholder={t('shelfNameExample')} /></label><label className="shelf-color-field">{t('shelfColor')}<input name="color" type="color" defaultValue="#1769FF" aria-label={t('shelfColorLabel')} /></label><p>{t('shelfLocalOnly')}</p><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setCreateShelfOpen(false)}>{t('cancel')}</button><button className="primary-button">{t('create')}</button></div></form></div>}
    {manageShelfOpen && activeShelf && <div className="modal-backdrop" onMouseDown={() => setManageShelfOpen(false)}><form className="dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); try { await window.roxy.renameShelf(activeShelf.id, String(data.get('name')), String(data.get('color'))); await refresh(); setManageShelfOpen(false); setNotice(t('shelfUpdated')) } catch (error) { setNotice(errorNotice(error, 'updateFailed')) } }}><div className="dialog-head"><strong>{t('manageShelf')}</strong><button type="button" className="icon-button" onClick={() => setManageShelfOpen(false)} aria-label={t('close')}><X size={18} /></button></div><label>{t('name')}<input name="name" maxLength={40} defaultValue={activeShelf.name} autoFocus /></label><label className="shelf-color-field">{t('shelfColor')}<input name="color" type="color" defaultValue={activeShelf.color} aria-label={t('shelfColorLabel')} /></label><p>{t('shelfDeleteNote')}</p><div className="dialog-actions split-actions"><button type="button" className="danger-text-button" onClick={async () => { await perform(() => window.roxy.removeShelf(activeShelf.id), t('shelfDeleted')); setActiveShelfId(null); setManageShelfOpen(false) }}>{t('deleteShelf')}</button><span /><button type="button" className="secondary-button" onClick={() => setManageShelfOpen(false)}>{t('cancel')}</button><button className="primary-button">{t('save')}</button></div></form></div>}
    {organizeBook && <div className="modal-backdrop" onMouseDown={() => setOrganizeBook(null)}><form className="dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={async (event) => { event.preventDefault(); await perform(() => window.roxy.setBookShelves(organizeBook.id, organizeShelfIds), t('shelfUpdated')); setOrganizeBook(null) }}><div className="dialog-head"><strong>{t('organizeToShelf')}</strong><button type="button" className="icon-button" onClick={() => setOrganizeBook(null)} aria-label={t('close')}><X size={18} /></button></div><p className="organize-title">{organizeBook.title}</p>{shelves.length ? <div className="shelf-check-list">{shelves.map((shelf) => <label key={shelf.id}><input type="checkbox" checked={organizeShelfIds.includes(shelf.id)} onChange={(event) => setOrganizeShelfIds((current) => event.target.checked ? [...current, shelf.id] : current.filter((id) => id !== shelf.id))} /><span><i className="shelf-color-dot" style={{ backgroundColor: shelf.color }} />{shelf.name}</span><small>{t('shelfBookCount', { count: shelf.bookIds.length })}</small></label>)}</div> : <div className="dialog-empty"><span>{t('noShelves')}</span><button type="button" className="secondary-button" onClick={() => { setOrganizeBook(null); setCreateShelfOpen(true) }}>{t('createShelfFirst')}</button></div>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setOrganizeBook(null)}>{t('cancel')}</button><button className="primary-button" disabled={!shelves.length}>{t('save')}</button></div></form></div>}
    {batchOrganizeOpen && <div className="modal-backdrop" onMouseDown={() => setBatchOrganizeOpen(false)}><form className="dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={async (event) => { event.preventDefault(); await saveBatchOrganize() }}><div className="dialog-head"><strong>{t('batchOrganize')}</strong><button type="button" className="icon-button" onClick={() => setBatchOrganizeOpen(false)} aria-label={t('close')}><X size={18} /></button></div><p className="organize-title">{t(selectedBookIds.length === 1 ? 'batchSelectedOne' : 'batchSelected', { count: selectedBookIds.length })}</p>{shelves.length ? <><p>{t('mixedShelfHint')}</p><div className="shelf-check-list">{shelves.map((shelf) => { const touched = batchTouchedShelfIds.includes(shelf.id); const mixed = batchMixedShelfIds.includes(shelf.id) && !touched; return <label key={shelf.id}><input type="checkbox" checked={batchShelfValues[shelf.id] ?? false} ref={(input) => { if (input) input.indeterminate = mixed }} onChange={(event) => { setBatchTouchedShelfIds((current) => current.includes(shelf.id) ? current : [...current, shelf.id]); setBatchShelfValues((current) => ({ ...current, [shelf.id]: event.target.checked })) }} /><span><i className="shelf-color-dot" style={{ backgroundColor: shelf.color }} />{shelf.name}</span><small>{t(mixed ? 'partial' : batchShelfValues[shelf.id] ? 'all' : 'noneSelected')}</small></label> })}</div></> : <div className="dialog-empty"><span>{t('noShelves')}</span><button type="button" className="secondary-button" onClick={() => { setBatchOrganizeOpen(false); setCreateShelfOpen(true) }}>{t('createShelfFirst')}</button></div>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setBatchOrganizeOpen(false)}>{t('cancel')}</button><button className="primary-button" disabled={!shelves.length || !batchTouchedShelfIds.length}>{t('applyOrganize')}</button></div></form></div>}
    {settingsOpen && <div className="modal-backdrop" onMouseDown={() => setSettingsOpen(false)}><div className="dialog" onMouseDown={(event) => event.stopPropagation()}><div className="dialog-head"><strong>{t('settings')}</strong><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label={t('close')}><X size={18} /></button></div><label className="settings-select-row"><span><strong>{t('language')}</strong><small>{t('languageHint')}</small></span><select value={language} onChange={async (event) => { const next = event.target.value as AppSettings['language']; try { await setLanguage(next); setAppSettings((current) => ({ ...current, language: next })) } catch { setNotice(t('operationFailed')) } }}><option value="zh-CN">{t('simplifiedChinese')}</option><option value="en-US">{t('english')}</option></select></label><label className="toggle-row"><span><strong>{t('pdfCoverTitle')}</strong><small>{t('pdfCoverHint')}</small></span><input type="checkbox" checked={appSettings.pdfFirstPageCovers} onChange={async (event) => { const enabled = event.target.checked; setAppSettings((current) => ({ ...current, pdfFirstPageCovers: enabled })); try { setAppSettings(await window.roxy.updateAppSettings({ pdfFirstPageCovers: enabled })) } catch { await refresh(); setNotice(t('pdfCoverSaveFailed')) } }} /></label><p>{t('pdfCoverNote')}</p><p className="app-version">{t('appName')} · {t('version', { version: appVersion })}</p></div></div>}
    {editBook && <div className="modal-backdrop" onMouseDown={() => setEditBook(null)}><form className="dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); await perform(() => window.roxy.updateBookMetadata(editBook.id, String(data.get('title')), String(data.get('author'))), t('metadataUpdated')); setEditBook(null) }}><div className="dialog-head"><strong>{t('editBook')}</strong><button type="button" className="icon-button" onClick={() => setEditBook(null)} aria-label={t('close')}><X size={18} /></button></div><label>{t('displayTitle')}<input name="title" defaultValue={editBook.title} autoFocus /></label><label>{t('displayAuthor')}<input name="author" defaultValue={editBook.author === '未知作者' ? t('unknownAuthor') : editBook.author} /></label><p>{t('metadataLocalOnly')}</p><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setEditBook(null)}>{t('cancel')}</button><button className="primary-button">{t('save')}</button></div></form></div>}
    {removeCandidate && <div className="modal-backdrop" onMouseDown={() => setRemoveCandidate(null)}><div className="dialog confirm-dialog" onMouseDown={(event) => event.stopPropagation()}><div className="dialog-head"><strong>{t('removeBookTitle')}</strong><button className="icon-button" onClick={() => setRemoveCandidate(null)} aria-label={t('close')}><X size={18} /></button></div><p>{t('removeBookMessage', { title: removeCandidate.title })}</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setRemoveCandidate(null)}>{t('cancel')}</button><button className="danger-button" onClick={async () => { await perform(() => window.roxy.removeBook(removeCandidate.id), t('removeBookSuccess')); setRemoveCandidate(null) }}>{t('remove')}</button></div></div></div>}
    {dragKind && <aside className={`drag-shelf-tray ${dragKind}`} aria-label={t(dragKind === 'files' ? 'chooseImportShelf' : 'chooseMoveShelf')}><div className="drag-shelf-tray-head">{dragKind === 'files' ? <Download size={16} /> : <FolderInput size={16} />}<div><strong>{t(dragKind === 'files' ? 'importToShelf' : 'moveToShelf')}</strong><span>{t(dragKind === 'files' ? 'dropImportShelf' : 'dropMoveShelf')}</span></div></div>{shelves.length ? <div className="drag-shelf-tray-list">{shelves.map((shelf) => <button key={shelf.id} className={dragOverShelfId === shelf.id ? 'drag-over' : ''} {...shelfDropHandlers(shelf)}><i className="shelf-color-dot" style={{ backgroundColor: shelf.color }} />{shelf.name}<small>{t('shelfBookCount', { count: shelf.bookIds.length })}</small></button>)}</div> : <p>{t('dropImportLibrary')}</p>}</aside>}
  </div>
}
