export interface ActivityDetails {
  changes?: Record<string, { before: unknown; after: unknown }>;
  [key: string]: unknown;
}
export interface ActivityEvent {
  id: string; created_at: string; action: string; actor_id: string | null; actor_name: string | null;
  target_user_id: string | null; target_name: string | null; game_id: string | null;
  game_title: string | null; game_starts_at: string | null; context_origin: string;
  details: ActivityDetails;
}
export interface ActivityCursor { at: string; id: string }
export interface ActivityPage {
  rows: ActivityEvent[]; next_cursor: ActivityCursor | null; as_of: string; timezone: string;
}
export const activityLabels: Readonly<Record<string, string>>;
export function activityLabel(action: string): string;
export function activityChanges(details: ActivityDetails): { field: string; before: unknown; after: unknown }[];
export function activityCsv(rows: ActivityEvent[]): string;
