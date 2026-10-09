/* Pure data adapters shared by the page and sync regression tests. */
(function (root) {
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const emptyYear = () => ({ done: [], notes: {}, customTasks: {}, notebookEntries: {}, notebookFolders: {} });
    function dateKey(value) {
        const match = String(value || '').replace(/^daily:/, '').match(/^(2025|2026)-(\d{1,2})-(\d{1,2})/);
        if (!match) return null;
        const [, year, month, day] = match;
        const date = new Date(Number(year), Number(month) - 1, Number(day));
        if (date.getMonth() + 1 !== Number(month) || date.getDate() !== Number(day)) return null;
        return year === '2025' && Number(month) === 12 ? `d${Number(day)}` : `${year}-${Number(month)}-${Number(day)}`;
    }
    function latestRows(rows) {
        const items = Array.isArray(rows) ? rows : Object.values(rows || {});
        const byId = new Map();
        for (const item of items) {
            if (!item?.id) continue;
            const previous = byId.get(item.id);
            const at = value => Date.parse(value.updated_at || value.created_at || '') || 0;
            if (!previous || at(item) >= at(previous)) byId.set(item.id, item);
        }
        return [...byId.values()].filter(item => !item.deleted_at);
    }
    function importV2(tables, settings) {
        const state = { '2025': emptyYear(), '2026': emptyYear(), settings: clone(settings || {}) };
        const subjects = new Map(latestRows(tables.subjects).map(item => [item.id, item]));
        const subjectType = id => {
            const subject = subjects.get(id);
            if (subject?.legacy_id) return subject.legacy_id;
            const name = subject?.name || '';
            if (name.includes('英语')) return 'cat-2';
            if (name.includes('政治')) return 'cat-1';
            if (name.includes('手绘')) return 'cat-0';
            if (name.includes('337')) return 'cat-3';
            return 'cat-4';
        };
        const categories = clone(state.settings.categories || []);
        for (const subject of subjects.values()) {
            const type = subjectType(subject.id);
            if (!categories.some(category => category.type === type)) categories.push({
                type, name: subject.name || '学习', color: subject.color || '#64748b', bg: '#f1f5f9', border: '#cbd5e1'
            });
        }
        if (categories.length) state.settings.categories = categories;
        const folderIds = new Map();
        const folderSubjects = new Map();
        for (const folder of latestRows(tables.folders)) {
            const id = folder.legacy_id || folder.id;
            folderIds.set(folder.id, id);
            const type = folder.subject_id ? subjectType(folder.subject_id) : (String(id).match(/cat-\d+/)?.[0] || 'cat-4');
            folderSubjects.set(folder.id, type);
            for (const year of ['2025', '2026']) state[year].notebookFolders[id] = {
                id, name: folder.name || '笔记', subjectType: type,
                createdAt: folder.created_at, updatedAt: folder.updated_at
            };
        }
        for (const task of latestRows(tables.tasks)) {
            const key = dateKey(task.task_date);
            if (!key) continue;
            const year = key.startsWith('d') ? '2025' : key.slice(0, 4);
            const id = task.legacy_id || task.id;
            (state[year].customTasks[key] ||= []).push({
                id, text: task.title || '', type: subjectType(task.subject_id),
                period: task.period || '全天', time: task.period || '全天'
            });
            if (task.status === 'done' || task.completed_at) state[year].done.push(id);
        }
        for (const note of latestRows(tables.notes)) {
            const links = (Array.isArray(note.linked_dates) ? note.linked_dates : []).map(dateKey).filter(Boolean);
            const dailyKey = /^daily:/.test(note.legacy_id || '') ? dateKey(note.legacy_id) : null;
            const key = dailyKey || links[0] || dateKey(note.created_at);
            if (!key) continue;
            const year = key.startsWith('d') ? '2025' : key.slice(0, 4);
            const html = note.html || note.plain_text || '';
            if (dailyKey || note.source === 'daily_note') {
                state[year].notes[key] = html;
            } else {
                const id = note.legacy_id || note.id;
                // V2 旧笔记常没有 subject_id，科目保存在所属文件夹上。
                const type = note.subject_id ? subjectType(note.subject_id) : (folderSubjects.get(note.folder_id) || 'cat-4');
                state[year].notebookEntries[id] = {
                    id, title: note.title || '', html, content: note.plain_text || '',
                    dateKey: key, linkedDateKeys: [...new Set(links)],
                    subjectType: type, folderId: folderIds.get(note.folder_id) || `folder-default-${type}`,
                    pinned: !!note.pinned, createdAt: note.created_at, updatedAt: note.updated_at
                };
            }
        }
        return state;
    }
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    // Apply only this device's changes to the latest cloud state, including removals.
    function merge(base, local, remote) {
        if (equal(base, local)) return clone(remote);
        if (equal(base, remote) || equal(local, remote)) return clone(local);
        if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
            if ([...base, ...local, ...remote].every(value => typeof value === 'string')) {
                const removed = new Set(base.filter(value => !local.includes(value)));
                return [...new Set([...remote.filter(value => !removed.has(value)), ...local.filter(value => !base.includes(value))])];
            }
            if ([...base, ...local, ...remote].every(value => object(value) && value.id)) {
                const index = rows => Object.fromEntries(rows.map(row => [row.id, row]));
                return Object.values(merge(index(base), index(local), index(remote)));
            }
            return clone(local);
        }
        if (object(local) && object(remote) && (object(base) || base === undefined)) {
            const result = {};
            for (const key of new Set([...Object.keys(base || {}), ...Object.keys(local), ...Object.keys(remote)])) {
                const value = merge(base?.[key], local[key], remote[key]);
                if (value !== undefined) result[key] = value;
            }
            return result;
        }
        return clone(local);
    }
    // Large notes do not fit safely in localStorage twice (state + upload queue).
    function createCache(indexedDB) {
        let opening;
        function open() {
            if (!indexedDB) return Promise.reject(new Error('IndexedDB unavailable'));
            if (!opening) opening = new Promise((resolve, reject) => {
                const request = indexedDB.open('study-cloud-cache', 1);
                request.onupgradeneeded = () => request.result.createObjectStore('records', { keyPath: 'id' });
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => { opening = null; reject(request.error); };
                request.onblocked = () => { opening = null; reject(new Error('Local cache is blocked by another page')); };
            });
            return opening;
        }
        async function transact(id, change) {
            const db = await open();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction('records', change ? 'readwrite' : 'readonly');
                const store = transaction.objectStore('records');
                const request = store.get(id);
                let result;
                request.onsuccess = () => {
                    result = request.result || { id };
                    if (change) { result = change(result); store.put(result); }
                };
                transaction.oncomplete = () => resolve(result);
                transaction.onabort = () => reject(transaction.error || new Error('Local cache transaction aborted'));
                transaction.onerror = () => reject(transaction.error);
            });
        }
        return {
            get: id => transact(id),
            update: (id, values) => transact(id, current => ({ ...current, ...values, id })),
            acknowledge: (id, pendingJSON, stateJSON) => transact(id, current =>
                current.pendingJSON === pendingJSON
                    ? { ...current, stateJSON, pendingJSON: '', pendingBaseJSON: '' }
                    : current)
        };
    }
    const api = { dateKey, latestRows, importV2, merge, createCache };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.StudyCloudData = api;
})(typeof window === 'undefined' ? this : window);
