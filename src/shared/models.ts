export type BookFormat = 'epub' | 'txt' | 'pdf'

export interface BookRecord {
  id: string
  format: BookFormat
  filePath: string
  fileName: string
  fileHash: string
  title: string
  author: string
  coverUrl: string | null
  addedAt: number
  lastOpenedAt: number | null
  progress: number
}

export interface CustomShelf {
  id: string
  name: string
  color: string
  createdAt: number
  bookIds: string[]
}

export interface BookShelfAssignment {
  bookId: string
  shelfIds: string[]
}

export interface AppSettings {
  pdfFirstPageCovers: boolean
}

export interface ImportCandidate {
  filePath: string
  fileName: string
  fileHash: string
  size: number
  data: ArrayBuffer
}

export interface ImportedMetadata {
  format: BookFormat
  filePath: string
  fileName: string
  fileHash: string
  title: string
  author: string
  coverDataUrl: string | null
}

export type TextEncoding = 'utf8' | 'utf16le' | 'utf16be' | 'gbk' | 'gb18030'

export interface TextImportCandidate {
  filePath: string
  fileName: string
  fileHash: string
  size: number
  title: string
  author: string
  encoding: TextEncoding
}

export interface PdfImportCandidate {
  filePath: string
  fileName: string
  fileHash: string
  size: number
  title: string
  author: string
}

export type PdfViewMode = 'continuous' | 'single' | 'double'
export type PdfZoomMode = 'custom' | 'fit-width' | 'fit-page'
export type TextPageLayout = 'single' | 'double'

export interface PdfReadingState {
  bookId: string
  page: number
  totalPages: number
  zoom: number
  zoomMode: PdfZoomMode
  viewMode: PdfViewMode
  scrollOffset: number
  updatedAt: number
}

export interface TextChapter {
  title: string
  byteOffset: number
}

export interface TextDocumentInfo {
  bookId: string
  encoding: TextEncoding
  detectChapters: boolean
  status: 'pending' | 'indexing' | 'ready' | 'error'
  progress: number
  totalBytes: number
  chapters: TextChapter[]
  error?: string
}

export interface TextChunk {
  start: number
  nextOffset: number
  totalBytes: number
  text: string
  hasMore: boolean
}

export interface ReadingState {
  bookId: string
  location: string | null
  progress: number
  fontSize: number
  lineHeight: number
  contentWidth: number
  fontFamily: string
  paragraphSpacing: number
  pageMargin: number
  readingMode: 'paginated' | 'continuous'
  pageLayout: TextPageLayout
  updatedAt: number
}

export interface TextSearchResult {
  byteOffset: number
  preview: string
}

export interface ReadingSessionHandle {
  id: string
  bookId: string
  startedAt: number
}

export interface BookReadingStatistics {
  bookId: string
  totalActiveSeconds: number
  firstReadAt: number | null
  lastReadAt: number | null
  completedAt: number | null
  progress: number
}

export interface ReadingTrendPoint {
  date: string
  activeSeconds: number
}

export interface ReadingOverview {
  todaySeconds: number
  weekSeconds: number
  monthSeconds: number
  yearSeconds: number
  totalSeconds: number
  recent7Days: ReadingTrendPoint[]
  recent30Days: ReadingTrendPoint[]
  yearCompletedBooks: number
  yearTopBook: { bookId: string; title: string; activeSeconds: number } | null
  yearTopMonth: { month: number; activeSeconds: number } | null
}

export type AnnotationKind = 'bookmark' | 'highlight'

export interface BookAnnotation {
  id: string
  bookId: string
  kind: AnnotationKind
  locator: string
  excerpt: string
  createdAt: number
}

export interface RoxyApi {
  chooseBookFiles(): Promise<string[]>
  getDroppedFilePath(file: File): string
  prepareImports(paths: string[]): Promise<ImportCandidate[]>
  prepareTextImports(paths: string[]): Promise<TextImportCandidate[]>
  preparePdfImports(paths: string[]): Promise<PdfImportCandidate[]>
  addBook(metadata: ImportedMetadata): Promise<{ book: BookRecord; duplicate: boolean; relinked: boolean }>
  listBooks(): Promise<BookRecord[]>
  listShelves(): Promise<CustomShelf[]>
  createShelf(name: string, color: string): Promise<CustomShelf>
  renameShelf(shelfId: string, name: string, color: string): Promise<CustomShelf>
  removeShelf(shelfId: string): Promise<void>
  setBookShelves(bookId: string, shelfIds: string[]): Promise<void>
  setBooksShelves(assignments: BookShelfAssignment[]): Promise<void>
  getAppSettings(): Promise<AppSettings>
  updateAppSettings(settings: Partial<AppSettings>): Promise<AppSettings>
  takeStartupNotice(): Promise<string>
  readBook(bookId: string): Promise<ArrayBuffer>
  getReadingState(bookId: string): Promise<ReadingState | null>
  saveReadingState(state: ReadingState): Promise<void>
  setLastOpened(bookId: string): Promise<void>
  takePendingOpenFiles(): Promise<string[]>
  onOpenFiles(callback: (paths: string[]) => void): () => void
  onLibraryChanged(callback: () => void): () => void
  initializeTextBook(bookId: string, encoding: TextEncoding): Promise<void>
  getTextInfo(bookId: string): Promise<TextDocumentInfo>
  readTextChunk(bookId: string, start: number): Promise<TextChunk>
  rebuildTextIndex(bookId: string, encoding: TextEncoding, detectChapters: boolean): Promise<void>
  getPdfReadingState(bookId: string): Promise<PdfReadingState | null>
  savePdfReadingState(state: PdfReadingState): Promise<void>
  updateBookMetadata(bookId: string, title: string, author: string): Promise<BookRecord>
  chooseBookCover(bookId: string): Promise<BookRecord | null>
  revealBook(bookId: string): Promise<void>
  markBookRead(bookId: string): Promise<void>
  removeBook(bookId: string): Promise<void>
  searchText(bookId: string, query: string): Promise<TextSearchResult[]>
  startReadingSession(bookId: string): Promise<ReadingSessionHandle>
  checkpointReadingSession(sessionId: string, activeSeconds: number): Promise<void>
  endReadingSession(sessionId: string, activeSeconds: number): Promise<void>
  getBookReadingStatistics(bookId: string): Promise<BookReadingStatistics>
  getReadingOverview(): Promise<ReadingOverview>
  listAnnotations(bookId: string): Promise<BookAnnotation[]>
  addAnnotation(bookId: string, kind: AnnotationKind, locator: string, excerpt: string): Promise<BookAnnotation>
  removeAnnotation(annotationId: string): Promise<void>
}
