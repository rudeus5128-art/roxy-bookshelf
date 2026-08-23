import fs from 'node:fs'
import path from 'node:path'
import initSqlJs, { type Database } from 'sql.js'
import { app } from 'electron'
import { splitActivityByLocalDay } from './readingActivity'
import type {
  AnnotationKind, AppSettings, BookAnnotation, BookReadingStatistics, BookRecord, BookShelfAssignment, CustomShelf, ImportedMetadata, PdfReadingState,
  ReadingOverview, ReadingSessionHandle, ReadingState, ReadingTrendPoint, TextEncoding
} from '../shared/models'

let db: Database
let dbPath: string

function rows<T>(statement: ReturnType<Database['prepare']>): T[] {
  const result: T[] = []
  while (statement.step()) result.push(statement.getAsObject() as T)
  statement.free()
  return result
}

function persist(): void {
  const temporary = `${dbPath}.tmp`
  fs.writeFileSync(temporary, Buffer.from(db.export()))
  fs.renameSync(temporary, dbPath)
}

function hasColumn(table: string, column: string): boolean {
  const statement = db.prepare(`PRAGMA table_info(${table})`)
  return rows<{ name: string }>(statement).some((item) => item.name === column)
}

function migrateDatabase(): void {
  db.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      format TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_hash TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      cover_url TEXT,
      added_at INTEGER NOT NULL,
      last_opened_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS reading_states (
      book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
      location TEXT,
      progress REAL NOT NULL DEFAULT 0,
      font_size INTEGER NOT NULL DEFAULT 18,
      line_height REAL NOT NULL DEFAULT 1.7,
      content_width INTEGER NOT NULL DEFAULT 720,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS text_settings (
      book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
      encoding TEXT NOT NULL,
      detect_chapters INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS pdf_states (
      book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
      page INTEGER NOT NULL DEFAULT 1,
      total_pages INTEGER NOT NULL DEFAULT 1,
      zoom REAL NOT NULL DEFAULT 1,
      zoom_mode TEXT NOT NULL DEFAULT 'fit-width',
      view_mode TEXT NOT NULL DEFAULT 'continuous',
      scroll_offset REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reading_sessions (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      session_start INTEGER NOT NULL,
      session_end INTEGER NOT NULL,
      active_seconds INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS reading_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES reading_sessions(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      recorded_at INTEGER NOT NULL,
      active_seconds INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reading_sessions_book ON reading_sessions(book_id, session_start);
    CREATE INDEX IF NOT EXISTS idx_reading_activity_time ON reading_activity(recorded_at);
    CREATE INDEX IF NOT EXISTS idx_reading_activity_book_time ON reading_activity(book_id, recorded_at);
    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('bookmark', 'highlight')),
      locator TEXT NOT NULL,
      excerpt TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      UNIQUE(book_id, kind, locator)
    );
    CREATE INDEX IF NOT EXISTS idx_annotations_book ON annotations(book_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS shelves (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      color TEXT NOT NULL DEFAULT '#1769FF',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shelf_books (
      shelf_id TEXT NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (shelf_id, book_id)
    );
    CREATE INDEX IF NOT EXISTS idx_shelf_books_book ON shelf_books(book_id);
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT OR IGNORE INTO app_settings (key, value) VALUES ('pdf_first_page_covers', 'false');
  `)
  if (!hasColumn('books', 'completed')) db.run('ALTER TABLE books ADD COLUMN completed INTEGER NOT NULL DEFAULT 0')
  if (!hasColumn('books', 'completed_at')) db.run('ALTER TABLE books ADD COLUMN completed_at INTEGER')
  if (!hasColumn('reading_states', 'font_family')) db.run("ALTER TABLE reading_states ADD COLUMN font_family TEXT NOT NULL DEFAULT 'system'")
  if (!hasColumn('reading_states', 'paragraph_spacing')) db.run('ALTER TABLE reading_states ADD COLUMN paragraph_spacing REAL NOT NULL DEFAULT 0.65')
  if (!hasColumn('reading_states', 'page_margin')) db.run('ALTER TABLE reading_states ADD COLUMN page_margin INTEGER NOT NULL DEFAULT 42')
  if (!hasColumn('reading_states', 'reading_mode')) db.run("ALTER TABLE reading_states ADD COLUMN reading_mode TEXT NOT NULL DEFAULT 'paginated'")
  if (!hasColumn('reading_states', 'page_layout')) db.run("ALTER TABLE reading_states ADD COLUMN page_layout TEXT NOT NULL DEFAULT 'double'")
  if (!hasColumn('shelves', 'color')) db.run("ALTER TABLE shelves ADD COLUMN color TEXT NOT NULL DEFAULT '#1769FF'")
  db.run('DELETE FROM reading_sessions WHERE active_seconds = 0')
  persist()
}

export async function initializeDatabase(): Promise<{ recovered: boolean }> {
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') })
  const dataDirectory = app.getPath('userData')
  fs.mkdirSync(dataDirectory, { recursive: true })
  dbPath = path.join(dataDirectory, 'roxy-library.sqlite3')
  const existed = fs.existsSync(dbPath)
  try {
    db = existed ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database()
    migrateDatabase()
    return { recovered: false }
  } catch (error) {
    if (!existed) throw error
    try { db?.close() } catch {}
    fs.renameSync(dbPath, `${dbPath}.corrupt-${Date.now()}`)
    db = new SQL.Database()
    migrateDatabase()
    return { recovered: true }
  }
}

export function listBooks(): BookRecord[] {
  return rows<BookRecord>(db.prepare(`
    SELECT b.id, b.format, b.file_path AS filePath, b.file_name AS fileName,
      b.file_hash AS fileHash, b.title, b.author, b.cover_url AS coverUrl,
      b.added_at AS addedAt, b.last_opened_at AS lastOpenedAt,
      CASE WHEN b.completed = 1 THEN 1
        WHEN b.format = 'pdf' THEN COALESCE(p.page * 1.0 / NULLIF(p.total_pages, 0), 0)
        ELSE COALESCE(r.progress, 0) END AS progress
    FROM books b LEFT JOIN reading_states r ON r.book_id = b.id
      LEFT JOIN pdf_states p ON p.book_id = b.id
    ORDER BY COALESCE(b.last_opened_at, b.added_at) DESC
  `))
}

function cleanShelfName(name: string): string {
  const clean = name.trim()
  if (!clean) throw new Error('子书架名称不能为空')
  if (clean.length > 40) throw new Error('子书架名称不能超过 40 个字符')
  return clean
}

function cleanShelfColor(color: string): string {
  const clean = color.trim().toUpperCase()
  if (!/^#[0-9A-F]{6}$/.test(clean)) throw new Error('子书架代表色无效')
  return clean
}

function shelfById(shelfId: string): CustomShelf | null {
  const statement = db.prepare('SELECT id, name, color, created_at AS createdAt FROM shelves WHERE id = ?')
  statement.bind([shelfId])
  const shelf = rows<Omit<CustomShelf, 'bookIds'>>(statement)[0]
  if (!shelf) return null
  const booksStatement = db.prepare('SELECT book_id AS bookId FROM shelf_books WHERE shelf_id = ? ORDER BY added_at')
  booksStatement.bind([shelfId])
  return { ...shelf, bookIds: rows<{ bookId: string }>(booksStatement).map((item) => item.bookId) }
}

export function listShelves(): CustomShelf[] {
  return rows<Omit<CustomShelf, 'bookIds'>>(db.prepare('SELECT id, name, color, created_at AS createdAt FROM shelves ORDER BY created_at'))
    .map((shelf) => shelfById(shelf.id)!)
}

export function createShelf(id: string, name: string, color: string): CustomShelf {
  try {
    db.run('INSERT INTO shelves (id, name, color, created_at) VALUES (?, ?, ?, ?)', [id, cleanShelfName(name), cleanShelfColor(color), Date.now()])
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new Error('已有同名子书架')
    throw error
  }
  persist()
  return shelfById(id)!
}

export function renameShelf(shelfId: string, name: string, color: string): CustomShelf {
  if (!shelfById(shelfId)) throw new Error('找不到这个子书架')
  try {
    db.run('UPDATE shelves SET name = ?, color = ? WHERE id = ?', [cleanShelfName(name), cleanShelfColor(color), shelfId])
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new Error('已有同名子书架')
    throw error
  }
  persist()
  return shelfById(shelfId)!
}

export function removeShelf(shelfId: string): void {
  db.run('DELETE FROM shelves WHERE id = ?', [shelfId])
  persist()
}

export function setBookShelves(bookId: string, shelfIds: string[]): void {
  setBooksShelves([{ bookId, shelfIds }])
}

export function setBooksShelves(assignments: BookShelfAssignment[]): void {
  const normalized = assignments.map((assignment) => ({
    bookId: assignment.bookId,
    shelfIds: [...new Set(assignment.shelfIds)]
  }))
  if (!normalized.length) return
  if (normalized.some((assignment) => !findBookById(assignment.bookId))) throw new Error('书籍不在书架中')
  const allShelfIds = [...new Set(normalized.flatMap((assignment) => assignment.shelfIds))]
  if (allShelfIds.some((id) => !shelfById(id))) throw new Error('子书架不存在')
  db.run('BEGIN')
  try {
    const now = Date.now()
    for (const assignment of normalized) {
      db.run('DELETE FROM shelf_books WHERE book_id = ?', [assignment.bookId])
      for (const shelfId of assignment.shelfIds) {
        db.run('INSERT INTO shelf_books (shelf_id, book_id, added_at) VALUES (?, ?, ?)', [shelfId, assignment.bookId, now])
      }
    }
    db.run('COMMIT')
    persist()
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  }
}

export function getAppSettings(): AppSettings {
  const statement = db.prepare("SELECT value FROM app_settings WHERE key = 'pdf_first_page_covers'")
  const value = rows<{ value: string }>(statement)[0]?.value
  return { pdfFirstPageCovers: value === 'true' }
}

export function updateAppSettings(settings: Partial<AppSettings>): AppSettings {
  if (typeof settings.pdfFirstPageCovers === 'boolean') {
    db.run("INSERT INTO app_settings (key, value) VALUES ('pdf_first_page_covers', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [settings.pdfFirstPageCovers ? 'true' : 'false'])
    persist()
  }
  return getAppSettings()
}

export function findBookByHash(hash: string): BookRecord | null {
  const statement = db.prepare(`
    SELECT b.id, b.format, b.file_path AS filePath, b.file_name AS fileName,
      b.file_hash AS fileHash, b.title, b.author, b.cover_url AS coverUrl,
      b.added_at AS addedAt, b.last_opened_at AS lastOpenedAt,
      CASE WHEN b.completed = 1 THEN 1
        WHEN b.format = 'pdf' THEN COALESCE(p.page * 1.0 / NULLIF(p.total_pages, 0), 0)
        ELSE COALESCE(r.progress, 0) END AS progress
    FROM books b LEFT JOIN reading_states r ON r.book_id = b.id
      LEFT JOIN pdf_states p ON p.book_id = b.id WHERE b.file_hash = ?
  `)
  statement.bind([hash])
  return rows<BookRecord>(statement)[0] ?? null
}

export function insertBook(metadata: ImportedMetadata, id: string, coverUrl: string | null): BookRecord {
  const now = Date.now()
  db.run(
    `INSERT INTO books (id, format, file_path, file_name, file_hash, title, author, cover_url, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, metadata.format, metadata.filePath, metadata.fileName, metadata.fileHash, metadata.title, metadata.author, coverUrl, now]
  )
  persist()
  return findBookByHash(metadata.fileHash)!
}

export function relinkBook(hash: string, filePath: string, fileName: string): BookRecord {
  db.run('UPDATE books SET file_path = ?, file_name = ? WHERE file_hash = ?', [filePath, fileName, hash])
  persist()
  return findBookByHash(hash)!
}

export function bookPath(bookId: string): string | null {
  const statement = db.prepare('SELECT file_path AS filePath FROM books WHERE id = ?')
  statement.bind([bookId])
  const result = rows<{ filePath: string }>(statement)[0]
  return result?.filePath ?? null
}

export function findBookById(bookId: string): BookRecord | null {
  const statement = db.prepare(`
    SELECT b.id, b.format, b.file_path AS filePath, b.file_name AS fileName,
      b.file_hash AS fileHash, b.title, b.author, b.cover_url AS coverUrl,
      b.added_at AS addedAt, b.last_opened_at AS lastOpenedAt,
      CASE WHEN b.completed = 1 THEN 1
        WHEN b.format = 'pdf' THEN COALESCE(p.page * 1.0 / NULLIF(p.total_pages, 0), 0)
        ELSE COALESCE(r.progress, 0) END AS progress
    FROM books b LEFT JOIN reading_states r ON r.book_id = b.id
      LEFT JOIN pdf_states p ON p.book_id = b.id WHERE b.id = ?
  `)
  statement.bind([bookId])
  return rows<BookRecord>(statement)[0] ?? null
}

export function getReadingState(bookId: string): ReadingState | null {
  const statement = db.prepare(`SELECT book_id AS bookId, location, progress,
    font_size AS fontSize, line_height AS lineHeight, content_width AS contentWidth,
    font_family AS fontFamily, paragraph_spacing AS paragraphSpacing,
    page_margin AS pageMargin, reading_mode AS readingMode, page_layout AS pageLayout,
    updated_at AS updatedAt FROM reading_states WHERE book_id = ?`)
  statement.bind([bookId])
  return rows<ReadingState>(statement)[0] ?? null
}

export function saveReadingState(state: ReadingState): void {
  db.run(`INSERT INTO reading_states
    (book_id, location, progress, font_size, line_height, content_width,
      font_family, paragraph_spacing, page_margin, reading_mode, page_layout, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(book_id) DO UPDATE SET location=excluded.location, progress=excluded.progress,
      font_size=excluded.font_size, line_height=excluded.line_height,
      content_width=excluded.content_width, font_family=excluded.font_family,
      paragraph_spacing=excluded.paragraph_spacing, page_margin=excluded.page_margin,
      reading_mode=excluded.reading_mode, page_layout=excluded.page_layout, updated_at=excluded.updated_at`,
    [state.bookId, state.location, state.progress, state.fontSize, state.lineHeight, state.contentWidth,
      state.fontFamily, state.paragraphSpacing, state.pageMargin, state.readingMode, state.pageLayout, state.updatedAt]
  )
  if (state.progress >= 0.995) {
    db.run('UPDATE books SET completed = 1, completed_at = COALESCE(completed_at, ?) WHERE id = ?', [Date.now(), state.bookId])
  }
  persist()
}

export function setLastOpened(bookId: string): void {
  db.run('UPDATE books SET last_opened_at = ? WHERE id = ?', [Date.now(), bookId])
  persist()
}

export function updateBookMetadata(bookId: string, title: string, author: string): BookRecord {
  db.run('UPDATE books SET title = ?, author = ? WHERE id = ?', [title, author, bookId])
  persist()
  return findBookById(bookId)!
}

export function setBookCover(bookId: string, coverUrl: string): BookRecord {
  db.run('UPDATE books SET cover_url = ? WHERE id = ?', [coverUrl, bookId])
  persist()
  return findBookById(bookId)!
}

export function markBookRead(bookId: string): void {
  db.run('UPDATE books SET completed = 1, completed_at = COALESCE(completed_at, ?) WHERE id = ?', [Date.now(), bookId])
  persist()
}

export function removeBook(bookId: string): void {
  db.run('DELETE FROM books WHERE id = ?', [bookId])
  persist()
}

export function saveTextSettings(bookId: string, encoding: TextEncoding, detectChapters = true): void {
  db.run(`INSERT INTO text_settings (book_id, encoding, detect_chapters) VALUES (?, ?, ?)
    ON CONFLICT(book_id) DO UPDATE SET encoding=excluded.encoding, detect_chapters=excluded.detect_chapters`,
  [bookId, encoding, detectChapters ? 1 : 0])
  persist()
}

export function getTextSettings(bookId: string): { encoding: TextEncoding; detectChapters: boolean } | null {
  const statement = db.prepare('SELECT encoding, detect_chapters AS detectChapters FROM text_settings WHERE book_id = ?')
  statement.bind([bookId])
  const result = rows<{ encoding: TextEncoding; detectChapters: number }>(statement)[0]
  return result ? { encoding: result.encoding, detectChapters: Boolean(result.detectChapters) } : null
}

export function getPdfReadingState(bookId: string): PdfReadingState | null {
  const statement = db.prepare(`SELECT book_id AS bookId, page, total_pages AS totalPages, zoom, zoom_mode AS zoomMode,
    view_mode AS viewMode, scroll_offset AS scrollOffset, updated_at AS updatedAt
    FROM pdf_states WHERE book_id = ?`)
  statement.bind([bookId])
  return rows<PdfReadingState>(statement)[0] ?? null
}

export function savePdfReadingState(state: PdfReadingState): void {
  db.run(`INSERT INTO pdf_states
    (book_id, page, total_pages, zoom, zoom_mode, view_mode, scroll_offset, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(book_id) DO UPDATE SET page=excluded.page, total_pages=excluded.total_pages, zoom=excluded.zoom,
      zoom_mode=excluded.zoom_mode, view_mode=excluded.view_mode,
      scroll_offset=excluded.scroll_offset, updated_at=excluded.updated_at`,
    [state.bookId, state.page, state.totalPages, state.zoom, state.zoomMode, state.viewMode, state.scrollOffset, state.updatedAt]
  )
  if (state.totalPages > 0 && state.page >= state.totalPages) {
    db.run('UPDATE books SET completed = 1, completed_at = COALESCE(completed_at, ?) WHERE id = ?', [Date.now(), state.bookId])
  }
  persist()
}

export function startReadingSession(bookId: string, id: string, startedAt: number): ReadingSessionHandle {
  if (!findBookById(bookId)) throw new Error('书籍不在书架中')
  db.run(`INSERT INTO reading_sessions (id, book_id, session_start, session_end, active_seconds)
    VALUES (?, ?, ?, ?, 0)`, [id, bookId, startedAt, startedAt])
  persist()
  return { id, bookId, startedAt }
}

function sessionRow(sessionId: string): { bookId: string; startedAt: number; endedAt: number; activeSeconds: number } | null {
  const statement = db.prepare(`SELECT book_id AS bookId, session_start AS startedAt,
    session_end AS endedAt, active_seconds AS activeSeconds FROM reading_sessions WHERE id = ?`)
  statement.bind([sessionId])
  return rows<{ bookId: string; startedAt: number; endedAt: number; activeSeconds: number }>(statement)[0] ?? null
}

export function checkpointReadingSession(sessionId: string, activeSeconds: number, recordedAt: number): void {
  const current = sessionRow(sessionId)
  if (!current) return
  const safeRecordedAt = Math.max(current.startedAt, Math.floor(recordedAt))
  const elapsedSeconds = Math.max(0, Math.floor((safeRecordedAt - current.startedAt) / 1000))
  const safeActiveSeconds = Math.min(elapsedSeconds, Math.max(0, Math.floor(activeSeconds)))
  const delta = safeActiveSeconds - current.activeSeconds
  if (delta <= 0) return
  db.run('BEGIN')
  try {
    db.run('UPDATE reading_sessions SET session_end = ?, active_seconds = ? WHERE id = ?',
      [safeRecordedAt, safeActiveSeconds, sessionId])
    for (const segment of splitActivityByLocalDay(safeRecordedAt, delta)) {
      db.run(`INSERT INTO reading_activity (session_id, book_id, recorded_at, active_seconds)
        VALUES (?, ?, ?, ?)`, [sessionId, current.bookId, segment.recordedAt, segment.activeSeconds])
    }
    db.run('COMMIT')
    persist()
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  }
}

export function endReadingSession(sessionId: string, activeSeconds: number, recordedAt: number): void {
  checkpointReadingSession(sessionId, activeSeconds, recordedAt)
  const current = sessionRow(sessionId)
  if (current?.activeSeconds === 0) {
    db.run('DELETE FROM reading_sessions WHERE id = ?', [sessionId])
    persist()
  }
}

function sumActivity(start?: number, end?: number): number {
  const conditions: string[] = []
  const values: number[] = []
  if (start !== undefined) { conditions.push('recorded_at >= ?'); values.push(start) }
  if (end !== undefined) { conditions.push('recorded_at < ?'); values.push(end) }
  const statement = db.prepare(`SELECT COALESCE(SUM(active_seconds), 0) AS value FROM reading_activity${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''}`)
  statement.bind(values)
  return Number(rows<{ value: number }>(statement)[0]?.value ?? 0)
}

export function getBookReadingStatistics(bookId: string): BookReadingStatistics {
  const book = findBookById(bookId)
  if (!book) throw new Error('书籍不在书架中')
  const sessionStatement = db.prepare(`SELECT COALESCE(SUM(active_seconds), 0) AS totalActiveSeconds,
    MIN(CASE WHEN active_seconds > 0 THEN session_start END) AS firstReadAt,
    MAX(CASE WHEN active_seconds > 0 THEN session_end END) AS lastReadAt
    FROM reading_sessions WHERE book_id = ?`)
  sessionStatement.bind([bookId])
  const session = rows<{ totalActiveSeconds: number; firstReadAt: number | null; lastReadAt: number | null }>(sessionStatement)[0]
  const completionStatement = db.prepare('SELECT completed_at AS completedAt FROM books WHERE id = ?')
  completionStatement.bind([bookId])
  const completion = rows<{ completedAt: number | null }>(completionStatement)[0]
  return {
    bookId,
    totalActiveSeconds: Number(session?.totalActiveSeconds ?? 0),
    firstReadAt: session?.firstReadAt ?? null,
    lastReadAt: session?.lastReadAt ?? null,
    completedAt: completion?.completedAt ?? null,
    progress: book.progress
  }
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function dateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function recentTrend(now: Date, days: number): ReadingTrendPoint[] {
  const today = startOfLocalDay(now)
  const firstDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days + 1)
  const points = Array.from({ length: days }, (_, index) => {
    const day = new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + index)
    return { date: dateKey(day), activeSeconds: 0 }
  })
  const byDate = new Map(points.map((point) => [point.date, point]))
  const statement = db.prepare('SELECT recorded_at AS recordedAt, active_seconds AS activeSeconds FROM reading_activity WHERE recorded_at >= ?')
  statement.bind([firstDay.getTime()])
  for (const item of rows<{ recordedAt: number; activeSeconds: number }>(statement)) {
    const point = byDate.get(dateKey(new Date(item.recordedAt)))
    if (point) point.activeSeconds += Number(item.activeSeconds)
  }
  return points
}

export function getReadingOverview(nowValue = Date.now()): ReadingOverview {
  const now = new Date(nowValue)
  const today = startOfLocalDay(now)
  const day = today.getDay()
  const week = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (day === 0 ? 6 : day - 1))
  const month = new Date(today.getFullYear(), today.getMonth(), 1)
  const year = new Date(today.getFullYear(), 0, 1)
  const nextYear = new Date(today.getFullYear() + 1, 0, 1)
  const completedStatement = db.prepare('SELECT COUNT(*) AS value FROM books WHERE completed_at >= ? AND completed_at < ?')
  completedStatement.bind([year.getTime(), nextYear.getTime()])
  const topBookStatement = db.prepare(`SELECT a.book_id AS bookId, b.title, SUM(a.active_seconds) AS activeSeconds
    FROM reading_activity a JOIN books b ON b.id = a.book_id
    WHERE a.recorded_at >= ? AND a.recorded_at < ? GROUP BY a.book_id, b.title
    ORDER BY activeSeconds DESC LIMIT 1`)
  topBookStatement.bind([year.getTime(), nextYear.getTime()])
  const topBook = rows<{ bookId: string; title: string; activeSeconds: number }>(topBookStatement)[0] ?? null
  const monthTotals = new Map<number, number>()
  const yearActivity = db.prepare('SELECT recorded_at AS recordedAt, active_seconds AS activeSeconds FROM reading_activity WHERE recorded_at >= ? AND recorded_at < ?')
  yearActivity.bind([year.getTime(), nextYear.getTime()])
  for (const item of rows<{ recordedAt: number; activeSeconds: number }>(yearActivity)) {
    const monthNumber = new Date(item.recordedAt).getMonth() + 1
    monthTotals.set(monthNumber, (monthTotals.get(monthNumber) ?? 0) + Number(item.activeSeconds))
  }
  const topMonthEntry = [...monthTotals.entries()].sort((left, right) => right[1] - left[1])[0]
  return {
    todaySeconds: sumActivity(today.getTime()),
    weekSeconds: sumActivity(week.getTime()),
    monthSeconds: sumActivity(month.getTime()),
    yearSeconds: sumActivity(year.getTime(), nextYear.getTime()),
    totalSeconds: sumActivity(),
    recent7Days: recentTrend(now, 7),
    recent30Days: recentTrend(now, 30),
    yearCompletedBooks: Number(rows<{ value: number }>(completedStatement)[0]?.value ?? 0),
    yearTopBook: topBook ? { ...topBook, activeSeconds: Number(topBook.activeSeconds) } : null,
    yearTopMonth: topMonthEntry ? { month: topMonthEntry[0], activeSeconds: topMonthEntry[1] } : null
  }
}

export function listAnnotations(bookId: string): BookAnnotation[] {
  const statement = db.prepare(`SELECT id, book_id AS bookId, kind, locator, excerpt,
    created_at AS createdAt FROM annotations WHERE book_id = ? ORDER BY created_at DESC`)
  statement.bind([bookId])
  return rows<BookAnnotation>(statement)
}

export function addAnnotation(bookId: string, id: string, kind: AnnotationKind, locator: string, excerpt: string): BookAnnotation {
  if (!findBookById(bookId)) throw new Error('书籍不在书架中')
  if (!['bookmark', 'highlight'].includes(kind)) throw new Error('不支持的标注类型')
  const cleanLocator = locator.trim()
  if (!cleanLocator || cleanLocator.length > 4096) throw new Error('标注位置无效')
  const cleanExcerpt = excerpt.trim().slice(0, 500)
  db.run(`INSERT INTO annotations (id, book_id, kind, locator, excerpt, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(book_id, kind, locator) DO UPDATE SET excerpt = excluded.excerpt`,
  [id, bookId, kind, cleanLocator, cleanExcerpt, Date.now()])
  persist()
  const statement = db.prepare(`SELECT id, book_id AS bookId, kind, locator, excerpt,
    created_at AS createdAt FROM annotations WHERE book_id = ? AND kind = ? AND locator = ?`)
  statement.bind([bookId, kind, cleanLocator])
  return rows<BookAnnotation>(statement)[0]
}

export function removeAnnotation(annotationId: string): void {
  db.run('DELETE FROM annotations WHERE id = ?', [annotationId])
  persist()
}
