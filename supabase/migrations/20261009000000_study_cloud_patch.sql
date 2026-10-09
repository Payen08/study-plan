-- Apply once in the Supabase SQL editor before using the new save path.
-- Only patches V1 fields; does not transfer, replace, or return the large appData blob.
-- SECURITY INVOKER keeps existing table grants and RLS in effect.
create or replace function public.study_cloud_patch(
    p_id text,
    p_state jsonb,
    p_expected_revision text,
    p_revision text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    affected integer;
    patch jsonb;
begin
    if p_id is null or char_length(p_id) not between 1 and 120
        or p_revision is null or p_revision = ''
        or jsonb_typeof(p_state) is distinct from 'object'
        or not (p_state ? '2025' or p_state ? '2026')
    then
        raise exception 'Invalid study state' using errcode = '22023';
    end if;
    -- Explicitly whitelist fields so appData can never be replaced by the client.
    select jsonb_object_agg(key, value) into patch
    from jsonb_each(p_state)
    where key in ('2025', '2026', 'settings');
    insert into public.study_progress as target (id, data)
    values (p_id, patch || jsonb_build_object('_cloudMeta', jsonb_build_object(
        'syncId', p_id, 'v1Revision', p_revision, 'savedAt', clock_timestamp()
    )))
    on conflict (id) do update set data = target.data || patch || jsonb_build_object(
        '_cloudMeta', coalesce(target.data->'_cloudMeta', '{}'::jsonb) || jsonb_build_object(
            'syncId', p_id, 'v1Revision', p_revision, 'savedAt', clock_timestamp()
        )
    ) where coalesce(target.data#>>'{_cloudMeta,v1Revision}', '') = coalesce(p_expected_revision, '');
    get diagnostics affected = row_count;
    return jsonb_build_object('id', p_id, 'saved', affected = 1, 'revision', p_revision);
end;
$$;
revoke all on function public.study_cloud_patch(text, jsonb, text, text) from public;
grant execute on function public.study_cloud_patch(text, jsonb, text, text) to anon, authenticated;
notify pgrst, 'reload schema';

-- Paginated section reads avoid serializing the entire shared JSON document.
create or replace function public.study_cloud_read(
    p_id text,
    p_section text,
    p_offset integer default 0,
    p_limit integer default 20
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    content jsonb;
    result jsonb;
    total integer;
    found_id text;
    has_v1 boolean;
    row_version text;
begin
    if p_offset < 0 or p_limit not between 1 and 50 then
        raise exception 'Invalid pagination' using errcode = '22023';
    end if;
    if p_section = 'info' then
        select id into found_id from public.study_progress where id = p_id;
        if found_id is null then return jsonb_build_object('exists', false); end if;
        select data->'_cloudMeta' into content from public.study_progress where id = p_id;
        result := jsonb_build_object('exists', true, 'meta', content);
        select jsonb_typeof(data->'2025') = 'object' or jsonb_typeof(data->'2026') = 'object' into has_v1 from public.study_progress where id = p_id;
        if exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'study_progress' and column_name = 'updated_at'
        ) then
            execute 'select updated_at::text from public.study_progress where id = $1' into row_version using p_id;
        end if;
        return result || jsonb_build_object('hasV1', coalesce(has_v1, false), 'version', row_version);
    end if;
    if p_section in ('2025', '2026', 'settings') then
        select data->p_section into content from public.study_progress where id = p_id;
        return jsonb_build_object('value', content);
    end if;
    if p_section not in ('tasks', 'notes', 'notebook_folders', 'subjects') then
        raise exception 'Invalid study section' using errcode = '22023';
    end if;
    select data#>array['appData', p_section] into content
        from public.study_progress where id = p_id;
    if jsonb_typeof(content) is distinct from 'array' then
        return jsonb_build_object('value', '[]'::jsonb, 'nextOffset', null);
    end if;
    total := jsonb_array_length(content);
    select coalesce(jsonb_agg(value order by position), '[]'::jsonb) into result
    from jsonb_array_elements(content) with ordinality as items(value, position)
    where position > p_offset and position <= p_offset + p_limit;
    return jsonb_build_object('value', result, 'nextOffset',
        case when p_offset + p_limit < total then p_offset + p_limit else null end);
end;
$$;
revoke all on function public.study_cloud_read(text, text, integer, integer) from public;
grant execute on function public.study_cloud_read(text, text, integer, integer) to anon, authenticated;
notify pgrst, 'reload schema';
