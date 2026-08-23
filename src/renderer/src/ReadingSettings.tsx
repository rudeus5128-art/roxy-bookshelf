import { useEffect, useState } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import type { ReadingState } from '../../shared/models'
import { useI18n } from './I18nContext'

export type TextReadingSettings = Pick<ReadingState,
  'fontSize' | 'lineHeight' | 'contentWidth' | 'fontFamily' |
  'paragraphSpacing' | 'pageMargin' | 'readingMode' | 'pageLayout'>

export const DEFAULT_READING_SETTINGS: TextReadingSettings = {
  fontSize: 18,
  lineHeight: 1.7,
  contentWidth: 720,
  fontFamily: 'system',
  paragraphSpacing: .65,
  pageMargin: 42,
  readingMode: 'paginated',
  pageLayout: 'double'
}

export const fontFamilies: Record<string, string> = {
  system: '"Segoe UI", "Microsoft YaHei UI", sans-serif',
  sans: '"Microsoft YaHei UI", Arial, sans-serif',
  serif: '"Noto Serif CJK SC", "Songti SC", SimSun, serif',
  simsun: 'SimSun, "Songti SC", serif'
}

export default function ReadingSettings({ settings, onChange }: {
  settings: TextReadingSettings
  onChange<K extends keyof TextReadingSettings>(key: K, value: TextReadingSettings[K]): void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return <div className="reader-settings">
    <button className="icon-button" onClick={() => setOpen((current) => !current)} aria-label={t('readingSettings')}><SlidersHorizontal size={18} /></button>
    {open && <div className="settings-popover">
      <div className="settings-head"><strong>{t('readingSettings')}</strong><button onClick={() => setOpen(false)} aria-label={t('closeReadingSettings')}><X size={16} /></button></div>
      <label>{t('readingMode')}<select value={settings.readingMode} onChange={(event) => onChange('readingMode', event.target.value as TextReadingSettings['readingMode'])}><option value="paginated">{t('paginated')}</option><option value="continuous">{t('continuousScroll')}</option></select></label>
      <label>{t('pageLayout')}<select value={settings.pageLayout} disabled={settings.readingMode === 'continuous'} onChange={(event) => onChange('pageLayout', event.target.value as TextReadingSettings['pageLayout'])}><option value="double">{t('doublePage')}</option><option value="single">{t('singlePage')}</option></select></label>
      <label>{t('font')}<select value={settings.fontFamily} onChange={(event) => onChange('fontFamily', event.target.value)}><option value="system">{t('systemDefault')}</option><option value="sans">{t('sansSerif')}</option><option value="serif">{t('serif')}</option><option value="simsun">{t('simsun')}</option></select></label>
      <label>{t('lineHeight')}<select value={settings.lineHeight} onChange={(event) => onChange('lineHeight', Number(event.target.value))}><option value="1.4">{t('compact')}</option><option value="1.7">{t('standard')}</option><option value="2">{t('relaxed')}</option></select></label>
      <label>{t('paragraphSpacing')}<select value={settings.paragraphSpacing} onChange={(event) => onChange('paragraphSpacing', Number(event.target.value))}><option value="0">{t('noSpacing')}</option><option value="0.65">{t('standard')}</option><option value="1.1">{t('relaxed')}</option></select></label>
      <label>{t('readingWidth')}<select value={settings.contentWidth} onChange={(event) => onChange('contentWidth', Number(event.target.value))}><option value="600">{t('narrow')}</option><option value="720">{t('standard')}</option><option value="900">{t('wide')}</option></select></label>
      <label>{t('pageMargin')}<select value={settings.pageMargin} onChange={(event) => onChange('pageMargin', Number(event.target.value))}><option value="24">{t('small')}</option><option value="42">{t('standard')}</option><option value="64">{t('large')}</option></select></label>
    </div>}
  </div>
}
