-- Run as a database administrator after migrations + seed. All fixtures roll back.
begin;
insert into auth.users(id,email) values
 ('10000000-0000-4000-8000-000000000001','tcf-rls-a@example.invalid'),
 ('10000000-0000-4000-8000-000000000002','tcf-rls-b@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select set_config('test.attempt',(public.begin_attempt('official-reading')->>'id'),true);
do $$ begin
 if (select count(*) from public.attempts)<>1 then raise exception 'Owner cannot see attempt'; end if;
 if (select count(*) from public.questions where test_id='official-reading')<>39 then raise exception 'Missing questions'; end if;
 begin
  update public.attempts set deadline=now()+interval '1 year';
  raise exception 'FAIL: candidate can change deadline';
 exception when insufficient_privilege then null; end;
 begin
  perform * from private.answer_keys;
  raise exception 'FAIL: answer keys exposed';
 exception when insufficient_privilege then null; end;
end $$;
select public.exam_action(current_setting('test.attempt')::uuid,'save','{"answers":{"reading-1":"0"}}');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$ begin
 if (select count(*) from public.attempts)<>0 then raise exception 'FAIL: cross-account visibility'; end if;
 begin
  perform public.exam_action(current_setting('test.attempt')::uuid,'submit','{}');
  raise exception 'FAIL: cross-account mutation';
 exception when raise_exception then
  if sqlerrm<>'Attempt not found' then raise; end if;
 end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$ declare result jsonb; begin
 result:=public.exam_action(current_setting('test.attempt')::uuid,'submit','{}');
 if result->>'raw_score'<>'1' or result->>'status'<>'submitted' then raise exception 'FAIL: scoring'; end if;
 begin
  perform public.exam_action(current_setting('test.attempt')::uuid,'save','{"answers":{}}');
  raise exception 'FAIL: mutable submission';
 exception when raise_exception then if sqlerrm<>'Attempt closed' then raise; end if; end;
end $$;
select set_config('test.audio',(public.begin_attempt('official-listening')->>'id'),true);
select public.exam_action(current_setting('test.audio')::uuid,'audio','{"question_id":"listening-1"}');
do $$ begin
 begin
  perform public.exam_action(current_setting('test.audio')::uuid,'audio','{"question_id":"listening-1"}');
  raise exception 'FAIL: replay permitted';
 exception when raise_exception then if sqlerrm not in ('Audio sequence locked','Audio already consumed') then raise; end if; end;
end $$;
reset role;
update public.attempts set started_at=now()-interval '1 hour',deadline=now()-interval '1 minute' where id=current_setting('test.audio')::uuid;
set local role authenticated;
do $$ declare result jsonb; begin
 result:=public.exam_action(current_setting('test.audio')::uuid,'save','{"answers":{"listening-1":"1"}}');
 if result->>'status'<>'expired' or result->'answers'<>'{}'::jsonb then raise exception 'FAIL: late answer accepted'; end if;
end $$;
rollback;
select 'PASS: ownership, answer isolation, immutable timestamps/submissions, atomic single-play claims and expired answer rejection' as security_tests;
