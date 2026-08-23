import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AppLanguage } from '../../shared/models'
import { normalizeLanguage, translate, type TranslationKey, type TranslationParams } from '../../shared/i18n'

type I18nValue = {
  language: AppLanguage
  setLanguage(language: AppLanguage): Promise<void>
  t(key: TranslationKey, params?: TranslationParams): string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>('zh-CN')

  useEffect(() => {
    let active = true
    window.roxy.getAppSettings().then((settings) => {
      if (active) setLanguageState(normalizeLanguage(settings.language))
    }).catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => {
    document.documentElement.lang = language
    document.title = translate(language, 'appName')
  }, [language])

  const setLanguage = useCallback(async (next: AppLanguage) => {
    const previous = language
    setLanguageState(next)
    try { await window.roxy.updateAppSettings({ language: next }) }
    catch (error) { setLanguageState(previous); throw error }
  }, [language])

  const value = useMemo<I18nValue>(() => ({
    language,
    setLanguage,
    t: (key, params) => translate(language, key, params)
  }), [language, setLanguage])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('I18nProvider is missing')
  return value
}
