-- FR-010 tests. Run after migration 20261023000008 in the same script. Always rolls back.
do $$
declare admin uuid := gen_random_uuid(); org uuid := gen_random_uuid(); player uuid := gen_random_uuid(); x_admin uuid := gen_random_uuid();
  grp uuid; grp_b uuid; g uuid; g_open uuid; g_keep uuid; r jsonb; log text := ''; i int; n int; t text;
begin
  insert into auth.users (id,email,aud,role,email_confirmed_at) values
    (admin,'dg-a@test.local','authenticated','authenticated',now()),(org,'dg-o@test.local','authenticated','authenticated',now()),
    (player,'dg-p@test.local','authenticated','authenticated',now()),(x_admin,'dg-x@test.local','authenticated','authenticated',now());
  insert into public.groups (name,timezone) values ('DG Group','Asia/Singapore') returning id into grp;
  insert into public.groups (name,timezone) values ('DG Other','Asia/Singapore') returning id into grp_b;
  insert into public.group_members (group_id,user_id,role) values (grp,admin,'admin'),(grp,org,'organiser'),(grp,player,'player'),(grp_b,x_admin,'admin');
  insert into public.profiles (user_id,display_name) values (admin,'DG A'),(org,'DG O'),(player,'DG P'),(x_admin,'DG X');
  insert into public.games (group_id,title,starts_at,ends_at,capacity,created_by) values
    (grp,'DG Cancel me',now()+interval '2 days',now()+interval '2 days 2 hours',8,admin) returning id into g;
  insert into public.games (group_id,title,starts_at,ends_at,capacity,created_by) values
    (grp,'DG Open',now()+interval '3 days',now()+interval '3 days 2 hours',8,admin) returning id into g_open;
  insert into public.games (group_id,title,starts_at,ends_at,capacity,created_by) values
    (grp,'DG Keep',now()+interval '4 days',now()+interval '4 days 2 hours',8,admin) returning id into g_keep;
  perform set_config('request.jwt.claims', json_build_object('sub',player,'role','authenticated')::text, true);
  perform public.join_game(g); perform public.join_game(g_keep);
  perform set_config('request.jwt.claims', json_build_object('sub',admin,'role','authenticated')::text, true);
  perform public.set_game_status(g,'cancelled');

  begin perform public.delete_game(g_open); log := log || E'D1 open game delete blocked: false\n';
  exception when others then log := log || format(E'D1 only cancelled games can be deleted: %s\n', sqlerrm='only_cancelled_games'); end;
  perform set_config('request.jwt.claims', json_build_object('sub',org,'role','authenticated')::text, true);
  begin perform public.delete_game(g); log := log || E'D2 organiser blocked: false\n';
  exception when others then log := log || format(E'D2 organiser cannot delete: %s\n', sqlerrm='forbidden'); end;
  perform set_config('request.jwt.claims', json_build_object('sub',player,'role','authenticated')::text, true);
  begin perform public.delete_game(g); log := log || E'D3 player blocked: false\n';
  exception when others then log := log || format(E'D3 player cannot delete: %s\n', sqlerrm='forbidden'); end;
  perform set_config('request.jwt.claims', json_build_object('sub',x_admin,'role','authenticated')::text, true);
  begin perform public.delete_game(g); log := log || E'D4 other-group admin blocked: false\n';
  exception when others then log := log || format(E'D4 admin of another group cannot delete: %s\n', sqlerrm='forbidden'); end;
  perform set_config('request.jwt.claims', '', true);
  begin perform public.delete_game(g); log := log || E'D5 signed-out blocked: false\n';
  exception when others then log := log || format(E'D5 signed-out cannot delete: %s\n', sqlerrm='not_signed_in'); end;

  perform set_config('request.jwt.claims', json_build_object('sub',admin,'role','authenticated')::text, true);
  r := public.delete_game(g);
  log := log || format(E'D6 admin deletes cancelled game: %s\n', r->>'deleted'='true' and r->>'title'='DG Cancel me');
  select count(*) into n from public.games where id=g;
  log := log || format(E'D7 game gone: %s\n', n=0);
  select count(*) into n from public.registrations where game_id=g;
  log := log || format(E'D8 its sign-ups gone: %s\n', n=0);
  select count(*) into n from public.audit_events where game_id=g;
  log := log || format(E'D9 its game-level log entries gone: %s\n', n=0);
  select count(*) into n from public.audit_events where group_id=grp and action='game_deleted' and actor_id=admin
    and details->>'title'='DG Cancel me' and (details->>'registrations')::int=1;
  log := log || format(E'D10 deletion recorded in group log with title and actor: %s\n', n=1);
  select count(*) into n from public.registrations where game_id=g_keep and user_id=player and cancelled_at is null;
  log := log || format(E'D11 other games and sign-ups untouched: %s\n', n=1 and exists(select 1 from public.games where id=g_open));
  begin perform public.delete_game(g); log := log || E'D12 repeat delete: false\n';
  exception when others then log := log || format(E'D12 deleting again reports not found: %s\n', sqlerrm='game_not_found'); end;

  select count(*) filter (where l ~ ': (t|true)$'), count(*) filter (where l <> '' and l !~ ': (t|true)$'),
         coalesce(string_agg(l, ' | ') filter (where l <> '' and l !~ ': (t|true)$'), 'none')
    into i, n, t from unnest(string_to_array(log, E'\n')) l;
  raise exception 'RESULTS passed=% failed=% failing=[%]%', i, n, t, E'\n' || log;
end $$;
