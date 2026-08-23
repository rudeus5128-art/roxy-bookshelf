import { useEffect, useState } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import type { ReadingState } from '../../shared/models'

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
  const [open, setOpen] = useState(false)
  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return <div className="reader-settings">
    <button className="icon-button" onClick={() => setOpen((current) => !current)} aria-label="阅读设置"><SlidersHorizontal size={18} /></button>
    {open && <div className="settings-popover">
      <div className="settings-head"><strong>阅读设置</strong><button onClick={() => setOpen(false)} aria-label="关闭阅读设置"><X size={16} /></button></div>
      <label>阅读模式<select value={settings.readingMode} onChange={(event) => onChange('readingMode', event.target.value as TextReadingSettings['readingMode'])}><option value="paginated">分页</option><option value="continuous">连续滚动</option></select></label>
      <label>分页布局<select value={settings.pageLayout} disabled={settings.readingMode === 'continuous'} onChange={(event) => onChange('pageLayout', event.target.value as TextReadingSettings['pageLayout'])}><option value="double">双页</option><option value="single">单页</option></select></label>
      <label>字体<select value={settings.fontFamily} onChange={(event) => onChange('fontFamily', event.target.value)}><option value="system">系统默认</option><option value="sans">无衬线</option><option value="serif">宋体 / 衬线</option><option value="simsun">中易宋体</option></select></label>
      <label>行距<select value={settings.lineHeight} onChange={(event) => onChange('lineHeight', Number(event.target.value))}><option value="1.4">紧凑</option><option value="1.7">标准</option><option value="2">宽松</option></select></label>
      <label>段落间距<select value={settings.paragraphSpacing} onChange={(event) => onChange('paragraphSpacing', Number(event.target.value))}><option value="0">无</option><option value="0.65">标准</option><option value="1.1">宽松</option></select></label>
      <label>阅读宽度<select value={settings.contentWidth} onChange={(event) => onChange('contentWidth', Number(event.target.value))}><option value="600">窄</option><option value="720">标准</option><option value="900">宽</option></select></label>
      <label>页面边距<select value={settings.pageMargin} onChange={(event) => onChange('pageMargin', Number(event.target.value))}><option value="24">小</option><option value="42">标准</option><option value="64">大</option></select></label>
    </div>}
  </div>
}
