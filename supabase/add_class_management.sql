-- 학급별 학습 세션 관리
-- 실행 순서: 이 파일을 Supabase SQL Editor에서 한 번 실행한 뒤 앱을 사용하세요.
-- 기존 세션의 class_name은 '미지정'으로 보존됩니다.

alter table public.learning_sessions add column if not exists class_name text;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'learning_sessions_class_name_check' and conrelid = 'public.learning_sessions'::pg_catalog.regclass) then
    alter table public.learning_sessions add constraint learning_sessions_class_name_check check (class_name is null or class_name in ('4반', '5반', '6반', '11반', '12반', '13반', '미지정'));
  end if;
end
$$;

create or replace function public.start_learning_session(p_student_code text, p_class_name text)
returns table (student_profile_id uuid, session_id uuid, student_code text, class_name text, started_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  normalized_code text;
  normalized_class text;
  profile_id uuid;
  new_session_id uuid;
  session_started_at timestamptz := pg_catalog.now();
begin
  normalized_code := pg_catalog.upper(pg_catalog.btrim(coalesce(p_student_code, '')));
  normalized_class := pg_catalog.btrim(coalesce(p_class_name, ''));
  if normalized_code !~ '^[A-Z0-9]{4,12}$' then raise exception using errcode = '22023', message = '학습 코드를 확인해주세요.'; end if;
  if normalized_class not in ('4반', '5반', '6반', '11반', '12반', '13반') then raise exception using errcode = '22023', message = '학급을 선택해주세요.'; end if;
  select sp.id into profile_id from public.student_profiles as sp where sp.student_code = normalized_code limit 1;
  if profile_id is null then
    insert into public.student_profiles as sp (owner_id, student_code) values (auth.uid(), normalized_code) returning sp.id into profile_id;
  end if;
  insert into public.learning_sessions as ls (owner_id, student_id, student_code, class_name, started_at, status)
  values (auth.uid(), profile_id, normalized_code, normalized_class, session_started_at, 'in_progress') returning ls.id into new_session_id;
  return query select profile_id, new_session_id, normalized_code, normalized_class, session_started_at;
end;
$$;

revoke all on function public.start_learning_session(text, text) from public;
grant execute on function public.start_learning_session(text, text) to anon, authenticated;

-- 기존 1개 매개변수 호출도 깨지지 않도록 미지정 학급으로 유지합니다.
create or replace function public.start_learning_session(p_student_code text)
returns table (student_profile_id uuid, session_id uuid, student_code text, started_at timestamptz)
language sql security definer set search_path = ''
as $$
  select result.student_profile_id, result.session_id, result.student_code, result.started_at
  from public.start_learning_session(p_student_code, '미지정') as result;
$$;

revoke all on function public.start_learning_session(text) from public;
grant execute on function public.start_learning_session(text) to anon, authenticated;
notify pgrst, 'reload schema';
