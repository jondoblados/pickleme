export function initials(name: string | null | undefined): string
export const AVATAR_COLOURS: readonly string[]
export function avatarColour(userId: string | null | undefined): string
export function contrastRatio(a: string, b: string): number
export function cropRect(width: number, height: number, view: number, zoom: number, ox: number, oy: number): { x: number; y: number; size: number; scale: number }
export function clampOffset(width: number, height: number, view: number, zoom: number, ox: number, oy: number): { ox: number; oy: number }
export const AVATAR_PATH: RegExp
