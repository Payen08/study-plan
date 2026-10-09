const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const StudyCloudData = require('../study-cloud-data.js');
const crypto = require('node:crypto');
const html = fs.readFileSync(path.join(__dirname, '../studyplan-github.html'), 'utf8');

function source(name) {
    const match = new RegExp(`(?:async )?function ${name}\\(`).exec(html);
    assert.ok(match, `Missing ${name}`);
    const start = match.index;
    const open = html.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < html.length; i++) {
        if (html[i] === '{') depth++;
        if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
    }
    throw new Error(`Unclosed ${name}`);
}
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function harness(extra = {}) {
    const data = new Map();
    const timers = [], statuses = [], writes = [];
    const cacheData = new Map();
    const context = vm.createContext({
        console, Promise, Date, Math, AbortController, crypto, StudyCloudData,
        setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
        clearTimeout() {},
        localStorage: {
            getItem: key => data.get(key) ?? null,
            setItem: (key, value) => data.set(key, String(value)),
            removeItem: key => data.delete(key)
        },
        window: {}, document: { getElementById: () => null },
        PENDING_CLOUD_PAYLOAD_KEY: 'pending', PENDING_CLOUD_ID_KEY: 'pendingId',
        DEFAULT_SYNC_ID: 'default', MY_SYNC_ID: 'payen', authUser: null, authSession: null,
        isCloud: true, cloudSyncInFlight: false, cloudFlushPromise: null,
        cloudLoadPromise: null, cloudPullInFlight: false, cloudRetryTimer: null, cloudRetryAttempts: 0,
        queuedCloudPersistPromise: Promise.resolve(),
        syncCache: {
            get: async id => cacheData.get(id) || { id },
            update: async (id, values) => { const value = { ...(cacheData.get(id) || {}), ...values, id }; cacheData.set(id, value); return value; },
            acknowledge: async (id, pendingJSON, stateJSON) => {
                const current = cacheData.get(id) || { id };
                if (current.pendingJSON === pendingJSON) cacheData.set(id, { ...current, stateJSON, pendingJSON: '', pendingBaseJSON: '' });
                return cacheData.get(id) || current;
            }
        },
        cloudReadMemo: new Map(), cloudBaseState: null, cloudBaseRecordId: '', queuedCloudBaseState: null,
        queuedCloudSnapshot: null, queuedCloudJson: '', queuedCloudRecordId: '', localStateRevision: 0,
        lastCloudPullAt: 0, aiSending: false, CURRENT_YEAR: 2026,
        fullState: { '2026': { done: [], notes: {}, customTasks: {}, notebookEntries: {} } },
        updateStatus: status => statuses.push(status), showToast() {},
        renderAuthState() {}, updateSyncLabel() {}, refresh() {}, refreshNotebookUI() {}, updateProgress() {},
        ensureStateStructure: state => state, ensureSettingsStructure() {},
        inject2026Plan() {}, cleanEmptyNotes() {}, isValidState: () => true,
        mergeStates: (local, cloud) => cloud,
        supabaseClient: {
            rpc: async () => ({ data: { exists: false } }),
            from() {
                const builder = {
                    upsert(payload) { writes.push(payload); return builder; },
                    select() { return builder; }, eq() { return builder; },
                    maybeSingle: async () => ({ data: null, error: null })
                };
                return builder;
            }
        },
        ...extra
    });
    context.window.switchYear = () => {};
    for (const name of [
        'syncIdForUser', 'effectiveSyncId', 'getCloudRecordId', 'ensureCloudDebug', 'hasPendingCloudSync',
        'scheduleCloudRetry', 'readCloudSection', 'readCloudRecord', 'pushCloudState', 'flushCloudQueue', 'runCloudQueue',
        'queueCloudSync', 'flushPendingCloudSync', 'hasActiveEditorSession',
        'refreshCloudIfSafe', 'loadCloud', 'performCloudLoad', 'initAuth',
        'normalize2026DateKey', 'normalize2026State'
    ]) vm.runInContext(source(name), context);
    return { context, data, cacheData, timers, statuses, writes };
}

test('Every inline script parses and production entry matches development entry', () => {
    for (const file of ['studyplan-github.html', 'index.html']) {
        const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        for (const match of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
            if (match[1].trim()) new vm.Script(match[1], { filename: file });
        }
    }
    assert.equal(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8'), html);
});

test('Failed old upload does not overwrite the latest queued edit; retry sends latest', async () => {
    const h = harness();
    const first = deferred();
    const sent = [];
    h.context.pushCloudState = async payload => {
        sent.push(payload.value);
        if (sent.length === 1) return first.promise;
        return 'payen';
    };
    const active = h.context.queueCloudSync({ value: 'old' }, '{"value":"old"}');
    assert.equal(h.data.get('pending'), '{"value":"old"}');
    h.context.queueCloudSync({ value: 'new' }, '{"value":"new"}');
    first.reject(new Error('Network interrupted'));
    await active;
    assert.equal(h.data.get('pending'), '{"value":"new"}');
    assert.equal(h.context.cloudSyncInFlight, false);
    await h.context.flushPendingCloudSync();
    assert.deepEqual(sent, ['old', 'new']);
    assert.equal(h.data.get('pending'), undefined);
});

test('Success of one tab preserves another tab pending snapshot', async () => {
    const h = harness();
    const request = deferred();
    h.context.pushCloudState = () => request.promise;
    const active = h.context.queueCloudSync({ value: 'tabA' }, '{"value":"tabA"}');
    h.data.set('pending', '{"value":"tabB"}');
    request.resolve('payen');
    await active;
    assert.equal(h.data.get('pending'), '{"value":"tabB"}');
    assert.equal(h.statuses.at(-1), 'syncing');
});

test('Refresh awaits pending upload before pulling cloud', async () => {
    const h = harness();
    const request = deferred();
    const order = [];
    h.context.pushCloudState = async () => { order.push('push'); return request.promise; };
    h.context.loadCloud = async () => { order.push('pull'); };
    h.data.set('pending', '{"value":"offline-edit"}');
    h.data.set('pendingId', 'payen');
    const active = h.context.refreshCloudIfSafe(true);
    await new Promise(setImmediate);
    assert.deepEqual(order, ['push']);
    request.resolve('payen');
    await active;
    assert.deepEqual(order, ['push', 'pull']);
});

test('Failed upload prevents a pull from replacing unsaved data', async () => {
    const h = harness();
    h.context.pushCloudState = async () => { throw new Error('offline'); };
    let pulls = 0;
    h.context.loadCloud = async () => { pulls++; };
    h.data.set('pending', '{"value":"offline-edit"}');
    h.data.set('pendingId', 'payen');
    await h.context.refreshCloudIfSafe(true);
    assert.equal(pulls, 0);
    assert.equal(h.data.get('pending'), '{"value":"offline-edit"}');
});

test('Late cloud response cannot overwrite an edit or update its status', async () => {
    const h = harness();
    const request = deferred();
    h.context.readCloudRecord = () => request.promise;
    const active = h.context.loadCloud(true);
    const newState = { '2026': { notes: { today: 'new edit' } } };
    h.context.fullState = newState;
    h.context.localStateRevision++;
    request.resolve({ exists: true, state: { '2026': { notes: { today: 'old' } } } });
    await active;
    assert.equal(h.context.fullState, newState);
    assert.deepEqual(h.statuses, ['syncing']);
});

test('Simultaneous pulls share a single request and release the lock', async () => {
    const h = harness();
    const request = deferred();
    let pulls = 0;
    h.context.readCloudRecord = () => { pulls++; return request.promise; };
    const a = h.context.loadCloud(true), b = h.context.loadCloud(true);
    assert.equal(a, b);
    request.resolve({ exists: false, state: null });
    await a;
    assert.equal(pulls, 1);
    assert.equal(h.context.cloudLoadPromise, null);
});

test('Pull failures record the reason and schedule recovery', async () => {
    const h = harness();
    h.context.readCloudRecord = async () => { throw new Error('connection lost'); };
    await h.context.loadCloud(true);
    assert.equal(h.context.window._cloudDebug.lastErr, 'connection lost');
    assert.equal(h.statuses.at(-1), 'offline');
    assert.equal(h.timers.length, 1);
});

test('Auth callback returns synchronously; network work starts after auth lock releases', async () => {
    const h = harness();
    let callback, locked = false, refreshed = 0;
    h.context.supabaseClient.auth = {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange(fn) { callback = fn; }
    };
    h.context.fetchStateBySyncId = async () => { assert.equal(locked, false); return null; };
    h.context.refreshCloudIfSafe = async () => { assert.equal(locked, false); refreshed++; };
    await h.context.initAuth();
    locked = true;
    assert.equal(callback('SIGNED_IN', { user: { id: 'account' } }), undefined);
    assert.equal(refreshed, 0);
    locked = false;
    await h.timers[0].fn();
    assert.equal(refreshed, 1);
    callback('SIGNED_OUT', null);
    assert.equal(h.context.MY_SYNC_ID, 'default');
});

test('Network timeout aborts stalled fetch and permits caller cancellation', async () => {
    const h = harness();
    let signal;
    h.context.fetch = (_url, options) => {
        signal = options.signal;
        return new Promise((resolve, reject) => {
            if (signal.aborted) reject(new Error('aborted'));
            else signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
    };
    // This function has a default {} parameter; load it with an explicit boundary.
    vm.runInContext(html.slice(html.indexOf('        async function fetchCloudWithTimeout'),
        html.indexOf('        function hasPendingCloudSync')), h.context);
    const request = h.context.fetchCloudWithTimeout('https://example.test');
    h.timers[0].fn();
    await assert.rejects(request, /aborted/);
    assert.equal(signal.aborted, true);
    const caller = new AbortController();
    caller.abort();
    await assert.rejects(h.context.fetchCloudWithTimeout('https://example.test', { signal: caller.signal }), /aborted/);
});


test('Manual sync ID remains effective on signed-in devices', async () => {
    const h = harness();
    h.data.set('study_sync_id', 'payen');
    let callback;
    h.context.supabaseClient.auth = {
        getSession: async () => ({ data: { session: { user: { id: 'account-uuid' } } } }),
        onAuthStateChange(fn) { callback = fn; }
    };
    await h.context.initAuth();
    assert.equal(h.context.getCloudRecordId(), 'payen');
    callback('TOKEN_REFRESHED', { user: { id: 'account-uuid' } });
    assert.equal(h.context.getCloudRecordId(), 'payen');
});

test('Upload sends only study fields to RPC and never replaces appData', async () => {
    const h = harness();
    let params;
    h.context.readCloudRecord = async () => ({ exists: true, state: null, revision: 'previous' });
    h.context.supabaseClient.rpc = async (name, value) => {
        assert.equal(name, 'study_cloud_patch');
        params = value;
        return { data: { saved: true } };
    };
    await h.context.pushCloudState({ '2026': { done: [], notes: {}, customTasks: {}, notebookEntries: {} } }, 'payen');
    assert.equal(params.p_state.appData, undefined);
    assert.equal(params.p_expected_revision, 'previous');
    assert.equal(params.p_id, 'payen');
});

test('Queued upload keeps its original record ID when active ID changes', async () => {
    const h = harness();
    h.context.cloudFlushPromise = Promise.resolve();
    h.context.queueCloudSync({ value: 'original-record' }, '{"value":"original-record"}', 'original-id');
    h.context.MY_SYNC_ID = 'different-id';
    h.context.cloudFlushPromise = null;
    let writtenId;
    h.context.pushCloudState = async (_payload, id) => { writtenId = id; return id; };
    await h.context.flushCloudQueue();
    assert.equal(writtenId, 'original-id');
});

test('V2 date formats normalize without duplicate tasks or linked dates', () => {
    const h = harness();
    const normalized = h.context.normalize2026State({
        notes: { '09-01': 'old format', '2026-9-1': 'canonical' },
        customTasks: { '09-01': [{ id: 't1', text: 'Task' }], '2026-09-01': [{ id: 't1', text: 'Task' }] },
        notebookEntries: { n1: { dateKey: '09-01', linkedDateKeys: ['09-01', '2026-09-01'] } }
    });
    assert.equal(normalized.notes['2026-9-1'], 'canonical');
    assert.equal(normalized.customTasks['2026-9-1'].length, 1);
    assert.equal(normalized.notebookEntries.n1.dateKey, '2026-9-1');
    assert.equal(normalized.notebookEntries.n1.linkedDateKeys.length, 1);
});


test('No cloud record is never reported as synchronized', async () => {
    const h = harness();
    await h.context.loadCloud(true);
    assert.equal(h.statuses.at(-1), 'offline');
    assert.match(h.context.window._cloudDebug.lastErr, /没有云端记录/);
});

test('V2-only cloud record imports actual task and note content', async () => {
    const h = harness();
    const selections = [];
    h.context.readCloudSection = async (_id, section) => {
        selections.push(section);
        if (section === 'info') return { exists: true, hasV1: false, meta: {} };
        if (section === 'settings') return { value: {} };
        if (section === 'tasks') return { value: [{ id: 'task', title: 'Real cloud task', task_date: '2026-10-09', status: 'done' }], nextOffset: null };
        if (section === 'notes') return { value: [{ id: 'note', source: 'daily_note', legacy_id: 'daily:2026-10-9', html: '<p>Real cloud note</p>' }], nextOffset: null };
        return { value: [], nextOffset: null };
    };
    await h.context.loadCloud(true);
    assert.equal(h.context.fullState['2026'].customTasks['2026-10-9'][0].text, 'Real cloud task');
    assert.equal(h.context.fullState['2026'].notes['2026-10-9'], '<p>Real cloud note</p>');
    assert.ok(h.context.fullState['2026'].done.includes('task'));
    assert.equal(h.statuses.at(-1), 'loaded');
    assert.ok(selections.every(value => value !== 'data'));
});

test('Concurrent cloud revision conflict retries without dropping another device edit', async () => {
    const h = harness();
    const base = { '2026': { done: [], notes: { a: 'base' }, customTasks: {}, notebookEntries: {} } };
    const local = structuredClone(base); local['2026'].notes.a = 'local';
    let attempts = 0, params;
    h.context.readCloudRecord = async () => {
        const remote = structuredClone(base);
        if (attempts) remote['2026'].notes.b = 'other device';
        return { state: remote, revision: String(attempts) };
    };
    h.context.supabaseClient.rpc = async (_name, value) => {
        params = value; attempts++;
        return { data: { saved: attempts > 1 } };
    };
    await h.context.pushCloudState(local, 'payen', base);
    assert.equal(attempts, 2);
    assert.equal(params.p_state['2026'].notes.a, 'local');
    assert.equal(params.p_state['2026'].notes.b, 'other device');
});

test('Missing save RPC reports installation requirement and preserves pending content', async () => {
    const h = harness();
    h.context.readCloudRecord = async () => ({ state: null, revision: '' });
    h.context.supabaseClient.rpc = async () => ({ error: { code: 'PGRST202' } });
    await h.context.queueCloudSync({ value: 'unsaved edit' }, '{"value":"unsaved edit"}');
    assert.equal(h.data.get('pending'), '{"value":"unsaved edit"}');
    assert.match(h.context.window._cloudDebug.lastErr, /保存接口尚未安装/);
});

test('Daily push cannot make a network request even with old enabled configuration', async () => {
    const h = harness();
    h.context.fetch = () => { throw new Error('No reminder request allowed'); };
    vm.runInContext(source('callStudyPushApi'), h.context);
    const result = await h.context.callStudyPushApi('daily');
    assert.equal(result.skipped, true);
    assert.ok(!html.includes('checkWechatPushReminder(now)'));
    assert.ok(!html.includes('async function triggerWechatDailyPush'));
});


test('Unchanged database version avoids downloading all notes again', async () => {
    const h = harness();
    const calls = [];
    h.context.readCloudSection = async (_id, section) => {
        calls.push(section);
        if (section === 'info') return { exists: true, hasV1: true, version: 'updated-at-1', meta: { v1Revision: 'r1' } };
        return { value: section === 'settings' ? {} : { done: [], notes: { today: 'cloud' }, customTasks: {}, notebookEntries: {} } };
    };
    await h.context.readCloudRecord('payen');
    calls.length = 0;
    const result = await h.context.readCloudRecord('payen');
    assert.deepEqual(calls, ['info']);
    assert.equal(result.state['2026'].notes.today, 'cloud');
});


test('Empty legacy year objects do not hide V2 tasks and notes', async () => {
    const h = harness();
    h.context.readCloudSection = async (_id, section) => {
        if (section === 'info') return { exists: true, hasV1: true, meta: {} };
        if (section === '2025' || section === '2026') return { value: { done: [], notes: {}, customTasks: {}, notebookEntries: {} } };
        if (section === 'tasks') return { value: [{ id: 'real-task', title: 'V2 task', task_date: '2026-10-9' }], nextOffset: null };
        return { value: section === 'settings' ? {} : [], nextOffset: null };
    };
    const result = await h.context.readCloudRecord('payen');
    assert.equal(result.state['2026'].customTasks['2026-10-9'][0].text, 'V2 task');
});


test('Failed pull never replaces recovered large cache with older localStorage content', async () => {
    const h = harness();
    h.data.set('study_v2', JSON.stringify({ '2026': { notes: { today: 'old cache' }, done: [], customTasks: {}, notebookEntries: {} } }));
    const recovered = { '2026': { notes: { today: 'recovered note' }, done: [], customTasks: {}, notebookEntries: {} } };
    h.context.fullState = recovered;
    h.context.readCloudRecord = async () => { throw new Error('network unavailable'); };
    await h.context.loadCloud(true);
    assert.equal(h.context.fullState['2026'].notes.today, 'recovered note');
});

test('Server-side daily guard returns success without reading state or calling a provider', async () => {
    const sourceText = fs.readFileSync(path.join(__dirname, '../supabase/functions/study-push/index.ts'), 'utf8');
    const handlerSource = sourceText.slice(sourceText.indexOf('Deno.serve(')).replace('let body: RequestBody = {};', 'let body = {};');
    let handler, networkCalls = 0;
    const context = vm.createContext({
        Request, Response, Error,
        Deno: { serve(fn) { handler = fn; }, env: { get() { throw new Error('Daily must stop before loading settings'); } } },
        fetch() { networkCalls++; throw new Error('Provider must not be contacted'); },
        corsHeaders: {}, jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status })
    });
    vm.runInContext(handlerSource, context);
    const response = await handler(new Request('https://example.test/study-push', { method: 'POST', body: JSON.stringify({ mode: 'daily', pushConfig: { enabled: true } }) }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).sent, false);
    assert.equal(networkCalls, 0);
});
