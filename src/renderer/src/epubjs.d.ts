declare module 'epubjs' {
  const ePub: (input: ArrayBuffer | string, options?: Record<string, unknown>) => any
  export default ePub
}
