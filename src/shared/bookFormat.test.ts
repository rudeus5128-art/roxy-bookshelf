import { describe, expect, it } from 'vitest'
import { formatFromFileName, isPhaseOneBook } from './bookFormat'
import { resolveArchiveResource } from './epubPath'

describe('Phase 1 format boundary', () => {
  it('accepts EPUB without depending on extension casing', () => {
    expect(formatFromFileName('小说.EPUB')).toBe('epub')
    expect(isPhaseOneBook('book.epub')).toBe(true)
  })

  it('resolves undeclared EPUB images relative to their chapter', () => {
    expect(resolveArchiveResource('/OPS/chapter15.html', 'images/illustration.jpg'))
      .toBe('/OPS/images/illustration.jpg')
    expect(resolveArchiveResource('/OPS/text/chapter.xhtml', '../images/插图.jpg'))
      .toBe('/OPS/images/%E6%8F%92%E5%9B%BE.jpg')
    expect(resolveArchiveResource('/OPS/chapter.html', 'https://example.com/image.jpg')).toBeNull()
    expect(resolveArchiveResource('/OPS/chapter.html', 'data:image/png;base64,AA==')).toBeNull()
  })

  it('enables TXT and PDF after their implementation phases', () => {
    expect(formatFromFileName('book.txt')).toBe('txt')
    expect(formatFromFileName('book.pdf')).toBe('pdf')
    expect(formatFromFileName('book')).toBeNull()
  })
})
