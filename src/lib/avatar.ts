// FR-016 browser side: prepare, upload, remove and display profile photos.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { AVATAR_PATH } from './avatar-core.js'

export const MAX_INPUT_BYTES = 10 * 1024 * 1024
const MAX_UPLOAD_BYTES = 300 * 1024
const OUTPUT = 512
const BUCKET = 'avatars'

export class AvatarError extends Error {}

/** Decode a picked file. Rejects non-images, files over 10 MB, and anything the browser cannot read. */
export async function decodeImage(file: File): Promise<ImageBitmap> {
  if (file.size > MAX_INPUT_BYTES) throw new AvatarError('That photo is larger than 10 MB. Please choose a smaller one.')
  if (file.type && !file.type.startsWith('image/')) throw new AvatarError('Please choose a photo (JPEG, PNG, WebP or HEIC).')
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }) }
  catch { throw new AvatarError("This photo couldn't be read. Try a JPEG or PNG, or take a screenshot of it.") }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality))
}

/** Crop and resize to 512×512 and re-encode. Re-encoding drops EXIF data such as GPS location. */
export async function renderAvatar(img: ImageBitmap, crop: { x: number; y: number; size: number }): Promise<{ blob: Blob; ext: 'webp' | 'jpg' }> {
  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT; canvas.height = OUTPUT
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, OUTPUT, OUTPUT)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, crop.x, crop.y, crop.size, crop.size, 0, 0, OUTPUT, OUTPUT)
  for (const q of [0.85, 0.75, 0.6, 0.45]) {
    const webp = await toBlob(canvas, 'image/webp', q)
    if (webp && webp.type === 'image/webp' && webp.size <= MAX_UPLOAD_BYTES) return { blob: webp, ext: 'webp' }
    const jpeg = await toBlob(canvas, 'image/jpeg', q)
    if (jpeg && jpeg.size <= MAX_UPLOAD_BYTES) return { blob: jpeg, ext: 'jpg' }
  }
  throw new AvatarError("This photo couldn't be made small enough. Please try another one.")
}

function randomName(): string {
  const b = new Uint8Array(16); crypto.getRandomValues(b)
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
}

/** Upload under a new random name, point the profile at it, then delete the previous file. */
export async function saveAvatar(userId: string, out: { blob: Blob; ext: 'webp' | 'jpg' }): Promise<string> {
  const path = `${userId}/${randomName()}.${out.ext}`
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, out.blob,
    { contentType: out.ext === 'webp' ? 'image/webp' : 'image/jpeg', upsert: false, cacheControl: '3600' })
  if (upErr) throw new AvatarError("Your photo couldn't be uploaded. Please check your connection and try again.")
  const { data, error } = await supabase.rpc('set_avatar', { p_path: path })
  if (error) { await supabase.storage.from(BUCKET).remove([path]); throw error }
  const prev = (data as { previous_path: string | null }).previous_path
  if (prev) await supabase.storage.from(BUCKET).remove([prev])   // best effort; weekly cleanup catches failures
  forget(prev)
  return path
}

export async function removeAvatar(): Promise<void> {
  const { data, error } = await supabase.rpc('clear_avatar')
  if (error) throw error
  const prev = (data as { previous_path: string | null }).previous_path
  if (prev) { await supabase.storage.from(BUCKET).remove([prev]); forget(prev) }
}

// ---- Signed URLs: one batch request per render pass, cached in memory for just under an hour. ----
const TTL_S = 3600
const cache = new Map<string, { url: string | null; until: number }>()
const waiting = new Map<string, ((u: string | null) => void)[]>()
let timer: ReturnType<typeof setTimeout> | null = null

function forget(path: string | null) { if (path) cache.delete(path) }

async function flush() {
  timer = null
  const paths = [...waiting.keys()]
  const callbacks = new Map(waiting); waiting.clear()
  if (!paths.length) return
  let urls = new Map<string, string | null>()
  try {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, TTL_S)
    urls = new Map((data ?? []).map(d => [d.path ?? '', d.error ? null : d.signedUrl]))
  } catch { /* fall back to initials */ }
  const until = Date.now() + (TTL_S - 300) * 1000
  for (const p of paths) {
    const url = urls.get(p) ?? null
    cache.set(p, { url, until: url ? until : Date.now() + 60_000 })
    for (const cb of callbacks.get(p) ?? []) cb(url)
  }
}

export function signedAvatarUrl(path: string): Promise<string | null> {
  const hit = cache.get(path)
  if (hit && hit.until > Date.now()) return Promise.resolve(hit.url)
  return new Promise(resolve => {
    waiting.set(path, [...(waiting.get(path) ?? []), resolve])
    if (!timer) timer = setTimeout(() => void flush(), 30)
  })
}

export function useAvatarUrl(path: string | null | undefined): string | null {
  const valid = path && AVATAR_PATH.test(path) ? path : null
  const cached = valid ? cache.get(valid) : undefined
  const [url, setUrl] = useState<string | null>(cached && cached.until > Date.now() ? cached.url : null)
  useEffect(() => {
    let live = true
    if (!valid) { setUrl(null); return }
    void signedAvatarUrl(valid).then(u => { if (live) setUrl(u) })
    return () => { live = false }
  }, [valid])
  return url
}
