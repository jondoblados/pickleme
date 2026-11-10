-- Integration tests for FR-019 cancellation reasons. Fixtures roll back.
begin;
do $$
declare admin uuid := gen_random_uuid(); org uuid := gen_random_uuid(); player uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid(); grp uuid; grp_b uuid; g uuid; g2 uuid; g_old uuid; r jsonb; c jsonb; checks int := 0;
  act text;
begin
  insert into auth.users (id,email,aud,role,email_confirmed_at) values
    (admin,'cr-a@test.local','authenticated','authenticated',now()),(org,'cr-o@test.local','authenticated','authenticated',now()),
    (player,'cr-p@test.local','authenticated','authenticated',now()),(outsider,'cr-x@test.local','authenticated','authenticated',now());
  insert into public.groups (name,timezone) values ('CR Group','Asia/Singapore') returning id into grp;
  insert into public.groups (name,timezone) values ('CR Other','Asia/Singapore') returning id into grp_b;
  insert into public.group_members (group_id,user_id,role) values (grp,admin,'admin'),(grp,org,'organiser'),(grp,player,'player'),(grp_b,outsider,'admin');
  insert into public.profiles (user_id,display_name) values (admin,'CR Admin'),(org,'CR Organiser'),(player,'CR Player'),(outsider,'CR Outsider');
  insert into public.games (group_id,title,starts_at,ends_at,capacity,created_by) values
    (grp,'CR Tuesday',now()+interval '1 day',now()+interval '1 day 2 hours',8,admin) returning id into g;
  insert into public.games (group_id,title,starts_at,ends_at,capacity,created_by) values
    (grp,'CR Thursday',now()+interval '3 days',now()+interval '3 days 2 hours',8,admin) returning id into g2;
  -- A game cancelled before FR-019: no reason recorded.
  insert into public.games (group_id,title,starts_at,ends_at,capacity,created_by,status,cancelled_at,cancelled_by) values
    (grp,'CR Legacy',now()+interval '2 days',now()+interval '2 days 2 hours',8,admin,'cancelled',now()-interval '1 hour',admin) returning id into g_old;

  -- 1. The generic status change can no longer cancel.
  perform set_config('request.jwt.claims', json_build_object('sub',org,'role','authenticated')::text, true);
  begin perform public.set_game_status(g,'cancelled'); raise exception 'set_game_status cancelled without reason';
  exception when others then if sqlerrm <> 'cancel_reason_required' then raise; end if; end;
  perform public.set_game_status(g,'closed'); perform public.set_game_status(g,'open');
  checks := checks + 1;

  -- 2. Reason is required, trimmed, 3-200 characters, and the code must be one of the pulldown options.
  begin perform public.cancel_game(g,'rain','  '); raise exception 'blank reason accepted';
  exception when others then if sqlerrm <> 'cancel_reason_required' then raise; end if; end;
  begin perform public.cancel_game(g,'rain',null); raise exception 'null reason accepted';
  exception when others then if sqlerrm <> 'cancel_reason_required' then raise; end if; end;
  begin perform public.cancel_game(g,'rain',repeat('x',201)); raise exception 'long reason accepted';
  exception when others then if sqlerrm <> 'cancel_reason_too_long' then raise; end if; end;
  begin perform public.cancel_game(g,'snow','Snow day'); raise exception 'unknown code accepted';
  exception when others then if sqlerrm <> 'invalid_cancel_reason' then raise; end if; end;
  begin perform public.cancel_game(g,null,'Rain'); raise exception 'null code accepted';
  exception when others then if sqlerrm <> 'invalid_cancel_reason' then raise; end if; end;
  if (select status from public.games where id=g) <> 'open' then raise exception 'game changed by failed cancel'; end if;
  checks := checks + 1;

  -- 3. Players and other groups' admins cannot cancel.
  perform set_config('request.jwt.claims', json_build_object('sub',player,'role','authenticated')::text, true);
  begin perform public.cancel_game(g,'rain','Rain / wet courts'); raise exception 'player cancelled';
  exception when others then if sqlerrm <> 'forbidden' then raise; end if; end;
  perform set_config('request.jwt.claims', json_build_object('sub',outsider,'role','authenticated')::text, true);
  begin perform public.cancel_game(g,'rain','Rain / wet courts'); raise exception 'outsider cancelled';
  exception when others then if sqlerrm <> 'forbidden' then raise; end if; end;
  checks := checks + 1;

  -- 4. Organiser cancels with a reason; the game page shows the note with name and role.
  perform set_config('request.jwt.claims', json_build_object('sub',org,'role','authenticated')::text, true);
  r := public.cancel_game(g,'rain','  Rain / wet courts. See you next Tuesday.  ');
  if r->>'reason' <> 'Rain / wet courts. See you next Tuesday.' then raise exception 'reason not trimmed: %', r; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',player,'role','authenticated')::text, true);
  c := public.get_game(g)->'game'->'cancellation';
  if c->>'reason' <> 'Rain / wet courts. See you next Tuesday.' or c->>'reason_code' <> 'rain'
     or c->>'note_by_name' <> 'CR Organiser' or c->>'note_by_role' <> 'organiser' or (c->>'edited')::boolean
     or c->>'cancelled_at' is null then raise exception 'cancellation json: %', c; end if;
  if (select x->>'cancel_reason' from jsonb_array_elements(public.list_games(false)) x where x->>'id' = g::text)
     <> 'Rain / wet courts. See you next Tuesday.' then raise exception 'list_games reason'; end if;
  if public.get_game(g2)->'game'->'cancellation' <> 'null'::jsonb then raise exception 'open game has cancellation'; end if;
  if (select x->'cancel_reason' from jsonb_array_elements(public.list_games(false)) x where x->>'id' = g2::text) <> 'null'::jsonb
    then raise exception 'open game list reason'; end if;
  checks := checks + 1;

  -- 5. Cannot cancel twice; join is blocked as before.
  perform set_config('request.jwt.claims', json_build_object('sub',admin,'role','authenticated')::text, true);
  begin perform public.cancel_game(g,'venue','Venue unavailable'); raise exception 'cancelled twice';
  exception when others then if sqlerrm <> 'game_cancelled' then raise; end if; end;
  checks := checks + 1;

  -- 6. Admin edits the note; it shows the admin as author and is marked edited. Same text is a no-op.
  r := public.update_cancel_reason(g,'lightning','Lightning risk — courts closed by venue.');
  if not (r->>'changed')::boolean then raise exception 'edit not applied'; end if;
  r := public.update_cancel_reason(g,'lightning','Lightning risk — courts closed by venue.');
  if (r->>'changed')::boolean then raise exception 'identical edit not a no-op'; end if;
  c := public.get_game(g)->'game'->'cancellation';
  if c->>'reason' <> 'Lightning risk — courts closed by venue.' or c->>'note_by_name' <> 'CR Admin'
     or c->>'note_by_role' <> 'admin' or not (c->>'edited')::boolean then raise exception 'edited json: %', c; end if;
  checks := checks + 1;

  -- 7. Edits: only organisers/admins, only for cancelled games, same validation.
  begin perform public.update_cancel_reason(g2,'rain','Rain'); raise exception 'edit on open game';
  exception when others then if sqlerrm <> 'game_not_cancelled' then raise; end if; end;
  begin perform public.update_cancel_reason(g,'rain','x'); raise exception 'short edit accepted';
  exception when others then if sqlerrm <> 'cancel_reason_required' then raise; end if; end;
  perform set_config('request.jwt.claims', json_build_object('sub',player,'role','authenticated')::text, true);
  begin perform public.update_cancel_reason(g,'rain','Rain / wet courts'); raise exception 'player edited';
  exception when others then if sqlerrm <> 'forbidden' then raise; end if; end;
  checks := checks + 1;

  -- 8. Legacy cancelled game: no reason until one is added; adding one is not shown as "edited".
  c := public.get_game(g_old)->'game'->'cancellation';
  if c->'reason' <> 'null'::jsonb or c->>'note_by_name' <> 'CR Admin' then raise exception 'legacy json: %', c; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',admin,'role','authenticated')::text, true);
  perform public.update_cancel_reason(g_old,'rain','Rain / wet courts');
  c := public.get_game(g_old)->'game'->'cancellation';
  if c->>'reason' <> 'Rain / wet courts' or (c->>'edited')::boolean then raise exception 'legacy added json: %', c; end if;
  checks := checks + 1;

  -- 9. Activity log keeps the reason and the edit (before/after); details are allow-listed.
  select string_agg(a.action, ',' order by a.id) into act from public.audit_events a where a.game_id in (g, g_old);
  if act <> 'status_closed,status_open,status_cancelled,cancel_reason_updated,cancel_reason_updated' then raise exception 'audit actions: %', act; end if;
  r := (select private.activity_details(a.action,a.details) from public.audit_events a where a.game_id=g and a.action='status_cancelled');
  if r->>'reason' <> 'Rain / wet courts. See you next Tuesday.' or r->>'reason_code' <> 'rain' then raise exception 'cancel details: %', r; end if;
  r := (select private.activity_details(a.action,a.details) from public.audit_events a where a.game_id=g and a.action='cancel_reason_updated');
  if r->'changes'->'cancel_reason'->>'before' <> 'Rain / wet courts. See you next Tuesday.'
     or r->'changes'->'cancel_reason'->>'after' <> 'Lightning risk — courts closed by venue.' then raise exception 'edit details: %', r; end if;
  checks := checks + 1;

  -- 10. Table constraints: reason fields only on cancelled games.
  begin update public.games set cancel_reason = 'Nope' where id = g2; raise exception 'reason on open game';
  exception when check_violation then null; end;
  checks := checks + 1;

  -- 11. Deleting a cancelled game still works.
  r := public.delete_game(g);
  if not (r->>'deleted')::boolean then raise exception 'delete failed'; end if;
  checks := checks + 1;

  raise notice 'FR-019 cancellation reasons: % checks passed', checks;
end $$;
rollback;
