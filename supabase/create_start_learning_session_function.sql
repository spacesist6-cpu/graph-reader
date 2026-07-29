-- 기존 함수가 있어도 다시 실행할 수 있습니다.
-- 앱 호출 방식은 다음과 동일하게 유지됩니다.
-- supabase.rpc('start_learning_session', { p_student_code: studentCode })

create or replace function public.start_learning_session(p_student_code text)
returns table (
  student_profile_id uuid,
  session_id uuid,
  student_code text,
  started_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_code text;
  profile_id uuid;
  new_session_id uuid;
  session_started_at timestamptz := pg_catalog.now();
begin
  normalized_code := pg_catalog.upper(pg_catalog.btrim(coalesce(p_student_code, '')));

  if normalized_code !~ '^[A-Z0-9]{4,12}$' then
    raise exception using
      errcode = '22023',
      message = '학습 코드는 영문 대문자와 숫자 4~12자로 입력해주세요.';
  end if;

  -- student_code 열은 반드시 sp 별칭으로 조회합니다.
  select sp.id
    into profile_id
  from public.student_profiles as sp
  where sp.student_code = normalized_code
  limit 1;

  -- 기존 프로필이 없을 때만 새 프로필을 생성합니다.
  if profile_id is null then
    insert into public.student_profiles as sp (owner_id, student_code)
    values (auth.uid(), normalized_code)
    returning sp.id into profile_id;
  end if;

  -- learning_sessions의 대상 테이블에도 ls 별칭을 사용합니다.
  insert into public.learning_sessions as ls (
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
  returning ls.id into new_session_id;

  return query
    select
      profile_id as student_profile_id,
      new_session_id as session_id,
      normalized_code as student_code,
      session_started_at as started_at;
end;
$$;

revoke all on function public.start_learning_session(text) from public;
grant execute on function public.start_learning_session(text) to anon, authenticated;

-- 함수 생성 확인
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'start_learning_session';

notify pgrst, 'reload schema';
