import * as THREE from 'three'
import { Color, Material, MeshLambertMaterial } from 'three'
import type { MaterialDefinition, RawMaterial } from '@thatopen/fragments'

export const MATERIAL_LOOKUP_BATCH_SIZE = 1500
export const MATERIAL_GEOMETRY_BATCH_SIZE = 64

// Clamps a numeric value into the inclusive 0..1 interval used by color and opacity channels.
export const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

// Normalizes one color channel from 0..255 or 0..1 input into a 0..1 float.
export const normalizeColorChannel = (value: unknown): number | null => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  const normalized = numeric > 1 ? numeric / 255 : numeric
  return clamp01(normalized)
}

// Converts supported raw color payloads into a Three.js color in sRGB space.
export const normalizeColor = (value: unknown): Color | null => {
  if (Array.isArray(value) && value.length >= 3) {
    const r = normalizeColorChannel(value[0])
    const g = normalizeColorChannel(value[1])
    const b = normalizeColorChannel(value[2])
    if (r === null || g === null || b === null) return null
    return new Color().setRGB(r, g, b, THREE.SRGBColorSpace)
  }

  if (!value || typeof value !== 'object') return null

  const candidate = value as {
    r?: unknown
    g?: unknown
    b?: unknown
    x?: unknown
    y?: unknown
    z?: unknown
  }

  const r = normalizeColorChannel(candidate.r ?? candidate.x)
  const g = normalizeColorChannel(candidate.g ?? candidate.y)
  const b = normalizeColorChannel(candidate.b ?? candidate.z)
  if (r === null || g === null || b === null) return null
  return new Color().setRGB(r, g, b, THREE.SRGBColorSpace)
}

// Normalizes alpha or opacity-like values into the inclusive 0..1 opacity range.
export const normalizeOpacity = (value: unknown): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 1
  const normalized = numeric > 1 ? numeric / 255 : numeric
  return clamp01(normalized)
}

// Builds or reuses a Three.js material from one fragments material definition.
export const materialFromDefinition = (
  definition: MaterialDefinition | undefined,
  cache: Map<string, Material>
): Material | null => {
  if (!definition) return null

  const definitionColor = (definition as any)?.color
  const color = normalizeColor(definitionColor)
  if (!color) return null
  const opacity = normalizeOpacity((definition as any)?.opacity)
  const transparent =
    typeof (definition as any)?.transparent === 'boolean'
      ? Boolean((definition as any)?.transparent)
      : opacity < 1
  const renderedFaces = Number((definition as any)?.renderedFaces)
  const side = renderedFaces === 1 ? THREE.DoubleSide : THREE.FrontSide
  const depthTest = true
  const depthWrite = !transparent

  const key = [
    color.r.toFixed(6),
    color.g.toFixed(6),
    color.b.toFixed(6),
    opacity.toFixed(6),
    transparent ? '1' : '0',
    side === THREE.DoubleSide ? '2' : '1',
    depthTest ? '1' : '0',
    depthWrite ? '1' : '0'
  ].join('|')

  const cached = cache.get(key)
  if (cached) return cached

  const material = new MeshLambertMaterial({
    color: color.clone(),
    opacity,
    transparent,
    side,
    depthTest,
    depthWrite
  })

  cache.set(key, material)
  return material
}

// Builds or reuses a Three.js material from the raw sample material payload returned by fragments.
export const materialFromRawMaterial = (
  raw: RawMaterial | undefined,
  cache: Map<string, Material>
): Material | null => {
  if (!raw) return null

  const color = normalizeColor(raw)
  if (!color) return null
  const opacity = normalizeOpacity((raw as any).a)
  const transparent = opacity < 1
  const renderedFaces = Number((raw as any).renderedFaces)
  const side = renderedFaces === 1 ? THREE.DoubleSide : THREE.FrontSide
  const depthTest = true
  const depthWrite = !transparent

  const key = [
    color.r.toFixed(6),
    color.g.toFixed(6),
    color.b.toFixed(6),
    opacity.toFixed(6),
    transparent ? '1' : '0',
    side === THREE.DoubleSide ? '2' : '1',
    depthTest ? '1' : '0',
    depthWrite ? '1' : '0'
  ].join('|')

  const cached = cache.get(key)
  if (cached) return cached

  const material = new MeshLambertMaterial({
    color: color.clone(),
    opacity,
    transparent,
    side,
    depthTest,
    depthWrite
  })

  cache.set(key, material)
  return material
}

// Deduplicates arbitrary numeric-ish values into a stable array of integer ids.
export const uniqueNumbers = (values: unknown[]): number[] => {
  const dedup = new Set<number>()
  values.forEach((raw) => {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return
    dedup.add(Math.trunc(parsed))
  })
  return Array.from(dedup)
}
