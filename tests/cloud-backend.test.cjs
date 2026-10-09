const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cloud = require('../study-cloud-data.js');
// Optional local test dependencies; no production dependency or credentials required.
function optional(name) {
    try { return require(require.resolve(name, { paths: [process.env.STUDY_SYNC_TEST_MODULES || __dirname] })); }
    catch (_) { return null; }
}
const pg = optional('@electric-sql/pglite');
const fake = optional('fake-indexeddb');

test('Database patch preserves V2, checks revisions, respects RLS, and round-trips real edits', { skip: !pg && 'Install @electric-sql/pglite for the isolated database test' }, async () => {
    const db = new pg.PGlite();
    try {
        await db.exec(`create role anon; create role authenticated;
            create table public.study_progress (id text primary key, data jsonb not null);
            grant usage on schema public to anon, authenticated;
            grant select, insert, update on public.study_progress to anon, authenticated;`);
        await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261009000000_study_cloud_patch.sql'), 'utf8'));
        const hugeV2 = { image: 'x'.repeat(6 * 1024 * 1024), tasks: [{ id: 'legacy', title: 'V2' }], notes: Array.from({ length: 45 }, (_, i) => ({ id: String(i), html: 'n'.repeat(100000) })) };
        await db.query('insert into study_progress values ($1, $2)', ['test', { appData: hugeV2, _cloudMeta: { v2Revision: 'keep' } }]);
        const read = async (section, offset = 0) => (await db.query('select study_cloud_read($1,$2,$3,$4) as result', ['test', section, offset, 20])).rows[0].result;
        assert.equal((await read('info')).hasV1, false);
        assert.equal((await read('info')).version, null);
        await db.exec('alter table study_progress add column updated_at timestamptz default now();');
        assert.ok((await read('info')).version);
        const firstPage = await read('notes');
        assert.equal(firstPage.value.length, 20);
        assert.equal(firstPage.nextOffset, 20);
        assert.equal((await read('notes', 40)).value.length, 5);
        assert.equal((await read('notes', 40)).nextOffset, null);
        await assert.rejects(read('user_settings'), /Invalid study section/);
        const save = async (state, expected, revision) => (await db.query('select study_cloud_patch($1,$2,$3,$4) as result', ['test', state, expected, revision])).rows[0].result;
        const stateA = { '2026': { done: [], notes: { a: 'device A' }, customTasks: {}, notebookEntries: {} }, settings: { nullable: null }, appData: { forbidden: true } };
        assert.equal((await save(stateA, '', 'r1')).saved, true);
        let row = (await db.query('select data from study_progress where id=$1', ['test'])).rows[0].data;
        assert.deepEqual(row.appData, hugeV2);
        assert.equal(row._cloudMeta.v2Revision, 'keep');
        assert.equal(row.settings.nullable, null);
        assert.equal((await read('info')).hasV1, true);
        assert.equal((await read('2026')).value.notes.a, 'device A');
        assert.equal((await save({ '2026': { notes: { b: 'stale device' } } }, '', 'stale')).saved, false);
        assert.equal((await db.query('select data#>>\'{2026,notes,a}\' as note from study_progress where id=$1', ['test'])).rows[0].note, 'device A');
        const base = structuredClone(stateA); delete base.appData;
        const localB = structuredClone(base); localB['2026'].notes.b = 'device B';
        const remoteA = structuredClone(base); remoteA['2026'].notes.a = 'new A';
        assert.equal((await save(remoteA, 'r1', 'r2')).saved, true);
        const merged = cloud.merge(base, localB, remoteA);
        assert.equal((await save(merged, 'r2', 'r3')).saved, true);
        row = (await db.query('select data from study_progress where id=$1', ['test'])).rows[0].data;
        assert.deepEqual(row['2026'].notes, { a: 'new A', b: 'device B' });
        assert.equal(row.appData.image.length, 6 * 1024 * 1024);
        const removed = structuredClone(merged); delete removed['2026'].notes.a;
        assert.equal((await save(removed, 'r3', 'r4')).saved, true);
        assert.equal((await db.query('select data#>>\'{2026,notes,a}\' as note from study_progress where id=$1', ['test'])).rows[0].note, null);
        await assert.rejects(save({ appData: {} }, 'r4', 'invalid'), /Invalid study state/);
        const functionInfo = (await db.query("select prosecdef from pg_proc where proname = 'study_cloud_patch'")).rows[0];
        assert.equal(functionInfo.prosecdef, false);
        await db.exec('alter table study_progress enable row level security; set role anon;');
        await assert.rejects(save(removed, 'r4', 'forbidden'), /row-level security/);
    } finally { await db.close(); }
});

test('IndexedDB stores large pending notes across reopen and isolates sync IDs', { skip: !fake && 'Install fake-indexeddb for the isolated cache test' }, async () => {
    const indexedDB = new fake.IDBFactory();
    const first = cloud.createCache(indexedDB);
    const large = 'x'.repeat(7 * 1024 * 1024);
    await first.update('phone', { stateJSON: large, pendingJSON: large, pendingBaseJSON: '{"base":true}' });
    const reopened = cloud.createCache(indexedDB);
    assert.equal((await reopened.get('phone')).pendingJSON.length, large.length);
    assert.equal((await reopened.get('pc')).pendingJSON, undefined);
    await reopened.update('phone', { pendingJSON: 'newer edit' });
    await first.acknowledge('phone', large, 'old acknowledgement');
    assert.equal((await reopened.get('phone')).pendingJSON, 'newer edit');
    await reopened.acknowledge('phone', 'newer edit', 'confirmed');
    assert.equal((await first.get('phone')).pendingJSON, '');
    assert.equal((await first.get('phone')).stateJSON, 'confirmed');
});
