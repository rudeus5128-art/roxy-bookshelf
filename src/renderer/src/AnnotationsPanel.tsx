import { useCallback, useEffect, useState } from 'react'
import { Bookmark, BookMarked, BookmarkPlus, Eraser, Highlighter, Trash2, X } from 'lucide-react'
import type { AnnotationKind, BookAnnotation } from '../../shared/models'

export function useBookAnnotations(bookId: string) {
  const [annotations, setAnnotations] = useState<BookAnnotation[]>([])
  const refresh = useCallback(async () => setAnnotations(await window.roxy.listAnnotations(bookId)), [bookId])
  useEffect(() => { refresh().catch(() => {}) }, [refresh])
  async function add(kind: AnnotationKind, locator: string, excerpt: string) {
    const annotation = await window.roxy.addAnnotation(bookId, kind, locator, excerpt)
    await refresh()
    return annotation
  }
  async function remove(annotationId: string) {
    await window.roxy.removeAnnotation(annotationId)
    await refresh()
  }
  return { annotations, add, remove, refresh }
}

export function AnnotationPanel({ annotations, onAddBookmark, onJump, onRemove }: {
  annotations: BookAnnotation[]
  onAddBookmark(): void | Promise<void>
  onJump(annotation: BookAnnotation): void | Promise<void>
  onRemove(annotation: BookAnnotation): void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const bookmarks = annotations.filter((item) => item.kind === 'bookmark').length
  const highlights = annotations.length - bookmarks
  return <>
    <button className="icon-button" onClick={() => setOpen(true)} aria-label="书签与高亮" title="书签与高亮"><BookMarked size={18} /></button>
    {open && <div className="drawer-backdrop annotation-backdrop" onMouseDown={() => setOpen(false)}>
      <aside className="toc-drawer annotation-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-head"><div><strong>书签与高亮</strong><span>{bookmarks} 个书签 · {highlights} 处高亮</span></div><button className="icon-button" onClick={() => setOpen(false)} aria-label="关闭"><X size={18} /></button></div>
        <div className="annotation-actions"><button className="secondary-button" onClick={onAddBookmark}><BookmarkPlus size={15} />添加当前位置书签</button></div>
        {annotations.length ? <ol className="annotation-list">{annotations.map((item) => <li key={item.id}>
          <button className="annotation-jump" onClick={async () => { await onJump(item); setOpen(false) }}>
            <span className={`annotation-kind ${item.kind}`}>{item.kind === 'bookmark' ? <Bookmark size={14} /> : <Highlighter size={14} />}{item.kind === 'bookmark' ? '书签' : '高亮'}</span>
            <strong>{item.excerpt || '未命名位置'}</strong>
            <small>{new Date(item.createdAt).toLocaleString()}</small>
          </button>
          <button className="annotation-delete" onClick={() => onRemove(item)} aria-label={item.kind === 'highlight' ? '擦除高亮' : '删除书签'} title={item.kind === 'highlight' ? '擦除高亮' : '删除书签'}>{item.kind === 'highlight' ? <Eraser size={15} /> : <Trash2 size={15} />}</button>
        </li>)}</ol> : <div className="annotation-empty"><BookMarked size={28} /><p>还没有书签或高亮</p><span>添加书签，或在正文中选中文字。</span></div>}
      </aside>
    </div>}
  </>
}

export function SelectionHighlightAction({ x, y, onAdd }: { x: number; y: number; onAdd(): void }) {
  return <button className="selection-highlight-action" style={{ left: x, top: y }} onMouseDown={(event) => event.preventDefault()} onClick={onAdd}>
    <Highlighter size={15} />高亮
  </button>
}
