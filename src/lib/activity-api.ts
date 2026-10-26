import { supabase } from './supabase'
import type { ActivityCursor, ActivityPage } from './activity-log.js'
export interface ActivityFilters { from: string; to: string; game: string; person: string; action: string }
export interface ActivityChoices { games: { id: string; name: string }[]; people: { id: string; name: string }[] }
export async function getActivityPage(groupId: string, filters: ActivityFilters, cursor: ActivityCursor | null = null, asOf: string | null = null, limit = 50) {
  const { data, error } = await supabase.rpc('list_activity_log', {
    p_group_id: groupId, p_from: filters.from, p_to: filters.to,
    p_game_id: filters.game || null, p_person_id: filters.person || null, p_action: filters.action || null,
    p_before_at: cursor?.at ?? null, p_before_id: cursor?.id ?? null, p_limit: limit, p_as_of: asOf,
  })
  if (error) throw error
  return data as ActivityPage
}
export async function getActivityChoices(groupId: string, from: string, to: string) {
  const { data, error } = await supabase.rpc('activity_filter_options', { p_group_id: groupId, p_from: from, p_to: to })
  if (error) throw error
  return data as ActivityChoices
}
