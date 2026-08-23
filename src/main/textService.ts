import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { app } from 'electron'
import { detect } from 'chardet'
import type { TextChunk, TextDocumentInfo, TextEncoding, TextImportCandidate, TextSearchResult } from '../shared/models'
import { bookPath, getTextSettings, saveTextSettings } from './database'

interface IndexFile {
  status: 'ready'
  progress: number
  totalBytes: number
  chapters: Array<{ title: string; byteOffset: number }>
  sourceSize: number
  encoding: TextEncoding
}

const jobs = new Map<string, { worker: Worker; progress: number; error?: string }>()

function pathsFor(bookId: string) {
  const directory = path.join(app.getPath('userData'), 'text-cache')
  return { directory, cachePath: path.join(directory, `${bookId}.utf8`), indexPath: path.join(directory, `${bookId}.json`) }
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

async function detectTextEncoding(filePath: string): Promise<TextEncoding> {
  const handle = await fs.promises.open(filePath, 'r')
  try {
    const sample = Buffer.alloc(256 * 1024)
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0)
    const data = sample.subarray(0, bytesRead)
    if (data[0] === 0xff && data[1] === 0xfe) return 'utf16le'
    if (data[0] === 0xfe && data[1] === 0xff) return 'utf16be'
    if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) return 'utf8'
    try {
      // The fixed-size sample may end halfway through a valid multibyte UTF-8
      // character. Streaming mode validates all complete bytes without treating
      // that trailing partial character as corruption.
      new TextDecoder('utf-8', { fatal: true }).decode(data, { stream: true })
      return 'utf8'
    } catch { /* continue with legacy Chinese encoding detection */ }
    const result = String(detect(data) || '').toUpperCase().replace(/[_-]/g, '')
    if (result.includes('UTF16LE')) return 'utf16le'
    if (result.includes('UTF16BE')) return 'utf16be'
    if (result.includes('GB18030')) return 'gb18030'
    if (result.includes('GB') || result.includes('BIG5')) return 'gbk'
    return 'gb18030'
  } finally { await handle.close() }
}

export async function prepareTextImports(filePaths: string[]): Promise<TextImportCandidate[]> {
  return Promise.all(filePaths.filter((filePath) => path.extname(filePath).toLowerCase() === '.txt' && fs.existsSync(filePath)).map(async (filePath) => ({
    filePath,
    fileName: path.basename(filePath),
    fileHash: await hashFile(filePath),
    size: (await fs.promises.stat(filePath)).size,
    title: path.basename(filePath, path.extname(filePath)).trim() || '未命名文本',
    author: '未知作者',
    encoding: await detectTextEncoding(filePath)
  })))
}

export function startTextIndex(bookId: string, encoding: TextEncoding, detectChapters: boolean): void {
  const sourcePath = bookPath(bookId)
  if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('找不到原始 TXT 文件')
  const existing = jobs.get(bookId)
  if (existing) existing.worker.terminate()
  const files = pathsFor(bookId)
  fs.mkdirSync(files.directory, { recursive: true })
  for (const target of [files.cachePath, files.indexPath]) {
    if (fs.existsSync(target)) fs.unlinkSync(target)
  }
  saveTextSettings(bookId, encoding, detectChapters)
  const worker = new Worker(path.join(__dirname, 'textIndexWorker.js'), {
    workerData: { sourcePath, cachePath: files.cachePath, indexPath: files.indexPath, encoding, detectChapters }
  })
  jobs.set(bookId, { worker, progress: 0 })
  worker.on('message', (message) => {
    const job = jobs.get(bookId)
    if (!job) return
    if (message.type === 'progress') job.progress = message.progress
    if (message.type === 'error') job.error = message.error
    if (message.type === 'ready') jobs.delete(bookId)
  })
  worker.on('error', (error) => {
    const job = jobs.get(bookId)
    if (job) job.error = error instanceof Error ? error.message : String(error)
  })
}

export function initializeTextBook(bookId: string, encoding: TextEncoding): void {
  const settings = getTextSettings(bookId)
  const files = pathsFor(bookId)
  if (settings && fs.existsSync(files.indexPath) && fs.existsSync(files.cachePath)) return
  startTextIndex(bookId, encoding, true)
}

export function getTextInfo(bookId: string): TextDocumentInfo {
  const settings = getTextSettings(bookId)
  if (!settings) throw new Error('TXT 尚未初始化')
  const files = pathsFor(bookId)
  if (fs.existsSync(files.indexPath)) {
    const index = JSON.parse(fs.readFileSync(files.indexPath, 'utf8')) as IndexFile
    return { bookId, encoding: settings.encoding, detectChapters: settings.detectChapters, status: 'ready', progress: 1, totalBytes: index.totalBytes, chapters: index.chapters }
  }
  const job = jobs.get(bookId)
  if (!job) startTextIndex(bookId, settings.encoding, settings.detectChapters)
  const current = jobs.get(bookId)
  return { bookId, encoding: settings.encoding, detectChapters: settings.detectChapters, status: current?.error ? 'error' : 'indexing', progress: current?.progress ?? 0, totalBytes: 0, chapters: [], error: current?.error }
}

export async function readTextChunk(bookId: string, start: number): Promise<TextChunk> {
  const files = pathsFor(bookId)
  if (!fs.existsSync(files.cachePath)) throw new Error('TXT 索引尚未完成')
  const totalBytes = fs.statSync(files.cachePath).size
  const safeStart = Math.max(0, Math.min(Math.floor(start), totalBytes))
  const handle = await fs.promises.open(files.cachePath, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(40 * 1024, totalBytes - safeStart))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, safeStart)
    let end = bytesRead
    if (safeStart + bytesRead < totalBytes) {
      const newline = buffer.lastIndexOf(0x0a, bytesRead - 1)
      if (newline > 16 * 1024) end = newline + 1
      else {
        while (end > 0 && (buffer[end - 1] & 0xc0) === 0x80) end -= 1
      }
    }
    const nextOffset = safeStart + end
    return { start: safeStart, nextOffset, totalBytes, text: buffer.subarray(0, end).toString('utf8'), hasMore: nextOffset < totalBytes }
  } finally { await handle.close() }
}

export async function searchText(bookId: string, query: string): Promise<TextSearchResult[]> {
  const term = query.trim()
  if (!term) return []
  const files = pathsFor(bookId)
  if (!fs.existsSync(files.cachePath)) throw new Error('TXT 索引尚未完成')
  const needle = Buffer.from(term.toLocaleLowerCase(), 'utf8')
  const handle = await fs.promises.open(files.cachePath, 'r')
  const results: TextSearchResult[] = []
  const chunkSize = 256 * 1024
  const overlapSize = Math.max(needle.length + 160, 256)
  let position = 0
  let overlap = Buffer.alloc(0)
  let lastOffset = -1
  try {
    while (results.length < 200) {
      const buffer = Buffer.alloc(chunkSize)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (!bytesRead) break
      const data = Buffer.concat([overlap, buffer.subarray(0, bytesRead)])
      const baseOffset = position - overlap.length
      const lowered = Buffer.from(data.toString('utf8').toLocaleLowerCase(), 'utf8')
      let offset = 0
      while (results.length < 200 && (offset = lowered.indexOf(needle, offset)) >= 0) {
        const absolute = baseOffset + offset
        if (absolute > lastOffset) {
          const previewStart = Math.max(0, offset - 72)
          const previewEnd = Math.min(data.length, offset + needle.length + 120)
          results.push({ byteOffset: absolute, preview: data.subarray(previewStart, previewEnd).toString('utf8').replace(/\s+/g, ' ').trim() })
          lastOffset = absolute
        }
        offset += Math.max(1, needle.length)
      }
      position += bytesRead
      overlap = data.subarray(Math.max(0, data.length - overlapSize))
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    return results
  } finally { await handle.close() }
}
