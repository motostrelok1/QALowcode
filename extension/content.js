// QA Recorder — content script (этап 1: запись кликов, сбор кандидатов)
// Покрывает п. 6.1, 6.2, 4, 4.1, 4.2 спецификации v0.4 (без тултипов, цепочек, contenteditable).

(() => {
  if (window.__qaRecorderInjected) return;
  window.__qaRecorderInjected = true;

  let recording = false;

  // ---------- утилиты ----------

  // Нормализация текста (п. 4.2): \u00a0 → пробел, схлопывание пробелов, trim
  const norm = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

  const cssEscape = (s) =>
    window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');

  // Эвристика «генерируемый id» (п. 4, приоритет 2): много цифр, react-:r3:, хэши
  function isGeneratedId(id) {
    if (!id) return true;
    if (/\d{4,}/.test(id)) return true;
    if (/^:r[0-9a-z]+:$/i.test(id)) return true;
    if (/^(mui|ember|mat-|ng-|radix|headlessui)/i.test(id)) return true;
    if (id.length >= 8 && /\d/.test(id) && /[a-f]/i.test(id) && /^[a-z0-9_-]+$/i.test(id)) return true;
    return false;
  }

  // Эвристика «стабильный класс» (п. 4, приоритет 6): отсекаем CSS-modules вида _item_tuvtt_13
  function isStableClass(cls) {
    if (/^_[A-Za-z0-9-]+_[A-Za-z0-9]{4,6}_\d+$/.test(cls)) return false; // CSS-modules
    if (/^(css|sc|emotion|jss|e)-[a-z0-9]{5,}$/i.test(cls)) return false; // styled/emotion
    if (/^[a-z]+-[a-f0-9]{6,}$/i.test(cls)) return false;
    return true;
  }

  // Подъём к интерактивному элементу (п. 6.2.1)
  function interactiveElement(t) {
    if (!(t instanceof Element)) return null;
    const found = t.closest(
      'button, a, [role="button"], [role="menuitem"], [role="option"], [role="tab"], ' +
      '[role="link"], [role="checkbox"], [role="switch"], [onclick], input, select, ' +
      'textarea, label, summary, [tabindex]:not([tabindex="-1"])'
    );
    return found || t;
  }

  function cssPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && parts.length < 6) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && !isGeneratedId(cur.id)) {
        parts.unshift('#' + cssEscape(cur.id));
        break;
      }
      const parent = cur.parentElement;
      if (parent) {
        const sameTag = [...parent.children].filter((c) => c.tagName === cur.tagName);
        if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  }

  function xPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 8) {
      let idx = 1;
      let sib = cur.previousElementSibling;
      while (sib) {
        if (sib.tagName === cur.tagName) idx++;
        sib = sib.previousElementSibling;
      }
      parts.unshift(`${cur.tagName.toLowerCase()}[${idx}]`);
      cur = cur.parentElement;
    }
    return '/' + parts.join('/');
  }

  // ---------- сбор кандидатов (раздел 4) ----------

  function buildCandidates(el) {
    const list = [];

    // 1. data-testid / data-qa
    for (const attr of ['data-testid', 'data-qa', 'data-test', 'data-cy']) {
      const v = el.getAttribute(attr);
      if (v) list.push({ kind: 'data-testid', priority: 1, selector: `[${attr}="${cssEscape(v)}"]` });
    }

    // 2. id (с отсечкой генерируемых)
    if (el.id) {
      if (!isGeneratedId(el.id)) {
        list.push({ kind: 'id', priority: 2, selector: `#${cssEscape(el.id)}` });
      } else {
        list.push({ kind: 'id', priority: 2, selector: `#${cssEscape(el.id)}`, rejected: 'generated-id' });
      }
    }

    // 3. name
    const name = el.getAttribute('name');
    if (name) list.push({ kind: 'name', priority: 3, selector: `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]` });

    // 4/5. role + текст и видимый текст (с нормализацией, п. 4.2)
    const role = el.getAttribute('role');
    const raw = (el.innerText || el.textContent || '').trim();
    const nrm = norm(raw);
    if (nrm && nrm.length <= 60) {
      if (role) list.push({ kind: 'role_text', priority: 4, role, text_raw: raw, text_norm: nrm });
      list.push({ kind: 'text', priority: 5, tag: el.tagName.toLowerCase(), text_raw: raw, text_norm: nrm });
    }

    // 6. тег + стабильные классы
    const stable = [...el.classList].filter(isStableClass).slice(0, 3);
    if (stable.length) {
      list.push({ kind: 'css', priority: 6, selector: el.tagName.toLowerCase() + '.' + stable.map(cssEscape).join('.') });
    }

    // 7. fallback: путь и xpath
    list.push({ kind: 'css-path', priority: 7, selector: cssPath(el) });
    list.push({ kind: 'xpath', priority: 7, selector: 'xpath:' + xPath(el) });

    return list;
  }

  // ---------- проверка уникальности (п. 4, правило уникальности) ----------

  function countMatches(c) {
    try {
      if (c.kind === 'text') {
        let n = 0;
        for (const e of document.querySelectorAll(c.tag)) {
          if (norm(e.innerText || e.textContent) === c.text_norm) n++;
        }
        return n;
      }
      if (c.kind === 'role_text') {
        let n = 0;
        for (const e of document.querySelectorAll(`[role="${c.role}"]`)) {
          if (norm(e.innerText || e.textContent) === c.text_norm) n++;
        }
        return n;
      }
      if (c.kind === 'xpath') {
        const r = document.evaluate(c.selector.slice(6), document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        return r.snapshotLength;
      }
      return document.querySelectorAll(c.selector).length;
    } catch {
      return Infinity;
    }
  }

  // Достройка within-контекста (п. 4.1) для неуникальных кандидатов
  function buildWithin(el) {
    const container = el.closest(
      'tr, [role="row"], li, [role="listitem"], article, section, [data-testid], [data-qa]'
    );
    if (!container) return null;
    // Текстовый якорь внутри контейнера (не сам элемент): первый содержательный текст
    const anchor = norm(container.innerText || '').slice(0, 80);
    if (!anchor) return null;
    return {
      container_selector: cssPath(container),
      anchor_text: anchor,
      description: `контейнер с текстом «${anchor.slice(0, 40)}${anchor.length > 40 ? '…' : ''}»`,
    };
  }

  // ---------- запись шага ----------

  function recordClick(event) {
    if (!recording) return;

    const el = interactiveElement(event.target);
    if (!el) return;

    const candidates = buildCandidates(el).map((c) => {
      if (c.rejected) return { ...c, unique: false, matches: 0 };
      const matches = countMatches(c);
      return { ...c, unique: matches === 1, matches };
    });

    // Если ни один кандидат не уникален — достраиваем within (п. 4.1)
    let within = null;
    if (!candidates.some((c) => c.unique)) {
      within = buildWithin(el);
    }

    const labelText = norm(el.innerText || el.textContent || '').slice(0, 40);
    const step = {
      step_id: crypto.randomUUID(),
      order: 0, // перенумерует панель
      group_id: null,
      resolution: 'resolve',
      action: 'click',
      human_label: `Клик по ${el.tagName.toLowerCase()}${labelText ? ` «${labelText}»` : ''}`,
      candidates,
      within,
      grid: null,
      tag: { assign_as: null, reuse_from: null },
      value: null,
      expect: { kind: 'none', selector: null, text: null },
      timing: { recorded_response_time_ms: null, wait_timeout_ms: 3000, post_action_delay_ms: 0 },
      assert: null,
      screenshot: null,
      enabled: true,
      url: location.href,
      recorded_at: new Date().toISOString(),
    };

    chrome.runtime.sendMessage({ type: 'qa:step', step }).catch(() => {});
  }

  // Capture-фаза — видим клики до обработчиков страницы (п. 6.1)
  document.addEventListener('click', recordClick, true);

  // ---------- управление состоянием ----------

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'qa:set-recording') recording = !!msg.recording;
  });

  // При загрузке страницы — спросить состояние (жёсткая перезагрузка, п. 7.6)
  chrome.runtime
    .sendMessage({ type: 'qa:content-ready' })
    .then((resp) => {
      if (resp) recording = !!resp.recording;
    })
    .catch(() => {});
})();
