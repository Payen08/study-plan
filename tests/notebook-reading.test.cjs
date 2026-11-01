const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const html = fs.readFileSync(path.join(__dirname, '../studyplan-github.html'), 'utf8');

function source(marker) {
    const start = html.indexOf(marker);
    assert.notEqual(start, -1, `Missing ${marker}`);
    const open = html.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < html.length; i++) {
        if (html[i] === '{') depth++;
        if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
    }
    throw new Error(`Unclosed ${marker}`);
}

function node() {
    const classes = new Set();
    return {
        value: '', innerHTML: '', textContent: '', attributes: {}, listeners: {}, focusCount: 0,
        classList: {
            contains: name => classes.has(name),
            add: (...names) => names.forEach(name => classes.add(name)),
            remove: (...names) => names.forEach(name => classes.delete(name)),
            toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }
        },
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); },
        focus() { this.focusCount++; },
        contains() { return false; }
    };
}

function harness() {
    const ids = Object.fromEntries([
        'notebook-modal', 'notebook-mode-btn', 'notebook-read-title', 'notebook-title-input',
        'notebook-current-filter', 'notebook-current-date', 'nb-history-panel', 'note-modal',
        'zoomed-img', 'img-zoom-modal', 'notebook-markdown-pane', 'notebook-preview-pane', 'notebook-markdown-live',
        'notebook-markdown-hint', 'notebook-format-select', 'notebook-markdown-source'
    ].map(id => [id, node()]));
    const notebookEditor = node();
    notebookEditor.innerHTML = '<p>编辑后的内容 <b>仍保留格式</b></p>';
    ids['notebook-title-input'].value = '设计创新';
    const first = { id: 'a', title: '旧标题', html: '<p>旧内容</p>', subjectType: 'design', folderId: 'folder', dateKey: '2026-11-1' };
    const second = { ...first, id: 'b', title: '另一篇笔记', html: '<p>另一篇正文</p>' };
    const timers = [], cleared = [], opened = [], noteLinks = [];
    const c = vm.createContext({
        notebookEditor, notebookTitleInput: ids['notebook-title-input'], editor: node(),
        notebookEditMode: true, notebookEditorDirty: true, notebookAutosaveTimer: 99,
        notebookFormat: 'html', notebookPreviewTimer: null, notebookInlineEditor: null,
        StudyMarkdownEditor: { create(element, options) {
            let value = options.value;
            return { getValue: () => value, setValue(next) { value = next; }, setTheme() {}, focus() { ids['notebook-markdown-source'].focusCount++; } };
        } },
        StudyMarkdown: { render: text => text ? '<p>' + text + '</p>' : '', toMarkdown: text => text.replace(/<[^>]+>/g, '') },
        notebookComposeSubject: 'design', notebookCurrentEntryId: 'a', notebookCurrentFolderId: 'folder',
        notebookCurrentDateKey: '2026-11-1', notebookMobileStep: 'editor', curNoteKey: null,
        currentState: { notebookEntries: { a: first, b: second }, notebookFolders: { folder: { name: '论述题' } } },
        saves: 0, hiddenSuggestions: 0, markdownCommands: 0,
        document: { body: node(), getElementById: id => ids[id], addEventListener() {}, execCommand() { c.markdownCommands++; } },
        setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
        clearTimeout(id) { cleared.push(id); },
        getCategories: () => [{ type: 'design', name: '337' }],
        getAutoNotebookDateKey: () => '2026-11-1', getDefaultNotebookFolderId: () => 'folder',
        ensureNotebookFolders() {}, renderNotebookFolders() {}, renderNotebookEntries() {},
        renderNotebookFolderMoveSelect() {}, renderSubjectChips() {}, refresh() {}, showToast() {},
        setNotebookMobileStep(step) { c.notebookMobileStep = step; },
        sanitizeRichHtml: value => value, textFromHtml: value => value.replace(/<[^>]+>/g, ''),
        upsertNotebookEntry(entry) { c.currentState.notebookEntries[entry.id] = entry; return entry; },
        save() { c.saves++; }, hideNoteLinkSuggest() { c.hiddenSuggestions++; },
        subjectMenu: node(), noteLinkMenu: node(), noteLinkSuggestState: { open: false },
        updateWordCount() {}, handleNoteLinkKeydown() {}, handleMarkdownTrigger() {},
        openNoteByKey(key) { noteLinks.push(key); },
        addEventListener() {}, open(...args) { opened.push(args); }
    });
    c.window = c;
    for (const marker of [
        'function updateNotebookEditorMode(', 'function setNotebookEditMode(',
        'function renderNotebookList(', 'function commitNotebookDraft(',
        'function renderNotebookMarkdownPreview(', 'window.handleNotebookMarkdownInput =', 'window.setNotebookFormat =',
        'function ensureNotebookInlineEditor(',
        'window.toggleNotebookEditMode =', 'window.handleNotebookComposeInput =',
        'window.selectNotebookEntry =', 'window.createNotebookNote =',
        'function updateNoteLinkSuggest(', 'function initEditorEvents('
    ]) vm.runInContext(source(marker), c);
    return { c, ids, notebookEditor, timers, cleared, opened, noteLinks };
}

test('Entering reading mode saves the pending draft before locking it without replacing the DOM', () => {
    const { c, ids, notebookEditor, cleared } = harness();
    const draft = notebookEditor.innerHTML;
    c.setNotebookEditMode(false);
    assert.equal(c.currentState.notebookEntries.a.html, draft);
    assert.equal(c.currentState.notebookEntries.a.title, '设计创新');
    assert.equal(c.saves, 1);
    assert.equal(cleared[0], 99);
    assert.equal(c.notebookEditorDirty, false);
    assert.equal(notebookEditor.innerHTML, draft);
    assert.equal(notebookEditor.contentEditable, 'false');
    assert.equal(notebookEditor.attributes['aria-readonly'], 'true');
    assert.equal(ids['notebook-title-input'].readOnly, true);
    assert.equal(ids['notebook-read-title'].textContent, '设计创新');
    assert.equal(ids['notebook-read-title'].hidden, false);
});

test('Switching modes keeps content and enables editing only after an explicit action', () => {
    const { c, ids, notebookEditor } = harness();
    c.notebookEditorDirty = false;
    c.setNotebookEditMode(false);
    c.toggleNotebookEditMode();
    assert.equal(notebookEditor.contentEditable, 'true');
    assert.equal(ids['notebook-read-title'].hidden, true);
    assert.equal(ids['notebook-mode-btn'].attributes['aria-label'], '切换到阅读模式');
    assert.equal(notebookEditor.focusCount, 1);
    c.toggleNotebookEditMode();
    assert.equal(notebookEditor.contentEditable, 'false');
    assert.equal(c.saves, 0);
});

test('Read-only input cannot mark a draft dirty, enqueue autosave, or write a note', () => {
    const { c, timers } = harness();
    c.notebookEditMode = false;
    c.notebookEditorDirty = false;
    c.handleNotebookComposeInput();
    c.commitNotebookDraft();
    assert.equal(c.notebookEditorDirty, false);
    assert.equal(timers.length, 0);
    assert.equal(c.saves, 0);
});

test('Refreshing a saved note keeps reading mode and opens its full title as plain text', () => {
    const { c, ids, notebookEditor } = harness();
    c.notebookEditMode = false;
    c.currentState.notebookEntries.a.title = '<b>只作为标题文字</b>';
    c.renderNotebookList();
    assert.equal(notebookEditor.contentEditable, 'false');
    assert.equal(ids['notebook-read-title'].textContent, '<b>只作为标题文字</b>');
});

test('Opening another note preserves the outgoing draft; new notes start in editing mode', () => {
    const { c, ids, notebookEditor } = harness();
    const draft = notebookEditor.innerHTML;
    c.selectNotebookEntry('b');
    assert.equal(c.currentState.notebookEntries.a.html, draft);
    assert.equal(notebookEditor.innerHTML, '<p>另一篇正文</p>');
    assert.equal(notebookEditor.contentEditable, 'false');
    c.createNotebookNote();
    assert.equal(c.notebookFormat, 'markdown');
    assert.equal(notebookEditor.contentEditable, 'false');
    assert.equal(ids['notebook-markdown-pane'].hidden, false);
    assert.equal(notebookEditor.innerHTML, '');
    assert.equal(ids['notebook-title-input'].readOnly, false);
    assert.equal(ids['notebook-title-input'].value, '');
});

test('Markdown source survives autosave and a reading/editing round trip without becoming rendered HTML', () => {
    const { c, ids, notebookEditor } = harness();
    const markdown = '# 标题\n\n**加粗** 和 `代码`\n\n- [ ] 复习';
    c.notebookFormat = 'markdown';
    ids['notebook-markdown-source'].value = markdown;
    c.handleNotebookMarkdownInput();
    c.setNotebookEditMode(false);
    assert.equal(c.currentState.notebookEntries.a.markdown, markdown);
    assert.equal(c.currentState.notebookEntries.a.format, 'markdown');
    assert.equal(c.currentState.notebookEntries.a.html, '<p>' + markdown + '</p>');
    c.toggleNotebookEditMode();
    assert.equal(ids['notebook-markdown-source'].value, markdown);
    assert.equal(ids['notebook-markdown-pane'].hidden, false);
    assert.equal(notebookEditor.contentEditable, 'false');
    assert.equal(ids['notebook-markdown-source'].focusCount, 1);
});

test('Opening a Markdown note reloads its source while old HTML notes stay in rich-text mode', () => {
    const { c, ids, notebookEditor } = harness();
    c.currentState.notebookEntries.b.format = 'markdown';
    c.currentState.notebookEntries.b.markdown = '**原文**';
    c.selectNotebookEntry('b');
    assert.equal(c.notebookFormat, 'markdown');
    assert.equal(ids['notebook-markdown-source'].value, '**原文**');
    assert.equal(notebookEditor.innerHTML, '<p>**原文**</p>');
    c.selectNotebookEntry('a');
    assert.equal(c.notebookFormat, 'html');
    assert.equal(ids['notebook-markdown-source'].value, '');
});

test('An image-only Markdown note is not treated as an empty draft', () => {
    const { c, ids } = harness();
    c.notebookFormat = 'markdown';
    c.StudyMarkdown.render = () => '<p><img src="image.png" alt=""></p>';
    ids['notebook-title-input'].value = '';
    ids['notebook-markdown-source'].value = '![](image.png)';
    c.commitNotebookDraft();
    assert.equal(c.currentState.notebookEntries.a.markdown, '![](image.png)');
    assert.equal(c.saves, 1);
});

test('Reading blocks checkbox edits and Markdown shortcuts while keeping images and links usable', () => {
    const { c, ids, notebookEditor, opened, noteLinks } = harness();
    c.notebookEditMode = false;
    c.initEditorEvents();
    let prevented = 0;
    notebookEditor.listeners.beforeinput[0]({ preventDefault() { prevented++; } });
    const click = notebookEditor.listeners.click[0];
    click({ target: { closest: selector => selector.startsWith('input') ? {} : null }, preventDefault() { prevented++; } });
    assert.equal(prevented, 2);
    click({ target: { tagName: 'IMG', src: 'diagram.svg', closest: () => null } });
    assert.equal(ids['zoomed-img'].src, 'diagram.svg');
    assert.equal(ids['img-zoom-modal'].classList.contains('open'), true);
    click({ target: { closest: selector => selector === 'a[data-note-key]' ? { dataset: { noteKey: '2026-11-1' } } : null }, preventDefault() {} });
    assert.deepEqual(noteLinks, ['2026-11-1']);
    click({ target: { closest: selector => selector === 'a[href]' ? { href: 'https://example.com/' } : null }, preventDefault() {} });
    assert.deepEqual(opened, [['https://example.com/', '_blank', 'noopener,noreferrer']]);
    const markdown = notebookEditor.listeners.keyup.at(-1);
    markdown({ key: ' ', currentTarget: { isContentEditable: false } });
    assert.equal(c.markdownCommands, 0);
    c.updateNoteLinkSuggest({ isContentEditable: false });
    assert.ok(c.hiddenSuggestions > 0);
});
