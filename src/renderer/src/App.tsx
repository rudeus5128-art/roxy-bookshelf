// tai and codex
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3, BookOpen, CheckCircle2, Download, Ellipsis, FolderInput, FolderOpen, FolderPlus, Image,
  LayoutGrid, Library, List, Moon, Pencil, Plus, Search, Settings, Sun, Trash2, X
} from 'lucide-react'
import type { AppSettings, BookRecord, CustomShelf } from '../../shared/models'
import { readEpubMetadata } from './epub'
import Reader from './Reader'
import TextReader from './TextReader'
import PDFReader from './PDFReader'
import StatisticsView from './StatisticsView'
import { recentlyOpenedSort, smartBookSort } from './shelfSort'

type Theme = 'light' | 'dark'
type ShelfFilter = 'all' | 'recent' | 'unread' | 'reading' | 'finished'
type ShelfView = 'grid' | 'list'
type ShelfDragKind = 'files' | 'books' | null
type ImportDetail = { title: string; size: number }
type ShelfNotice = { message: string; importDetails?: ImportDetail[] }
const appIconUrl = new URL('../../../build/roxy-app-icon-character-v9-large.png', import.meta.url).href

const filters: Array<{ value: ShelfFilter; label: string }> = [
  { value: 'all', label: '全部' }, { value: 'recent', label: '最近阅读' },
  { value: 'unread', label: '未读' }, { value: 'reading', label: '阅读中' },
  { value: 'finished', label: '已读' }
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
  const showCover = Boolean(book.coverUrl) && (book.format !== 'pdf' || pdfCoversEnabled)
  return <div className="cover-frame">
    {showCover ? <img src={book.coverUrl!} alt="" /> : <DefaultCover title={book.title} />}
    {shelfDots.length > 0 && <span className="book-shelf-dots" title={shelfDots.map((shelf) => shelf.name).join('、')} aria-label={`所属子书架：${shelfDots.map((shelf) => shelf.name).join('、')}`}>{shelfDots.slice(0, 5).map((shelf) => <i key={shelf.id} style={{ backgroundColor: shelf.color }} />)}</span>}
    {book.progress > 0 && <div className="cover-progress"><i style={{ width: `${Math.min(100, book.progress * 100)}%` }} /></div>}
  </div>
}

function progressLabel(progress: number) {
  if (progress >= .995) return '已读'
  if (progress > 0) return `已读 ${Math.round(progress * 100)}%`
  return '未开始'
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
  const [theme, toggleTheme] = useTheme()
  const [books, setBooks] = useState<BookRecord[]>([])
  const [shelves, setShelves] = useState<CustomShelf[]>([])
  const [appSettings, setAppSettings] = useState<AppSettings>({ pdfFirstPageCovers: false })
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
      const summary = [added ? `已导入 ${added} 本` : '', relinked ? `${relinked} 本已更新文件位置` : '', duplicates ? `${duplicates} 本已存在，未重复添加` : '', failed ? `${failed} 本无法读取` : ''].filter(Boolean).join(' · ') || '没有找到可导入的电子书'
      return { books, summary, details }
    } catch (error) {
      return { books, summary: error instanceof Error ? error.message : '导入失败，请检查文件后重试', details }
    } finally {
      for (const key of pathKeys) importingPathKeys.current.delete(key)
      setBusy(false)
    }
  }, [refresh])

  const importPaths = useCallback(async (paths: string[], openAfterImport = false) => {
    const { books, summary, details } = await importFiles(paths)
    if (summary) setNotice(summary, details)
    if (openAfterImport && books[0]) setActiveBook(books[0])
  }, [importFiles])

  useEffect(() => {
    refresh().catch(() => { setLoading(false); setNotice('书架加载失败') })
    window.roxy.takeStartupNotice().then((value) => { if (value) setNotice(value) }).catch(() => {})
    window.roxy.takePendingOpenFiles().then((paths) => { if (paths.length) importPaths(paths, true) }).catch(() => {})
    const stopOpening = window.roxy.onOpenFiles((paths) => importPaths(paths, true))
    const stopLibraryUpdates = window.roxy.onLibraryChanged(() => refresh().catch(() => {}))
    return () => { stopOpening(); stopLibraryUpdates() }
  }, [refresh, importPaths])

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
          setNotice([summary, `已归入「${shelf.name}」`].filter(Boolean).join(' · '), details)
        } catch (error) { setNotice(error instanceof Error ? error.message : '归入子书架失败') }
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
        setNotice(`已移动 ${ids.length} 本到「${shelf.name}」`)
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
    catch (error) { setNotice(error instanceof Error ? error.message : '操作失败') }
  }
  async function chooseCover(book: BookRecord) {
    setMenu(null)
    try {
      const updated = await window.roxy.chooseBookCover(book.id)
      if (!updated) return
      await refresh(); setNotice('封面已更新')
    } catch (error) { setNotice(error instanceof Error ? error.message : '封面更新失败') }
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
      await refresh(); setNotice(`已整理 ${assignments.length} 本书`); clearSelection()
    } catch (error) { setNotice(error instanceof Error ? error.message : '批量整理失败') }
  }
  function renderBook(book: BookRecord) {
    const assignedShelves = shelves.filter((shelf) => shelf.bookIds.includes(book.id))
    const selected = selectedBookIds.includes(book.id)
    const cover = <BookCover book={book} pdfCoversEnabled={appSettings.pdfFirstPageCovers} shelfDots={assignedShelves} />
    const activate = () => selectionMode ? toggleBookSelection(book.id) : setActiveBook(book)
    if (view === 'list') return <article className={`book-row${selected ? ' selected' : ''}`} key={book.id} draggable onDragStart={(event) => startBookDrag(event, book)} onDragEnd={clearDragState} onContextMenu={(event) => { event.preventDefault(); if (!selectionMode) openMenu(book, event.clientX, event.clientY) }}>
      <button className="book-row-open" onClick={activate} aria-pressed={selectionMode ? selected : undefined}><div className="list-cover">{cover}</div><div className="book-row-main"><strong>{book.title}</strong><span>{book.author}</span><small>{book.fileName}</small></div><span className="format-badge">{book.format.toUpperCase()}</span><div className="row-progress"><span>{progressLabel(book.progress)}</span><i><b style={{ width: `${Math.min(100, book.progress * 100)}%` }} /></i></div></button>
      {selectionMode ? <span className="book-selection-mark">{selected && <CheckCircle2 size={17} />}</span> : <button className="book-menu-trigger" onClick={(event) => { event.stopPropagation(); openMenu(book, event.clientX, event.clientY) }} aria-label={`管理 ${book.title}`}><Ellipsis size={18} /></button>}
    </article>
    return <article className={`book-tile${selected ? ' selected' : ''}`} key={book.id} draggable onDragStart={(event) => startBookDrag(event, book)} onDragEnd={clearDragState} onContextMenu={(event) => { event.preventDefault(); if (!selectionMode) openMenu(book, event.clientX, event.clientY) }}><button className="book-open-button" onClick={activate} aria-pressed={selectionMode ? selected : undefined}>{cover}<strong title={book.title}>{book.title}</strong><span title={book.author}>{book.author}</span><small>{progressLabel(book.progress)}</small></button>{selectionMode ? <span className="book-selection-mark">{selected && <CheckCircle2 size={17} />}</span> : <button className="book-menu-trigger" onClick={(event) => { event.stopPropagation(); openMenu(book, event.clientX, event.clientY) }} aria-label={`管理 ${book.title}`}><Ellipsis size={18} /></button>}</article>
  }

  return <div className="app-shell" onClick={() => setMenu(null)} onDragEnter={(event) => { if (isFileDrag(event)) keepFileDragActive() }} onDragOver={(event) => { event.preventDefault(); if (isFileDrag(event)) { event.dataTransfer.dropEffect = 'copy'; keepFileDragActive() } else if (isBookDrag(event)) { event.dataTransfer.dropEffect = 'move'; setDragKind('books') } }} onDragLeave={(event) => { if (event.currentTarget === event.target) clearDragState() }} onDrop={onDrop}>
    <header className="shelf-header"><div className="brand-mark"><img src={appIconUrl} alt="" /></div><div className="brand-copy"><h1>Roxy 的书架</h1><p>{books.length ? `${books.length} 本本地书籍` : '本地电子书架'}</p></div><div className="header-actions"><button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="书架设置"><Settings size={19} /></button><button className="icon-button" onClick={toggleTheme} aria-label="切换明暗主题">{theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}</button><button className="primary-button" onClick={chooseFiles} disabled={busy}><Plus size={18} />{busy ? '正在导入…' : '导入书籍'}</button></div></header>
    <main className="shelf-content">
      <div className="library-toolbar"><nav className="shelf-filters" aria-label="书架分类">{filters.map((item) => <button key={item.value} className={!activeShelfId && filter === item.value ? 'active' : ''} onClick={() => selectBuiltInFilter(item.value)}>{item.label}<span>{counts[item.value]}</span></button>)}</nav><div className="library-tools"><button className="statistics-entry" onClick={() => setShowStatistics(true)}><BarChart3 size={15} />统计</button><label className="library-search"><Search size={16} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索书名、作者或文件名" /><kbd>Ctrl F</kbd>{query && <button onClick={() => setQuery('')} aria-label="清除搜索"><X size={14} /></button>}</label><div className="view-switch" aria-label="书架视图"><button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} aria-label="网格视图"><LayoutGrid size={17} /></button><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label="列表视图"><List size={18} /></button></div></div></div>
      <div className="custom-shelves"><span>子书架</span><div>{shelves.map((shelf) => <button key={shelf.id} className={`${activeShelfId === shelf.id ? 'active' : ''}${dragOverShelfId === shelf.id ? ' drag-over' : ''}`} onClick={() => selectCustomShelf(shelf.id)} {...shelfDropHandlers(shelf)} title="拖入电子书以导入并归类；拖动书籍到这里以移动"><i className="shelf-color-dot" style={{ backgroundColor: shelf.color }} />{shelf.name}<small>{shelf.bookIds.length}</small></button>)}<button className="add-shelf" onClick={() => setCreateShelfOpen(true)}><FolderPlus size={14} />新建</button></div></div>
      <div className="section-title"><div><h2>{activeShelf?.name ?? filters.find((item) => item.value === filter)?.label}</h2><p>{visibleBooks.length} 本书{deferredQuery ? ` · 搜索“${deferredQuery}”` : ''} · {sortByLastOpened ? '按最近打开排列' : '按格式与名称排列'}</p></div><div className="section-actions">{selectionMode ? <><span>已选 {selectedBookIds.length} 本</span><button className="secondary-button" onClick={toggleAllVisibleBooks}>{visibleBooks.length > 0 && visibleBooks.every((book) => selectedBookIds.includes(book.id)) ? '取消全选' : '全选当前'}</button><button className="primary-button" onClick={beginBatchOrganize} disabled={!selectedBookIds.length}><FolderInput size={14} />整理</button><button className="secondary-button" onClick={clearSelection}>取消</button></> : <button className="secondary-button" onClick={() => setSelectionMode(true)} disabled={!visibleBooks.length}>选择</button>}{activeShelf && !selectionMode && <button className="secondary-button shelf-manage-button" onClick={() => setManageShelfOpen(true)}><Pencil size={14} />管理子书架</button>}</div></div>
      {notice && <div className="notice" role="status"><div><span>{notice.message}</span>{notice.importDetails?.length ? <details className="import-details"><summary>导入详情（{notice.importDetails.length}）</summary><ul>{notice.importDetails.map((item, index) => <li key={`${item.title}-${index}`}><span title={item.title}>{item.title}</span><small>{formatFileSize(item.size)}</small></li>)}</ul></details> : null}</div><button onClick={() => setNotice('')}>关闭</button></div>}
      {loading ? <section className="empty-state compact"><span className="loading-line" /><p>正在加载本地书架…</p></section> : visibleBooks.length ? <section className={view === 'grid' ? 'book-grid' : 'book-list'}>{visibleBooks.map(renderBook)}</section> : <section className="empty-state">{books.length ? <><Search size={38} strokeWidth={1.4} /><h2>没有符合条件的书籍</h2><p>{activeShelf ? '可以从书籍菜单把书整理到这个子书架。' : '试试清除搜索词或切换分类。'}</p><button className="secondary-button" onClick={() => { setQuery(''); selectBuiltInFilter('all') }}>查看全部书籍</button></> : <><Library size={42} strokeWidth={1.4} /><h2>书架还是空的</h2><p>导入本地 EPUB、TXT 或 PDF，也可以直接把文件拖到这里。</p><button className="primary-button" onClick={chooseFiles} disabled={busy}><Download size={18} />选择电子书</button></>}</section>}
    </main>
    {menu && <div className="context-menu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}><button onClick={() => setActiveBook(menu.book)}><BookOpen size={16} />打开</button><button onClick={() => beginOrganize(menu.book)}><FolderInput size={16} />整理到子书架</button><button onClick={() => perform(() => window.roxy.revealBook(menu.book.id))}><FolderOpen size={16} />查看文件位置</button><button onClick={() => { setEditBook(menu.book); setMenu(null) }}><Pencil size={16} />修改书名与作者</button><button onClick={() => chooseCover(menu.book)}><Image size={16} />更换封面</button>{menu.book.progress < .995 && <button onClick={() => perform(() => window.roxy.markBookRead(menu.book.id), '已标记为已读')}><CheckCircle2 size={16} />标记已读</button>}<div className="menu-separator" /><button className="danger" onClick={() => { setRemoveCandidate(menu.book); setMenu(null) }}><Trash2 size={16} />从书架移除</button></div>}
    {createShelfOpen && <div className="modal-backdrop" onMouseDown={() => setCreateShelfOpen(false)}><form className="dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); try { const shelf = await window.roxy.createShelf(String(data.get('name')), String(data.get('color'))); await refresh(); setActiveShelfId(shelf.id); setFilter('all'); setCreateShelfOpen(false) } catch (error) { setNotice(error instanceof Error ? error.message : '新建子书架失败') } }}><div className="dialog-head"><strong>新建子书架</strong><button type="button" className="icon-button" onClick={() => setCreateShelfOpen(false)}><X size={18} /></button></div><label>名称<input name="name" maxLength={40} autoFocus placeholder="例如：小说" /></label><label className="shelf-color-field">代表色<input name="color" type="color" defaultValue="#1769FF" aria-label="子书架代表色" /></label><p>子书架只用于整理本地书籍，不会移动原始文件。</p><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setCreateShelfOpen(false)}>取消</button><button className="primary-button">创建</button></div></form></div>}
    {manageShelfOpen && activeShelf && <div className="modal-backdrop" onMouseDown={() => setManageShelfOpen(false)}><form className="dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); try { await window.roxy.renameShelf(activeShelf.id, String(data.get('name')), String(data.get('color'))); await refresh(); setManageShelfOpen(false); setNotice('子书架已更新') } catch (error) { setNotice(error instanceof Error ? error.message : '更新失败') } }}><div className="dialog-head"><strong>管理子书架</strong><button type="button" className="icon-button" onClick={() => setManageShelfOpen(false)}><X size={18} /></button></div><label>名称<input name="name" maxLength={40} defaultValue={activeShelf.name} autoFocus /></label><label className="shelf-color-field">代表色<input name="color" type="color" defaultValue={activeShelf.color} aria-label="子书架代表色" /></label><p>删除子书架不会移除书籍，也不会删除原始文件。</p><div className="dialog-actions split-actions"><button type="button" className="danger-text-button" onClick={async () => { await perform(() => window.roxy.removeShelf(activeShelf.id), '子书架已删除，书籍保持不变'); setActiveShelfId(null); setManageShelfOpen(false) }}>删除子书架</button><span /><button type="button" className="secondary-button" onClick={() => setManageShelfOpen(false)}>取消</button><button className="primary-button">保存</button></div></form></div>}
    {organizeBook && <div className="modal-backdrop" onMouseDown={() => setOrganizeBook(null)}><form className="dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={async (event) => { event.preventDefault(); await perform(() => window.roxy.setBookShelves(organizeBook.id, organizeShelfIds), '子书架已更新'); setOrganizeBook(null) }}><div className="dialog-head"><strong>整理到子书架</strong><button type="button" className="icon-button" onClick={() => setOrganizeBook(null)}><X size={18} /></button></div><p className="organize-title">{organizeBook.title}</p>{shelves.length ? <div className="shelf-check-list">{shelves.map((shelf) => <label key={shelf.id}><input type="checkbox" checked={organizeShelfIds.includes(shelf.id)} onChange={(event) => setOrganizeShelfIds((current) => event.target.checked ? [...current, shelf.id] : current.filter((id) => id !== shelf.id))} /><span><i className="shelf-color-dot" style={{ backgroundColor: shelf.color }} />{shelf.name}</span><small>{shelf.bookIds.length} 本</small></label>)}</div> : <div className="dialog-empty"><span>还没有子书架</span><button type="button" className="secondary-button" onClick={() => { setOrganizeBook(null); setCreateShelfOpen(true) }}>先新建子书架</button></div>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setOrganizeBook(null)}>取消</button><button className="primary-button" disabled={!shelves.length}>保存</button></div></form></div>}
    {batchOrganizeOpen && <div className="modal-backdrop" onMouseDown={() => setBatchOrganizeOpen(false)}><form className="dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={async (event) => { event.preventDefault(); await saveBatchOrganize() }}><div className="dialog-head"><strong>批量整理到子书架</strong><button type="button" className="icon-button" onClick={() => setBatchOrganizeOpen(false)}><X size={18} /></button></div><p className="organize-title">已选择 {selectedBookIds.length} 本书</p>{shelves.length ? <><p>横线表示只有部分书籍属于该子书架；不操作会保留各自归属。</p><div className="shelf-check-list">{shelves.map((shelf) => { const touched = batchTouchedShelfIds.includes(shelf.id); const mixed = batchMixedShelfIds.includes(shelf.id) && !touched; return <label key={shelf.id}><input type="checkbox" checked={batchShelfValues[shelf.id] ?? false} ref={(input) => { if (input) input.indeterminate = mixed }} onChange={(event) => { setBatchTouchedShelfIds((current) => current.includes(shelf.id) ? current : [...current, shelf.id]); setBatchShelfValues((current) => ({ ...current, [shelf.id]: event.target.checked })) }} /><span><i className="shelf-color-dot" style={{ backgroundColor: shelf.color }} />{shelf.name}</span><small>{mixed ? '部分' : batchShelfValues[shelf.id] ? '全部' : '未选'}</small></label> })}</div></> : <div className="dialog-empty"><span>还没有子书架</span><button type="button" className="secondary-button" onClick={() => { setBatchOrganizeOpen(false); setCreateShelfOpen(true) }}>先新建子书架</button></div>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setBatchOrganizeOpen(false)}>取消</button><button className="primary-button" disabled={!shelves.length || !batchTouchedShelfIds.length}>应用整理</button></div></form></div>}
    {settingsOpen && <div className="modal-backdrop" onMouseDown={() => setSettingsOpen(false)}><div className="dialog" onMouseDown={(event) => event.stopPropagation()}><div className="dialog-head"><strong>书架设置</strong><button className="icon-button" onClick={() => setSettingsOpen(false)}><X size={18} /></button></div><label className="toggle-row"><span><strong>显示 PDF 第一页封面</strong><small>开启后在本地生成缺失的 PDF 封面；默认关闭。</small></span><input type="checkbox" checked={appSettings.pdfFirstPageCovers} onChange={async (event) => { const enabled = event.target.checked; setAppSettings((current) => ({ ...current, pdfFirstPageCovers: enabled })); try { setAppSettings(await window.roxy.updateAppSettings({ pdfFirstPageCovers: enabled })) } catch { await refresh(); setNotice('PDF 封面设置保存失败') } }} /></label><p>关闭时不生成、也不显示 PDF 封面；已生成的本地缓存会保留，方便再次开启。</p></div></div>}
    {editBook && <div className="modal-backdrop" onMouseDown={() => setEditBook(null)}><form className="dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); await perform(() => window.roxy.updateBookMetadata(editBook.id, String(data.get('title')), String(data.get('author'))), '书籍信息已更新'); setEditBook(null) }}><div className="dialog-head"><strong>修改书籍信息</strong><button type="button" className="icon-button" onClick={() => setEditBook(null)}><X size={18} /></button></div><label>显示书名<input name="title" defaultValue={editBook.title} autoFocus /></label><label>显示作者<input name="author" defaultValue={editBook.author} /></label><p>只修改 Roxy 中的显示信息，不会改写原始文件。</p><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setEditBook(null)}>取消</button><button className="primary-button">保存</button></div></form></div>}
    {removeCandidate && <div className="modal-backdrop" onMouseDown={() => setRemoveCandidate(null)}><div className="dialog confirm-dialog" onMouseDown={(event) => event.stopPropagation()}><div className="dialog-head"><strong>从书架移除？</strong><button className="icon-button" onClick={() => setRemoveCandidate(null)}><X size={18} /></button></div><p>“{removeCandidate.title}”将从 Roxy 书架移除，原始电子书文件不会被删除。</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setRemoveCandidate(null)}>取消</button><button className="danger-button" onClick={async () => { await perform(() => window.roxy.removeBook(removeCandidate.id), '已从书架移除，原始文件保持不变'); setRemoveCandidate(null) }}>移除</button></div></div></div>}
    {dragKind && <aside className={`drag-shelf-tray ${dragKind}`} aria-label={dragKind === 'files' ? '选择导入子书架' : '选择移动子书架'}><div className="drag-shelf-tray-head">{dragKind === 'files' ? <Download size={16} /> : <FolderInput size={16} />}<div><strong>{dragKind === 'files' ? '导入到子书架' : '移动到子书架'}</strong><span>{dragKind === 'files' ? '松开到目标书架即可导入并归类' : '松开到目标书架即可移动'}</span></div></div>{shelves.length ? <div className="drag-shelf-tray-list">{shelves.map((shelf) => <button key={shelf.id} className={dragOverShelfId === shelf.id ? 'drag-over' : ''} {...shelfDropHandlers(shelf)}><i className="shelf-color-dot" style={{ backgroundColor: shelf.color }} />{shelf.name}<small>{shelf.bookIds.length} 本</small></button>)}</div> : <p>松开即可导入到书架</p>}</aside>}
  </div>
}
