-- FR-009 tests: re-copy invite links, who joined with each link, joins from game links.
-- Run after migration 20261023000007 in the same script. Always rolls back.
do $$
declare
  admin uuid := gen_random_uuid(); org uuid := gen_random_uuid(); player uuid := gen_random_uuid();
  j1 uuid := gen_random_uuid(); j2 uuid := gen_random_uuid(); gj uuid := gen_random_uuid(); other_admin uuid := gen_random_uuid();
  grp uuid; grp_b uuid; g uuid; inv jsonb; inv2 jsonb; legacy uuid; r jsonb; e jsonb; log text := ''; i int; n int; t text;
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at) values
    (admin,'ic-a@test.local','authenticated','authenticated',now()), (org,'ic-o@test.local','authenticated','authenticated',now()),
    (player,'ic-p@test.local','authenticated','authenticated',now()), (j1,'ic-j1@test.local','authenticated','authenticated',now()),
    (j2,'ic-j2@test.local','authenticated','authenticated',now()), (gj,'ic-gj@test.local','authenticated','authenticated',now()),
    (other_admin,'ic-x@test.local','authenticated','authenticated',now());
  insert into public.groups (name, timezone) values ('IC Group','Asia/Singapore') returning id into grp;
  insert into public.groups (name, timezone) values ('IC Other','Asia/Singapore') returning id into grp_b;
  insert into public.group_members (group_id,user_id,role) values (grp,admin,'admin'),(grp,org,'organiser'),(grp,player,'player'),(grp_b,other_admin,'admin');
  insert into public.profiles (user_id, display_name) values (admin,'IC Admin'),(org,'IC Org'),(player,'IC Player'),(j1,'IC J1'),(j2,'IC J2'),(gj,'IC GJ'),(other_admin,'IC X');

  perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  inv := public.create_invite(grp, 30, 200);
  inv2 := public.create_invite(grp, 30, 1);
  -- A link from before this release: hash only, no stored token.
  insert into public.group_invites (group_id, token_hash, created_by, expires_at, max_uses)
  values (grp, encode(extensions.digest('legacy-token','sha256'),'hex'), admin, now() + interval '10 days', 200) returning id into legacy;

  r := public.get_invite_link((inv->>'id')::uuid);
  log := log || format(E'C1 admin re-copies the same link: %s\n', r->>'token' = inv->>'token');
  perform set_config('request.jwt.claims', json_build_object('sub', org, 'role', 'authenticated')::text, true);
  r := public.get_invite_link((inv->>'id')::uuid);
  log := log || format(E'C2 organiser can copy too: %s\n', r->>'token' = inv->>'token');
  perform set_config('request.jwt.claims', json_build_object('sub', player, 'role', 'authenticated')::text, true);
  begin perform public.get_invite_link((inv->>'id')::uuid); log := log || E'C3 player blocked: false\n';
  exception when others then log := log || format(E'C3 player cannot copy: %s\n', sqlerrm = 'forbidden'); end;
  begin perform public.list_invites_detail(grp); log := log || E'C4 player list blocked: false\n';
  exception when others then log := log || format(E'C4 player cannot see invite list: %s\n', sqlerrm = 'forbidden'); end;
  begin perform public.list_game_link_joins(grp); log := log || E'C5 player game-joins blocked: false\n';
  exception when others then log := log || format(E'C5 player cannot see game-link joins: %s\n', sqlerrm = 'forbidden'); end;
  perform set_config('request.jwt.claims', json_build_object('sub', other_admin, 'role', 'authenticated')::text, true);
  begin perform public.get_invite_link((inv->>'id')::uuid); log := log || E'C6 other-group admin blocked: false\n';
  exception when others then log := log || format(E'C6 other group admin cannot copy: %s\n', sqlerrm = 'forbidden'); end;
  set local role authenticated;
  begin select count(*) into n from private.invite_tokens; log := log || E'C7 token table hidden: false\n';
  exception when insufficient_privilege then log := log || E'C7 raw tokens not readable directly: true\n'; end;
  reset role;

  -- Two people join with the first link; the re-copied token redeems normally.
  perform set_config('request.jwt.claims', json_build_object('sub', j1, 'role', 'authenticated')::text, true);
  perform public.redeem_invite(inv->>'token');
  perform set_config('request.jwt.claims', json_build_object('sub', j2, 'role', 'authenticated')::text, true);
  perform public.redeem_invite(inv->>'token');
  perform public.redeem_invite(inv->>'token'); -- already a member: not counted twice
  -- Someone joins from a game link.
  insert into public.games (group_id,title,starts_at,ends_at,capacity,created_by)
  values (grp,'IC Game',now()+interval '1 day',now()+interval '1 day 2 hours',8,admin) returning id into g;
  perform set_config('request.jwt.claims', json_build_object('sub', gj, 'role', 'authenticated')::text, true);
  perform public.join_shared_game(g);

  perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  r := public.list_invites_detail(grp);
  log := log || format(E'L1 lists all 3 invites: %s\n', jsonb_array_length(r) = 3);
  select x into e from jsonb_array_elements(r) x where x->>'id' = inv->>'id';
  log := log || format(E'L2 new link copyable, creator named: %s\n', e->>'copyable' = 'true' and e->>'created_by_name' = 'IC Admin');
  log := log || format(E'L3 joined list has J1 and J2 (no duplicate): %s\n', jsonb_array_length(e->'joined') = 2
    and e->'joined' @> jsonb_build_array(jsonb_build_object('name','IC J1')) and e->'joined' @> jsonb_build_array(jsonb_build_object('name','IC J2')));
  log := log || format(E'L4 joined count matches use_count: %s\n', (e->>'use_count')::int = jsonb_array_length(e->'joined'));
  log := log || format(E'L5 newest join listed first: %s\n', e->'joined'->0->>'name' = 'IC J2');
  select x into e from jsonb_array_elements(r) x where x->>'id' = legacy::text;
  log := log || format(E'L6 pre-release link marked not copyable: %s\n', e->>'copyable' = 'false');
  begin perform public.get_invite_link(legacy); log := log || E'L7 legacy copy rejected: false\n';
  exception when others then log := log || format(E'L7 pre-release link cannot be copied: %s\n', sqlerrm = 'invite_not_copyable'); end;
  select x into e from jsonb_array_elements(r) x where x->>'id' = inv2->>'id';
  log := log || format(E'L8 unused link has empty joined list: %s\n', jsonb_array_length(e->'joined') = 0);

  r := public.list_game_link_joins(grp);
  log := log || format(E'G1 game-link join listed with game name: %s\n', jsonb_array_length(r) = 1 and r->0->>'name' = 'IC GJ' and r->0->>'game' = 'IC Game');
  select count(*) into n from jsonb_array_elements(public.list_invites_detail(grp)) x, jsonb_array_elements(x->'joined') j where j->>'name' = 'IC GJ';
  log := log || format(E'G2 game-link joiner not counted under any invite: %s\n', n = 0);
  perform set_config('request.jwt.claims', json_build_object('sub', other_admin, 'role', 'authenticated')::text, true);
  r := public.list_game_link_joins(grp_b);
  log := log || format(E'G3 other group sees none of these joins: %s\n', jsonb_array_length(r) = 0);

  -- Inactive links cannot be copied: turned off, used up, expired.
  perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  perform public.revoke_invite((inv->>'id')::uuid);
  begin perform public.get_invite_link((inv->>'id')::uuid); log := log || E'X1 turned-off copy rejected: false\n';
  exception when others then log := log || format(E'X1 turned-off link cannot be copied: %s\n', sqlerrm = 'invite_inactive'); end;
  select x into e from jsonb_array_elements(public.list_invites_detail(grp)) x where x->>'id' = inv->>'id';
  log := log || format(E'X2 turned-off link keeps its joined history: %s\n', jsonb_array_length(e->'joined') = 2 and e->>'revoked_at' is not null);
  perform set_config('request.jwt.claims', json_build_object('sub', player, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', j1, 'role', 'authenticated')::text, true);
  -- use up inv2 (max 1) with a fresh user
  insert into auth.users (id, email, aud, role, email_confirmed_at) values (gen_random_uuid(),'ic-u@test.local','authenticated','authenticated',now()) returning id into gj;
  perform set_config('request.jwt.claims', json_build_object('sub', gj, 'role', 'authenticated')::text, true);
  perform public.redeem_invite(inv2->>'token');
  perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  begin perform public.get_invite_link((inv2->>'id')::uuid); log := log || E'X3 used-up copy rejected: false\n';
  exception when others then log := log || format(E'X3 used-up link cannot be copied: %s\n', sqlerrm = 'invite_inactive'); end;
  update public.group_invites set expires_at = now() - interval '1 minute' where id = legacy;
  begin perform public.get_invite_link(legacy); log := log || E'X4 expired copy rejected: false\n';
  exception when others then log := log || format(E'X4 expired link cannot be copied: %s\n', sqlerrm = 'invite_inactive'); end;

  -- Existing production links: history matches use counts.
  select count(*) into n from public.group_invites i where i.created_at < now()
    and i.use_count <> (select count(*) from public.audit_events a where a.action='member_joined' and a.details->>'invite_id'=i.id::text);
  log := log || format(E'P1 every existing link''s history matches its use count: %s\n', n = 0);

  select count(*) filter (where l ~ ': (t|true)$'), count(*) filter (where l <> '' and l !~ ': (t|true)$'),
         coalesce(string_agg(l, ' | ') filter (where l <> '' and l !~ ': (t|true)$'), 'none')
    into i, n, t from unnest(string_to_array(log, E'\n')) l;
  raise exception 'RESULTS passed=% failed=% failing=[%]%', i, n, t, E'\n' || log;
end $$;
