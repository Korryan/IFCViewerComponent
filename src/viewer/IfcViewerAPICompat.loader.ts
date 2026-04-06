// Detects whether a wasm path already points to an absolute URL or root-relative location.
export const isAbsoluteWasmPath = (path: string) => {
  return path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/')
}

// Applies the current wasm path and merged WebIFC config onto the ThatOpen IFC loader settings object.
export const applyIfcLoaderSettings = (args: {
  ifcLoader: any
  wasmPath: string
  webIfcConfig: Record<string, any>
}) => {
  args.ifcLoader.settings.autoSetWasm = false
  args.ifcLoader.settings.wasm.path = args.wasmPath
  args.ifcLoader.settings.wasm.absolute = isAbsoluteWasmPath(args.wasmPath)
  args.ifcLoader.settings.webIfc = {
    ...args.ifcLoader.settings.webIfc,
    ...args.webIfcConfig
  }
}

// Extracts a stable IFC file name from a URL and falls back to model.ifc when none is present.
export const getNameFromUrl = (url: string): string => {
  try {
    const parsed = new URL(url, window.location.origin)
    const tail = parsed.pathname.split('/').pop()
    return tail && tail.trim() ? tail : 'model.ifc'
  } catch {
    const tail = url.split('/').pop()
    return tail && tail.trim() ? tail : 'model.ifc'
  }
}

// Builds a sanitized unique model key from a file name so fragments models do not collide.
export const makeModelKey = (name: string): string => {
  const clean =
    name
      .toLowerCase()
      .replace(/\.ifc$/i, '')
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'model'
  const suffix = Math.random().toString(36).slice(2, 10)
  return `${clean}-${suffix}`
}
