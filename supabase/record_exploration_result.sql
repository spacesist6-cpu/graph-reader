-- 탐구 결과 저장 RPC
-- Supabase SQL Editor에서 이 파일 전체를 한 번에 실행하세요.

-- 기존 6개 인자 함수가 남아 있으면 새 7개 인자 함수와 충돌할 수 있으므로 삭제합니다.
drop function if exists public.record_exploration_result(
  uuid,
  text,
  text,
  text,
  jsonb,
  text
);

-- 기존 테이블에 필요한 열이 없었던 환경에서도 실행할 수 있도록 보완합니다.
alter table public.exploration_results
  add column if not exists session_id uuid,
  add column if not exists path text,
  add column if not exists prompt_id text,
  add column if not exists coefficient_snapshot jsonb,
  add column if not exists ai_feedback jsonb,
  add column if not exists feedback_created_at timestamptz,
  add column if not exists feedback_status text;

-- 일부 스키마에서는 학생 답변 열 이름이 response_text입니다.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'exploration_results'
      and column_name in ('response_text', 'student_response')
  ) then
    alter table public.exploration_results add column student_response text;
  end if;
end
$$;

create or replace function public.record_exploration_result(
  p_session_id uuid,
  p_path text,
  p_prompt_id text,
  p_student_response text,
  p_coefficient_snapshot jsonb,
  p_ai_feedback jsonb,
  p_feedback_status text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  response_column text;
  saved_id uuid;
begin
  if p_coefficient_snapshot is null
     or jsonb_typeof(p_coefficient_snapshot) <> 'object'
     or not (p_coefficient_snapshot ? 'a')
     or not (p_coefficient_snapshot ? 'b')
     or not (p_coefficient_snapshot ? 'c') then
    raise exception using
      errcode = '22023',
      message = 'coefficientSnapshot은 a, b, c 값을 포함해야 합니다.';
  end if;

  if not exists (
    select 1
    from public.learning_sessions as ls
    where ls.id = p_session_id
  ) then
    raise exception using
      errcode = '22023',
      message = '학습 세션을 찾을 수 없습니다.';
  end if;

  select case
    when exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'exploration_results'
        and column_name = 'response_text'
    ) then 'response_text'
    else 'student_response'
  end
  into response_column;

  execute format(
    'insert into public.exploration_results as er
      (session_id, path, prompt_id, %I, coefficient_snapshot, ai_feedback, feedback_created_at, feedback_status)
     values ($1, $2, $3, $4, $5, $6, pg_catalog.now(), $7)
     returning er.id',
    response_column
  )
  into saved_id
  using
    p_session_id,
    p_path,
    p_prompt_id,
    p_student_response,
    p_coefficient_snapshot,
    p_ai_feedback,
    p_feedback_status;

  return saved_id;
end;
$$;

revoke all on function public.record_exploration_result(
  uuid, text, text, text, jsonb, jsonb, text
) from public;
grant execute on function public.record_exploration_result(
  uuid, text, text, text, jsonb, jsonb, text
) to anon, authenticated;

-- 실행 후 새 시그니처가 등록되었는지 확인합니다.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'record_exploration_result';

notify pgrst, 'reload schema';
