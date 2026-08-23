import fs from 'node:fs'
import path from 'node:path'
import type { PDFDocumentProxy } from 'pdfjs-dist'

export async function renderPdfFirstPageCover(filePath: string): Promise<string | null> {
  if (path.extname(filePath).toLowerCase() !== '.pdf' || !fs.existsSync(filePath)) return null
  let pdf: PDFDocumentProxy | null = null
  let loadingTask: { promise: Promise<PDFDocumentProxy>; destroy(): Promise<void> } | null = null
  try {
    const [{ getDocument }, { createCanvas }] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('@napi-rs/canvas')
    ])
    loadingTask = getDocument({ url: path.resolve(filePath) })
    pdf = await loadingTask.promise
    const page = await pdf.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.max(.1, Math.min(420 / base.width, 640 / base.height))
    const viewport = page.getViewport({ scale })
    const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)))
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise
    return `data:image/jpeg;base64,${canvas.toBuffer('image/jpeg', 82).toString('base64')}`
  } catch (error) {
    console.warn(`Unable to render PDF cover for ${path.basename(filePath)}`, error)
    return null
  } finally {
    await loadingTask?.destroy().catch(() => {})
  }
}
