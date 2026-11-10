export type CancelReasonCode = 'rain' | 'lightning' | 'venue' | 'players' | 'organiser' | 'other'
export const CANCEL_REASONS: readonly { code: CancelReasonCode; label: string; text: string }[]
export const CANCEL_REASON_MIN: number
export const CANCEL_REASON_MAX: number
export function checkCancelReason(code: string, reason: string): { ok: true; text: string } | { ok: false; error: string }
export function presetText(nextCode: string, currentText: string): string
export interface Cancellation {
  reason: string | null; reason_code: CancelReasonCode | null; cancelled_at: string | null; note_at: string | null
  edited: boolean; note_by_name: string | null; note_by_role: 'player' | 'organiser' | 'admin' | null
}
export function cancelNoteAuthor(c: Cancellation | null | undefined): string
export function cancelNoteLine(c: Cancellation | null | undefined): string | null
