import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { pathToFileURL } from 'node:url'
import type { AnnotationKind, ImportedMetadata, PdfImportCandidate } from '../shared/models'
import { isPhaseOneBook } from '../shared/bookFormat'
import { getTextInfo, initializeTextBook, prepareTextImports, readTextChunk, searchText, startTextIndex } from './textService'
import { renderPdfFirstPageCover } from './pdfCoverService'
import {
  addAnnotation, bookPath, checkpointReadingSession, createShelf, endReadingSession, findBookByHash, findBookById,
  getAppSettings, getBookReadingStatistics, getPdfReadingState, getReadingOverview, getReadingState, initializeDatabase,
  insertBook, listAnnotations, listBooks, listShelves, markBookRead, relinkBook, removeAnnotation, removeBook, removeShelf,
  renameShelf, savePdfReadingState, saveReadingState, setBookCover, setBookShelves, setBooksShelves, setLastOpened, startReadingSession,
  updateAppSettings, updateBookMetadata
} from './database'

let mainWindow: BrowserWindow | null = null
let pendingOpenFiles: string[] = []
let rendererReady = false
let pdfCoverBackfillPromise: Promise<void> | null = null
let startupNotice = ''

if (!app.isPackaged && process.env.ROXY_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.ROXY_USER_DATA_DIR))
}

function validEpubPaths(paths: string[]): string[] {
  return paths.filter((item) => isPhaseOneBook(item) && fs.existsSync(item))
}

function validBookPaths(paths: string[]): string[] {
  const seen = new Set<string>()
  return paths.filter((item) => {
    if (!['.epub', '.txt', '.pdf'].includes(path.extname(item).toLowerCase()) || !fs.existsSync(item)) return false
    const key = path.resolve(item).toLocaleLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function preparePdfImports(paths: string[]): Promise<PdfImportCandidate[]> {
  return Promise.all(validBookPaths(paths).filter((item) => path.extname(item).toLowerCase() === '.pdf').map(async (filePath) => ({
    filePath,
    fileName: path.basename(filePath),
    fileHash: await hashFile(filePath),
    size: (await fs.promises.stat(filePath)).size,
    title: path.basename(filePath, path.extname(filePath)),
    author: '未知作者'
  })))
}

function sendOpenFiles(paths: string[]): void {
  const valid = validBookPaths(paths)
  if (!valid.length) return
  if (mainWindow?.webContents && rendererReady) mainWindow.webContents.send('files:opened', valid, true)
  else pendingOpenFiles = validBookPaths([...pendingOpenFiles, ...valid])
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 840,
    minHeight: 600,
    show: false,
    backgroundColor: '#111318',
    title: 'Roxy 的书架',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('did-finish-load', () => {
    rendererReady = true
    void backfillMissingPdfCovers()
  })
  mainWindow.on('closed', () => { mainWindow = null; rendererReady = false })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function coverFileFromUrl(coverUrl: string | null): string | null {
  if (!coverUrl?.startsWith('roxy-cover://')) return null
  const url = new URL(coverUrl)
  const fileName = path.basename(url.hostname + url.pathname)
  return path.join(app.getPath('userData'), 'covers', fileName)
}

async function storeCoverDataUrl(bookId: string, dataUrl: string): Promise<string | null> {
  const match = dataUrl.match(/^data:(image\/[\w.+-]+);base64,(.+)$/)
  if (!match) return null
  const extension = match[1].includes('png') ? 'png' : 'jpg'
  const coverDirectory = path.join(app.getPath('userData'), 'covers')
  await fs.promises.mkdir(coverDirectory, { recursive: true })
  await fs.promises.writeFile(path.join(coverDirectory, `${bookId}.${extension}`), Buffer.from(match[2], 'base64'))
  return `roxy-cover://${bookId}.${extension}`
}

async function backfillMissingPdfCovers(): Promise<void> {
  if (!getAppSettings().pdfFirstPageCovers) return
  if (pdfCoverBackfillPromise) return pdfCoverBackfillPromise
  pdfCoverBackfillPromise = (async () => {
    let changed = false
    for (const book of listBooks()) {
      if (book.format !== 'pdf' || book.coverUrl || !fs.existsSync(book.filePath)) continue
      const dataUrl = await renderPdfFirstPageCover(book.filePath)
      if (!dataUrl) continue
      const coverUrl = await storeCoverDataUrl(book.id, dataUrl)
      if (!coverUrl) continue
      setBookCover(book.id, coverUrl)
      changed = true
    }
    if (changed) mainWindow?.webContents.send('library:changed')
  })().finally(() => { pdfCoverBackfillPromise = null })
  return pdfCoverBackfillPromise
}

function registerIpc(): void {
  ipcMain.handle('files:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '导入电子书', properties: ['openFile', 'multiSelections'],
      filters: [{ name: '电子书', extensions: ['epub', 'txt', 'pdf'] }]
    })
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle('files:take-pending', () => {
    const paths = pendingOpenFiles
    pendingOpenFiles = []
    return paths
  })
  ipcMain.handle('imports:prepare', async (_event, paths: string[]) => Promise.all(validEpubPaths(paths).map(async (filePath) => {
    const buffer = await fs.promises.readFile(filePath)
    return {
      filePath, fileName: path.basename(filePath),
      fileHash: crypto.createHash('sha256').update(buffer).digest('hex'),
      size: buffer.byteLength,
      data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    }
  })))
  ipcMain.handle('text-imports:prepare', (_event, paths: string[]) => prepareTextImports(paths))
  ipcMain.handle('pdf-imports:prepare', (_event, paths: string[]) => preparePdfImports(paths))
  ipcMain.handle('library:list', () => listBooks())
  ipcMain.handle('shelves:list', () => listShelves())
  ipcMain.handle('shelves:create', (_event, name: string, color: string) => createShelf(crypto.randomUUID(), name, color))
  ipcMain.handle('shelves:rename', (_event, shelfId: string, name: string, color: string) => renameShelf(shelfId, name, color))
  ipcMain.handle('shelves:remove', (_event, shelfId: string) => removeShelf(shelfId))
  ipcMain.handle('shelves:set-book', (_event, bookId: string, shelfIds: string[]) => setBookShelves(bookId, shelfIds))
  ipcMain.handle('shelves:set-books', (_event, assignments) => setBooksShelves(assignments))
  ipcMain.handle('settings:get', () => getAppSettings())
  ipcMain.handle('app:take-startup-notice', () => {
    const notice = startupNotice
    startupNotice = ''
    return notice
  })
  ipcMain.handle('settings:update', (_event, settings) => {
    const updated = updateAppSettings(settings)
    mainWindow?.webContents.send('library:changed')
    if (updated.pdfFirstPageCovers) void backfillMissingPdfCovers()
    return updated
  })
  ipcMain.handle('library:update-metadata', (_event, id: string, title: string, author: string) => {
    const cleanTitle = title.trim()
    const cleanAuthor = author.trim()
    if (!cleanTitle) throw new Error('书名不能为空')
    return updateBookMetadata(id, cleanTitle, cleanAuthor || '未知作者')
  })
  ipcMain.handle('library:choose-cover', async (_event, id: string) => {
    const book = findBookById(id)
    if (!book) throw new Error('书籍不在书架中')
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择封面图片', properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const source = result.filePaths[0]
    const extension = path.extname(source).toLowerCase().replace('.', '') || 'jpg'
    const coverDirectory = path.join(app.getPath('userData'), 'covers')
    await fs.promises.mkdir(coverDirectory, { recursive: true })
    const oldCover = coverFileFromUrl(book.coverUrl)
    const target = path.join(coverDirectory, `${id}.${extension}`)
    await fs.promises.copyFile(source, target)
    if (oldCover && path.resolve(oldCover) !== path.resolve(target) && fs.existsSync(oldCover)) await fs.promises.unlink(oldCover)
    return setBookCover(id, `roxy-cover://${id}.${extension}?v=${Date.now()}`)
  })
  ipcMain.handle('library:reveal', (_event, id: string) => {
    const filePath = bookPath(id)
    if (!filePath || !fs.existsSync(filePath)) throw new Error('找不到原始电子书')
    shell.showItemInFolder(filePath)
  })
  ipcMain.handle('library:mark-read', (_event, id: string) => markBookRead(id))
  ipcMain.handle('library:remove', async (_event, id: string) => {
    const book = findBookById(id)
    if (!book) return
    const coverPath = coverFileFromUrl(book.coverUrl)
    removeBook(id)
    const localFiles = [coverPath,
      path.join(app.getPath('userData'), 'text-cache', `${id}.utf8`),
      path.join(app.getPath('userData'), 'text-cache', `${id}.json`)]
    await Promise.all(localFiles.filter((item): item is string => Boolean(item)).map(async (item) => {
      if (fs.existsSync(item)) await fs.promises.unlink(item)
    }))
  })
  ipcMain.handle('library:add', async (_event, metadata: ImportedMetadata) => {
    const duplicate = findBookByHash(metadata.fileHash)
    if (duplicate) {
      const relinked = path.resolve(duplicate.filePath).toLowerCase() !== path.resolve(metadata.filePath).toLowerCase()
      let book = relinked ? relinkBook(metadata.fileHash, metadata.filePath, metadata.fileName) : duplicate
      if (book.format === 'pdf' && !book.coverUrl && getAppSettings().pdfFirstPageCovers) {
        const dataUrl = await renderPdfFirstPageCover(metadata.filePath)
        const coverUrl = dataUrl ? await storeCoverDataUrl(book.id, dataUrl) : null
        if (coverUrl) book = setBookCover(book.id, coverUrl)
      }
      return { book, duplicate: true, relinked }
    }
    const id = crypto.randomUUID()
    let coverUrl: string | null = null
    const coverDataUrl = metadata.coverDataUrl ??
      (metadata.format === 'pdf' && getAppSettings().pdfFirstPageCovers ? await renderPdfFirstPageCover(metadata.filePath) : null)
    if (coverDataUrl) coverUrl = await storeCoverDataUrl(id, coverDataUrl)
    return { book: insertBook(metadata, id, coverUrl), duplicate: false, relinked: false }
  })
  ipcMain.handle('book:read', async (_event, id: string) => {
    const filePath = bookPath(id)
    if (!filePath) throw new Error('书籍不在书架中')
    if (!fs.existsSync(filePath)) throw new Error('找不到原始电子书。请从文件的新位置重新导入同一本书以更新路径。')
    const buffer = await fs.promises.readFile(filePath)
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  })
  ipcMain.handle('progress:get', (_event, id: string) => getReadingState(id))
  ipcMain.handle('progress:save', (_event, state) => saveReadingState(state))
  ipcMain.handle('library:opened', (_event, id: string) => setLastOpened(id))
  ipcMain.handle('text:initialize', (_event, id: string, encoding) => initializeTextBook(id, encoding))
  ipcMain.handle('text:info', (_event, id: string) => getTextInfo(id))
  ipcMain.handle('text:chunk', (_event, id: string, start: number) => readTextChunk(id, start))
  ipcMain.handle('text:rebuild', (_event, id: string, encoding, detectChapters: boolean) => startTextIndex(id, encoding, detectChapters))
  ipcMain.handle('text:search', (_event, id: string, query: string) => searchText(id, query))
  ipcMain.handle('pdf:progress-get', (_event, id: string) => getPdfReadingState(id))
  ipcMain.handle('pdf:progress-save', (_event, state) => savePdfReadingState(state))
  ipcMain.handle('reading-session:start', (_event, bookId: string) => startReadingSession(bookId, crypto.randomUUID(), Date.now()))
  ipcMain.handle('reading-session:checkpoint', (_event, sessionId: string, activeSeconds: number) => {
    checkpointReadingSession(sessionId, activeSeconds, Date.now())
  })
  ipcMain.handle('reading-session:end', (_event, sessionId: string, activeSeconds: number) => {
    endReadingSession(sessionId, activeSeconds, Date.now())
  })
  ipcMain.handle('reading-statistics:book', (_event, bookId: string) => getBookReadingStatistics(bookId))
  ipcMain.handle('reading-statistics:overview', () => getReadingOverview())
  ipcMain.handle('annotations:list', (_event, bookId: string) => listAnnotations(bookId))
  ipcMain.handle('annotations:add', (_event, bookId: string, kind: AnnotationKind, locator: string, excerpt: string) =>
    addAnnotation(bookId, crypto.randomUUID(), kind, locator, excerpt))
  ipcMain.handle('annotations:remove', (_event, annotationId: string) => removeAnnotation(annotationId))
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
else {
  protocol.registerSchemesAsPrivileged([{ scheme: 'roxy-cover', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
  app.on('second-instance', (_event, argv) => {
    sendOpenFiles(argv.filter((arg) => ['.epub', '.txt', '.pdf'].includes(path.extname(arg).toLowerCase())))
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.whenReady().then(async () => {
    app.setAppUserModelId('local.roxy.bookshelf')
    protocol.handle('roxy-cover', (request) => {
      const name = path.basename(new URL(request.url).hostname + new URL(request.url).pathname)
      const coverPath = path.join(app.getPath('userData'), 'covers', name)
      return net.fetch(pathToFileURL(coverPath).toString())
    })
    const databaseResult = await initializeDatabase()
    if (databaseResult.recovered) startupNotice = '书库数据库已损坏，Roxy 已保留备份并建立新书库。原始电子书没有被修改。'
    registerIpc()
    createWindow()
    sendOpenFiles(process.argv.filter((arg) => ['.epub', '.txt', '.pdf'].includes(path.extname(arg).toLowerCase())))
  })
}

app.on('window-all-closed', () => app.quit())
