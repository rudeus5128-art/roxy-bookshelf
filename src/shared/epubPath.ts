export function resolveArchiveResource(sectionUrl: string, resourceUrl: string): string | null {
  const source = resourceUrl.trim()
  if (!source || /^(?:data|blob|https?|file):/i.test(source) || source.startsWith('//')) return null
  try {
    return new URL(source, `https://roxy.local${sectionUrl.startsWith('/') ? '' : '/'}${sectionUrl}`).pathname
  } catch {
    return null
  }
}
