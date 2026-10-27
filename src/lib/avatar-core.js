// FR-016 pure helpers (no browser APIs) so they can be unit-tested with node --test.

/** Up to two initials from a display name; '?' when there is no usable name. */
export function initials(name) {
  const words = String(name ?? '').trim().split(/[\s._-]+/).filter(w => /[\p{L}\p{N}]/u.test(w))
  if (!words.length) return '?'
  const first = [...words[0]].find(ch => /[\p{L}\p{N}]/u.test(ch)) ?? ''
  const last = words.length > 1 ? ([...words[words.length - 1]].find(ch => /[\p{L}\p{N}]/u.test(ch)) ?? '') : ''
  return (first + last).toLocaleUpperCase()
}

/** Dark backgrounds that all give white text at least 4.5:1 contrast (WCAG AA). */
export const AVATAR_COLOURS = Object.freeze(['#1f6f43', '#1d5f8a', '#7a3e9d', '#a23b2a', '#8a5a00', '#2f6b6b', '#5b4fa8', '#9b2f63', '#3d6b1f', '#6b4f3a'])

/** Stable colour from the user ID, so it does not change when the person renames. */
export function avatarColour(userId) {
  let h = 2166136261
  for (const ch of String(userId ?? '')) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0 }
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length]
}

/** Relative luminance contrast ratio of two #rrggbb colours. */
export function contrastRatio(a, b) {
  const lum = hex => {
    const [r, g, bl] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** Source-pixel crop square for a viewport of `view` px showing the image scaled by `scale` and offset by ox/oy. */
export function cropRect(width, height, view, zoom, ox, oy) {
  const scale = (view / Math.min(width, height)) * zoom
  const size = view / scale
  const x = Math.min(Math.max(-ox / scale, 0), width - size)
  const y = Math.min(Math.max(-oy / scale, 0), height - size)
  return { x, y, size, scale }
}

/** Keep the image covering the viewport while panning. */
export function clampOffset(width, height, view, zoom, ox, oy) {
  const scale = (view / Math.min(width, height)) * zoom
  return { ox: Math.min(0, Math.max(view - width * scale, ox)), oy: Math.min(0, Math.max(view - height * scale, oy)) }
}

export const AVATAR_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{32}\.(webp|jpg)$/
