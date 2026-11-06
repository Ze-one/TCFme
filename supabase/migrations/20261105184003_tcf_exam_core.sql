begin;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create table public.tests (
 id text primary key, skill text not null check(skill in ('listening','reading','writing','speaking')),
 mode text not null check(mode in ('official','c2')), title text not null,
 duration_seconds integer not null check(duration_seconds>0), question_count integer not null check(question_count>0),
 version integer not null default 1, published boolean not null default false,
 calibration_status text not null default 'editorial_unvalidated', unique(skill,mode)
);
create table public.questions (
 test_id text not null references public.tests(id), id text not null, position integer not null,
 skill text not null, level text not null check(level in ('A1','A2','B1','B2','C1','C2')),
 title text not null, passage text not null default '', prompt text not null, options jsonb not null default '[]',
 min_words integer, max_words integer, duration_seconds integer, preparation_seconds integer,
 primary key(test_id,id), unique(test_id,position), check(jsonb_typeof(options)='array')
);
create table private.answer_keys (
 test_id text not null, question_id text not null, correct integer check(correct between 0 and 3),
 rationale text, audio_path text, script text, primary key(test_id,question_id),
 foreign key(test_id,question_id) references public.questions(test_id,id) on delete cascade
);
create table public.attempts (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 test_id text not null references public.tests(id), skill text not null, mode text not null,
 status text not null default 'active' check(status in ('active','submitted','expired')),
 started_at timestamptz not null default clock_timestamp(), deadline timestamptz not null,
 submitted_at timestamptz, answers jsonb not null default '{}', audio_claims text[] not null default '{}',
 integrity_events jsonb not null default '[]', raw_score integer, total integer not null,
 check(deadline>started_at), check(jsonb_typeof(answers)='object'), check(jsonb_typeof(integrity_events)='array')
);
create index attempts_user_started_idx on public.attempts(user_id,started_at desc);
create index attempts_test_idx on public.attempts(test_id);
create unique index one_active_attempt on public.attempts(user_id) where status='active';
create table public.recordings (
 attempt_id uuid not null references public.attempts(id) on delete cascade, question_id text not null,
 user_id uuid not null references auth.users(id) on delete cascade, path text not null unique,
 mime_type text not null, created_at timestamptz not null default now(), primary key(attempt_id,question_id)
);
create index recordings_user_idx on public.recordings(user_id);
create table public.ai_scoring_logs (
 id uuid primary key default gen_random_uuid(), attempt_id uuid not null references public.attempts(id) on delete cascade,
 question_id text not null, user_id uuid not null references auth.users(id) on delete cascade,
 status text not null check(status in ('pending','complete','failed')), model text not null, rubric_version text not null,
 result jsonb, error_code text, input_tokens integer, output_tokens integer,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(attempt_id,question_id,rubric_version)
);
create index scoring_user_idx on public.ai_scoring_logs(user_id,created_at desc);
create index scoring_attempt_idx on public.ai_scoring_logs(attempt_id);
alter table public.tests enable row level security;
alter table public.questions enable row level security;
alter table public.attempts enable row level security;
alter table public.recordings enable row level security;
alter table public.ai_scoring_logs enable row level security;
alter table private.answer_keys enable row level security;
grant select on public.tests to anon,authenticated;
grant select on public.questions,public.attempts,public.recordings,public.ai_scoring_logs to authenticated;
revoke insert,update,delete on public.tests,public.questions,public.attempts,public.recordings,public.ai_scoring_logs from anon,authenticated;
grant all on public.tests,public.questions,public.attempts,public.recordings,public.ai_scoring_logs to service_role;
create policy published_tests on public.tests for select to anon,authenticated using(published);
create policy own_attempts on public.attempts for select to authenticated using(user_id=(select auth.uid()));
create policy attempted_questions on public.questions for select to authenticated using(exists(select 1 from public.attempts a where a.user_id=(select auth.uid()) and a.test_id=questions.test_id));
create policy own_recordings on public.recordings for select to authenticated using(user_id=(select auth.uid()));
create policy own_scores on public.ai_scoring_logs for select to authenticated using(user_id=(select auth.uid()));

-- The private definer owns the narrow state transition. The exposed wrapper is an invoker.
-- No client can directly update server timestamps, scores, owner IDs or submitted work.
create function private.begin_attempt(p_test text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); t public.tests; a public.attempts;
begin
 if u is null then raise exception 'Authentication required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into t from public.tests where id=p_test and published;
 if not found then raise exception 'Test unavailable'; end if;
 update public.attempts set status='expired',submitted_at=clock_timestamp() where user_id=u and status='active' and deadline<=clock_timestamp();
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
create function public.begin_attempt(p_test text) returns jsonb language sql security invoker set search_path='' as $$ select private.begin_attempt(p_test) $$;

create function private.exam_action(p_attempt uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); a public.attempts; q public.questions; item record; k private.answer_keys; candidate jsonb; score integer; qid text;
begin
 if u is null then raise exception 'Authentication required'; end if;
 select * into a from public.attempts where id=p_attempt and user_id=u for update;
 if not found then raise exception 'Attempt not found'; end if;
 if p_action='read' then return to_jsonb(a); end if;
 if a.status<>'active' then
  if p_action='submit' then return to_jsonb(a); end if;
  raise exception 'Attempt closed';
 end if;
 if clock_timestamp()>=a.deadline then
  select count(*) into score from private.answer_keys ak where ak.test_id=a.test_id and ak.correct::text=a.answers->>ak.question_id;
  update public.attempts set status='expired',submitted_at=clock_timestamp(),raw_score=case when skill in ('reading','listening') then score else null end where id=a.id returning * into a;
  return to_jsonb(a);
 end if;
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
create function public.exam_action(p_attempt uuid,p_action text,p_payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select private.exam_action(p_attempt,p_action,p_payload) $$;

create function private.review_attempt(p_attempt uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.attempts;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into a from public.attempts where id=p_attempt and user_id=auth.uid() and status<>'active';
 if not found then raise exception 'Completed attempt required'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('question_id',question_id,'correct',correct,'rationale',rationale,'script',script)) from private.answer_keys where test_id=a.test_id),'[]');
end $$;
create function public.review_attempt(p_attempt uuid) returns jsonb language sql security invoker set search_path='' as $$select private.review_attempt(p_attempt)$$;

revoke all on function private.begin_attempt(text), private.exam_action(uuid,text,jsonb), private.review_attempt(uuid) from public,anon;
revoke all on function public.begin_attempt(text), public.exam_action(uuid,text,jsonb), public.review_attempt(uuid) from public,anon;
grant execute on function private.begin_attempt(text),private.exam_action(uuid,text,jsonb),private.review_attempt(uuid) to authenticated;
grant execute on function public.begin_attempt(text),public.exam_action(uuid,text,jsonb),public.review_attempt(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('exam-audio','exam-audio',false,10485760,array['audio/mpeg','audio/wav']),
 ('speaking-recordings','speaking-recordings',false,15728640,array['audio/webm','audio/mp4','audio/ogg'])
 on conflict(id) do nothing;
create policy audio_claim_read on storage.objects for select to authenticated using(bucket_id='exam-audio' and exists(
 select 1 from public.attempts a where a.user_id=(select auth.uid()) and a.status='active' and a.deadline>now() and (replace(storage.objects.name,'.wav',''))=any(a.audio_claims)
));
create policy own_recording_read on storage.objects for select to authenticated using(bucket_id='speaking-recordings' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy own_recording_insert on storage.objects for insert to authenticated with check(bucket_id='speaking-recordings' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(
 select 1 from public.attempts a join public.questions q on q.test_id=a.test_id
 where a.id::text=(storage.foldername(storage.objects.name))[2] and a.user_id=(select auth.uid()) and a.skill='speaking'
 and a.status='active' and now()<a.deadline+interval '30 seconds'
 and now()>=a.started_at+make_interval(secs=>case q.position when 1 then 0 when 2 then 240 else 450 end)
 and now()<=a.started_at+make_interval(secs=>case q.position when 1 then 150 when 2 then 480 else 750 end)
 and storage.filename(storage.objects.name)=q.id||'.webm'
));
-- No UPDATE: uploads cannot replace frozen recordings. No public audio bucket.
create function private.register_recording(p_attempt uuid,p_question text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.attempts; object_path text; m text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into a from public.attempts where id=p_attempt and user_id=auth.uid() and skill='speaking' for update;
 if not found then raise exception 'Attempt not found'; end if;
 if clock_timestamp()>a.deadline+interval '45 seconds' then raise exception 'Upload deadline expired'; end if;
 if not exists(select 1 from public.questions where test_id=a.test_id and id=p_question) then raise exception 'Invalid task'; end if;
 object_path:=a.user_id::text||'/'||a.id::text||'/'||p_question||'.webm';
 select metadata->>'mimetype' into m from storage.objects where bucket_id='speaking-recordings' and name=object_path;
 if not found then raise exception 'Recording not uploaded'; end if;
 insert into public.recordings(attempt_id,question_id,user_id,path,mime_type) values(a.id,p_question,a.user_id,object_path,m) on conflict(attempt_id,question_id) do nothing;
 return jsonb_build_object('saved',true);
end $$;
create function public.register_recording(p_attempt uuid,p_question text) returns jsonb language sql security invoker set search_path='' as $$select private.register_recording(p_attempt,p_question)$$;
revoke all on function private.register_recording(uuid,text),public.register_recording(uuid,text) from public,anon;
grant execute on function private.register_recording(uuid,text),public.register_recording(uuid,text) to authenticated;
commit;
