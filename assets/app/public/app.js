(() => {
  const FONT_SIZE_MIN = 10;
  const FONT_SIZE_MAX = 20;
  const DEFAULT_FONT_FAMILY = '.AppleSystemUIFont';
  const DEFAULT_FONT_SIZE = 14;

  const FONT_STACKS = {
    '.AppleSystemUIFont': '.AppleSystemUIFont, -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    'system-ui': 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    '-apple-system': '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    'SF Mono': '"SF Mono", Menlo, Monaco, monospace',
    'Menlo': 'Menlo, Monaco, monospace',
    'Monaco': 'Monaco, Menlo, monospace',
    'JetBrains Mono': '"JetBrains Mono", Menlo, monospace',
    'Fira Code': '"Fira Code", Menlo, monospace',
    'Source Code Pro': '"Source Code Pro", Menlo, monospace',
    'Cascadia Code': '"Cascadia Code", Menlo, monospace',
    'Courier New': '"Courier New", Courier, monospace',
    'PingFang SC': '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    'Hiragino Sans GB': '"Hiragino Sans GB", "PingFang SC", "Microsoft YaHei", sans-serif',
    'Microsoft YaHei': '"Microsoft YaHei", "PingFang SC", sans-serif',
    'monospace': 'monospace',
  };

  function clampFontSize(value) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return DEFAULT_FONT_SIZE;
    return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n));
  }

  const SIDEBAR_MIN = 200;
  const SIDEBAR_MAX = 640;
  function clampSidebarWidth(value) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return 300;
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n));
  }

  const state = {
    summary: null,
    files: [],
    filtered: [],
    selectedPath: null,
    fileDiff: null,
    mode: localStorage.getItem('cdv.mode') || 'split', // split | unified
    syncScroll: localStorage.getItem('cdv.syncScroll') !== '0',
    collapseUnchanged: localStorage.getItem('cdv.collapseUnchanged') !== '0',
    showLineNo: localStorage.getItem('cdv.showLineNo') !== '0',
    showPath: localStorage.getItem('cdv.showPath') !== '0',
    fontFamily: localStorage.getItem('cdv.fontFamily') || '.AppleSystemUIFont',
    fontSize: clampFontSize(localStorage.getItem('cdv.fontSize') || '14'),
    sidebarWidth: clampSidebarWidth(localStorage.getItem('cdv.sidebarWidth') || '300'),
    sessionId: localStorage.getItem('cdv.sessionId') || '',
    sessions: [],
    dayFilter: localStorage.getItem('cdv.dayFilter') || 'today', // 'today' | 'history'
    currentDiffIndex: -1,
    diffAnchors: [],
    syncingScroll: false,
    confirmResolver: null,
  };

  const el = {
    repoMeta: document.getElementById('repoMeta'),
    fileStats: document.getElementById('fileStats'),
    sessionSummaryCard: document.getElementById('sessionSummaryCard'),
    sessionSummaryText: document.getElementById('sessionSummaryText'),
    fileList: document.getElementById('fileList'),
    emptyFiles: document.getElementById('emptyFiles'),
    fileFilter: document.getElementById('fileFilter'),
    fileHeader: document.getElementById('fileHeader'),
    fileStatusBadge: document.getElementById('fileStatusBadge'),
    filePathLabel: document.getElementById('filePathLabel'),
    fileDiffStats: document.getElementById('fileDiffStats'),
    welcome: document.getElementById('welcome'),
    diffRoot: document.getElementById('diffRoot'),
    errorBox: document.getElementById('errorBox'),
    btnSplit: document.getElementById('btnSplit'),
    btnUnified: document.getElementById('btnUnified'),
    syncScroll: document.getElementById('syncScroll'),
    collapseUnchanged: document.getElementById('collapseUnchanged'),
    showLineNo: document.getElementById('showLineNo'),
    showPath: document.getElementById('showPath'),
    fontFamily: document.getElementById('fontFamily'),
    fontSize: document.getElementById('fontSize'),
    prevDiff: document.getElementById('prevDiff'),
    nextDiff: document.getElementById('nextDiff'),
    refreshBtn: document.getElementById('refreshBtn'),
    undoFileBtn: document.getElementById('undoFileBtn'),
    undoAllBtn: document.getElementById('undoAllBtn'),
    sessionSelect: document.getElementById('sessionSelect'),
    scanSessionsBtn: document.getElementById('scanSessionsBtn'),
    dayFilterSwitch: document.getElementById('dayFilterSwitch'),
    dayFilterToday: document.getElementById('dayFilterToday'),
    dayFilterHistory: document.getElementById('dayFilterHistory'),
    sidebar: document.getElementById('sidebar'),
    sidebarResizer: document.getElementById('sidebarResizer'),
    mainLayout: document.getElementById('mainLayout'),
    confirmModal: document.getElementById('confirmModal'),
    confirmTitle: document.getElementById('confirmTitle'),
    confirmMessage: document.getElementById('confirmMessage'),
    confirmCancel: document.getElementById('confirmCancel'),
    confirmOk: document.getElementById('confirmOk'),
  };

  function statusIcon(status) {
    if (status === 'added') return { cls: 'add', text: '＋', title: '新增' };
    if (status === 'deleted') return { cls: 'del', text: '－', title: '删除' };
    return { cls: 'mod', text: '～', title: '修改' };
  }

  function statusLabel(status) {
    const map = {
      added: '新增',
      deleted: '删除',
      modified: '修改',
      renamed: '重命名',
      copied: '复制',
    };
    return map[status] || status;
  }

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }


  function resolveHighlightLang(language) {
    const raw = String(language || 'plaintext').toLowerCase();
    if (!raw || raw === 'plaintext' || raw === 'text' || raw === 'plain') return null;
    if (typeof hljs === 'undefined' || !hljs) return null;
    const aliases = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      rb: 'ruby',
      rs: 'rust',
      yml: 'yaml',
      sh: 'bash',
      shell: 'bash',
      zsh: 'bash',
      kt: 'kotlin',
      cs: 'csharp',
      'c#': 'csharp',
      'c++': 'cpp',
      hpp: 'cpp',
      h: 'c',
      md: 'markdown',
      html: 'xml',
      htm: 'xml',
      vue: 'xml',
      svelte: 'xml',
      dockerfile: 'dockerfile',
      make: 'makefile',
      mk: 'makefile',
      ps1: 'powershell',
      tf: 'terraform',
      proto: 'protobuf',
      plaintext: null,
    };
    const lang = aliases[raw] !== undefined ? aliases[raw] : raw;
    if (!lang) return null;
    if (hljs.getLanguage && hljs.getLanguage(lang)) return lang;
    return null;
  }

  function highlightSourceToLineHtml(text, language) {
    const source = text == null ? '' : String(text);
    const plainLines = source.split('\n');
    const lang = resolveHighlightLang(language);
    if (!lang || typeof hljs === 'undefined') {
      return plainLines.map((line) => escapeHtml(line));
    }
    let highlighted = '';
    try {
      highlighted = hljs.highlight(source, { language: lang, ignoreIllegals: true }).value;
    } catch {
      try {
        highlighted = hljs.highlightAuto(source).value;
      } catch {
        return plainLines.map((line) => escapeHtml(line));
      }
    }
    return splitHighlightedHtmlLinesWithTags(highlighted, plainLines.length);
  }

  function splitHighlightedHtmlLinesWithTags(html, expectedCount) {
    const lines = [];
    let current = '';
    const openTags = [];
    const reopen = () => openTags.join('');
    const closeAll = () => openTags
      .slice()
      .reverse()
      .map((tag) => {
        const name = /^<([a-zA-Z0-9-]+)/.exec(tag)?.[1] || 'span';
        return `</${name}>`;
      })
      .join('');

    let i = 0;
    while (i < html.length) {
      if (html[i] === '<') {
        const gt = html.indexOf('>', i);
        if (gt === -1) {
          current += escapeHtml(html.slice(i));
          break;
        }
        const tag = html.slice(i, gt + 1);
        if (/^<!--/.test(tag)) {
          current += tag;
        } else if (/^<\//.test(tag)) {
          current += tag;
          openTags.pop();
        } else {
          current += tag;
          if (!/\/>$/.test(tag)) openTags.push(tag);
        }
        i = gt + 1;
        continue;
      }
      if (html[i] === '\n') {
        current += closeAll();
        lines.push(current);
        current = reopen();
        i += 1;
        continue;
      }
      current += html[i];
      i += 1;
    }
    current += closeAll();
    lines.push(current);

    while (lines.length < expectedCount) lines.push('');
    if (lines.length > expectedCount && expectedCount > 0) {
      const head = lines.slice(0, expectedCount - 1);
      const tail = lines.slice(expectedCount - 1).join('');
      return head.concat([tail]);
    }
    return lines;
  }

  function buildLineHighlightMaps(diff) {
    const language = diff.language || 'plaintext';
    const oldLines = highlightSourceToLineHtml(diff.oldText || '', language);
    const newLines = highlightSourceToLineHtml(diff.newText || '', language);
    const oldMap = new Map();
    const newMap = new Map();
    oldLines.forEach((html, idx) => oldMap.set(idx + 1, html));
    newLines.forEach((html, idx) => newMap.set(idx + 1, html));
    return { oldMap, newMap, language };
  }

  function codeHtmlFromMaps(maps, side, lineNo, fallbackText) {
    if (lineNo == null) return '';
    const map = side === 'old' ? maps.oldMap : maps.newMap;
    if (map.has(lineNo)) return map.get(lineNo);
    return escapeHtml(fallbackText ?? '');
  }

  function splitName(path) {
    const idx = path.lastIndexOf('/');
    if (idx < 0) return { dir: '', base: path };
    return { dir: path.slice(0, idx + 1), base: path.slice(idx + 1) };
  }

  function withSession(url) {
    if (!state.sessionId) return url;
    const join = url.includes('?') ? '&' : '?';
    return `${url}${join}session=${encodeURIComponent(state.sessionId)}`;
  }

  async function api(url, options = null) {
    const res = await fetch(withSession(url), options || undefined);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || res.statusText || '请求失败');
      err.code = data.code;
      throw err;
    }
    return data;
  }


  const customSelects = new Map();

  function closeAllCustomSelects(exceptId = null) {
    for (const [id, ctl] of customSelects.entries()) {
      if (exceptId && id === exceptId) continue;
      ctl.close();
    }
  }

  function initCustomSelect(selectEl) {
    if (!selectEl || !selectEl.id) return null;
    const box = document.querySelector(`[data-cselect="${selectEl.id}"]`);
    if (!box) return null;
    const trigger = box.querySelector('.cselect-trigger');
    const menu = box.querySelector('.cselect-menu');
    const valueEl = box.querySelector('.cselect-value');
    if (!trigger || !menu || !valueEl) return null;

    const ctl = {
      id: selectEl.id,
      select: selectEl,
      box,
      trigger,
      menu,
      valueEl,
      open: false,
      activeIndex: -1,
      rebuild() {
        const options = Array.from(selectEl.options || []);
        menu.innerHTML = '';
        options.forEach((opt, index) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'cselect-option';
          btn.setAttribute('role', 'option');
          btn.dataset.value = opt.value;
          btn.dataset.index = String(index);
          if (selectEl.id === 'sessionSelect') {
            const sessionObj = (state.sessions || []).find((x) => x.sessionId === opt.value) || {
              sessionId: opt.value,
              createdAt: opt.dataset.time,
              title: opt.dataset.project,
              changeSummary: opt.dataset.summaryFull,
              changedFileCount: Number.parseInt(String(opt.dataset.count || '').replace(/[^0-9]/g, ''), 10) || 0,
            };
            const label = buildSessionLabelHtml(sessionObj);
            btn.classList.add('cselect-option-session');
            btn.innerHTML = label.html;
            btn.title = opt.title || label.title;
          } else {
            btn.textContent = opt.textContent || opt.value;
            if (opt.title) btn.title = opt.title;
          }
          if (opt.disabled) {
            btn.disabled = true;
            btn.classList.add('is-disabled');
          }
          if (opt.selected || selectEl.value === opt.value) {
            btn.classList.add('is-selected');
            btn.setAttribute('aria-selected', 'true');
          } else {
            btn.setAttribute('aria-selected', 'false');
          }
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            ctl.setValue(opt.value, true);
            ctl.close();
          });
          menu.appendChild(btn);
        });
        ctl.syncLabel();
      },
      syncLabel() {
        const selected = selectEl.selectedOptions && selectEl.selectedOptions[0];
        if (!selected) {
          valueEl.textContent = '请选择';
          valueEl.title = '请选择';
        } else if (selectEl.id === 'sessionSelect') {
          const hit = (state.sessions || []).find((x) => x.sessionId === selected.value);
          const sessionObj = hit || {
            sessionId: selected.value,
            title: selected.dataset.project,
            changeSummary: selected.dataset.summaryFull,
            changedFileCount: Number.parseInt(String(selected.dataset.count || '').replace(/[^0-9]/g, ''), 10) || 0,
          };
          const label = buildSessionLabelHtml(sessionObj);
          valueEl.classList.add('cselect-value-session');
          valueEl.innerHTML = label.html;
          valueEl.title = selected.title || label.title;
        } else {
          valueEl.classList.remove('cselect-value-session');
          valueEl.textContent = selected.textContent || selected.value || '请选择';
          valueEl.title = selected.title || valueEl.textContent;
        }
        menu.querySelectorAll('.cselect-option').forEach((node) => {
          const selectedNow = node.dataset.value === selectEl.value;
          node.classList.toggle('is-selected', selectedNow);
          node.setAttribute('aria-selected', selectedNow ? 'true' : 'false');
        });
      },
      setValue(value, emitChange) {
        const prev = selectEl.value;
        if (String(prev) === String(value)) {
          ctl.syncLabel();
          return;
        }
        selectEl.value = value;
        // ensure option selected flags
        Array.from(selectEl.options).forEach((o) => {
          o.selected = o.value === value;
        });
        ctl.syncLabel();
        if (emitChange) {
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      },
      openMenu() {
        closeAllCustomSelects(selectEl.id);
        ctl.rebuild();
        ctl.open = true;
        box.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
        document.querySelector('.topbar')?.classList.add('is-dropdown-open');

        // Portal to body so second toolbar row cannot cover the menu.
        if (menu.parentElement !== document.body) {
          ctl._menuHome = menu.parentElement;
          ctl._menuNext = menu.nextSibling;
          document.body.appendChild(menu);
        }
        menu.classList.add('is-portaled');
        menu.hidden = false;

        // Always open downward from trigger, using fixed viewport coords (never flip upward).
        const place = () => {
          if (!ctl.open) return;
          const rect = trigger.getBoundingClientRect();
          const isSession = box.classList.contains('cselect-session');
          const maxW = isSession ? 900 : Math.max(rect.width, 280);
          const width = Math.min(maxW, Math.max(rect.width, isSession ? Math.min(rect.width, 900) : rect.width));
          let left = rect.left;
          if (left + width > window.innerWidth - 8) {
            left = Math.max(8, window.innerWidth - width - 8);
          }
          const top = rect.bottom + 6; // force below
          menu.style.position = 'fixed';
          menu.style.top = `${Math.max(0, top)}px`;
          menu.style.left = `${left}px`;
          menu.style.right = 'auto';
          menu.style.bottom = 'auto';
          menu.style.width = `${width}px`;
          menu.style.minWidth = `${width}px`;
          menu.style.maxWidth = `${Math.min(window.innerWidth - 16, isSession ? 900 : Math.max(width, 280))}px`;
          menu.style.zIndex = '20000';
          const available = Math.max(120, window.innerHeight - top - 12);
          menu.style.maxHeight = `${Math.min(360, available)}px`;
        };
        ctl._placeMenu = place;
        place();
        requestAnimationFrame(place);
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        const selectedIdx = Array.from(selectEl.options).findIndex((o) => o.value === selectEl.value);
        ctl.setActive(selectedIdx >= 0 ? selectedIdx : 0, true);
      },
      close() {
        ctl.open = false;
        box.classList.remove('open');
        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        menu.querySelectorAll('.cselect-option.is-active').forEach((n) => n.classList.remove('is-active'));
        ctl.activeIndex = -1;
        if (ctl._placeMenu) {
          window.removeEventListener('resize', ctl._placeMenu);
          window.removeEventListener('scroll', ctl._placeMenu, true);
          ctl._placeMenu = null;
        }
        menu.classList.remove('is-portaled');
        menu.style.position = '';
        menu.style.top = '';
        menu.style.left = '';
        menu.style.right = '';
        menu.style.bottom = '';
        menu.style.width = '';
        menu.style.minWidth = '';
        menu.style.maxWidth = '';
        menu.style.maxHeight = '';
        menu.style.zIndex = '';
        // restore menu node back into its cselect box
        if (ctl._menuHome) {
          if (ctl._menuNext && ctl._menuNext.parentElement === ctl._menuHome) {
            ctl._menuHome.insertBefore(menu, ctl._menuNext);
          } else {
            ctl._menuHome.appendChild(menu);
          }
          ctl._menuHome = null;
          ctl._menuNext = null;
        }
        // clear topbar elevated state if no open selects remain
        const anyOpen = Array.from(customSelects.values()).some((c) => c.open);
        if (!anyOpen) document.querySelector('.topbar')?.classList.remove('is-dropdown-open');
      },
      toggle() {
        if (ctl.open) ctl.close();
        else ctl.openMenu();
      },
      setActive(index, scroll) {
        const items = Array.from(menu.querySelectorAll('.cselect-option:not(:disabled)'));
        if (!items.length) return;
        const idx = Math.max(0, Math.min(items.length - 1, index));
        ctl.activeIndex = idx;
        items.forEach((n, i) => n.classList.toggle('is-active', i === idx));
        if (scroll) items[idx]?.scrollIntoView({ block: 'nearest' });
      },
    };

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      ctl.toggle();
    });
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!ctl.open) ctl.openMenu();
        else if (e.key === 'ArrowDown') ctl.setActive(ctl.activeIndex + 1, true);
      } else if (e.key === 'Escape') {
        ctl.close();
      }
    });
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        ctl.setActive(ctl.activeIndex + 1, true);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        ctl.setActive(ctl.activeIndex - 1, true);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const items = Array.from(menu.querySelectorAll('.cselect-option:not(:disabled)'));
        const item = items[ctl.activeIndex];
        if (item) {
          ctl.setValue(item.dataset.value, true);
          ctl.close();
        }
      } else if (e.key === 'Escape') {
        ctl.close();
        trigger.focus();
      }
    });

    // keep in sync if select options/value changed programmatically
    const mo = new MutationObserver(() => ctl.rebuild());
    mo.observe(selectEl, { childList: true, subtree: true, characterData: true, attributes: true });
    selectEl.addEventListener('change', () => ctl.syncLabel());

    ctl.rebuild();
    customSelects.set(selectEl.id, ctl);
    return ctl;
  }

  function initCustomSelects() {
    ['sessionSelect', 'fontFamily', 'fontSize'].forEach((id) => {
      const node = document.getElementById(id);
      if (node) initCustomSelect(node);
    });
    if (!window.__cdvCSelectDocBound) {
      document.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.closest && (t.closest('.cselect') || t.closest('.cselect-menu'))) return;
        closeAllCustomSelects();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllCustomSelects();
      });
      window.__cdvCSelectDocBound = true;
    }
  }

  function refreshCustomSelect(id) {
    const ctl = customSelects.get(id);
    if (ctl) ctl.rebuild();
  }

  function setError(message) {
    if (!message) {
      el.errorBox.classList.add('hidden');
      el.errorBox.textContent = '';
      return;
    }
    el.errorBox.textContent = message;
    el.errorBox.classList.remove('hidden');
  }

  function persistPrefs() {
    localStorage.setItem('cdv.mode', state.mode);
    localStorage.setItem('cdv.syncScroll', state.syncScroll ? '1' : '0');
    localStorage.setItem('cdv.collapseUnchanged', state.collapseUnchanged ? '1' : '0');
    localStorage.setItem('cdv.showLineNo', state.showLineNo ? '1' : '0');
    localStorage.setItem('cdv.showPath', state.showPath ? '1' : '0');
    localStorage.setItem('cdv.fontFamily', state.fontFamily);
    localStorage.setItem('cdv.fontSize', String(state.fontSize));
    localStorage.setItem('cdv.sidebarWidth', String(state.sidebarWidth));
    if (state.sessionId) localStorage.setItem('cdv.sessionId', state.sessionId);
    localStorage.setItem('cdv.dayFilter', state.dayFilter);
  }

  function applyTypography() {
    const family = FONT_STACKS[state.fontFamily] || FONT_STACKS[DEFAULT_FONT_FAMILY];
    const size = clampFontSize(state.fontSize);
    state.fontSize = size;
    const root = document.documentElement;
    root.style.setProperty('--diff-font-family', family);
    root.style.setProperty('--diff-font-size', `${size}px`);
    root.style.setProperty('--diff-line-height', `${Math.round(size * 1.45)}px`);
  }

  function applyToolbarState() {
    el.btnSplit.classList.toggle('active', state.mode === 'split');
    el.btnUnified.classList.toggle('active', state.mode === 'unified');
    el.syncScroll.checked = state.syncScroll;
    el.collapseUnchanged.checked = state.collapseUnchanged;
    el.showLineNo.checked = state.showLineNo;
    el.showPath.checked = state.showPath;
    el.syncScroll.disabled = state.mode !== 'split';

    if (el.fontFamily) {
      const exists = Array.from(el.fontFamily.options).some((o) => o.value === state.fontFamily);
      if (!exists) {
        const opt = document.createElement('option');
        opt.value = state.fontFamily;
        opt.textContent = state.fontFamily;
        el.fontFamily.appendChild(opt);
      }
      el.fontFamily.value = state.fontFamily;
    }
    if (el.fontSize) {
      el.fontSize.value = String(state.fontSize);
    }
    refreshCustomSelect('fontFamily');
    refreshCustomSelect('fontSize');
    refreshCustomSelect('sessionSelect');
    applyTypography();
    applySidebarWidth();
    updateUndoButtons();
  }

  function applySidebarWidth() {
    const w = clampSidebarWidth(state.sidebarWidth);
    state.sidebarWidth = w;
    document.documentElement.style.setProperty('--sidebar-width', `${w}px`);
  }

  function updateUndoButtons() {
    const hasFiles = (state.files || []).length > 0;
    const hasSelected = !!state.selectedPath;
    if (el.undoAllBtn) el.undoAllBtn.disabled = !hasFiles || !state.sessionId;
    if (el.undoFileBtn) el.undoFileBtn.disabled = !hasSelected || !state.sessionId;
  }

  function formatSessionTime(s) {
    const t = s.createdAt ? new Date(s.createdAt) : null;
    if (!t || Number.isNaN(t.getTime())) return s.sessionId || '';
    const p = (n) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
  }

  // 时间 / 项目名 / 文件数：完整展示
  // 概括说明：完整放入 DOM，仅中间列按真实剩余宽度 CSS 省略

  function deriveProjectName(workspaceRoot, fallback = '') {
    if (!workspaceRoot) return fallback || 'project';
    let p = String(workspaceRoot).replace(/\\/g, '/').replace(/\/+$/, '');
    // 去掉 /Users/<name> 或 /home/<name> 主目录前缀，保留 /javaProject/traceback/backend
    const homeMatch = p.match(/^\/(?:Users|home)\/[^/]+(\/.*)?$/);
    if (homeMatch) {
      const rest = homeMatch[1] || '';
      return rest || '/';
    }
    p = p.replace(/^[A-Za-z]:/, '');
    return p.startsWith('/') ? p : `/${p}`;
  }

  function getSessionLabelParts(s) {
    const time = formatSessionTime(s);
    // 项目名：去掉用户主目录前缀，保留路径形态（如 /javaProject/traceback/backend）
    const project = deriveProjectName(s.workspaceRoot, s.projectName);
    const summaryFull = (s.changeSummary || '').trim() || '暂无改动概括';
    const count = typeof s.changedFileCount === 'number'
      ? s.changedFileCount
      : (typeof s.fileCount === 'number' ? s.fileCount : 0);
    const countText = `${count} 个文件`;
    return { time, project, summaryFull, count, countText };
  }

  function formatSessionOption(s) {
    const parts = getSessionLabelParts(s);
    return `${parts.time} · ${parts.project} · ${parts.summaryFull} · ${parts.countText}`;
  }

  function buildSessionLabelHtml(s) {
    const parts = getSessionLabelParts(s);
    const full = `${parts.time} · ${parts.project} · ${parts.summaryFull} · ${parts.countText}`;
    // grid: auto auto auto auto minmax(0,1fr) auto auto
    //        time · project · summary · count
    const html = [
      '<span class="sess-label">',
      `<span class="sess-time">${escapeHtml(parts.time)}</span>`,
      '<span class="sess-sep">·</span>',
      `<span class="sess-project">${escapeHtml(parts.project)}</span>`,
      '<span class="sess-sep">·</span>',
      `<span class="sess-summary" title="${escapeHtml(parts.summaryFull)}">${escapeHtml(parts.summaryFull)}</span>`,
      '<span class="sess-sep">·</span>',
      `<span class="sess-count">${escapeHtml(parts.countText)}</span>`,
      '</span>',
    ].join('');
    return { html, title: full, text: full, parts };
  }

  async function focusSession(sessionId, { selectFirstFile = true } = {}) {
    if (!sessionId) return;
    const next = String(sessionId);
    await loadSessions(next);
    if (!state.sessions.some((s) => s.sessionId === next)) {
      // 列表尚未出现时仍尝试加载 summary
      state.sessionId = next;
    } else {
      state.sessionId = next;
    }
    if (el.sessionSelect) {
      el.sessionSelect.value = state.sessionId;
      refreshCustomSelect('sessionSelect');
    }
    persistPrefs();
    state.selectedPath = null;
    state.fileDiff = null;
    await loadSummary();
    if (selectFirstFile && state.files.length) {
      await selectFile(state.files[0].path, true);
    } else {
      showWelcome();
    }
    try { window.focus(); } catch {}
  }

  function connectLiveChannel() {
    if (state.liveSource || typeof EventSource === 'undefined') return;
    try {
      const es = new EventSource('/api/events');
      state.liveSource = es;
      es.addEventListener('hello', () => {
        // connected
      });
      es.addEventListener('focus', (ev) => {
        try {
          const data = JSON.parse(ev.data || '{}');
          if (!data.sessionId) return;
          if (data.sessionId === state.sessionId) {
            // 同一会话：刷新列表与内容
            loadSessions(data.sessionId)
              .then(() => loadSummary())
              .then(async () => {
                if (state.selectedPath) await selectFile(state.selectedPath, true);
                else if (state.files.length) await selectFile(state.files[0].path, true);
              })
              .catch((e) => setError(e.message));
            return;
          }
          focusSession(data.sessionId).catch((e) => setError(e.message));
        } catch (e) {
          setError(e.message || String(e));
        }
      });
      es.onerror = () => {
        // 浏览器会自动重连；服务重启时也无需额外处理
      };
    } catch {
      // ignore
    }
  }

  function isTodaySession(s) {
    if (!s.createdAt) return false;
    const t = new Date(s.createdAt);
    if (Number.isNaN(t.getTime())) return false;
    const now = new Date();
    return t.getFullYear() === now.getFullYear()
      && t.getMonth() === now.getMonth()
      && t.getDate() === now.getDate();
  }

  function applyDayFilterUI() {
    if (el.dayFilterToday) el.dayFilterToday.classList.toggle('active', state.dayFilter === 'today');
    if (el.dayFilterHistory) el.dayFilterHistory.classList.toggle('active', state.dayFilter === 'history');
  }

  async function loadSessions(preferSessionId = '') {
    // sessions list endpoint should not require session query to fail
    const res = await fetch('/api/sessions');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '加载会话失败');
    state.sessions = data.sessions || [];

    // 按 dayFilter 过滤展示，今日模式下若无数据自动降级显示全部
    let visibleSessions = state.sessions;
    if (state.dayFilter === 'today') {
      const todaySessions = state.sessions.filter(isTodaySession);
      visibleSessions = todaySessions.length > 0 ? todaySessions : state.sessions;
    }

    const select = el.sessionSelect;
    if (!select) return data;
    select.innerHTML = '';
    if (!visibleSessions.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '暂无历史会话';
      select.appendChild(opt);
      state.sessionId = '';
      applyDayFilterUI();
      return data;
    }
    for (const s of visibleSessions) {
      const opt = document.createElement('option');
      opt.value = s.sessionId;
      const label = buildSessionLabelHtml(s);
      // native option 文本：概括已单独截断，其它字段完整
      opt.textContent = label.text;
      opt.dataset.summaryFull = s.changeSummary || '';
      opt.dataset.project = deriveProjectName(s.workspaceRoot, s.projectName);
      opt.dataset.time = label.parts.time;
      opt.dataset.count = label.parts.countText;
      opt.title = [
        label.title,
        s.sessionId,
        s.workspaceRoot || '',
      ].filter(Boolean).join('\n');
      select.appendChild(opt);
    }
    const preferred = preferSessionId || state.sessionId || data.current || visibleSessions[0].sessionId;
    const exists = visibleSessions.some((s) => s.sessionId === preferred);
    state.sessionId = exists ? preferred : visibleSessions[0].sessionId;
    select.value = state.sessionId;
    persistPrefs();
    applyDayFilterUI();
    refreshCustomSelect('sessionSelect');
    return data;
  }

  function openConfirm({ title, message }) {
    return new Promise((resolve) => {
      state.confirmResolver = resolve;
      if (el.confirmTitle) el.confirmTitle.textContent = title || '确认';
      if (el.confirmMessage) el.confirmMessage.textContent = message || '';
      if (el.confirmModal) {
        el.confirmModal.classList.remove('hidden');
        el.confirmModal.setAttribute('aria-hidden', 'false');
      }
      el.confirmOk?.focus();
    });
  }

  function closeConfirm(result) {
    if (el.confirmModal) {
      el.confirmModal.classList.add('hidden');
      el.confirmModal.setAttribute('aria-hidden', 'true');
    }
    const resolver = state.confirmResolver;
    state.confirmResolver = null;
    if (resolver) resolver(!!result);
  }

  async function revertChanges({ all = false } = {}) {
    if (!state.sessionId) {
      setError('没有可撤销的会话');
      return;
    }
    if (all) {
      const ok = await openConfirm({
        title: '确认撤销全部修改',
        message: [
          '将把本会话（' + state.sessionId + '）中所有已跟踪文件回滚到“编码前”基线。',
          '新增文件会被删除，修改/删除文件会恢复基线内容。此操作不可撤销。',
        ].join('\n'),
      });
      if (!ok) return;
      setError('');
      const result = await api('/api/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      await loadSummary();
      if (result.errors && result.errors.length) {
        setError('部分文件回滚失败：' + result.errors.map((e) => e.path + ': ' + e.error).join('；'));
      }
      return;
    }

    if (!state.selectedPath) {
      setError('请先选择要撤销的文件');
      return;
    }
    const ok = await openConfirm({
      title: '确认撤销当前文件',
      message: [
        '将文件回滚到编码前：',
        state.selectedPath,
        '',
        '若该文件是本次新增，将被删除；否则恢复为基线内容。此操作不可撤销。',
      ].join('\n'),
    });
    if (!ok) return;
    setError('');
    const result = await api('/api/revert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.selectedPath }),
    });
    const prev = state.selectedPath;
    await loadSummary();
    if (!state.files.find((f) => f.path === prev)) {
      state.selectedPath = null;
      state.fileDiff = null;
      if (state.files.length) await selectFile(state.files[0].path, true);
      else showWelcome();
    }
    if (result.errors && result.errors.length) {
      setError('回滚失败：' + result.errors.map((e) => e.path + ': ' + e.error).join('；'));
    }
  }


  function bindSidebarResize() {
    const handle = el.sidebarResizer;
    if (!handle) return;
    let dragging = false;
    let startX = 0;
    let startW = 0;

    const onMove = (e) => {
      if (!dragging) return;
      if (e.cancelable) e.preventDefault();
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      state.sidebarWidth = clampSidebarWidth(startW + (x - startX));
      applySidebarWidth();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('is-resizing-sidebar');
      persistPrefs();
      updateDiffConnectors();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
    const onDown = (e) => {
      dragging = true;
      startX = e.touches ? e.touches[0].clientX : e.clientX;
      startW = clampSidebarWidth(state.sidebarWidth);
      document.body.classList.add('is-resizing-sidebar');
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onUp);
      e.preventDefault();
    };
    handle.addEventListener('mousedown', onDown);
    handle.addEventListener('touchstart', onDown, { passive: false });
  }

  function renderFileList() {
    const q = (el.fileFilter.value || '').trim().toLowerCase();
    state.filtered = state.files.filter((f) => {
      if (!q) return true;
      return f.path.toLowerCase().includes(q) || (f.oldPath || '').toLowerCase().includes(q);
    });

    el.fileList.innerHTML = '';
    if (!state.filtered.length) {
      el.emptyFiles.classList.toggle('hidden', state.files.length > 0 && !q);
      if (state.files.length && q) {
        el.emptyFiles.textContent = '没有匹配的文件';
        el.emptyFiles.classList.remove('hidden');
      } else if (!state.files.length) {
        el.emptyFiles.textContent = '当前没有未提交的改动';
        el.emptyFiles.classList.remove('hidden');
      }
      return;
    }

    el.emptyFiles.classList.add('hidden');
    const frag = document.createDocumentFragment();
    for (const file of state.filtered) {
      const li = document.createElement('li');
      li.className = 'file-item' + (file.path === state.selectedPath ? ' active' : '');
      li.dataset.path = file.path;

      const icon = statusIcon(file.status);
      const { dir, base } = splitName(file.path);
      const nameHtml = state.showPath
        ? `<span class="dir">${escapeHtml(dir)}</span>${escapeHtml(base)}`
        : escapeHtml(base);

      const counts = file.binary
        ? '<span class="counts muted">binary</span>'
        : `<span class="counts"><span class="a">+${file.additions || 0}</span> <span class="d">-${file.deletions || 0}</span></span>`;

      li.innerHTML = `
        <span class="icon ${icon.cls}" title="${icon.title}">${icon.text}</span>
        <span class="name" title="${escapeHtml(file.path)}">${nameHtml}</span>
        ${counts}
      `;
      li.addEventListener('click', () => selectFile(file.path));
      frag.appendChild(li);
    }
    el.fileList.appendChild(frag);
  }



  function renderSessionSummary(summary) {
    if (!el.sessionSummaryText) return;
    if (!summary) {
      el.sessionSummaryText.textContent = '暂无改动概括';
      return;
    }
    const text = (summary.changeSummary || '').trim() || '暂无改动概括';
    el.sessionSummaryText.textContent = text;
  }

  async function loadSummary() {
    setError('');
    const summary = await api('/api/summary');
    state.summary = summary;
    state.files = summary.files || [];
    if (summary.sessionId) {
      state.sessionId = summary.sessionId;
      if (el.sessionSelect && el.sessionSelect.value !== state.sessionId) {
        const has = Array.from(el.sessionSelect.options).some((o) => o.value === state.sessionId);
        if (has) el.sessionSelect.value = state.sessionId;
      }
      persistPrefs();
    }
    if (summary.mode === 'session') {
      el.repoMeta.textContent = `会话 ${summary.sessionId} · ${summary.workspaceRoot || summary.repoRoot}`;
    } else {
      el.repoMeta.textContent = `${summary.branch} @ ${summary.head} · ${summary.repoRoot}`;
    }
    el.fileStats.textContent = `${summary.total} 文件 · +${summary.added} ~${summary.modified} -${summary.deleted}`;
    renderSessionSummary(summary);
    renderFileList();
    updateUndoButtons();

    if (state.selectedPath) {
      const still = state.files.find((f) => f.path === state.selectedPath);
      if (still) {
        await selectFile(state.selectedPath, true);
      } else {
        state.selectedPath = null;
        state.fileDiff = null;
        showWelcome();
      }
    }
  }

  function showWelcome() {
    el.welcome.classList.remove('hidden');
    el.diffRoot.classList.add('hidden');
    el.fileHeader.classList.add('hidden');
    state.diffAnchors = [];
    state.currentDiffIndex = -1;
    updateNavButtons();
  }

  async function selectFile(path, force = false) {
    if (!force && state.selectedPath === path && state.fileDiff) {
      return;
    }
    state.selectedPath = path;
    renderFileList();
    updateUndoButtons();
    setError('');
    el.welcome.classList.add('hidden');
    el.diffRoot.classList.remove('hidden');
    el.diffRoot.innerHTML = '<div class="no-diff-note">加载中…</div>';

    try {
      const diff = await api(`/api/file?path=${encodeURIComponent(path)}`);
      state.fileDiff = diff;
      renderFileHeader(diff);
      renderDiff();
    } catch (error) {
      el.diffRoot.innerHTML = '';
      setError(error.message);
    }
  }

  function renderFileHeader(diff) {
    el.fileHeader.classList.remove('hidden');
    el.fileStatusBadge.textContent = statusLabel(diff.status);
    el.fileStatusBadge.className = `status-badge ${diff.status}`;
    const pathText =
      diff.status === 'renamed' && diff.oldPath && diff.oldPath !== diff.path
        ? `${diff.oldPath} → ${diff.path}`
        : diff.path;
    el.filePathLabel.textContent = pathText;
    el.filePathLabel.classList.toggle('hidden', !state.showPath);
    if (diff.binary) {
      el.fileDiffStats.innerHTML = '二进制文件';
    } else {
      const lang = diff.language && diff.language !== 'plaintext' ? `<span class="lang-badge">${escapeHtml(diff.language)}</span>` : '';
      el.fileDiffStats.innerHTML = `${lang}<span class="a">+${diff.stats?.additions || 0}</span> <span class="d">-${diff.stats?.deletions || 0}</span>`;
    }
  }


  function isChangeType(type) {
    return type === 'add' || type === 'del' || type === 'mod';
  }

  /** Assign contiguous change rows into block ids (1-based). Non-change => null. */

  function blockEdgeClass(blockIds, index) {
    const id = blockIds[index];
    if (!id) return '';
    const prev = index > 0 ? blockIds[index - 1] : null;
    const next = index < blockIds.length - 1 ? blockIds[index + 1] : null;
    const isStart = prev !== id;
    const isEnd = next !== id;
    if (isStart && isEnd) return ' block-single';
    if (isStart) return ' block-start';
    if (isEnd) return ' block-end';
    return ' block-mid';
  }

  function blockTypeClass(type) {
    if (type === 'add') return ' block-type-add';
    if (type === 'del') return ' block-type-del';
    if (type === 'mod') return ' block-type-mod';
    return '';
  }

  function assignDiffBlockIds(rows, getType) {
    const ids = new Array(rows.length).fill(null);
    let blockId = 0;
    let inBlock = false;
    for (let i = 0; i < rows.length; i += 1) {
      const changed = isChangeType(getType(rows[i]));
      if (changed) {
        if (!inBlock) {
          blockId += 1;
          inBlock = true;
        }
        ids[i] = blockId;
      } else {
        inBlock = false;
      }
    }
    return ids;
  }


  function collapseRows(rows, getType) {
    if (!state.collapseUnchanged) {
      return rows.map((row) => ({ kind: 'row', row }));
    }

    const CONTEXT = 3;
    const changeIdx = [];
    rows.forEach((row, i) => {
      if (isChangeType(getType(row))) changeIdx.push(i);
    });

    if (!changeIdx.length) {
      // pure context / empty
      if (rows.length <= CONTEXT * 2) {
        return rows.map((row) => ({ kind: 'row', row }));
      }
      return [
        ...rows.slice(0, CONTEXT).map((row) => ({ kind: 'row', row })),
        {
          kind: 'hunk',
          hidden: rows.length - CONTEXT * 2,
          from: CONTEXT,
          to: rows.length - CONTEXT,
        },
        ...rows.slice(rows.length - CONTEXT).map((row) => ({ kind: 'row', row })),
      ];
    }

    const keep = new Array(rows.length).fill(false);
    for (const idx of changeIdx) {
      for (let i = Math.max(0, idx - CONTEXT); i <= Math.min(rows.length - 1, idx + CONTEXT); i += 1) {
        keep[i] = true;
      }
    }

    const out = [];
    let i = 0;
    while (i < rows.length) {
      if (keep[i]) {
        out.push({ kind: 'row', row: rows[i] });
        i += 1;
      } else {
        const start = i;
        while (i < rows.length && !keep[i]) i += 1;
        out.push({ kind: 'hunk', hidden: i - start, from: start, to: i });
      }
    }
    return out;
  }

  function renderDiff() {
    const diff = state.fileDiff;
    if (!diff) return;

    if (diff.binary) {
      el.diffRoot.innerHTML = '<div class="binary-note">该文件为二进制文件，无法展示文本 Diff。</div>';
      state.diffAnchors = [];
      state.currentDiffIndex = -1;
      updateNavButtons();
      return;
    }

    if (state.mode === 'split') {
      renderSplit(diff);
    } else {
      renderUnified(diff);
    }
    collectAnchors();
    updateNavButtons();
  }

  function lineNo(n) {
    return n == null ? '' : String(n);
  }

  function renderUnified(diff) {
    const blocks = collapseRows(diff.unified || [], (r) => r.type);
    const hideLn = !state.showLineNo;
    const highlightMaps = buildLineHighlightMaps(diff);

    let body = '';
    let expanded = new Set();

    function paint() {
      body = '';
      let rowCursor = 0;
      const unifiedBlockIds = assignDiffBlockIds(diff.unified || [], (r) => r.type);
      const indexedSequence = [];
      for (const block of blocks) {
        if (block.kind === 'hunk') {
          const key = `${block.from}-${block.to}`;
          if (expanded.has(key)) {
            for (let i = block.from; i < block.to; i += 1) indexedSequence.push({ kind: 'row', row: diff.unified[i], index: i });
          } else {
            indexedSequence.push(block);
          }
        } else {
          // block.row is one of unified rows; locate first unused matching reference by progressive scan
          // safer: collapseRows preserves order, recover index by sequential pointer
          indexedSequence.push({ kind: 'row', row: block.row, index: -1 });
        }
      }
      // Fill indexes for non-hunk rows by sequential scan through unified
      {
        let p = 0;
        for (const item of indexedSequence) {
          if (item.kind !== 'row' || item.index >= 0) continue;
          while (p < (diff.unified || []).length && diff.unified[p] !== item.row) p += 1;
          if (p < (diff.unified || []).length) {
            item.index = p;
            p += 1;
          }
        }
      }

      for (const block of indexedSequence) {
        if (block.kind === 'hunk') {
          body += `
            <tr class="row-hunk" data-hunk="${block.from}-${block.to}">
              <td class="ln"></td>
              <td class="ln"></td>
              <td class="gutter">⋮</td>
              <td class="code">⋯ 收起了 ${block.hidden} 行未更改内容，点击展开</td>
            </tr>`;
          continue;
        }
        const row = block.row;
        const type = row.type;
        const gutter = type === 'add' ? '+' : type === 'del' ? '−' : ' ';
        const cls = type === 'add' ? 'row-add' : type === 'del' ? 'row-del' : 'row-ctx';
        const blockId = block.index >= 0 ? unifiedBlockIds[block.index] : null;
        const edge = blockId != null ? blockEdgeClass(unifiedBlockIds, block.index) : '';
        const typeBlock = blockId ? blockTypeClass(type === 'add' || type === 'del' ? type : 'mod') : '';
        const anchor = blockId ? ' row-diff-anchor row-diff-block' + edge + typeBlock : '';
        const blockAttr = blockId ? ` data-diff-block="${blockId}"` : '';
        body += `
          <tr class="${cls}${anchor}" data-diff-type="${type}"${blockAttr}>
            <td class="ln">${escapeHtml(lineNo(row.oldLine))}</td>
            <td class="ln">${escapeHtml(lineNo(row.newLine))}</td>
            <td class="gutter">${gutter}</td>
            <td class="code">${
              type === 'del'
                ? codeHtmlFromMaps(highlightMaps, 'old', row.oldLine, row.text)
                : codeHtmlFromMaps(highlightMaps, 'new', row.newLine, row.text)
            }</td>
          </tr>`;
        rowCursor += 1;
      }

      el.diffRoot.innerHTML = `
        <div class="diff-pane-labels unified">
          <div class="pane-label"><strong>本次会话统一 Diff</strong>${escapeHtml(diff.path)}</div>
        </div>
        <div class="diff-scroll-host">
          <div class="diff-scroll" id="diffScrollMain">
            <table class="diff-table ${hideLn ? 'hide-ln' : ''}">
              <tbody>${body}</tbody>
            </table>
          </div>
        </div>
      `;

      el.diffRoot.querySelectorAll('[data-hunk]').forEach((node) => {
        node.addEventListener('click', () => {
          expanded.add(node.getAttribute('data-hunk'));
          paint();
          collectAnchors();
          updateNavButtons();
        });
      });
    }

    paint();
  }

  function renderSplit(diff) {
    const rows = diff.sideBySide || [];
    const blocks = collapseRows(rows, (r) => r.type);
    const hideLn = !state.showLineNo;
    const highlightMaps = buildLineHighlightMaps(diff);
    const expanded = new Set();

    function paint() {
      let leftBody = '';
      let rightBody = '';

      const splitBlockIds = assignDiffBlockIds(rows, (r) => r.type);
      const indexedSequence = [];
      for (const block of blocks) {
        if (block.kind === 'hunk') {
          const key = `${block.from}-${block.to}`;
          if (expanded.has(key)) {
            for (let i = block.from; i < block.to; i += 1) indexedSequence.push({ kind: 'row', row: rows[i], index: i });
          } else {
            indexedSequence.push(block);
          }
        } else {
          indexedSequence.push({ kind: 'row', row: block.row, index: -1 });
        }
      }
      {
        let p = 0;
        for (const item of indexedSequence) {
          if (item.kind !== 'row' || item.index >= 0) continue;
          while (p < rows.length && rows[p] !== item.row) p += 1;
          if (p < rows.length) {
            item.index = p;
            p += 1;
          }
        }
      }

      for (const block of indexedSequence) {
        if (block.kind === 'hunk') {
          const hunkRow = `
            <tr class="row-hunk" data-hunk="${block.from}-${block.to}">
              <td class="ln"></td>
              <td class="gutter">⋮</td>
              <td class="code">⋯ 收起了 ${block.hidden} 行未更改内容，点击展开</td>
            </tr>`;
          leftBody += hunkRow;
          rightBody += hunkRow;
          continue;
        }

        const row = block.row;
        const leftType = row.left?.type || 'empty';
        const rightType = row.right?.type || 'empty';
        const leftCls =
          leftType === 'del' ? 'row-del' : leftType === 'add' ? 'row-add' : leftType === 'empty' ? 'row-empty' : row.type === 'mod' ? 'row-mod' : 'row-ctx';
        const rightCls =
          rightType === 'add' ? 'row-add' : rightType === 'del' ? 'row-del' : rightType === 'empty' ? 'row-empty' : row.type === 'mod' ? 'row-mod' : 'row-ctx';
        const blockId = block.index >= 0 ? splitBlockIds[block.index] : null;
        const edge = blockId != null ? blockEdgeClass(splitBlockIds, block.index) : '';
        const typeBlock = blockId ? blockTypeClass(row.type) : '';
        const anchor = blockId ? ' row-diff-anchor row-diff-block' + edge + typeBlock : '';
        const blockAttr = blockId ? ` data-diff-block="${blockId}"` : '';
        const leftGutter = leftType === 'del' ? '−' : leftType === 'add' ? '+' : row.type === 'mod' ? '~' : ' ';
        const rightGutter = rightType === 'add' ? '+' : rightType === 'del' ? '−' : row.type === 'mod' ? '~' : ' ';

        leftBody += `
          <tr class="${leftCls}${anchor}" data-diff-type="${row.type}"${blockAttr}>
            <td class="ln">${escapeHtml(lineNo(row.left?.line))}</td>
            <td class="gutter">${leftGutter}</td>
            <td class="code">${codeHtmlFromMaps(highlightMaps, 'old', row.left?.line, row.left?.text ?? '')}</td>
          </tr>`;
        rightBody += `
          <tr class="${rightCls}${anchor}" data-diff-type="${row.type}"${blockAttr}>
            <td class="ln">${escapeHtml(lineNo(row.right?.line))}</td>
            <td class="gutter">${rightGutter}</td>
            <td class="code">${codeHtmlFromMaps(highlightMaps, 'new', row.right?.line, row.right?.text ?? '')}</td>
          </tr>`;
      }

      el.diffRoot.innerHTML = `
        <div class="diff-pane-labels split-labels">
          <div class="pane-label"><strong>编码前</strong>${escapeHtml(diff.oldPath || diff.path)}</div>
          <div class="pane-label pane-label-gap" aria-hidden="true"></div>
          <div class="pane-label"><strong>本次后</strong>${escapeHtml(diff.path)}</div>
        </div>
        <div class="diff-scroll-host split" id="diffScrollHost">
          <div class="diff-scroll" id="diffScrollLeft">
            <table class="diff-table ${hideLn ? 'hide-ln' : ''}"><tbody>${leftBody}</tbody></table>
          </div>
          <div class="diff-connector-rail" id="diffConnectorRail" aria-hidden="true">
            <svg class="diff-connectors" id="diffConnectors"></svg>
          </div>
          <div class="diff-scroll" id="diffScrollRight">
            <table class="diff-table ${hideLn ? 'hide-ln' : ''}"><tbody>${rightBody}</tbody></table>
          </div>
        </div>
      `;

      const left = document.getElementById('diffScrollLeft');
      const right = document.getElementById('diffScrollRight');
      bindSyncScroll(left, right);
      bindConnectorUpdates(left, right);
      requestAnimationFrame(() => updateDiffConnectors());

      el.diffRoot.querySelectorAll('[data-hunk]').forEach((node) => {
        node.addEventListener('click', () => {
          expanded.add(node.getAttribute('data-hunk'));
          paint();
          collectAnchors();
          updateNavButtons();
        });
      });
    }

    paint();
  }

  function bindSyncScroll(left, right) {
    if (!left || !right) return;
    const onScroll = (source, target) => {
      if (!state.syncScroll || state.mode !== 'split') return;
      if (state.syncingScroll) return;
      state.syncingScroll = true;
      target.scrollTop = source.scrollTop;
      target.scrollLeft = source.scrollLeft;
      requestAnimationFrame(() => {
        state.syncingScroll = false;
        updateDiffConnectors();
      });
    };
    left.addEventListener('scroll', () => {
      onScroll(left, right);
      if (!(state.syncScroll && state.mode === 'split')) updateDiffConnectors();
    }, { passive: true });
    right.addEventListener('scroll', () => {
      onScroll(right, left);
      if (!(state.syncScroll && state.mode === 'split')) updateDiffConnectors();
    }, { passive: true });
  }

  function bindConnectorUpdates(left, right) {
    if (state._connectorResizeObs) {
      try { state._connectorResizeObs.disconnect(); } catch {}
      state._connectorResizeObs = null;
    }
    const host = document.getElementById('diffScrollHost');
    if (!host) return;
    const ro = new ResizeObserver(() => updateDiffConnectors());
    ro.observe(host);
    if (left) ro.observe(left);
    if (right) ro.observe(right);
    state._connectorResizeObs = ro;
    if (!state._connectorWindowBound) {
      window.addEventListener('resize', () => updateDiffConnectors());
      state._connectorWindowBound = true;
    }
  }

  function updateDiffConnectors() {
    const host = document.getElementById('diffScrollHost');
    const svg = document.getElementById('diffConnectors');
    const left = document.getElementById('diffScrollLeft');
    const right = document.getElementById('diffScrollRight');
    if (!host || !svg || !left || !right || state.mode !== 'split') return;

    const hostRect = host.getBoundingClientRect();
    const rail = document.getElementById('diffConnectorRail');
    const railRect = rail ? rail.getBoundingClientRect() : hostRect;
    // Coordinates are relative to host; keep host-sized viewBox so x from rail still maps.
    // But SVG itself sits in the rail: use rail local coords for simpler rendering.
    const width = Math.max(0, rail ? rail.clientWidth : host.clientWidth);
    const height = Math.max(0, host.clientHeight);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const leftRows = Array.from(left.querySelectorAll('tr.row-diff-block[data-diff-block]'));
    const ids = [];
    const seen = new Set();
    for (const row of leftRows) {
      const id = row.getAttribute('data-diff-block');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }

    const currentId =
      state.currentDiffIndex >= 0 && state.diffAnchors[state.currentDiffIndex]
        ? String(state.diffAnchors[state.currentDiffIndex].id)
        : null;

    const parts = [];
    for (const id of ids) {
      const lRows = Array.from(left.querySelectorAll(`tr.row-diff-block[data-diff-block="${id}"]`));
      const rRows = Array.from(right.querySelectorAll(`tr.row-diff-block[data-diff-block="${id}"]`));
      if (!lRows.length || !rRows.length) continue;

      const lFirst = lRows[0].getBoundingClientRect();
      const lLast = lRows[lRows.length - 1].getBoundingClientRect();
      const rFirst = rRows[0].getBoundingClientRect();
      const rLast = rRows[rRows.length - 1].getBoundingClientRect();

      // Skip fully out-of-view bands for cleaner SVG
      const bandTop = Math.min(lFirst.top, rFirst.top);
      const bandBottom = Math.max(lLast.bottom, rLast.bottom);
      if (bandBottom < hostRect.top - 40 || bandTop > hostRect.bottom + 40) continue;

      // Rail-local coordinates: full middle gutter width.
      const pad = 3;
      const x1 = pad;
      const x2 = Math.max(pad + 8, width - pad);
      const y1t = lFirst.top - railRect.top;
      const y1b = lLast.bottom - railRect.top;
      const y2t = rFirst.top - railRect.top;
      const y2b = rLast.bottom - railRect.top;
      const span = Math.max(24, x2 - x1);
      // Stronger S-curve control points so the band reads clearly.
      const c1 = x1 + span * 0.45;
      const c2 = x2 - span * 0.45;

      // Infer connector color class from left block type classes
      let kind = 'mod';
      if (lRows[0].classList.contains('block-type-add') || lRows[0].classList.contains('row-add')) kind = 'add';
      if (lRows[0].classList.contains('block-type-del') || lRows[0].classList.contains('row-del')) kind = 'del';
      if (lRows[0].classList.contains('block-type-mod') || lRows[0].classList.contains('row-mod')) kind = 'mod';
      // mixed split: prefer mod if both sides differ significantly
      const hasDel = lRows.some((r) => r.classList.contains('row-del') || r.classList.contains('row-mod'));
      const hasAdd = rRows.some((r) => r.classList.contains('row-add') || r.classList.contains('row-mod'));
      if (hasDel && hasAdd) kind = 'mod';
      else if (hasAdd && !hasDel) kind = 'add';
      else if (hasDel && !hasAdd) kind = 'del';

      const active = currentId === String(id) ? ' is-active' : '';
      const d = [
        `M ${x1.toFixed(1)} ${y1t.toFixed(1)}`,
        `C ${c1.toFixed(1)} ${y1t.toFixed(1)}, ${c2.toFixed(1)} ${y2t.toFixed(1)}, ${x2.toFixed(1)} ${y2t.toFixed(1)}`,
        `L ${x2.toFixed(1)} ${y2b.toFixed(1)}`,
        `C ${c2.toFixed(1)} ${y2b.toFixed(1)}, ${c1.toFixed(1)} ${y1b.toFixed(1)}, ${x1.toFixed(1)} ${y1b.toFixed(1)}`,
        'Z',
      ].join(' ');
      // fill band + explicit top/bottom edge strokes for higher contrast
      const topEdge = [
        `M ${x1.toFixed(1)} ${y1t.toFixed(1)}`,
        `C ${c1.toFixed(1)} ${y1t.toFixed(1)}, ${c2.toFixed(1)} ${y2t.toFixed(1)}, ${x2.toFixed(1)} ${y2t.toFixed(1)}`,
      ].join(' ');
      const bottomEdge = [
        `M ${x1.toFixed(1)} ${y1b.toFixed(1)}`,
        `C ${c1.toFixed(1)} ${y1b.toFixed(1)}, ${c2.toFixed(1)} ${y2b.toFixed(1)}, ${x2.toFixed(1)} ${y2b.toFixed(1)}`,
      ].join(' ');
      parts.push(
        `<path class="diff-connector kind-${kind}${active}" data-diff-block="${id}" d="${d}"></path>` +
        `<path class="diff-connector-edge kind-${kind}${active}" data-diff-block="${id}" d="${topEdge}"></path>` +
        `<path class="diff-connector-edge kind-${kind}${active}" data-diff-block="${id}" d="${bottomEdge}"></path>`
      );
    }
    svg.innerHTML = parts.join('');
  }

  function getDiffRootPane() {
    if (state.mode === 'split') return document.getElementById('diffScrollLeft') || el.diffRoot;
    return document.getElementById('diffScrollMain') || el.diffRoot;
  }

  function collectAnchors() {
    // Navigate by contiguous change BLOCKS, not individual lines.
    const root = getDiffRootPane();
    const rows = Array.from(root.querySelectorAll('tr.row-diff-block[data-diff-block]'));
    const blocks = [];
    const seen = new Set();
    for (const row of rows) {
      const id = row.getAttribute('data-diff-block');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      blocks.push({
        id,
        start: row,
        rows: Array.from(root.querySelectorAll(`tr.row-diff-block[data-diff-block="${id}"]`)),
      });
    }
    state.diffAnchors = blocks;
    state.currentDiffIndex = blocks.length ? 0 : -1;
    highlightCurrentAnchor(false);
  }

  function clearBlockHighlight() {
    el.diffRoot.querySelectorAll('tr.row-diff-block.current, tr.row-diff-block.current-block').forEach((node) => {
      node.classList.remove('current', 'current-block');
    });
  }

  function highlightCurrentAnchor(scroll) {
    clearBlockHighlight();
    if (state.currentDiffIndex < 0 || !state.diffAnchors[state.currentDiffIndex]) {
      updateDiffConnectors();
      return;
    }
    const block = state.diffAnchors[state.currentDiffIndex];
    const blockId = block.id;

    if (state.mode === 'split') {
      const leftRows = Array.from(document.querySelectorAll(`#diffScrollLeft tr.row-diff-block[data-diff-block="${blockId}"]`));
      const rightRows = Array.from(document.querySelectorAll(`#diffScrollRight tr.row-diff-block[data-diff-block="${blockId}"]`));
      leftRows.forEach((node, i) => {
        node.classList.add('current-block');
        if (i === 0) node.classList.add('current');
      });
      rightRows.forEach((node, i) => {
        node.classList.add('current-block');
        if (i === 0) node.classList.add('current');
      });
      if (scroll) {
        leftRows[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (!state.syncScroll) {
          rightRows[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        // connectors after scroll animation starts
        setTimeout(() => updateDiffConnectors(), 80);
        setTimeout(() => updateDiffConnectors(), 220);
      }
    } else {
      const rows = Array.from(document.querySelectorAll(`#diffScrollMain tr.row-diff-block[data-diff-block="${blockId}"]`));
      rows.forEach((node, i) => {
        node.classList.add('current-block');
        if (i === 0) node.classList.add('current');
      });
      if (scroll) {
        rows[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
    updateDiffConnectors();
  }

  function jumpDiff(delta) {
    if (!state.diffAnchors.length) return;
    state.currentDiffIndex =
      (state.currentDiffIndex + delta + state.diffAnchors.length) % state.diffAnchors.length;
    highlightCurrentAnchor(true);
    updateNavButtons();
  }

  function updateNavButtons() {
    const has = state.diffAnchors.length > 0;
    el.prevDiff.disabled = !has;
    el.nextDiff.disabled = !has;
    if (has) {
      const label = `${state.currentDiffIndex + 1}/${state.diffAnchors.length}`;
      el.prevDiff.title = `上一个差异块 (${label})`;
      el.nextDiff.title = `下一个差异块 (${label})`;
      el.prevDiff.textContent = `↑ 上一个差异`;
      el.nextDiff.textContent = `↓ 下一个差异`;
    }
  }

  function bindEvents() {
    el.btnSplit.addEventListener('click', () => {
      state.mode = 'split';
      persistPrefs();
      applyToolbarState();
      if (state.fileDiff) renderDiff();
    });
    el.btnUnified.addEventListener('click', () => {
      state.mode = 'unified';
      persistPrefs();
      applyToolbarState();
      if (state.fileDiff) renderDiff();
    });
    el.syncScroll.addEventListener('change', () => {
      state.syncScroll = el.syncScroll.checked;
      persistPrefs();
    });
    el.collapseUnchanged.addEventListener('change', () => {
      state.collapseUnchanged = el.collapseUnchanged.checked;
      persistPrefs();
      if (state.fileDiff) renderDiff();
    });
    el.showLineNo.addEventListener('change', () => {
      state.showLineNo = el.showLineNo.checked;
      persistPrefs();
      if (state.fileDiff) renderDiff();
    });
    el.showPath.addEventListener('change', () => {
      state.showPath = el.showPath.checked;
      persistPrefs();
      renderFileList();
      if (state.fileDiff) renderFileHeader(state.fileDiff);
    });
    el.fontFamily.addEventListener('change', () => {
      state.fontFamily = el.fontFamily.value || DEFAULT_FONT_FAMILY;
      persistPrefs();
      applyTypography();
    });
    el.fontSize.addEventListener('change', () => {
      state.fontSize = clampFontSize(el.fontSize.value);
      el.fontSize.value = String(state.fontSize);
      persistPrefs();
      applyTypography();
    });
    el.prevDiff.addEventListener('click', () => jumpDiff(-1));
    el.nextDiff.addEventListener('click', () => jumpDiff(1));
    el.refreshBtn.addEventListener('click', () => {
      loadSummary().catch((e) => setError(e.message));
    });
    el.undoFileBtn?.addEventListener('click', () => {
      revertChanges({ all: false }).catch((e) => setError(e.message));
    });
    el.undoAllBtn?.addEventListener('click', () => {
      revertChanges({ all: true }).catch((e) => setError(e.message));
    });
    el.scanSessionsBtn?.addEventListener('click', () => {
      loadSessions(state.sessionId)
        .then(() => loadSummary())
        .catch((e) => setError(e.message));
    });
    el.dayFilterSwitch?.addEventListener('click', (e) => {
      const btn = e.target.closest('.day-filter-btn');
      if (!btn) return;
      const filter = btn.dataset.filter;
      if (!filter || filter === state.dayFilter) return;
      state.dayFilter = filter;
      persistPrefs();
      loadSessions('')
        .then(() => loadSummary())
        .then(async () => {
          if (state.files.length) await selectFile(state.files[0].path, true);
          else showWelcome();
        })
        .catch((e) => setError(e.message));
    });
    el.sessionSelect?.addEventListener('change', () => {
      const next = el.sessionSelect.value;
      if (!next || next === state.sessionId) return;
      state.sessionId = next;
      state.selectedPath = null;
      state.fileDiff = null;
      persistPrefs();
      loadSummary()
        .then(async () => {
          if (state.files.length) await selectFile(state.files[0].path, true);
          else showWelcome();
        })
        .catch((e) => setError(e.message));
    });
    el.confirmCancel?.addEventListener('click', () => closeConfirm(false));
    el.confirmOk?.addEventListener('click', () => closeConfirm(true));
    el.confirmModal?.addEventListener('click', (e) => {
      if (e.target && e.target.getAttribute('data-close') === '1') closeConfirm(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.confirmModal && !el.confirmModal.classList.contains('hidden')) {
        closeConfirm(false);
      }
    });
    el.fileFilter.addEventListener('input', () => renderFileList());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'F7' && e.shiftKey) {
        e.preventDefault();
        jumpDiff(-1);
      } else if (e.key === 'F7') {
        e.preventDefault();
        jumpDiff(1);
      }
    });
  }

  async function init() {
    initCustomSelects();
    applyToolbarState();
    applyDayFilterUI();
    bindEvents();
    connectLiveChannel();
    bindSidebarResize();
    try {
      await loadSessions(state.sessionId);
      await loadSummary();
      if (state.files.length) {
        await selectFile(state.files[0].path);
      } else {
        showWelcome();
      }
    } catch (error) {
      setError(error.message);
      showWelcome();
    }
  }

  init();
})();
