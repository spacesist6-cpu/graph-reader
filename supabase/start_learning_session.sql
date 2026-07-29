-- 1단계: 함수가 사용하는 테이블 열 확인
select
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('student_profiles', 'learning_sessions')
order by table_name, ordinal_position;

-- 함수 생성 전 필요한 열이 없다면 먼저 추가합니다.
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
    from pg_catalog.pg_constraint
    where conname = 'learning_sessions_status_check'
      and conrelid = 'public.learning_sessions'::pg_catalog.regclass
  ) then
    alter table public.learning_sessions
      add constraint learning_sessions_status_check
      check (status in ('in_progress', 'completed', 'abandoned'));
  end if;
end
$$;

alter table public.student_profiles enable row level security;
alter table public.learning_sessions enable row level security;

-- 2단계부터는 별도 파일을 실행하세요.
-- supabase/create_start_learning_session_function.sql
