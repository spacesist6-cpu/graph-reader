-- checkpoint_attempts 실제 열 확인
select
  table_schema,
  table_name,
  ordinal_position,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'checkpoint_attempts'
order by ordinal_position;

-- 기존 데이터와 다른 테이블을 건드리지 않고 확인문제 전용 테이블을 준비합니다.
do $$
begin
  if to_regclass('public.checkpoint_attempts') is null then
    create table public.checkpoint_attempts (
      id uuid primary key default gen_random_uuid(),
      session_id uuid not null,
      path text not null,
      question_id text not null,
      question_version text not null,
      question_parameters jsonb not null,
      student_answer text not null,
      is_correct boolean not null,
      response_time_ms integer not null,
      attempt_number integer not null,
      submitted_at timestamptz not null default pg_catalog.now()
    );
  else
    alter table public.checkpoint_attempts
      add column if not exists id uuid default gen_random_uuid(),
      add column if not exists session_id uuid,
      add column if not exists path text,
      add column if not exists question_id text,
      add column if not exists question_version text,
      add column if not exists question_parameters jsonb,
      add column if not exists student_answer text,
      add column if not exists is_correct boolean,
      add column if not exists response_time_ms integer,
      add column if not exists attempt_number integer,
      add column if not exists submitted_at timestamptz default pg_catalog.now();
  end if;
end
$$;

-- RLS는 켠 상태로 유지합니다. 브라우저는 테이블에 직접 INSERT하지 않습니다.
alter table public.checkpoint_attempts enable row level security;

-- 재도전 시도는 별도 행으로 보존해야 하므로 session_id + question_id 단일 unique 제한을 제거합니다.
do $constraint$
declare
  v_constraint record;
begin
  for v_constraint in
    select c.conname
    from pg_catalog.pg_constraint as c
    where c.conrelid = 'public.checkpoint_attempts'::pg_catalog.regclass
      and c.contype = 'u'
      and (
        select pg_catalog.array_agg(a.attname order by k.ordinality)
        from pg_catalog.unnest(c.conkey) with ordinality as k(attnum, ordinality)
        join pg_catalog.pg_attribute as a
          on a.attrelid = c.conrelid and a.attnum = k.attnum
      ) = pg_catalog.array['session_id', 'question_id']::text[]
  loop
    execute pg_catalog.format('alter table public.checkpoint_attempts drop constraint %I', v_constraint.conname);
  end loop;
end
$constraint$;

create or replace function public.record_checkpoint_attempt(
  p_session_id uuid,
  p_path text,
  p_question_id text,
  p_question_version text,
  p_question_parameters jsonb,
  p_student_answer text,
  p_is_correct boolean,
  p_response_time_ms integer
)
returns table (
  attempt_id uuid,
  attempt_number integer,
  is_correct boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
  v_attempt_number integer;
begin
  if not exists (
    select 1
    from public.learning_sessions as ls_check
    where ls_check.id = p_session_id
  ) then
    raise exception using errcode = '22023', message = '학습 세션을 찾을 수 없습니다.';
  end if;

  select coalesce(max(ca.attempt_number), 0) + 1
    into v_attempt_number
  from public.checkpoint_attempts as ca
  where ca.session_id = p_session_id
    and ca.question_id = p_question_id;

  insert into public.checkpoint_attempts as ca (
    session_id,
    path,
    question_id,
    question_version,
    question_parameters,
    student_answer,
    is_correct,
    response_time_ms,
    attempt_number,
    submitted_at
  ) values (
    p_session_id,
    p_path,
    p_question_id,
    p_question_version,
    p_question_parameters,
    p_student_answer,
    p_is_correct,
    p_response_time_ms,
    v_attempt_number,
    pg_catalog.now()
  )
  returning ca.id into v_attempt_id;

  return query
  select v_attempt_id, v_attempt_number, p_is_correct;
end;
$$;

revoke all on function public.record_checkpoint_attempt(
  uuid, text, text, text, jsonb, text, boolean, integer
) from public;
grant execute on function public.record_checkpoint_attempt(
  uuid, text, text, text, jsonb, text, boolean, integer
) to anon, authenticated;

notify pgrst, 'reload schema';
