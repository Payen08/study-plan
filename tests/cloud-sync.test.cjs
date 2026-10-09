const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
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
    const context = vm.createContext({
        console, Promise, Date, Math, AbortController,
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
        cloudLoadPromise: null, cloudPullInFlight: false, cloudRetryTimer: null,
        queuedCloudSnapshot: null, queuedCloudJson: '', localStateRevision: 0,
        lastCloudPullAt: 0, aiSending: false, CURRENT_YEAR: 2026,
        fullState: { '2026': { done: [], notes: {}, customTasks: {}, notebookEntries: {} } },
        updateStatus: status => statuses.push(status), showToast() {},
        renderAuthState() {}, updateSyncLabel() {}, refresh() {}, updateProgress() {},
        ensureStateStructure: state => state, ensureSettingsStructure() {},
        inject2026Plan() {}, cleanEmptyNotes() {}, isValidState: () => true,
        mergeStates: (local, cloud) => cloud,
        supabaseClient: {
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
        'effectiveSyncId', 'getCloudRecordId', 'ensureCloudDebug', 'hasPendingCloudSync',
        'scheduleCloudRetry', 'pushCloudState', 'flushCloudQueue', 'runCloudQueue',
        'queueCloudSync', 'flushPendingCloudSync', 'hasActiveEditorSession',
        'refreshCloudIfSafe', 'loadCloud', 'performCloudLoad', 'initAuth'
    ]) vm.runInContext(source(name), context);
    return { context, data, timers, statuses, writes };
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
    h.context.supabaseClient.from = () => ({
        select() { return this; }, eq() { return this; }, maybeSingle: () => request.promise
    });
    const active = h.context.loadCloud(true);
    const newState = { '2026': { notes: { today: 'new edit' } } };
    h.context.fullState = newState;
    h.context.localStateRevision++;
    request.resolve({ data: { data: { '2026': { notes: { today: 'old' } } } } });
    await active;
    assert.equal(h.context.fullState, newState);
    assert.deepEqual(h.statuses, ['syncing']);
});

test('Simultaneous pulls share a single request and release the lock', async () => {
    const h = harness();
    const request = deferred();
    let pulls = 0;
    h.context.supabaseClient.from = () => {
        pulls++;
        return { select() { return this; }, eq() { return this; }, maybeSingle: () => request.promise };
    };
    const a = h.context.loadCloud(true), b = h.context.loadCloud(true);
    assert.equal(a, b);
    request.resolve({ data: null, error: null });
    await a;
    assert.equal(pulls, 1);
    assert.equal(h.context.cloudLoadPromise, null);
});

test('Pull failures record the reason and schedule recovery', async () => {
    const h = harness();
    h.context.supabaseClient.from = () => ({
        select() { return this; }, eq() { return this; },
        maybeSingle: async () => ({ error: { message: 'connection lost' } })
    });
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
