import type { FeeSummary } from './api'
export const FEE_MAX_CENTS: number
export function formatSgd(cents: number | null | undefined): string
export function parseSgd(text: string | null | undefined): number | null
export function shareCents(totalCents: number | null | undefined, people: number | null | undefined): number | null
export function costLine(fee: Pick<FeeSummary, 'total_cents' | 'share_cents' | 'share_if_full_cents' | 'basis' | 'final'> | null | undefined,
  opts?: { short?: boolean }): string | null
export const COUNTRY_CODES: readonly { code: string; label: string }[]
export function normalizeMobile(text: string | null | undefined): string
export function buildMobile(countryCode: string, typed: string): { ok: true; mobile: string } | { ok: false; error: string }
export function checkPayNowMobile(text: string): { ok: true; mobile: string } | { ok: false; error: string }
export function formatMobile(mobile: string | null | undefined): string
export function visibleFrom(visibility: string, startsAtIso: string | null | undefined): string | null
