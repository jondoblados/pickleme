-- Tests for the deleted-account session fix. Run after migration 20261023000010. Always rolls back.
do $$
declare live uuid := gen_random_uuid(); ghost uuid := gen_random_uuid(); grp uuid; r jsonb; log text := ''; i int; n int; t text;
begin
  insert into auth.users (id,email,aud,role,email_confirmed_at) values (live,'da-live@test.local','authenticated','authenticated',now());
  insert into public.groups (name,timezone) values ('DA Group','Asia/Singapore') returning id into grp;
  insert into public.group_members (group_id,user_id,role) values (grp,live,'admin');
  insert into public.profiles (user_id,display_name) values (live,'DA Live');

  -- ghost: a session for a user id that is not in auth.users (account deleted after sign-in).
  perform set_config('request.jwt.claims', json_build_object('sub',ghost,'role','authenticated')::text, true);
  begin perform public.get_me(); log := log || E'A1 get_me rejects deleted account: false\n';
  exception when others then log := log || format(E'A1 get_me reports account_not_found: %s\n', sqlerrm='account_not_found'); end;
  begin perform public.set_display_name('You'); log := log || E'A2 set_display_name: false\n';
  exception when others then log := log || format(E'A2 saving a name reports account_not_found (not FK error): %s\n', sqlerrm='account_not_found'); end;
  begin perform public.join_game(gen_random_uuid()); log := log || E'A3 join_game: false\n';
  exception when others then log := log || format(E'A3 sign-up actions report account_not_found: %s\n', sqlerrm='account_not_found'); end;
  r := public.list_games(false);
  log := log || format(E'A3b games list returns nothing for a deleted account: %s\n', jsonb_array_length(r)=0);

  perform set_config('request.jwt.claims', json_build_object('sub',live,'role','authenticated')::text, true);
  r := public.get_me();
  log := log || format(E'A4 live account unaffected: %s\n', r->>'display_name'='DA Live' and jsonb_array_length(r->'groups')=1);
  r := public.set_display_name('DA Renamed');
  log := log || format(E'A5 live account can save name: %s\n', r->>'display_name'='DA Renamed');
  perform set_config('request.jwt.claims', '', true);
  begin perform public.get_me(); log := log || E'A6 signed-out get_me: false\n';
  exception when others then log := log || format(E'A6 signed-out still reports not_signed_in: %s\n', sqlerrm='not_signed_in'); end;

  select count(*) filter (where l ~ ': (t|true)$'), count(*) filter (where l <> '' and l !~ ': (t|true)$'),
         coalesce(string_agg(l, ' | ') filter (where l <> '' and l !~ ': (t|true)$'), 'none')
    into i, n, t from unnest(string_to_array(log, E'\n')) l;
  raise exception 'RESULTS passed=% failed=% failing=[%]%', i, n, t, E'\n' || log;
end $$;
