export const CODE_MIN: number
export const CODE_MAX: number
export const PENDING_KEY: string
export const PENDING_TTL_MS: number
export function normaliseCode(input: unknown): string
export function isCompleteCode(code: string): boolean
export function readPending(raw: string | null, now?: number): string | null
export function writePending(email: string, now?: number): string
