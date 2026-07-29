-- 익명 학생 세션 시작을 위한 최소한의 RPC 준비
alter table public.student_profiles
  alter column owner_id drop not null;

alter table public.learning_sessions
  alter column owner_id drop not null;

alter table public.learning_sessions
  add column if not exists status text not null default 'in_progress';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'learning_sessions_status_check'
  ) then
    alter table public.learning_sessions
      add constraint learning_sessions_status_check
      check (status in ('in_progress', 'completed', 'abandoned'));
  end if;
end
$$;

create or replace function public.start_learning_session(p_student_code text)
returns table (
  student_profile_id uuid,
  session_id uuid,
  student_code text,
  started_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  normalized_code text;
  profile_id uuid;
  new_session_id uuid;
  session_started_at timestamptz := now();
begin
  normalized_code := upper(trim(p_student_code));

  if normalized_code is null or normalized_code !~ '^[A-Z0-9]{4,12}$' then
    raise exception using
      errcode = '22023',
      message = '학습 코드는 영문 대문자와 숫자 4~12자로 입력해주세요.';
  end if;

  insert into public.student_profiles (owner_id, student_code)
  values (auth.uid(), normalized_code)
  on conflict (student_code) do update
    set created_at = public.student_profiles.created_at
  returning id into profile_id;

  insert into public.learning_sessions (
    owner_id,
    student_id,
    student_code,
    started_at,
    status
  )
  values (
    auth.uid(),
    profile_id,
    normalized_code,
    session_started_at,
    'in_progress'
  )
  returning id into new_session_id;

  return query
    select profile_id, new_session_id, normalized_code, session_started_at;
end;
$$;

revoke all on function public.start_learning_session(text) from public;
grant execute on function public.start_learning_session(text) to anon, authenticated;
