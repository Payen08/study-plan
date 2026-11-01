const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const create = require('../study-markdown.js');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (_) {}

function service() {
    const window = new JSDOM('').window;
    for (const file of ['marked-18.1.2.umd.js', 'purify-3.4.17.min.js', 'turndown-7.2.4.js']) {
        const context = vm.createContext({ window, document: window.document, DOMParser: window.DOMParser, console });
        // UMD bundles use their global object; browser globals share this context.
        context.self = context;
        context.globalThis = context;
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../vendor', file), 'utf8'), context);
        if (context.marked) window.marked = context.marked;
        if (context.DOMPurify) window.DOMPurify = context.DOMPurify;
        if (context.TurndownService) window.TurndownService = context.TurndownService;
    }
    return { window, md: create(window.marked, window.DOMPurify, window.TurndownService) };
}

test('Missing dependencies keep source visible as escaped plain text', () => {
    assert.equal(create().render('<img onerror="evil()">\n**笔记**'), '<p>&lt;img onerror=&quot;evil()&quot;&gt;<br>**笔记**</p>');
});

test('Markdown renders headings, tables, tasks, formatting and fenced code', { skip: !JSDOM && 'Install jsdom for DOM integration tests' }, () => {
    const { window, md } = service();
    assert.equal(md.ready, true);
    const body = window.document.createElement('div');
    body.innerHTML = md.render('# 标题\n\n**重点** 与 *强调*\n\n> 引用\n\n- [x] 完成\n\n| 概念 | 释义 |\n| --- | --- |\n| A | B |\n\n```js\nconst x = "<tag>";\n```');
    assert.equal(body.querySelector('h1').textContent, '标题');
    assert.equal(body.querySelector('strong').textContent, '重点');
    assert.equal(body.querySelector('em').textContent, '强调');
    assert.ok(body.querySelector('blockquote'));
    assert.equal(body.querySelectorAll('th').length, 2);
    assert.equal(body.querySelector('input').checked, true);
    assert.equal(body.querySelector('input').disabled, true);
    assert.ok(body.querySelector('pre code').textContent.includes('<tag>'));
});

test('Rendered Markdown cannot inject scripts, event handlers, dangerous URLs or page overlays', { skip: !JSDOM && 'Install jsdom for DOM integration tests' }, () => {
    const { window, md } = service();
    const body = window.document.createElement('div');
    body.innerHTML = md.render('<script>evil()</script><img src="x" onerror="evil()"><svg onload="evil()"></svg><iframe src="evil"></iframe><div style="position:fixed" id="notebook-editor">overlay</div>\n\n[bad](javascript:evil) <a href="jav&#x61;script:evil()">bad</a>');
    assert.equal(body.querySelector('script,svg,iframe,[style],[id],[onerror],[onload]'), null);
    for (const anchor of body.querySelectorAll('a')) assert.ok(!/^javascript:/i.test(anchor.getAttribute('href') || ''));
});

test('Converting an existing HTML note preserves text, links, code, images, tables and note references', { skip: !JSDOM && 'Install jsdom for DOM integration tests' }, () => {
    const { window, md } = service();
    const source = md.toMarkdown('<h2>原标题</h2><p><strong>重点</strong> <a href="https://example.com">资料</a> <a href="#" data-note-key="2026-11-1">日记</a></p><pre><code>x &lt; y</code></pre><p><img src="figure.png" alt="图"></p><table><tr><th>A</th></tr><tr><td>B</td></tr></table>');
    const body = window.document.createElement('div');
    body.innerHTML = md.render(source);
    assert.equal(body.querySelector('h2').textContent, '原标题');
    assert.equal(body.querySelector('strong').textContent, '重点');
    assert.equal(body.querySelector('a[data-note-key]').getAttribute('data-note-key'), '2026-11-1');
    assert.equal(body.querySelector('img').getAttribute('src'), 'figure.png');
    assert.equal(body.querySelector('table td').textContent, 'B');
    assert.ok(body.querySelector('pre code').textContent.includes('x < y'));
});
