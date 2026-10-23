-- FR-010: admins (not organisers) can permanently delete a cancelled game.
-- Deleting cascades to its sign-ups, attendance, notification outbox and game-level audit events.
-- A group-level audit entry (no game_id, so it survives the cascade) records what was deleted and by whom.
create or replace function public.delete_game(p_game_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g public.games; regs int;
begin
  perform private.require_uid();
  g := private.lock_game(p_game_id);
  if not private.has_role(g.group_id, array['admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if g.status <> 'cancelled' then raise exception 'only_cancelled_games' using errcode = 'P0001'; end if;
  select count(*) into regs from public.registrations where game_id = g.id;
  delete from public.games where id = g.id;
  perform private.audit(g.group_id, null, 'game_deleted', null, jsonb_build_object(
    'game_id', g.id, 'title', g.title, 'starts_at', g.starts_at, 'registrations', regs));
  return jsonb_build_object('deleted', true, 'title', g.title);
end $$;
revoke all on function public.delete_game(uuid) from public, anon;
grant execute on function public.delete_game(uuid) to authenticated;
