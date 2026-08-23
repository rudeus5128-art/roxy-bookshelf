import fs from 'node:fs'
import path from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import iconv from 'iconv-lite'

interface WorkerInput {
  sourcePath: string
  cachePath: string
  indexPath: string
  encoding: string
  detectChapters: boolean
}

const input = workerData as WorkerInput
const chapterPattern = /^\s*(?:第\s*[零〇一二两三四五六七八九十百千万\d]+\s*[章节卷部篇回集]|卷\s*[零〇一二两三四五六七八九十百千万\d]+|Chapter\s+\d+).{0,80}$/i

async function run(): Promise<void> {
  fs.mkdirSync(path.dirname(input.cachePath), { recursive: true })
  const temporaryCache = `${input.cachePath}.tmp`
  const output = fs.openSync(temporaryCache, 'w')
  const sourceSize = fs.statSync(input.sourcePath).size
  const chapters: Array<{ title: string; byteOffset: number }> = []
  let outputOffset = 0
  let sourceRead = 0
  let carry = ''
  let lastProgress = 0

  function writeCompleteLines(text: string): string {
    const newline = /\r\n|\n|\r/g
    let match: RegExpExecArray | null
    let consumed = 0
    let localBytes = 0
    while ((match = newline.exec(text))) {
      const line = text.slice(consumed, match.index + match[0].length)
      const heading = line.replace(/[\r\n]+$/, '').trim()
      if (input.detectChapters && heading && chapterPattern.test(heading)) chapters.push({ title: heading, byteOffset: outputOffset + localBytes })
      localBytes += Buffer.byteLength(line, 'utf8')
      consumed = match.index + match[0].length
    }
    if (consumed) {
      const bytes = Buffer.from(text.slice(0, consumed), 'utf8')
      fs.writeSync(output, bytes)
      outputOffset += bytes.length
    }
    return text.slice(consumed)
  }

  const source = fs.createReadStream(input.sourcePath, { highWaterMark: 256 * 1024 })
  source.on('data', (chunk) => {
    sourceRead += Buffer.byteLength(chunk as Buffer)
    const progress = sourceSize ? sourceRead / sourceSize : 1
    if (progress - lastProgress >= 0.05) { lastProgress = progress; parentPort?.postMessage({ type: 'progress', progress }) }
  })
  const decoded = source.pipe(iconv.decodeStream(input.encoding))
  for await (const chunk of decoded) {
    carry += String(chunk)
    carry = writeCompleteLines(carry)
  }
  if (carry) {
    const heading = carry.trim()
    if (input.detectChapters && heading && chapterPattern.test(heading)) chapters.push({ title: heading, byteOffset: outputOffset })
    const bytes = Buffer.from(carry, 'utf8')
    fs.writeSync(output, bytes)
    outputOffset += bytes.length
  }
  fs.closeSync(output)
  fs.renameSync(temporaryCache, input.cachePath)
  const index = { status: 'ready', progress: 1, totalBytes: outputOffset, chapters, sourceSize, encoding: input.encoding }
  const temporaryIndex = `${input.indexPath}.tmp`
  fs.writeFileSync(temporaryIndex, JSON.stringify(index))
  fs.renameSync(temporaryIndex, input.indexPath)
  parentPort?.postMessage({ type: 'ready', index })
}

run().catch((error) => {
  parentPort?.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) })
})
