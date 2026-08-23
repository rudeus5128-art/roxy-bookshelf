import ePub from 'epubjs'
import type { ImportCandidate, ImportedMetadata } from '../../shared/models'
import { resolveArchiveResource } from '../../shared/epubPath'

function fileStem(fileName: string): string {
  return fileName.replace(/\.epub$/i, '').trim() || '未命名书籍'
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function readEpubMetadata(candidate: ImportCandidate): Promise<ImportedMetadata> {
  const book = ePub(candidate.data)
  const navigationLoaded = book.loaded.navigation.catch(() => null)
  try {
    const metadata = await book.loaded.metadata
    let coverDataUrl: string | null = null
    try {
      const coverUrl = await book.coverUrl()
      if (coverUrl) coverDataUrl = await blobToDataUrl(await fetch(coverUrl).then((response) => response.blob()))
    } catch {
      coverDataUrl = null
    }
    return {
      format: 'epub',
      filePath: candidate.filePath,
      fileName: candidate.fileName,
      fileHash: candidate.fileHash,
      title: String(metadata?.title || fileStem(candidate.fileName)),
      author: String(metadata?.creator || '未知作者'),
      coverDataUrl
    }
  } finally {
    await navigationLoaded
    book.destroy()
  }
}

/**
 * Some older EPUB generators omit inline illustrations from the OPF manifest.
 * epub.js correctly ignores those undeclared resources, while tolerant readers
 * still show them. Resolve relative image sources straight from the read-only
 * archive so malformed books remain readable without altering the source file.
 */
export function installArchiveImageFallback(book: any): void {
  book.spine.hooks.content.register(async (document: Document, section: { url?: string; href?: string }) => {
    if (!book.archive) return
    const sectionUrl = section.url || section.href || '/'
    const images = Array.from(document.querySelectorAll('img, image'))
    await Promise.all(images.map(async (image) => {
      const isSvgImage = image.localName.toLowerCase() === 'image'
      const source = isSvgImage
        ? (image.getAttribute('href') || image.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || image.getAttribute('xlink:href'))
        : image.getAttribute('src')
      if (!source) return
      const archivePath = resolveArchiveResource(sectionUrl, source)
      if (!archivePath) return
      try {
        const resourceUrl = await book.archive.createUrl(archivePath)
        if (isSvgImage) image.setAttribute('href', resourceUrl)
        else image.setAttribute('src', resourceUrl)
      } catch {
        // Keep the original source so standards-compliant resources can use
        // epub.js's normal replacement path and one bad image cannot stop a chapter.
      }
    }))
  })
}

export { ePub }
