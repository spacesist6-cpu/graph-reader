-- 실제 열 구조 확인
select table_name, ordinal_position, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('student_profiles', 'learning_sessions', 'diagnosis_responses', 'checkpoint_attempts', 'exploration_results', 'final_challenge_attempts')
order by table_name, ordinal_position;

-- Supabase Auth app_metadata.role = 'teacher'인 계정만 교사로 인정합니다.
create or replace function public.is_teacher()
returns boolean language sql stable security invoker set search_path = ''
as $$ select coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'teacher'; $$;
revoke all on function public.is_teacher() from public;
grant execute on function public.is_teacher() to authenticated;

do $policies$
declare table_name text; policy_name text;
begin
  foreach table_name in array array['student_profiles', 'learning_sessions', 'diagnosis_responses', 'checkpoint_attempts', 'exploration_results', 'final_challenge_attempts'] loop
    execute format('alter table public.%I enable row level security', table_name);
    policy_name := 'teacher_read_' || table_name;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = table_name and policyname = policy_name) then
      execute format('create policy %I on public.%I for select to authenticated using (public.is_teacher())', policy_name, table_name);
    end if;
  end loop;
end
$policies$;

notify pgrst, 'reload schema';
