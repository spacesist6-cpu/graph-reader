-- final_challenge_attempts 실제 열 확인
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
  and table_name in ('final_challenge_attempts', 'learning_sessions')
order by table_name, ordinal_position;

-- 기존 테이블과 데이터를 유지하면서 최종 미션 저장에 필요한 열만 보완합니다.
do $$
begin
  if to_regclass('public.final_challenge_attempts') is null then
    create table public.final_challenge_attempts (
      id uuid primary key default gen_random_uuid(),
      session_id uuid not null,
      question_id text not null,
      question_formula text not null,
      question_parameters jsonb not null,
      selected_choice_id text not null,
      selected_formula text not null,
      is_correct boolean not null,
      attempt_number integer not null,
      feedback text not null,
      submitted_at timestamptz not null default pg_catalog.now(),
      created_at timestamptz not null default pg_catalog.now()
    );
  else
    alter table public.final_challenge_attempts
      add column if not exists id uuid default gen_random_uuid(),
      add column if not exists session_id uuid,
      add column if not exists question_id text,
      add column if not exists question_formula text,
      add column if not exists question_parameters jsonb,
      add column if not exists selected_choice_id text,
      add column if not exists selected_formula text,
      add column if not exists is_correct boolean,
      add column if not exists attempt_number integer,
      add column if not exists feedback text,
      add column if not exists submitted_at timestamptz default pg_catalog.now(),
      add column if not exists created_at timestamptz default pg_catalog.now();
  end if;
end
$$;

alter table public.learning_sessions
  add column if not exists status text not null default 'in_progress',
  add column if not exists completed_at timestamptz;

-- RLS는 계속 활성화합니다. 저장은 아래 security definer 함수만 수행합니다.
alter table public.final_challenge_attempts enable row level security;
alter table public.learning_sessions enable row level security;

-- 재도전 시도는 별도 행으로 보존해야 하므로 session_id + question_id 단일 unique 제한을 제거합니다.
do $constraint$
declare
  v_constraint record;
begin
  for v_constraint in
    select c.conname
    from pg_catalog.pg_constraint as c
    where c.conrelid = 'public.final_challenge_attempts'::pg_catalog.regclass
      and c.contype = 'u'
      and (
        select pg_catalog.array_agg(a.attname order by k.ordinality)
        from pg_catalog.unnest(c.conkey) with ordinality as k(attnum, ordinality)
        join pg_catalog.pg_attribute as a
          on a.attrelid = c.conrelid and a.attnum = k.attnum
      ) = pg_catalog.array['session_id', 'question_id']::text[]
  loop
    execute pg_catalog.format('alter table public.final_challenge_attempts drop constraint %I', v_constraint.conname);
  end loop;
end
$constraint$;

create or replace function public.record_final_challenge_attempt(
  p_session_id uuid,
  p_question_id text,
  p_question_formula text,
  p_question_parameters jsonb,
  p_selected_choice_id text,
  p_selected_formula text,
  p_is_correct boolean,
  p_feedback text
)
returns table (
  attempt_id uuid,
  is_correct boolean,
  attempt_number integer,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
  v_attempt_number integer;
  v_completed_at timestamptz;
begin
  if not exists (
    select 1
    from public.learning_sessions as ls_check
    where ls_check.id = p_session_id
  ) then
    raise exception using errcode = '22023', message = '학습 세션을 찾을 수 없습니다.';
  end if;

  select coalesce(max(fca.attempt_number), 0) + 1
    into v_attempt_number
  from public.final_challenge_attempts as fca
  where fca.session_id = p_session_id
    and fca.question_id = p_question_id;

  insert into public.final_challenge_attempts as fca (
    session_id,
    question_id,
    question_formula,
    question_parameters,
    selected_choice_id,
    selected_formula,
    is_correct,
    attempt_number,
    feedback,
    submitted_at,
    created_at
  ) values (
    p_session_id,
    p_question_id,
    p_question_formula,
    p_question_parameters,
    p_selected_choice_id,
    p_selected_formula,
    p_is_correct,
    v_attempt_number,
    p_feedback,
    pg_catalog.now(),
    pg_catalog.now()
  )
  returning fca.id into v_attempt_id;

  if p_is_correct then
    update public.learning_sessions as ls_update
    set status = 'completed',
        completed_at = coalesce(ls_update.completed_at, pg_catalog.now())
    where ls_update.id = p_session_id
    returning ls_update.completed_at into v_completed_at;
  end if;

  return query
  select v_attempt_id, p_is_correct, v_attempt_number, v_completed_at;
end;
$$;

revoke all on function public.record_final_challenge_attempt(
  uuid, text, text, jsonb, text, text, boolean, text
) from public;
grant execute on function public.record_final_challenge_attempt(
  uuid, text, text, jsonb, text, text, boolean, text
) to anon, authenticated;

notify pgrst, 'reload schema';
