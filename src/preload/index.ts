import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ImportedMetadata, PdfReadingState, ReadingState, RoxyApi } from '../shared/models'

const api: RoxyApi = {
  chooseBookFiles: () => ipcRenderer.invoke('files:choose'),
  getDroppedFilePath: (file) => webUtils.getPathForFile(file),
  prepareImports: (paths) => ipcRenderer.invoke('imports:prepare', paths),
  prepareTextImports: (paths) => ipcRenderer.invoke('text-imports:prepare', paths),
  preparePdfImports: (paths) => ipcRenderer.invoke('pdf-imports:prepare', paths),
  addBook: (metadata: ImportedMetadata) => ipcRenderer.invoke('library:add', metadata),
  listBooks: () => ipcRenderer.invoke('library:list'),
  listShelves: () => ipcRenderer.invoke('shelves:list'),
  createShelf: (name, color) => ipcRenderer.invoke('shelves:create', name, color),
  renameShelf: (shelfId, name, color) => ipcRenderer.invoke('shelves:rename', shelfId, name, color),
  removeShelf: (shelfId) => ipcRenderer.invoke('shelves:remove', shelfId),
  setBookShelves: (bookId, shelfIds) => ipcRenderer.invoke('shelves:set-book', bookId, shelfIds),
  setBooksShelves: (assignments) => ipcRenderer.invoke('shelves:set-books', assignments),
  getAppSettings: () => ipcRenderer.invoke('settings:get'),
  updateAppSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  takeStartupNotice: () => ipcRenderer.invoke('app:take-startup-notice'),
  readBook: (id) => ipcRenderer.invoke('book:read', id),
  getReadingState: (id) => ipcRenderer.invoke('progress:get', id),
  saveReadingState: (state: ReadingState) => ipcRenderer.invoke('progress:save', state),
  setLastOpened: (id) => ipcRenderer.invoke('library:opened', id),
  takePendingOpenFiles: () => ipcRenderer.invoke('files:take-pending'),
  onOpenFiles: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, paths: string[]) => callback(paths)
    ipcRenderer.on('files:opened', listener)
    return () => ipcRenderer.removeListener('files:opened', listener)
  },
  onLibraryChanged: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('library:changed', listener)
    return () => ipcRenderer.removeListener('library:changed', listener)
  },
  initializeTextBook: (id, encoding) => ipcRenderer.invoke('text:initialize', id, encoding),
  getTextInfo: (id) => ipcRenderer.invoke('text:info', id),
  readTextChunk: (id, start) => ipcRenderer.invoke('text:chunk', id, start),
  rebuildTextIndex: (id, encoding, detectChapters) => ipcRenderer.invoke('text:rebuild', id, encoding, detectChapters),
  getPdfReadingState: (id) => ipcRenderer.invoke('pdf:progress-get', id),
  savePdfReadingState: (state: PdfReadingState) => ipcRenderer.invoke('pdf:progress-save', state),
  updateBookMetadata: (id, title, author) => ipcRenderer.invoke('library:update-metadata', id, title, author),
  chooseBookCover: (id) => ipcRenderer.invoke('library:choose-cover', id),
  revealBook: (id) => ipcRenderer.invoke('library:reveal', id),
  markBookRead: (id) => ipcRenderer.invoke('library:mark-read', id),
  removeBook: (id) => ipcRenderer.invoke('library:remove', id),
  searchText: (id, query) => ipcRenderer.invoke('text:search', id, query),
  startReadingSession: (bookId) => ipcRenderer.invoke('reading-session:start', bookId),
  checkpointReadingSession: (sessionId, activeSeconds) => ipcRenderer.invoke('reading-session:checkpoint', sessionId, activeSeconds),
  endReadingSession: (sessionId, activeSeconds) => ipcRenderer.invoke('reading-session:end', sessionId, activeSeconds),
  getBookReadingStatistics: (bookId) => ipcRenderer.invoke('reading-statistics:book', bookId),
  getReadingOverview: () => ipcRenderer.invoke('reading-statistics:overview'),
  listAnnotations: (bookId) => ipcRenderer.invoke('annotations:list', bookId),
  addAnnotation: (bookId, kind, locator, excerpt) => ipcRenderer.invoke('annotations:add', bookId, kind, locator, excerpt),
  removeAnnotation: (annotationId) => ipcRenderer.invoke('annotations:remove', annotationId)
}

contextBridge.exposeInMainWorld('roxy', api)
