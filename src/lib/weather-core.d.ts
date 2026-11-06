export interface WeatherHour { t: string; temp: number | null; code: number | null; pop: number | null; rain: number | null; wind: number | null; day: number | null }
export interface WeatherResponse {
  state: 'no_location' | 'not_configured' | 'configured' | 'cancelled'
  can_manage: boolean; now: string; timezone?: string; location?: string
  venue?: { address: string; latitude: number; longitude: number }
  game?: { starts_at: string; ends_at: string; date: string; day_start: string }
  active_from?: string; active_until?: string; last_attempt_at?: string | null; last_attempt_failed?: boolean
  forecast?: null | { provider: string; fetched_at: string; grid: { latitude: number; longitude: number }
    hours: WeatherHour[]; day: null | { date: string; code: number | null; tmax: number | null; tmin: number | null; pop_max: number | null; rain_sum: number | null } }
}
export interface Interval { start: number; end: number; temp: number | null; code: number | null; day: 0 | 1; wind: number | null; pop: number | null; rain: number | null }
export interface Slot extends Interval { inGame: boolean; isNow: boolean }
export interface Summary { code: number | null; day: number; tmin: number | null; tmax: number | null; popMax: number | null; thunder: boolean }
export interface Part extends Summary { label: string; from: number; to: number; hasGame: boolean; complete: boolean }
interface Base { venue: NonNullable<WeatherResponse['venue']>; location: string; canManage: boolean; timezone: string }
interface Meta extends Base { fetchedAt: string; stale: boolean; provider: string; grid: { latitude: number; longitude: number }; lastAttemptFailed: boolean }
export type WeatherView =
  | { kind: 'hidden' }
  | { kind: 'setup'; location: string }
  | ({ kind: 'not_yet'; availableFrom: string } & Base)
  | ({ kind: 'pending' } & Base)
  | ({ kind: 'unavailable' } & Base)
  | ({ kind: 'day_before'; date: string; complete: boolean; parts: Part[]; game: Summary
      daily: null | { code: number | null; tmin: number | null; tmax: number | null; popMax: number | null; rainSum: number | null } } & Meta)
  | ({ kind: 'game_day'; window: { from: number; to: number }; slots: Slot[]; complete: boolean; game: Summary; gameStart: number; gameEnd: number } & Meta)
export const STALE_AFTER_MS: number
export function conditionFor(code: number | null, isDay?: number | null): { key: string; label: string }
export function severity(code: number | null | undefined): number
export function hourIntervals(hours: WeatherHour[] | null | undefined): Interval[]
export function gameWindow(startsAt: string, endsAt: string): { from: number; to: number }
export function buildWeatherView(resp: WeatherResponse | null | undefined): WeatherView
