begin;
create or replace function private.begin_attempt(p_test text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); t public.tests; a public.attempts;
begin
 if u is null then raise exception 'Authentication required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into t from public.tests where id=p_test and published;
 if not found then raise exception 'Test unavailable'; end if;
 update public.attempts a set status='expired',submitted_at=clock_timestamp(),raw_score=case when a.skill in ('reading','listening') then (select count(*) from private.answer_keys k where k.test_id=a.test_id and k.correct::text=a.answers->>k.question_id) else null end where user_id=u and status='active' and deadline<=clock_timestamp();
 select * into a from public.attempts where user_id=u and status='active';
 if found then
  if a.test_id<>p_test then raise exception 'Terminez la tentative en cours avant d’en ouvrir une autre.'; end if;
  return to_jsonb(a);
 end if;
 if (select count(*) from public.attempts where user_id=u and started_at>now()-interval '24 hours')>=20 then raise exception 'Daily attempt limit reached'; end if;
 insert into public.attempts(user_id,test_id,skill,mode,deadline,total)
 values(u,t.id,t.skill,t.mode,clock_timestamp()+make_interval(secs=>t.duration_seconds),t.question_count) returning * into a;
 return to_jsonb(a);
end $$;
create or replace function private.exam_action(p_attempt uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); a public.attempts; q public.questions; item record; k private.answer_keys; candidate jsonb; score integer; qid text;
begin
 if u is null then raise exception 'Authentication required'; end if;
 select * into a from public.attempts where id=p_attempt and user_id=u for update;
 if not found then raise exception 'Attempt not found'; end if;
 if a.status<>'active' then
  if p_action in ('submit','read') then return to_jsonb(a); end if;
  raise exception 'Attempt closed';
 end if;
 if clock_timestamp()>=a.deadline then
  select count(*) into score from private.answer_keys ak where ak.test_id=a.test_id and ak.correct::text=a.answers->>ak.question_id;
  update public.attempts set status='expired',submitted_at=clock_timestamp(),raw_score=case when skill in ('reading','listening') then score else null end where id=a.id returning * into a;
  return to_jsonb(a);
 end if;
 if p_action='read' then return to_jsonb(a); end if;
 if p_action in ('save','submit') then
  candidate:=coalesce(p_payload->'answers',a.answers);
  if jsonb_typeof(candidate)<>'object' or octet_length(candidate::text)>60000 then raise exception 'Invalid answers'; end if;
  for item in select * from jsonb_each(candidate) loop
   select * into q from public.questions where test_id=a.test_id and id=item.key;
   if not found or jsonb_typeof(item.value)<>'string' then raise exception 'Unknown question or invalid answer'; end if;
   if a.skill in ('reading','listening') and (item.value#>>'{}') not in ('0','1','2','3','') then raise exception 'Invalid choice'; end if;
   if length(item.value#>>'{}')>12000 then raise exception 'Answer too long'; end if;
   if a.skill='listening' and not(item.key=any(a.audio_claims)) then raise exception 'Audio must be played first'; end if;
  end loop;
  if a.skill='speaking' and candidate<>'{}'::jsonb then raise exception 'Speaking responses must be recordings'; end if;
  -- Listening responses are immutable once the next recording has been claimed.
  if a.skill='listening' and cardinality(a.audio_claims)>1 then
   for qid in select unnest(a.audio_claims[1:cardinality(a.audio_claims)-1]) loop
    if (candidate->qid) is distinct from (a.answers->qid) then raise exception 'Previous listening answer locked'; end if;
   end loop;
  end if;
  update public.attempts set answers=candidate where id=a.id returning * into a;
  if p_action='submit' then
   select count(*) into score from private.answer_keys ak where ak.test_id=a.test_id and ak.correct::text=a.answers->>ak.question_id;
   update public.attempts set status='submitted',submitted_at=clock_timestamp(),raw_score=case when skill in ('reading','listening') then score else null end where id=a.id returning * into a;
  end if;
 elsif p_action='audio' then
  qid:=p_payload->>'question_id';
  if a.skill<>'listening' then raise exception 'Not a listening attempt'; end if;
  select * into q from public.questions where test_id=a.test_id and id=qid;
  if not found or q.position<>cardinality(a.audio_claims)+1 then raise exception 'Audio sequence locked'; end if;
  if qid=any(a.audio_claims) then raise exception 'Audio already consumed'; end if;
  select * into k from private.answer_keys where test_id=a.test_id and question_id=qid;
  if k.audio_path is null then raise exception 'Audio unavailable'; end if;
  update public.attempts set audio_claims=array_append(audio_claims,qid) where id=a.id;
  return jsonb_build_object('path',k.audio_path);
 elsif p_action='integrity' then
  if p_payload->>'type' not in ('focus_lost','fullscreen_exit','reloaded','audio_error') then raise exception 'Invalid event'; end if;
  if jsonb_array_length(a.integrity_events)<200 then
   update public.attempts set integrity_events=integrity_events||jsonb_build_array(jsonb_build_object('type',p_payload->>'type','at',clock_timestamp())) where id=a.id returning * into a;
  end if;
 else raise exception 'Unknown action'; end if;
 return to_jsonb(a);
end $$;
commit;
