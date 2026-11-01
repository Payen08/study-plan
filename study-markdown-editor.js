(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory;
    else root.StudyMarkdownEditor = factory(root.Vditor);
})(typeof window === 'undefined' ? this : window, function (Vditor) {
    'use strict';
    function create(element, options) {
        let value = options.value || '', ready = false, setting = false;
        let pendingFocus = false;
        let dark = !!options.dark;
        let editor;
        element.setAttribute('inert', '');
        element.setAttribute('aria-busy', 'true');
        const notify = next => {
            if (!ready || setting || next === value) return;
            value = next;
            options.onChange(value);
        };
        const cdn = new URL('./vendor/vditor-4.0.1', document.baseURI).href.replace(/\/$/, '');
        editor = new Vditor(element, {
            value, mode: 'ir', cdn, lang: 'zh_CN', icon: '',
            height: '100%', minHeight: 0, toolbar: [],
            cache: { enable: false }, resize: { enable: false },
            counter: { enable: false }, outline: { enable: false },
            theme: options.dark ? 'dark' : 'classic',
            placeholder: '直接输入 Markdown，例如 # 标题、**加粗**、- 列表…',
            hint: { emoji: {}, parse: false },
            preview: {
                hljs: { enable: false },
                markdown: { sanitize: true, codeBlockPreview: false, mathBlockPreview: false, inlineMath: false },
                theme: { current: options.dark ? 'dark' : 'light', path: cdn + '/dist/css/content-theme' },
                render: { media: { enable: false } }
            },
            input: notify,
            after() {
                ready = true;
                editor.setValue(value, true);
                element.removeAttribute('inert');
                element.setAttribute('aria-busy', 'false');
                editor.setTheme(dark ? 'dark' : 'classic', dark ? 'dark' : 'light', undefined, cdn + '/dist/css/content-theme');
                const input = element.querySelector('.vditor-ir [contenteditable="true"]');
                if (input) {
                    input.setAttribute('role', 'textbox');
                    input.setAttribute('aria-label', 'Markdown 正文');
                    input.setAttribute('aria-multiline', 'true');
                    input.setAttribute('spellcheck', 'false');
                }
                if (pendingFocus && !element.closest('[hidden]')) editor.focus();
                pendingFocus = false;
            }
        });
        // Flush native input immediately, including a quick click on 阅读 before
        // the editor's delayed render callback, without moving the caret.
        element.addEventListener('input', () => { if (ready) notify(editor.getValue()); });
        return {
            getValue() { return ready ? editor.getValue() : value; },
            setValue(next) {
                next = String(next || '');
                if (next === value) return;
                value = next;
                if (ready) {
                    setting = true;
                    try { editor.setValue(value, true); } finally { setting = false; }
                }
            },
            focus() { pendingFocus = true; if (ready) editor.focus(); },
            setTheme(nextDark) {
                dark = !!nextDark;
                if (ready) editor.setTheme(dark ? 'dark' : 'classic', dark ? 'dark' : 'light', undefined, cdn + '/dist/css/content-theme');
            }
        };
    }
    return { create };
});
