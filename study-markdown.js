(function (root, create) {
    if (typeof module === 'object' && module.exports) module.exports = create;
    else root.StudyMarkdown = create(root.marked, root.DOMPurify, root.TurndownService);
})(typeof window === 'undefined' ? this : window, function (marked, purifier, TurndownService) {
    'use strict';
    const ready = !!(marked?.parse && purifier?.sanitize && TurndownService);
    const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const options = {
        ALLOWED_TAGS: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'a', 'img', 'input', 'sup', 'sub', 'mark'],
        ALLOWED_ATTR: ['href', 'title', 'src', 'alt', 'type', 'checked', 'disabled', 'start', 'align', 'class', 'data-note-key'],
        ALLOW_DATA_ATTR: false
    };
    const clean = html => purifier.sanitize(html, options);
    function render(source) {
        const text = String(source || '');
        if (!text) return '';
        if (!ready) return '<p>' + escape(text).replace(/\n/g, '<br>') + '</p>';
        return clean(marked.parse(text, { gfm: true, breaks: true, async: false }));
    }
    function toMarkdown(html) {
        if (!ready) throw new Error('Markdown 编辑器未加载完成，请刷新后重试');
        const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
        converter.keep(['table', 'sup', 'sub', 'mark', 'u']);
        converter.addRule('note-links', {
            filter: node => node.nodeName === 'A' && node.hasAttribute('data-note-key'),
            replacement: (content, node) => '<a href="#" data-note-key="' + escape(node.getAttribute('data-note-key')) + '">' + content + '</a>'
        });
        converter.addRule('task-checkbox', {
            filter: node => node.nodeName === 'INPUT' && node.type === 'checkbox',
            replacement: (_, node) => node.checked ? '[x] ' : '[ ] '
        });
        return converter.turndown(clean(html || ''));
    }
    return { ready, render, toMarkdown };
});
