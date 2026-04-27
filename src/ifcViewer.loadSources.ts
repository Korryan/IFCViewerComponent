import { UPLOADED_ITEM_PREFIX } from './ifcViewer.constants'

// Describes the currently active viewer load source so reloads can be deduplicated.
export type LoadSource =
  | { kind: 'none' }
  | { kind: 'file'; file: File }
  | { kind: 'url'; url: string }

// Builds a stable uploaded furniture item id from one IFC file name.
export const buildUploadedFurnitureId = (fileName: string) => {
  const slug =
    fileName
      .toLowerCase()
      .replace(/\.ifc$/i, '')
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'asset'
  return `${UPLOADED_ITEM_PREFIX}${slug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// Builds the default furniture display name from one IFC file name.
export const buildUploadedFurnitureName = (fileName: string) =>
  fileName.replace(/\.ifc$/i, '') || fileName

// Compares two viewer load sources so duplicate model reloads can be skipped.
export const isSameLoadSource = (left: LoadSource, right: LoadSource): boolean => {
  if (left.kind !== right.kind) return false
  if (left.kind === 'none') return true
  if (left.kind === 'file' && right.kind === 'file') return left.file === right.file
  if (left.kind === 'url' && right.kind === 'url') return left.url === right.url
  return false
}

// Wraps one promise with a timeout that throws a labeled error when the operation takes too long.
export const withTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> => {
  let timer: number | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)
  })

  try {
    return (await Promise.race([promise, timeoutPromise])) as T
  } finally {
    if (timer !== undefined) {
      window.clearTimeout(timer)
    }
  }
}
