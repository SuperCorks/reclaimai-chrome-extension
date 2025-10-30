// Reclaim Planner helper content script
// - Appends human-friendly durations to time ranges in <p> text (e.g., "1:15 - 2:15pm (1h00m)").
// - Adds a subtle, accessible copy button to the event title that copies a cleaned-up title.
// - Detects the visible Attendees list for the current event and updates the Google Meet Join
//   button's URL to include ?authuser=<matching_email> using a prioritized list of your addresses.
//   This targets only the "Online meeting" Join link within the same details panel and updates
//   automatically as the page re-renders.

(function () {
  const MARK_ATTR = 'data-reclaim-duration-appended';
  const MARK_VERSION = '1';
  const AUTHUSER_ATTR = 'data-reclaim-authuser-applied';

  // Ordered priority list of emails to use for Meet authUser param
  const KNOWN_EMAILS_PRIORITY = [
    'simon@hoptech.ca',
    'simon@redkrypton.com',
    'simoncorcos.ing@gmail.com',
    'simon@corcos.ca',
    'simon.corcos@toptal.com',
  ];

  // Regex to match time ranges like "1:15 - 2:15pm", "9:35am - 1:05pm", or "12:00pm - 1:30pm"
  // Supports optional minutes and optional am/pm on BOTH times.
  const TIME_RANGE_REGEX = /\b(\d{1,2})(?::(\d{2}))?\s*([ap]m)?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*([ap]m)?\b/i;
  // Regex for legacy appended duration suffix (h/m), e.g. " (1h00m)" or " (05m)" at the end
  const LEGACY_SUFFIX_REGEX = /\s\((?:\d+h)?\d{2}m\)\s*$/;
  // Regex for decimal hour text suffix, e.g. " (1.25h)" at the end
  const DECIMAL_TEXT_SUFFIX_REGEX = /\s\(\d+(?:\.\d{2})?h\)\s*$/;

  function hasLegacySuffix(text) {
    return LEGACY_SUFFIX_REGEX.test(text);
  }
  function hasDecimalTextSuffix(text) {
    return DECIMAL_TEXT_SUFFIX_REGEX.test(text);
  }

  function toMinutes(hour, minute, meridiem) {
    let h = parseInt(hour, 10);
    let m = minute != null ? parseInt(minute, 10) : 0;

    if (meridiem) {
      const mer = meridiem.toLowerCase();
      if (mer === 'pm' && h !== 12) h += 12;
      if (mer === 'am' && h === 12) h = 0;
    }
    return h * 60 + m;
  }

  function formatDuration(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const hPart = h > 0 ? `${h}h` : '';
    const mPart = `${m.toString().padStart(2, '0')}m`;
    return hPart ? `${hPart}${mPart}` : `${mPart}`;
  }

  function formatDecimalHours(minutes) {
    // Always two decimals as per examples (e.g., 1.25h, 0.75h)
    const dec = (minutes / 60);
    return dec.toFixed(2);
  }

  // Parse a raw title string to remove client/project prefixes per examples
  function parseTitleForCopy(raw) {
    if (raw == null) return '';
    let s = String(raw).trim();
    if (!s) return '';

    const original = s;

    // 1) Remove one or more leading parenthetical tags e.g., (HOP) (RK)
    s = s.replace(/^(?:\s*\([^)]{1,30}\)\s*)+/g, '').trim();

    // 2) If there's a middle dot separator (client · title), drop the left side
    const dotIdx = s.indexOf('·');
    if (dotIdx > -1) {
      const left = s.slice(0, dotIdx).trim();
      const right = s.slice(dotIdx + 1).trim();
      // Heuristic: left looks like a short client/project label
      if (left.length > 0 && left.length <= 30 && left.split(/\s+/).length <= 4) {
        s = right;
      }
    }

    // 3) Remove prefix before hyphen when it looks like a client/project label
    //    Handles cases like "GM - Title" and "Gleam - Title"
    const hyphenMatch = s.match(/^\s*(.+?)\s*[\-–—]\s+(.+)$/);
    if (hyphenMatch) {
      const left = hyphenMatch[1].trim();
      const right = hyphenMatch[2].trim();

      const leftWords = left.split(/\s+/).filter(Boolean);
      const rightWords = right.split(/\s+/).filter(Boolean);
      const leftLooksLikeCode = /^[A-Z0-9]{1,5}$/.test(left);
      const isLeftShort = left.length <= 20 && leftWords.length <= 3;
      const leftTitleCased = leftWords.length > 0 && leftWords.every(w => /^[A-Z][a-z0-9'()&.-]*$/.test(w));
      const rightHasIndicators = /[,()]/.test(right) || rightWords.length >= 4;
      const rightStartsWithVerb = /\b(Add|Fix|Deploy|Update|Upgrade|Implement|Migrate|Refactor|QA|Design|Build|Setup|Set\s*up|Sync|Investigate|Research|Write|Draft|Review|Plan|Meeting|Kickoff|Support|Debug|Copy|Create|Optimize|Improve|Bug|Test)\b/i.test(right);
      // Also check if right side looks like a person's name or task description (has at least 2 words)
      const rightLooksSubstantive = rightWords.length >= 2;

      if (leftLooksLikeCode || (isLeftShort && leftTitleCased && (rightHasIndicators || rightStartsWithVerb || rightLooksSubstantive))) {
        s = right;
      }
    }

    s = s.trim();
    return s || original;
  }

  function parseAndFormatDuration(text) {
    // Remove any trailing duration we might have previously appended as plain text
    const baseText = text.replace(LEGACY_SUFFIX_REGEX, '').replace(DECIMAL_TEXT_SUFFIX_REGEX, '').trim();
    const match = baseText.match(TIME_RANGE_REGEX);
    if (!match) return null;
    const [, h1, m1, mer1Maybe, h2, m2, mer2Maybe] = match;

    let mer1 = mer1Maybe ? mer1Maybe.toLowerCase() : undefined;
    let mer2 = mer2Maybe ? mer2Maybe.toLowerCase() : undefined;

    // If only one side has am/pm, assume same period for the other
    if (!mer1 && mer2) mer1 = mer2;
    if (mer1 && !mer2) mer2 = mer1;

    let start = toMinutes(h1, m1, mer1);
    let end = toMinutes(h2, m2, mer2);

    // If end <= start, assume crossing into the next day
    if (end <= start) {
      end += 24 * 60;
    }

    const duration = end - start;
    if (duration <= 0 || duration > 24 * 60) return null;

    // Return both styles plus raw minutes
    const decimalStr = formatDecimalHours(duration);
    return {
      minutes: duration,
      decimal: decimalStr,
      pretty: ` (${decimalStr}h)`,
      // Preferred display: legacy h/m format
      legacy: ` (${formatDuration(duration)})`,
    };
  }

  function ensureHoverStyle() {
    if (document.getElementById('reclaim-duration-style')) return;
    const style = document.createElement('style');
    style.id = 'reclaim-duration-style';
    style.textContent = `
      .reclaim-duration{cursor:pointer;text-decoration:none;}
      .reclaim-duration .reclaim-duration-inner{ text-decoration:none; }
      .reclaim-duration:hover .reclaim-duration-inner{ text-decoration:underline; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureCopyTitleStyle() {
    if (document.getElementById('reclaim-copy-title-style')) return;
    const style = document.createElement('style');
    style.id = 'reclaim-copy-title-style';
    style.textContent = `
      .reclaim-copy-title-btn{ 
        display:inline-flex; align-items:center; justify-content:center; 
        width:18px; height:18px; min-width:22px; min-height:22px; margin-left:8px; padding:0; border-radius:4px; border:1px solid transparent; 
        cursor:pointer; background:transparent; color:inherit; line-height:1; 
        /* Do not rely on flex ordering to avoid breaking host layout */
      }
      /* Anchor for absolute positioning inside the title element */
      .reclaim-copy-title-anchor{ position:relative; padding-right:26px; }
      .reclaim-copy-title-anchor > .reclaim-copy-title-btn{ position:absolute; right:0; top:50%; transform:translateY(-50%); margin-left:0; }
      .reclaim-copy-title-btn:hover{ background:rgba(0,0,0,0.06); }
      .reclaim-copy-title-btn:active{ transform: translateY(calc(-50% + 0.5px)); }
      .reclaim-copy-title-btn svg{ width:18px; height:18px; fill: currentColor; }
      .reclaim-copy-title-badge{ font-size:12px; margin-left:6px; opacity:0.75; }
      /* Minimal viewer tweaks only; avoid overriding display or order so we don't
         disrupt the app's original flex/stacking (e.g., "Viewing" line above title). */
      .reclaim-copy-title-viewer{ min-width:0; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function buildDurationSpan(info) {
    const span = document.createElement('span');
    span.className = 'reclaim-duration';
    span.setAttribute('data-reclaim-duration', '1');
    span.setAttribute('data-decimal-hours', info.decimal);
    span.style.cursor = 'pointer';
    span.title = `Copy ${info.decimal} to clipboard`;
    span.setAttribute('role', 'button');
    span.setAttribute('tabindex', '0');

    // Leading space + opening paren
    span.appendChild(document.createTextNode(' ('));
    const inner = document.createElement('span');
    inner.className = 'reclaim-duration-inner';
    inner.textContent = formatDuration(info.minutes); // e.g., 3h00m or 45m
    span.appendChild(inner);
    // Closing paren
    span.appendChild(document.createTextNode(')'));

    const copy = (e) => {
      e.stopPropagation();
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(info.decimal).catch(() => {});
        } else {
          const ta = document.createElement('textarea');
          ta.value = info.decimal;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          try { document.execCommand('copy'); } catch (_) {}
          document.body.removeChild(ta);
        }
      } catch (_) {}
    };
    span.addEventListener('click', copy);
    span.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        copy(e);
        e.preventDefault();
      }
    });

    return span;
  }

  function annotateElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
    if (el.tagName && el.tagName.toLowerCase() !== 'p') return; // Only process <p>
    const text = el.textContent ? el.textContent.trim() : '';
    if (!text) return;
    // If we've already added our duration span, ensure it has inner structure for underline
    const existingSpan = el.querySelector ? el.querySelector('.reclaim-duration') : null;
    if (existingSpan) {
      ensureHoverStyle();
      if (!existingSpan.querySelector('.reclaim-duration-inner')) {
        // Upgrade structure using stored decimal data if available
        const dec = existingSpan.getAttribute('data-decimal-hours');
        let minutes = null;
        if (dec && !Number.isNaN(parseFloat(dec))) {
          minutes = Math.round(parseFloat(dec) * 60);
        }
        let info = null;
        if (minutes != null && minutes > 0) {
          info = { minutes, decimal: (minutes / 60).toFixed(2) };
        } else {
          // Fallback: attempt re-parse from element text
          const t = el.textContent ? el.textContent.trim() : '';
          info = parseAndFormatDuration(t);
        }
        if (info) {
          // Replace existing span contents
          existingSpan.textContent = '';
          const upgraded = buildDurationSpan(info);
          // Move attributes from upgraded to existing span
          for (const attr of upgraded.attributes) {
            existingSpan.setAttribute(attr.name, attr.value);
          }
          // Append children of upgraded span into existing
          while (upgraded.firstChild) existingSpan.appendChild(upgraded.firstChild);
        }
      }
      el.setAttribute(MARK_ATTR, MARK_VERSION);
      return;
    }
    // If there's already a decimal duration as text, skip to avoid duplication
    if (hasDecimalTextSuffix(text)) return;
    let workingText = text;
    // If there's a legacy h/m suffix and this <p> has no element children, strip it from textContent
    if (hasLegacySuffix(text)) {
      if (!el.children || el.children.length === 0) {
        workingText = text.replace(LEGACY_SUFFIX_REGEX, '').trim();
        el.textContent = workingText;
      }
      // If there are children, we leave legacy text in place to avoid breaking markup; we'll still append the new span
    }

    const info = parseAndFormatDuration(workingText);
    if (info) {
      ensureHoverStyle();
      const span = buildDurationSpan(info);
      el.appendChild(span);
      el.setAttribute(MARK_ATTR, MARK_VERSION);
    }
  }

  // ---------- Title copy button injection ----------
  function buildCopyButton(getText) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'reclaim-copy-title-btn';
    btn.setAttribute('aria-label', 'Copy title to clipboard');
    btn.title = 'Copy title to clipboard';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M16 1H4c-1.1 0-2 .9-2 2v12h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"></path>
      </svg>
    `;

    const copy = (e) => {
      e.stopPropagation();
      const raw = (typeof getText === 'function') ? (getText() || '') : '';
      const text = parseTitleForCopy(raw);
      if (!text) return;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).catch(() => {});
        } else {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          try { document.execCommand('copy'); } catch (_) {}
          document.body.removeChild(ta);
        }
        // brief visual feedback via title change
        const prev = btn.title;
        btn.title = 'Copied!';
        setTimeout(() => { btn.title = prev; }, 1200);
      } catch (_) {}
    };
    btn.addEventListener('click', copy);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { copy(e); e.preventDefault(); }
    });
    return btn;
  }

  function getTitleTextFromContainer(container) {
    if (!container) return '';
    // If in edit mode, prefer the input's value
    const input = container.querySelector('input[type="text"], textarea');
    if (input && typeof input.value === 'string' && input.value.trim().length > 0) {
      return input.value.trim();
    }
    // Primary: span with class containing 'EmojiTextField_viewer__'
    const viewer = container.querySelector('[class*="EmojiTextField_viewer__"]');
    if (viewer && viewer.textContent) return viewer.textContent.trim();
    // Fallback: any element with role heading or first text node
    const heading = container.querySelector('[role="heading"], h1, h2, h3');
    if (heading && heading.textContent) return heading.textContent.trim();
    return container.textContent ? container.textContent.trim() : '';
  }

  // ----- Title wrapper processing and observers -----
  const TITLE_WRAPPER_SELECTOR = [
    '[class*="GenericEventDetails_inner__header__titles"] [class*="EmojiTextField_root"]',
    // Simple title variant: plain title div inside the titles container
    '[class*="GenericEventDetails_inner__header__titles"] [class*="GenericEventDetails_inner__header__titles__title__"]',
    '[class*="GenericEventDetails_inner__header__titles"] > [class*="GenericEventDetails_inner__header__titles__title__"]'
  ].join(',');
  const wrapperObserverMap = new WeakMap();
  const wrapperDebounceMap = new WeakMap();

  function processTitleWrapper(parent) {
    if (!parent) return;
    // Prefer an active TextField container (edit mode); otherwise fall back to viewer span
    let titleEl = parent.querySelector && parent.querySelector('[class*="MuiTextField-root"]');
    if (!titleEl && parent.querySelector) titleEl = parent.querySelector('[class*="EmojiTextField_viewer__"]');
    // Simple title case: no child title element; use parent itself as title element
    if (!titleEl) titleEl = parent;

    // Tag the title element for our minimal CSS (do not change layout/display)
    try { titleEl.classList.add('reclaim-copy-title-viewer'); } catch(_) {}

    // Choose an anchor inside which the button will be absolutely positioned
    let anchor = null;
    try { anchor = parent.querySelector('[class*="EmojiTextField_viewer__"]') || titleEl; } catch(_) { anchor = titleEl; }
    try { anchor.classList.add('reclaim-copy-title-anchor'); } catch(_) {}

    // Remove any existing buttons under the same parent except the one inside anchor
    const existingInAnchor = anchor.querySelector('.reclaim-copy-title-btn');
    if (existingInAnchor) {
      // Clean up stray duplicates elsewhere under parent
      const extras = parent.querySelectorAll('.reclaim-copy-title-btn');
      for (const b of extras) { if (b !== existingInAnchor) b.remove(); }
    } else {
      const btn = buildCopyButton(() => getTitleTextFromContainer(parent));
      anchor.appendChild(btn);
      // Ensure anchor remains the same height; no further layout changes
    }

    // Hide emoji button (optional UX tweak) without altering layout
    try {
      const emoji = parent.querySelector('[class*="EmojiTextField_emoji"]');
      if (emoji && emoji.style) emoji.style.display = 'none';
    } catch(_) {}
  }

  function isSelfMutation(mutation) {
    // Ignore mutations fully caused by our elements/classes
    if (mutation.type === 'childList') {
      // If all added nodes are our button, ignore
      if (mutation.addedNodes && mutation.addedNodes.length > 0) {
        let allOurs = true;
        mutation.addedNodes.forEach((n) => {
          if (!(n.nodeType === 1 && n.classList && n.classList.contains('reclaim-copy-title-btn'))) {
            allOurs = false;
          }
        });
        if (allOurs) return true;
      }
      // If all removed nodes are our button, ignore
      if (mutation.removedNodes && mutation.removedNodes.length > 0) {
        let allOurs = true;
        mutation.removedNodes.forEach((n) => {
          if (!(n.nodeType === 1 && n.classList && n.classList.contains('reclaim-copy-title-btn'))) {
            allOurs = false;
          }
        });
        if (allOurs) return true;
      }
    } else if (mutation.type === 'attributes') {
      const t = mutation.target;
      if (t && t.classList) {
        if (t.classList.contains('reclaim-copy-title-viewer') || t.classList.contains('reclaim-copy-title-btn')) {
          return true;
        }
      }
    }
    return false;
  }

  function ensureObserverForWrapper(parent) {
    if (!parent || wrapperObserverMap.has(parent)) return;
    const obs = new MutationObserver((mutations) => {
      // If all mutations are ours, skip
      const hasRelevant = mutations.some((m) => !isSelfMutation(m));
      if (!hasRelevant) return;
      // Debounce per-wrapper to avoid thrashing on rapid React renders
      const existing = wrapperDebounceMap.get(parent);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        try { processTitleWrapper(parent); } catch(_) {}
      }, 50);
      wrapperDebounceMap.set(parent, timer);
    });
    obs.observe(parent, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'] // ignore style changes we apply
    });
    wrapperObserverMap.set(parent, obs);
  }

  function ensureTitleCopyButtons() {
    ensureCopyTitleStyle();
    // Find title wrappers and handle both view and edit modes
    const wrappers = document.querySelectorAll(TITLE_WRAPPER_SELECTOR);
    for (const parent of wrappers) {
      processTitleWrapper(parent);
      ensureObserverForWrapper(parent);
    }
  }

  // ---------- Google Meet authuser handling ----------
  function getDetailValueContainer(labelText, scopeRoot) {
    // Find a detail row where the left label equals labelText and return the right value container, scoped to a root
    const root = scopeRoot || document;
    try {
      const labelNodes = Array.from(root.querySelectorAll('div, span, p'))
        .filter(el => el && el.childElementCount === 0 && el.textContent && el.textContent.trim() === labelText);
      for (const node of labelNodes) {
        const parent = node.parentElement;
        if (!parent) continue;
        const value = parent.nextElementSibling;
        if (value && value.textContent != null) return value;
      }
    } catch (_) {}
    return null;
  }

  function collectAttendeeEmails(scopeRoot) {
    const valueContainer = getDetailValueContainer('Attendees', scopeRoot);
    const emails = new Set();
    if (!valueContainer) return emails;
    const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
    // Walk text from descendants
    try {
      const walker = document.createTreeWalker(valueContainer, NodeFilter.SHOW_TEXT, null);
      let n;
      while ((n = walker.nextNode())) {
        const t = n.nodeValue || '';
        let m;
        while ((m = EMAIL_RE.exec(t)) !== null) {
          emails.add(m[0].toLowerCase());
        }
      }
    } catch (_) {}
    return emails;
  }

  function collectEmailsFromContainer(containerEl) {
    const emails = new Set();
    if (!containerEl) return emails;
    const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
    try {
      const walker = document.createTreeWalker(containerEl, NodeFilter.SHOW_TEXT, null);
      let n;
      while ((n = walker.nextNode())) {
        const t = n.nodeValue || '';
        let m;
        while ((m = EMAIL_RE.exec(t)) !== null) {
          emails.add(m[0].toLowerCase());
        }
      }
    } catch (_) {}
    return emails;
  }

  function pickAuthEmail(attendeeEmails) {
    for (const e of KNOWN_EMAILS_PRIORITY) {
      if (attendeeEmails.has(e.toLowerCase())) return e;
    }
    return null;
  }

  function findJoinMeetAnchors() {
    const anchors = Array.from(document.querySelectorAll('a[href*="meet.google.com"]'));
    if (anchors.length === 0) return [];

    // Prefer anchors in the "Online meeting" row or with Join button styling/text
    const onlineValue = getDetailValueContainer('Online meeting');
    const inOnline = new Set();
    if (onlineValue) {
      for (const a of onlineValue.querySelectorAll('a[href*="meet.google.com"]')) inOnline.add(a);
    }

    const result = [];
    for (const a of anchors) {
      const text = (a.textContent || '').trim().toLowerCase();
      const cls = a.className || '';
      const looksJoin = text.includes('join') || /JoinMeetingButton_/i.test(cls);
      if (inOnline.has(a) || looksJoin) result.push(a);
    }
    return result;
  }

  function getScopeRootForAnchor(anchor) {
    // Ascend to a container that contains both the Online meeting and Attendees rows
    let el = anchor;
    for (let depth = 0; el && depth < 12; depth++) {
      const root = el;
      try {
        const hasOnline = !!getDetailValueContainer('Online meeting', root);
        const hasAttendees = !!getDetailValueContainer('Attendees', root);
        if (hasOnline && hasAttendees) return root;
      } catch (_) {}
      el = el.parentElement;
    }
    // Fallback to document
    return document;
  }

  function findAttendeesContainerNear(anchor) {
    // Prefer an explicit Attendees subsection container near the anchor
    let el = anchor;
    for (let depth = 0; el && depth < 12; depth++) {
      try {
        const c = el.querySelector('[class*="AttendeesDomainDetailContent_root__"], [class*="AttendeesDomainDetailContent_content__"]');
        if (c) return c;
      } catch (_) {}
      el = el.parentElement;
    }
    // fallback via label-based lookup within the broader scope root
    const scope = getScopeRootForAnchor(anchor);
    return getDetailValueContainer('Attendees', scope) || null;
  }

  function applyAuthUserToHref(href, email) {
    try {
      const url = new URL(href, location.href);
      // Set only the lowercase authuser=<email> param (preferred by Meet) and remove any other
      // variant (e.g., mixed-case authUser) while preserving existing query params.
      url.searchParams.delete('authuser');
      url.searchParams.set('authuser', email);
      return url.toString();
    } catch (_) {
      return href;
    }
  }

  function ensureMeetAuthUserOnJoin() {
    try {
      const anchors = findJoinMeetAnchors();
      for (const a of anchors) {
        // Compute chosen email using the closest Attendees subsection
        const attendeesContainer = findAttendeesContainerNear(a);
        let attendeeEmails = collectEmailsFromContainer(attendeesContainer);
        if (attendeeEmails.size === 0) {
          const scopeRoot = getScopeRootForAnchor(a);
          attendeeEmails = collectAttendeeEmails(scopeRoot);
        }
        const chosen = pickAuthEmail(attendeeEmails);
        if (!chosen) {
          // If previously applied, remove param to avoid stale account selection
          const before = a.href;
          try {
            const url = new URL(before, location.href);
            if (url.searchParams.has('authuser') || url.searchParams.has('authuser')) {
              url.searchParams.delete('authuser');
              url.searchParams.delete('authuser');
              a.href = url.toString();
              a.removeAttribute(AUTHUSER_ATTR);
            }
          } catch (_) {}
          continue;
        }
        const currentApplied = a.getAttribute(AUTHUSER_ATTR);
        if (currentApplied === chosen && a.href && /[?&]authuser=/i.test(a.href)) {
          continue; // already correct
        }
        const before = a.href;
        const after = applyAuthUserToHref(before, chosen);
        if (after !== before) {
          a.href = after;
        } else if (!/[?&]authuser=/i.test(before)) {
          // Fallback: append query manually if URL parsing failed
          const sep = before.includes('?') ? '&' : '?';
          a.href = `${before}${sep}authuser=${encodeURIComponent(chosen)}`;
        }
        a.setAttribute(AUTHUSER_ATTR, chosen);
      }
    } catch (_) {}
  }

  // Throttled processing of candidate <p> elements collected from mutations
  const candidatePs = new Set();
  let throttleTimer = null;
  const THROTTLE_MS = 1000; // 1 second

  function queueElementForAnnotation(node) {
    if (!node) return;
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node;
      if (el.tagName && el.tagName.toLowerCase() === 'p') {
        candidatePs.add(el);
      }
      // Add any descendant <p> elements
      const descPs = el.querySelectorAll ? el.querySelectorAll('p') : [];
      for (const p of descPs) candidatePs.add(p);
    } else if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement || (node.parentNode && node.parentNode.nodeType === Node.ELEMENT_NODE ? node.parentNode : null);
      if (parent) {
        const p = parent.closest ? parent.closest('p') : null;
        if (p) candidatePs.add(p);
      }
    }
  }

  function runAnnotationNow() {
    // Always ensure the title copy button and ordering on each tick
    try { ensureTitleCopyButtons(); } catch (_) {}
  // Ensure Meet authuser is applied to Join links when relevant
    try { ensureMeetAuthUserOnJoin(); } catch (_) {}

    // Process candidate <p> nodes if any
    if (candidatePs.size > 0) {
      for (const el of candidatePs) annotateElement(el);
      candidatePs.clear();
    }
  }

  function scheduleAnnotate() {
    if (throttleTimer !== null) return; // Coalesce calls within the window
    throttleTimer = setTimeout(() => {
      try {
        runAnnotationNow();
      } finally {
        throttleTimer = null;
      }
    }, THROTTLE_MS);
  }

  function setupObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'characterData') {
          queueElementForAnnotation(m.target);
        } else if (m.type === 'childList') {
          m.addedNodes && m.addedNodes.forEach((n) => queueElementForAnnotation(n));
          // We ignore removed nodes; if content is reinserted, it'll trigger addedNodes
        }
      }
      scheduleAnnotate();
    });
    observer.observe(document.documentElement || document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    return observer;
  }

  // Initial run and observer
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      document.querySelectorAll('p').forEach((p) => candidatePs.add(p));
      scheduleAnnotate();
      // Initial title scan
      try { ensureTitleCopyButtons(); } catch (_) {}
      // Initial Meet authuser pass
      try { ensureMeetAuthUserOnJoin(); } catch (_) {}
    }, { once: true });
  } else {
    document.querySelectorAll('p').forEach((p) => candidatePs.add(p));
    scheduleAnnotate();
    try { ensureTitleCopyButtons(); } catch (_) {}
    try { ensureMeetAuthUserOnJoin(); } catch (_) {}
  }
  setupObserver();
})();
