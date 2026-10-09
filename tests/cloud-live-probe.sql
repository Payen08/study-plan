-- Isolated live RPC validation. Every write is rolled back.
begin;
set local role anon;
do $probe$
declare
    result jsonb;
    snapshot jsonb;
    probe_id text := 'codex-sync-probe-20261009-7a912e';
begin
    insert into public.study_progress (id, data) values (
        probe_id,
        jsonb_build_object('appData', jsonb_build_object('sentinel', repeat('x', 6000000)))
    );
    result := public.study_cloud_patch(probe_id,
        '{"2026":{"done":[],"notes":{"2026-10-9":"probe note"},"customTasks":{},"notebookEntries":{}}}'::jsonb,
        '', 'probe-r1');
    if result->>'saved' is distinct from 'true' then raise exception 'Save was not confirmed'; end if;
    result := public.study_cloud_patch(probe_id, '{"2026":{"notes":{}}}'::jsonb, '', 'stale');
    if result->>'saved' is distinct from 'false' then raise exception 'Stale version was not rejected'; end if;
    select data into snapshot from public.study_progress where id = probe_id;
    if length(snapshot#>>'{appData,sentinel}') <> 6000000 then raise exception 'V2 content was changed'; end if;
    result := public.study_cloud_read(probe_id, '2026', 0, 20);
    if result#>>'{value,notes,2026-10-9}' is distinct from 'probe note' then raise exception 'Saved note was not read back'; end if;
end;
$probe$;
rollback;
select 'Save, read-back, revision conflict, V2 preservation: passed' as validation,
    count(*) = 0 as test_writes_rolled_back
from public.study_progress where id = 'codex-sync-probe-20261009-7a912e';
