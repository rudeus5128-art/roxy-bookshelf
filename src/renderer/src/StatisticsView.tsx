import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BarChart3, Moon, Sun } from 'lucide-react'
import type { ReadingOverview, ReadingTrendPoint } from '../../shared/models'
import { formatReadingDuration } from './readingTimerCore'

type Theme = 'light' | 'dark'
type TrendRange = 7 | 30

function dateLabel(value: string) {
  const [, month, day] = value.split('-').map(Number)
  return `${month}/${day}`
}

function Trend({ points }: { points: ReadingTrendPoint[] }) {
  const maximum = Math.max(1, ...points.map((point) => point.activeSeconds))
  return <div className={`statistics-chart days-${points.length}`} role="img" aria-label={`最近 ${points.length} 天每日阅读时长`}>
    {points.map((point, index) => {
      const minutes = Math.floor(point.activeSeconds / 60)
      const height = point.activeSeconds ? Math.max(4, point.activeSeconds / maximum * 100) : 2
      const showLabel = points.length === 7 || index === 0 || index === points.length - 1 || index % 7 === 0
      return <div className="statistics-bar-column" key={point.date} title={`${point.date} · ${formatReadingDuration(point.activeSeconds)}`}>
        <span className="statistics-bar-value">{minutes ? `${minutes}m` : ''}</span>
        <div className="statistics-bar-track"><i className={point.activeSeconds ? '' : 'empty'} style={{ height: `${height}%` }} /></div>
        <small>{showLabel ? dateLabel(point.date) : ''}</small>
      </div>
    })}
  </div>
}

export default function StatisticsView({ theme, onThemeChange, onClose }: {
  theme: Theme
  onThemeChange(): void
  onClose(): void
}) {
  const [overview, setOverview] = useState<ReadingOverview | null>(null)
  const [error, setError] = useState('')
  const [range, setRange] = useState<TrendRange>(7)

  useEffect(() => {
    let disposed = false
    window.roxy.getReadingOverview()
      .then((value) => { if (!disposed) setOverview(value) })
      .catch(() => { if (!disposed) setError('暂时无法读取本地统计') })
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const points = useMemo(() => {
    if (!overview) return []
    return range === 7 ? overview.recent7Days : overview.recent30Days
  }, [overview, range])

  return <div className="statistics-shell">
    <header className="statistics-header">
      <button className="icon-button" onClick={onClose} aria-label="返回书架"><ArrowLeft size={19} /></button>
      <div className="statistics-title"><strong>阅读统计</strong><span>所有记录仅保存在本机</span></div>
      <button className="icon-button" onClick={onThemeChange} aria-label="切换明暗主题">{theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}</button>
    </header>

    <main className="statistics-content">
      <div className="statistics-intro">
        <div><span>READING RECORD</span><h1>阅读记录</h1><p>只记录窗口处于焦点、且近期存在阅读操作的时间。</p></div>
        <BarChart3 size={28} strokeWidth={1.5} />
      </div>

      {error ? <section className="statistics-state"><p>{error}</p><button className="secondary-button" onClick={onClose}>返回书架</button></section> : !overview ? <section className="statistics-state"><span className="loading-line" /><p>正在整理本地阅读记录…</p></section> : <>
        <section className="statistics-overview" aria-label="阅读时长概览">
          <div><span>今天</span><strong>{formatReadingDuration(overview.todaySeconds)}</strong></div>
          <div><span>本月</span><strong>{formatReadingDuration(overview.monthSeconds)}</strong></div>
          <div><span>今年</span><strong>{formatReadingDuration(overview.yearSeconds)}</strong></div>
          <div><span>全部</span><strong>{formatReadingDuration(overview.totalSeconds)}</strong></div>
        </section>

        <section className="statistics-section">
          <div className="statistics-section-head">
            <div><span>DAILY TREND</span><h2>每日阅读</h2></div>
            <div className="statistics-range" aria-label="趋势范围">
              <button className={range === 7 ? 'active' : ''} onClick={() => setRange(7)}>近 7 天</button>
              <button className={range === 30 ? 'active' : ''} onClick={() => setRange(30)}>近 30 天</button>
            </div>
          </div>
          <Trend points={points} />
        </section>

        <section className="statistics-section annual-summary">
          <div className="statistics-section-head"><div><span>{new Date().getFullYear()} SUMMARY</span><h2>今年</h2></div></div>
          <dl>
            <div><dt>本周阅读</dt><dd>{formatReadingDuration(overview.weekSeconds)}</dd></div>
            <div><dt>今年累计</dt><dd>{formatReadingDuration(overview.yearSeconds)}</dd></div>
            <div><dt>今年读完</dt><dd>{overview.yearCompletedBooks} 本</dd></div>
            <div><dt>阅读最久</dt><dd>{overview.yearTopBook ? `${overview.yearTopBook.title} · ${formatReadingDuration(overview.yearTopBook.activeSeconds)}` : '暂无记录'}</dd></div>
            <div><dt>阅读最多的月份</dt><dd>{overview.yearTopMonth ? `${overview.yearTopMonth.month} 月 · ${formatReadingDuration(overview.yearTopMonth.activeSeconds)}` : '暂无记录'}</dd></div>
          </dl>
        </section>

        <p className="statistics-footnote">统计模块独立于阅读内容运行；统计失败不会影响打开或阅读书籍。</p>
      </>}
    </main>
  </div>
}
