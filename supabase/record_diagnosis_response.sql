-- 실행 전 실제 열 이름을 먼저 확인하세요.
alter table public.diagnosis_responses
  add column if not exists question_version text,
  add column if not exists question_parameters jsonb;

drop function if exists public.record_diagnosis_response(
  uuid, text, text, boolean, timestamptz, timestamptz, integer
);

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'diagnosis_responses'
order by ordinal_position;

create unique index if not exists diagnosis_responses_session_question_key
on public.diagnosis_responses (session_id, question_id);

create or replace function public.record_diagnosis_response(
  p_session_id uuid,
  p_question_id text,
  p_question_version text,
  p_question_parameters jsonb,
  p_answer text,
  p_is_correct boolean,
  p_shown_at timestamptz,
  p_submitted_at timestamptz,
  p_response_time_ms integer
)
returns table (id uuid, session_id uuid, question_id text, submitted_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_id uuid;
  question_order_value integer;
  saved_id uuid;
  saved_submitted_at timestamptz;
begin
  if not exists (
    select 1
    from public.learning_sessions as ls
    where ls.id = p_session_id
  ) then
    raise exception using errcode = '22023', message = '학습 세션을 찾을 수 없습니다.';
  end if;

  question_order_value := case p_question_id
    when 'direction' then 1
    when 'width' then 2
    when 'axis' then 3
    when 'intercept' then 4
    when 'relationship' then 5
    else null
  end;

  if question_order_value is null then
    raise exception using errcode = '22023', message = '알 수 없는 진단 문항입니다.';
  end if;

  select dr.id
    into existing_id
  from public.diagnosis_responses as dr
  where dr.session_id = p_session_id
    and dr.question_id = p_question_id
  limit 1;

  if existing_id is not null then
    update public.diagnosis_responses as dr
    set question_order = question_order_value,
        question_version = p_question_version,
        question_parameters = p_question_parameters,
        answer = p_answer,
        is_correct = p_is_correct,
        shown_at = p_shown_at,
        submitted_at = p_submitted_at,
        response_time_ms = p_response_time_ms
    where dr.id = existing_id
    returning dr.id, dr.submitted_at into saved_id, saved_submitted_at;
  else
    insert into public.diagnosis_responses as dr (
      session_id,
      question_id,
      question_order,
      question_version,
      question_parameters,
      answer,
      is_correct,
      shown_at,
      submitted_at,
      response_time_ms
    ) values (
      p_session_id,
      p_question_id,
      question_order_value,
      p_question_version,
      p_question_parameters,
      p_answer,
      p_is_correct,
      p_shown_at,
      p_submitted_at,
      p_response_time_ms
    )
    returning dr.id, dr.submitted_at into saved_id, saved_submitted_at;
  end if;

  return query select saved_id, p_session_id, p_question_id, saved_submitted_at;
end;
$$;

revoke all on function public.record_diagnosis_response(uuid, text, text, jsonb, text, boolean, timestamptz, timestamptz, integer) from public;
grant execute on function public.record_diagnosis_response(uuid, text, text, jsonb, text, boolean, timestamptz, timestamptz, integer) to anon, authenticated;

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'record_diagnosis_response';

notify pgrst, 'reload schema';
