const MODULE_NAME = 'ui_n';
const ROOT_CLASS = 'ntu-enabled';
const VERSION = '0.3.7';

const defaults = {
    enabled: true,
    theme: 'auto',
    fontSize: 19,
    lineHeight: 1.95,
    sidePadding: 24,
    compactUser: true,
};

let observer;
let initialized = false;

function context() {
    return globalThis.SillyTavern?.getContext?.();
}

function settings() {
    const ctx = context();
    if (!ctx) return structuredClone(defaults);
    const saved = ctx.extensionSettings[MODULE_NAME] || {};
    ctx.extensionSettings[MODULE_NAME] = Object.assign(structuredClone(defaults), saved);
    return ctx.extensionSettings[MODULE_NAME];
}

function save() {
    context()?.saveSettingsDebounced?.();
}

function resolvedTheme(theme = settings().theme) {
    if (theme === 'light' || theme === 'dark') return theme;
    return globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyAppearance() {
    const value = settings();
    const body = document.body;
    body.classList.toggle(ROOT_CLASS, Boolean(value.enabled));
    body.classList.toggle('ntu-compact-user', Boolean(value.compactUser));
    body.dataset.ntuTheme = value.theme;
    body.style.setProperty('--ntu-font-size', `${value.fontSize}px`);
    body.style.setProperty('--ntu-line-height', String(value.lineHeight));
    body.style.setProperty('--ntu-side-padding', `${value.sidePadding}px`);

    const toggle = document.getElementById('ntu_quick_toggle');
    toggle?.classList.toggle('ntu-active', Boolean(value.enabled));
    toggle?.setAttribute('title', resolvedTheme(value.theme) === 'dark' ? '切换到日间主题' : '切换到夜间主题');
    const enabled = document.getElementById('ntu_enabled');
    if (enabled) enabled.checked = Boolean(value.enabled);
    const theme = document.getElementById('ntu_theme');
    if (theme) theme.value = value.theme;

    if (value.enabled) {
        setTimeout(() => refreshMessages(), 0);
    } else {
        restoreMessages();
    }
}

function textOf(element) {
    return element?.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function findCacheText(message) {
    const explicit = message.querySelector('[data-cache-hit], .memo-cache-hit, .cache-hit, [class*="cache_hit"], [class*="cache-hit"]');
    if (explicit && /缓存|cache/i.test(textOf(explicit))) {
        explicit.dataset.ntuCacheSource = 'true';
        return textOf(explicit);
    }

    const candidates = message.querySelectorAll('.ch_name *, .mes_block *');
    for (const item of candidates) {
        if (item.matches('.mes_text, .mes_text *, .ntu-meta, .ntu-meta *, .mes_buttons, .mes_buttons *, .mes_edit_buttons, .mes_edit_buttons *')) continue;
        if (item.children.length > 0) continue;
        const text = textOf(item);
        if (/^(缓存命中|缓存|cache hit)\s*[:：]?\s*\d+(?:\.\d+)?%$/i.test(text)) {
            item.dataset.ntuCacheSource = 'true';
            return text;
        }
    }
    return '';
}

function normalizeMetric(text, type) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    if (type === 'layer') {
        const number = clean.match(/\d+/)?.[0];
        return number ? `第 ${number} 层` : clean;
    }
    if (type === 'cache') {
        const percent = clean.match(/\d+(?:\.\d+)?%/)?.[0];
        return percent ? `缓存 ${percent}` : clean;
    }
    return clean;
}

function upsertMeta(message) {
    if (!(message instanceof HTMLElement)) return;
    let meta = message.querySelector(':scope > .mes_block > .ntu-meta');
    if (!meta) {
        meta = document.createElement('div');
        meta.className = 'ntu-meta';
        meta.setAttribute('aria-label', '本条回复数据');
        meta.innerHTML = '<div class="ntu-meta-stats"></div><div class="ntu-actions"></div>';
        message.querySelector(':scope > .mes_block')?.prepend(meta);
    }

    const stats = meta.querySelector('.ntu-meta-stats');
    const actions = meta.querySelector('.ntu-actions');
    const buttons = message.querySelector('.mes_buttons:not(.ntu-actions .mes_buttons)');
    if (buttons && actions) {
        const anchor = document.createElement('span');
        anchor.className = 'ntu-actions-anchor';
        anchor.hidden = true;
        buttons.before(anchor);
        actions.append(buttons);
    }

    const values = [
        normalizeMetric(textOf(message.querySelector('.mesIDDisplay')), 'layer'),
        normalizeMetric(findCacheText(message), 'cache'),
        normalizeMetric(textOf(message.querySelector('.mes_timer')), 'timer'),
        normalizeMetric(textOf(message.querySelector('.tokenCounterDisplay')), 'token'),
    ].filter(Boolean);

    const signature = values.join('|');
    if (!stats || meta.dataset.signature === signature) return;
    meta.dataset.signature = signature;
    stats.replaceChildren(...values.map((value, index) => {
        const fragment = document.createDocumentFragment();
        if (index > 0) {
            const dot = document.createElement('span');
            dot.className = 'ntu-meta-dot';
            dot.textContent = '·';
            fragment.append(dot);
        }
        const item = document.createElement('span');
        item.className = 'ntu-meta-item';
        item.textContent = value;
        fragment.append(item);
        return fragment;
    }));
}

function restoreMessages() {
    document.querySelectorAll('#chat .mes').forEach((message) => {
        const anchor = message.querySelector('.ntu-actions-anchor');
        const buttons = message.querySelector('.ntu-actions > .mes_buttons');
        if (anchor && buttons) anchor.after(buttons);
        anchor?.remove();
        message.querySelectorAll('[data-ntu-cache-source]').forEach((item) => delete item.dataset.ntuCacheSource);
        message.querySelector(':scope > .mes_block > .ntu-meta')?.remove();
    });
}

function refreshMessages(root = document) {
    root.querySelectorAll?.('#chat .mes').forEach(upsertMeta);
}

function observeChat() {
    observer?.disconnect();
    const chat = document.getElementById('chat');
    if (!chat) return;
    observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            const message = mutation.target instanceof Element ? mutation.target.closest('.mes') : null;
            if (message) upsertMeta(message);
            mutation.addedNodes.forEach((node) => {
                if (!(node instanceof Element)) return;
                if (node.matches('.mes')) upsertMeta(node);
                refreshMessages(node);
            });
        }
    });
    observer.observe(chat, { childList: true, subtree: true, characterData: true });
    refreshMessages();
}

function addQuickToggle() {
    if (document.getElementById('ntu_quick_toggle')) return;
    const button = document.createElement('button');
    button.id = 'ntu_quick_toggle';
    button.type = 'button';
    button.className = 'menu_button interactable fa-solid fa-book-open-reader';
    button.setAttribute('aria-label', '切换 UI-N 日间或夜间主题');
    button.addEventListener('click', () => {
        const value = settings();
        value.enabled = true;
        value.theme = resolvedTheme(value.theme) === 'dark' ? 'light' : 'dark';
        const checkbox = document.getElementById('ntu_enabled');
        if (checkbox) checkbox.checked = true;
        applyAppearance();
        save();
    });

    const target = document.getElementById('leftSendForm') || document.getElementById('send_form');
    target?.prepend(button);
}

function settingRow(label, control) {
    const row = document.createElement('label');
    row.className = 'ntu-setting-row';
    const text = document.createElement('span');
    text.textContent = label;
    row.append(text, control);
    return row;
}

function addSettingsPanel() {
    if (document.getElementById('ntu_settings')) return;
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host) return;

    const panel = document.createElement('div');
    panel.id = 'ntu_settings';
    panel.className = 'extension_container';
    panel.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>UI-N</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content ntu-settings-content"></div>
        </div>`;
    host.append(panel);

    const content = panel.querySelector('.ntu-settings-content');
    const value = settings();

    const enabled = document.createElement('input');
    enabled.id = 'ntu_enabled';
    enabled.type = 'checkbox';
    enabled.checked = value.enabled;
    enabled.addEventListener('change', () => update('enabled', enabled.checked));
    content.append(settingRow('启用沉浸阅读', enabled));

    const compact = document.createElement('input');
    compact.type = 'checkbox';
    compact.checked = value.compactUser;
    compact.addEventListener('change', () => update('compactUser', compact.checked));
    content.append(settingRow('压缩用户消息', compact));

    const theme = document.createElement('select');
    theme.id = 'ntu_theme';
    [['auto', '跟随系统'], ['light', '日间'], ['dark', '夜间']].forEach(([key, label]) => {
        const option = new Option(label, key, false, value.theme === key);
        theme.add(option);
    });
    theme.addEventListener('change', () => update('theme', theme.value));
    content.append(settingRow('显示模式', theme));

    content.append(rangeControl('正文字号', 'fontSize', 16, 24, 1, value.fontSize));
    content.append(rangeControl('正文行距', 'lineHeight', 1.55, 2.25, 0.05, value.lineHeight));
    content.append(rangeControl('左右留白', 'sidePadding', 14, 40, 1, value.sidePadding));
}

function rangeControl(label, key, min, max, step, initial) {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(initial);
    const value = document.createElement('output');
    value.textContent = String(initial);
    input.addEventListener('input', () => {
        value.textContent = input.value;
        update(key, Number(input.value));
    });
    const group = document.createElement('div');
    group.className = 'ntu-range-row';
    const top = document.createElement('div');
    top.className = 'ntu-range-label';
    top.append(document.createTextNode(label), value);
    group.append(top, input);
    return group;
}

function update(key, value) {
    settings()[key] = value;
    applyAppearance();
    save();
}

function init() {
    if (initialized) {
        applyAppearance();
        observeChat();
        refreshMessages();
        return;
    }
    initialized = true;
    settings();
    addSettingsPanel();
    addQuickToggle();
    applyAppearance();
    observeChat();

    const ctx = context();
    const events = ctx?.event_types;
    if (ctx?.eventSource && events) {
        [events.CHAT_CHANGED, events.USER_MESSAGE_RENDERED, events.CHARACTER_MESSAGE_RENDERED, events.MESSAGE_EDITED]
            .filter(Boolean)
            .forEach((event) => ctx.eventSource.on(event, () => setTimeout(() => refreshMessages(), 0)));
    }
    console.info(`[UI-N] v${VERSION} loaded`);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0), { once: true });
} else {
    setTimeout(init, 0);
}

export function onDisable() {
    document.body.classList.remove(ROOT_CLASS, 'ntu-compact-user');
    observer?.disconnect();
    restoreMessages();
}

export function onEnable() {
    setTimeout(init, 0);
}
