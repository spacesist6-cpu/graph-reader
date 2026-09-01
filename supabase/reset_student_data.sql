-- 학생 학습 기록 초기화
--
-- 이 스크립트는 학생 데이터만 삭제합니다.
-- 교사 Auth 계정, 테이블 구조, 함수, RLS 정책은 변경하지 않습니다.
-- 실행 전 Supabase SQL Editor에서 아래 SELECT 결과를 먼저 확인하세요.

select 'diagnosis_responses' as table_name, count(*) as row_count from public.diagnosis_responses
union all
select 'checkpoint_attempts', count(*) from public.checkpoint_attempts
union all
select 'exploration_results', count(*) from public.exploration_results
union all
select 'final_challenge_attempts', count(*) from public.final_challenge_attempts
union all
select 'learning_sessions', count(*) from public.learning_sessions
union all
select 'student_profiles', count(*) from public.student_profiles;

-- 위 결과를 확인하고 백업이 필요 없다는 것을 확인한 뒤,
-- 아래 주석을 해제하여 별도로 실행하세요.
/*
begin;

delete from public.diagnosis_responses;
delete from public.checkpoint_attempts;
delete from public.exploration_results;
delete from public.final_challenge_attempts;
delete from public.learning_sessions;
delete from public.student_profiles;

commit;

select 'student data reset complete' as result;
*/
