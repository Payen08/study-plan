const { test } = require('node:test');
const assert = require('node:assert/strict');
const cloud = require('../study-cloud-data.js');

test('Remote removal and note updates propagate while independent local edits survive', () => {
    const base = { notes: { a: 'original', b: 'old' }, done: ['a'], tasks: [{ id: '1', text: 'old' }] };
    const local = structuredClone(base); local.notes.local = 'new local';
    const remote = { notes: { a: 'remote edit' }, done: [], tasks: [] };
    assert.deepEqual(cloud.merge(base, local, remote), { notes: { a: 'remote edit', local: 'new local' }, done: [], tasks: [] });
});

test('Unchecking locally and completing another task remotely are both preserved', () => {
    assert.deepEqual(cloud.merge(['a'], [], ['a', 'b']), ['b']);
});

test('Deleting a task locally does not resurrect it from an old remote copy', () => {
    const base = [{ id: 'a', text: 'old' }];
    assert.deepEqual(cloud.merge(base, [], [{ id: 'a', text: 'old' }, { id: 'b', text: 'other device' }]), [{ id: 'b', text: 'other device' }]);
});

test('Newer deleted V2 records suppress older live duplicates', () => {
    assert.deepEqual(cloud.latestRows([
        { id: 'a', updated_at: '2026-10-08' },
        { id: 'a', updated_at: '2026-10-09', deleted_at: '2026-10-09' }
    ]), []);
});

test('V2 daily notes, notebooks, folders and task completion map to real content', () => {
    const state = cloud.importV2({
        subjects: [{ id: 's', name: '英语', legacy_id: 'cat-2' }],
        folders: [{ id: 'folder', legacy_id: 'old-folder', subject_id: 's', name: '英语笔记' }],
        tasks: [{ id: 'task', legacy_id: 'old-task', subject_id: 's', title: 'Reading', task_date: '2026-10-09', status: 'done' }],
        notes: [
            { id: 'daily', legacy_id: 'daily:2026-10-9', source: 'daily_note', html: '<p>Daily</p>' },
            { id: 'notebook', legacy_id: 'old-notebook', subject_id: 's', folder_id: 'folder', title: 'Words', html: '<p>Notebook</p>', linked_dates: ['2026-10-09'], pinned: true }
        ]
    });
    const year = state['2026'];
    assert.equal(year.notes['2026-10-9'], '<p>Daily</p>');
    assert.equal(year.notebookEntries['old-notebook'].folderId, 'old-folder');
    assert.equal(year.notebookEntries['old-notebook'].html, '<p>Notebook</p>');
    assert.equal(year.notebookFolders['old-folder'].subjectType, 'cat-2');
    assert.equal(year.customTasks['2026-10-9'][0].id, 'old-task');
    assert.deepEqual(year.done, ['old-task']);
});

test('Date adapter rejects invalid dates and supports December 2025 keys', () => {
    assert.equal(cloud.dateKey('daily:2025-12-03'), 'd3');
    assert.equal(cloud.dateKey('2026-02-30'), null);
    assert.equal(cloud.dateKey('2026-13-01'), null);
});


test('Legacy V2 notes inherit their subject from the folder when subject_id is null', () => {
    const state = cloud.importV2({
        subjects: [{ id: 'english', name: '英语', legacy_id: 'cat-2' }],
        folders: [{ id: 'f', name: 'Reading', subject_id: 'english', legacy_id: 'old-folder' }],
        notes: [{ id: 'n', subject_id: null, folder_id: 'f', source: 'web', legacy_id: 'old-note', created_at: '2026-05-07T05:34:00Z', html: 'Reading note' }]
    });
    assert.equal(state['2026'].notebookEntries['old-note'].subjectType, 'cat-2');
    assert.equal(state['2026'].notebookEntries['old-note'].folderId, 'old-folder');
    assert.ok(state.settings.categories.some(category => category.type === 'cat-2'));
});
