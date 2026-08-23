import { useEffect, useRef, useState } from 'react'
import type { BookReadingStatistics, ReadingSessionHandle } from '../../shared/models'
import {
  formatReadingDuration, isReadingKey, READING_CHECKPOINT_SECONDS, shouldAccumulateReading
} from './readingTimerCore'

interface Props { bookId: string; progress: number }

export default function ReadingSessionStatus({ bookId, progress }: Props) {
  const [sessionSeconds, setSessionSeconds] = useState(0)
  const [statistics, setStatistics] = useState<BookReadingStatistics | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const sessionRef = useRef<ReadingSessionHandle | null>(null)
  const startingRef = useRef<Promise<ReadingSessionHandle> | null>(null)
  const activeMillisecondsRef = useRef(0)
  const persistedSecondsRef = useRef(0)
  const lastTickRef = useRef(performance.now())
  const lastActivityRef = useRef<number | null>(null)
  const disposedRef = useRef(false)

  function checkpoint(end = false) {
    const session = sessionRef.current
    if (!session) return
    const seconds = Math.floor(activeMillisecondsRef.current / 1000)
    if (!end && seconds <= persistedSecondsRef.current) return
    const operation = end
      ? window.roxy.endReadingSession(session.id, seconds)
      : window.roxy.checkpointReadingSession(session.id, seconds)
    operation.then(() => { persistedSecondsRef.current = Math.max(persistedSecondsRef.current, seconds) }).catch(() => {})
  }

  function markActivity() {
    lastActivityRef.current = performance.now()
    if (sessionRef.current || startingRef.current || disposedRef.current) return
    const starting = window.roxy.startReadingSession(bookId)
    startingRef.current = starting
    starting.then((session) => {
      startingRef.current = null
      if (disposedRef.current) { window.roxy.endReadingSession(session.id, 0).catch(() => {}); return }
      sessionRef.current = session
      lastTickRef.current = performance.now()
    }).catch(() => { startingRef.current = null })
  }

  useEffect(() => {
    disposedRef.current = false
    window.roxy.getBookReadingStatistics(bookId).then(setStatistics).catch(() => {})

    const onKeyDown = (event: KeyboardEvent) => { if (event.isTrusted && isReadingKey(event)) markActivity() }
    const onWheel = (event: WheelEvent) => { if (event.isTrusted && Math.abs(event.deltaX) + Math.abs(event.deltaY) > 2) markActivity() }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (event.isTrusted && target?.closest('.reading-stage,.text-stage,.pdf-stage,.toc-drawer')) markActivity()
    }
    const onPause = () => checkpoint()
    window.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('wheel', onWheel, { capture: true, passive: true })
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', onPause)
    document.addEventListener('visibilitychange', onPause)
    window.addEventListener('beforeunload', onPause)

    const iframeCleanups: Array<() => void> = []
    const attachedFrames = new WeakSet<HTMLIFrameElement>()
    const attachedDocuments = new WeakSet<Document>()
    function attachFrame(frame: HTMLIFrameElement) {
      if (attachedFrames.has(frame)) return
      attachedFrames.add(frame)
      function attachDocument() {
        try {
          const iframeDocument = frame.contentDocument
          if (!iframeDocument || attachedDocuments.has(iframeDocument)) return
          attachedDocuments.add(iframeDocument)
          const iframeKey = (event: KeyboardEvent) => { if (event.isTrusted && isReadingKey(event)) markActivity() }
          const iframePointer = (event: PointerEvent) => { if (event.isTrusted) markActivity() }
          iframeDocument.addEventListener('keydown', iframeKey, true)
          iframeDocument.addEventListener('wheel', onWheel, { capture: true, passive: true })
          iframeDocument.addEventListener('pointerdown', iframePointer, true)
          iframeCleanups.push(() => {
            iframeDocument.removeEventListener('keydown', iframeKey, true)
            iframeDocument.removeEventListener('wheel', onWheel, true)
            iframeDocument.removeEventListener('pointerdown', iframePointer, true)
          })
        } catch { /* EPUB iframe instrumentation must never affect reading. */ }
      }
      frame.addEventListener('load', attachDocument)
      iframeCleanups.push(() => frame.removeEventListener('load', attachDocument))
      attachDocument()
    }
    function attachEpubFrames() { document.querySelectorAll<HTMLIFrameElement>('.epub-viewport iframe').forEach(attachFrame) }
    const frameObserver = new MutationObserver(attachEpubFrames)
    frameObserver.observe(document.body, { childList: true, subtree: true })
    attachEpubFrames()

    const timer = window.setInterval(() => {
      const now = performance.now()
      const elapsed = Math.min(1500, Math.max(0, now - lastTickRef.current))
      lastTickRef.current = now
      if (!sessionRef.current || !shouldAccumulateReading({
        visible: document.visibilityState === 'visible', focused: document.hasFocus(),
        now, lastActivityAt: lastActivityRef.current
      })) return
      activeMillisecondsRef.current += elapsed
      const seconds = Math.floor(activeMillisecondsRef.current / 1000)
      setSessionSeconds(seconds)
      if (seconds - persistedSecondsRef.current >= READING_CHECKPOINT_SECONDS) checkpoint()
    }, 1000)

    return () => {
      disposedRef.current = true
      clearInterval(timer)
      frameObserver.disconnect()
      iframeCleanups.forEach((cleanup) => cleanup())
      window.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('wheel', onWheel, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('blur', onPause)
      document.removeEventListener('visibilitychange', onPause)
      window.removeEventListener('beforeunload', onPause)
      checkpoint(true)
    }
  }, [bookId])

  const totalSeconds = (statistics?.totalActiveSeconds ?? 0) + sessionSeconds
  const dateTitle = statistics?.firstReadAt
    ? `首次阅读 ${new Date(statistics.firstReadAt).toLocaleDateString()} · 最后阅读 ${new Date(statistics.lastReadAt ?? statistics.firstReadAt).toLocaleDateString()}`
    : '发生翻页、滚动或阅读快捷键操作后开始计时'
  const dateValue = (value: number | null) => value ? new Date(value).toLocaleDateString() : '暂无记录'
  return <div className="reading-statistics-control">
    <button className="reading-session-status" title={dateTitle} aria-expanded={detailsOpen} onClick={() => setDetailsOpen((current) => !current)}
      data-reading-session-seconds={sessionSeconds} data-reading-total-seconds={totalSeconds}>
      {Math.round(progress * 100)}% · 已阅读 {formatReadingDuration(totalSeconds)} · 本次 {formatReadingDuration(sessionSeconds)}
    </button>
    {detailsOpen && <div className="book-statistics-popover">
      <div><span>累计阅读</span><strong>{formatReadingDuration(totalSeconds)}</strong></div>
      <div><span>本次阅读</span><strong>{formatReadingDuration(sessionSeconds)}</strong></div>
      <div><span>首次阅读</span><strong>{dateValue(statistics?.firstReadAt ?? null)}</strong></div>
      <div><span>最后阅读</span><strong>{dateValue(statistics?.lastReadAt ?? null)}</strong></div>
      <div><span>当前进度</span><strong>{Math.round(progress * 100)}%</strong></div>
      {statistics?.completedAt && <div><span>读完日期</span><strong>{dateValue(statistics.completedAt)}</strong></div>}
    </div>}
  </div>
}
