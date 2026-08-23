import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BarChart3, Moon, Sun } from 'lucide-react'
import type { ReadingOverview, ReadingTrendPoint } from '../../shared/models'
import { formatReadingDuration } from './readingTimerCore'
import { useI18n } from './I18nContext'

type Theme = 'light' | 'dark'
type TrendRange = 7 | 30

function dateLabel(value: string) {
  const [, month, day] = value.split('-').map(Number)
  return `${month}/${day}`
}

function Trend({ points }: { points: ReadingTrendPoint[] }) {
  const { t } = useI18n()
  const maximum = Math.max(1, ...points.map((point) => point.activeSeconds))
  return <div className={`statistics-chart days-${points.length}`} role="img" aria-label={t('dailyDuration', { days: points.length })}>
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
  const { language, t } = useI18n()
  const [overview, setOverview] = useState<ReadingOverview | null>(null)
  const [error, setError] = useState('')
  const [range, setRange] = useState<TrendRange>(7)

  useEffect(() => {
    let disposed = false
    window.roxy.getReadingOverview()
      .then((value) => { if (!disposed) setOverview(value) })
      .catch(() => { if (!disposed) setError(t('statisticsUnavailable')) })
    return () => { disposed = true }
  }, [t])

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
      <button className="icon-button" onClick={onClose} aria-label={t('backToLibrary')}><ArrowLeft size={19} /></button>
      <div className="statistics-title"><strong>{t('readingStatistics')}</strong><span>{t('localRecordsOnly')}</span></div>
      <button className="icon-button" onClick={onThemeChange} aria-label={t('toggleTheme')}>{theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}</button>
    </header>

    <main className="statistics-content">
      <div className="statistics-intro">
        <div><span>READING RECORD</span><h1>{t('readingRecord')}</h1><p>{t('statisticsIntro')}</p></div>
        <BarChart3 size={28} strokeWidth={1.5} />
      </div>

      {error ? <section className="statistics-state"><p>{error}</p><button className="secondary-button" onClick={onClose}>{t('backToLibrary')}</button></section> : !overview ? <section className="statistics-state"><span className="loading-line" /><p>{t('preparingStatistics')}</p></section> : <>
        <section className="statistics-overview" aria-label={t('durationOverview')}>
          <div><span>{t('today')}</span><strong>{formatReadingDuration(overview.todaySeconds)}</strong></div>
          <div><span>{t('thisMonth')}</span><strong>{formatReadingDuration(overview.monthSeconds)}</strong></div>
          <div><span>{t('thisYear')}</span><strong>{formatReadingDuration(overview.yearSeconds)}</strong></div>
          <div><span>{t('total')}</span><strong>{formatReadingDuration(overview.totalSeconds)}</strong></div>
        </section>

        <section className="statistics-section">
          <div className="statistics-section-head">
            <div><span>DAILY TREND</span><h2>{t('dailyReading')}</h2></div>
            <div className="statistics-range" aria-label={t('trendRange')}>
              <button className={range === 7 ? 'active' : ''} onClick={() => setRange(7)}>{t('last7Days')}</button>
              <button className={range === 30 ? 'active' : ''} onClick={() => setRange(30)}>{t('last30Days')}</button>
            </div>
          </div>
          <Trend points={points} />
        </section>

        <section className="statistics-section annual-summary">
          <div className="statistics-section-head"><div><span>{new Date().getFullYear()} SUMMARY</span><h2>{t('thisYear')}</h2></div></div>
          <dl>
            <div><dt>{t('thisWeekReading')}</dt><dd>{formatReadingDuration(overview.weekSeconds)}</dd></div>
            <div><dt>{t('yearTotal')}</dt><dd>{formatReadingDuration(overview.yearSeconds)}</dd></div>
            <div><dt>{t('booksFinished')}</dt><dd>{t(overview.yearCompletedBooks === 1 ? 'oneBook' : 'bookUnit', { count: overview.yearCompletedBooks })}</dd></div>
            <div><dt>{t('longestRead')}</dt><dd>{overview.yearTopBook ? `${overview.yearTopBook.title} · ${formatReadingDuration(overview.yearTopBook.activeSeconds)}` : t('noRecord')}</dd></div>
            <div><dt>{t('topMonth')}</dt><dd>{overview.yearTopMonth ? t('monthDuration', { month: overview.yearTopMonth.month, duration: formatReadingDuration(overview.yearTopMonth.activeSeconds) }) : t('noRecord')}</dd></div>
          </dl>
        </section>

        <p className="statistics-footnote">{t('statisticsFootnote')}</p>
      </>}
    </main>
  </div>
}
