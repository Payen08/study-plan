const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness() {
    const changes = [], focus = [], instances = [], attributes = {};
    const element = { listeners: {}, setAttribute(name, value) { attributes[name] = value; }, removeAttribute(name) { delete attributes[name]; }, addEventListener(name, fn) { this.listeners[name] = fn; }, querySelector: () => ({ setAttribute(name, value) { attributes[name] = value; } }), closest: () => null };
    class Vditor {
        constructor(el, options) { this.options = options; this.value = options.value; instances.push(this); }
        getValue() { return this.value; }
        setValue(value, clearStack) { this.value = value; this.clearStack = clearStack; }
        focus() { focus.push(true); }
        setTheme() {}
    }
    const context = vm.createContext({ module: { exports: {} }, URL, document: { baseURI: 'https://payen08.github.io/study-plan/' } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../study-markdown-editor.js'), 'utf8'), context);
    const adapter = context.module.exports(Vditor).create(element, { value: '# 原文', onChange: value => changes.push(value) });
    return { adapter, editor: instances[0], element, changes, focus, attributes };
}

test('Uses one instant-rendering editor with no split preview or independent draft cache', () => {
    const { editor } = harness();
    assert.equal(editor.options.mode, 'ir');
    assert.equal(editor.options.toolbar.length, 0);
    assert.equal(editor.options.cache.enable, false);
    assert.equal(editor.options.preview.markdown.sanitize, true);
    assert.equal(editor.options.cdn, 'https://payen08.github.io/study-plan/vendor/vditor-4.0.1');
});

test('Asynchronous initialization uses the latest note and exposes an accessible editing area', () => {
    const { adapter, editor, attributes, focus } = harness();
    assert.equal(attributes.inert, '');
    adapter.setValue('**另一篇**');
    adapter.focus();
    editor.options.after();
    assert.equal(editor.value, '**另一篇**');
    assert.equal(attributes['aria-label'], 'Markdown 正文');
    assert.equal(attributes.inert, undefined);
    assert.equal(focus.length, 1);
});

test('Native typing is captured immediately and changing notes clears undo without writing the new note', () => {
    const { adapter, editor, element, changes } = harness();
    editor.options.after();
    editor.value = '# 中文输入\n\n最后一个字';
    element.listeners.input();
    assert.equal(changes[0], '# 中文输入\n\n最后一个字');
    assert.equal(adapter.getValue(), '# 中文输入\n\n最后一个字');
    adapter.setValue('另一个笔记');
    assert.equal(editor.clearStack, true);
    assert.equal(changes.length, 1);
});
