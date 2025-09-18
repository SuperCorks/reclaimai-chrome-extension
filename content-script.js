// Content script for Reclaim Planner Duration Helper
// Finds time ranges like "1:15 - 2:15pm" and appends the duration e.g., " (1h00m)"

(function () {
  const MARK_ATTR = 'data-reclaim-duration-appended';
  const MARK_VERSION = '1';

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
    if (candidatePs.size === 0) return;
    for (const el of candidatePs) annotateElement(el);
    candidatePs.clear();
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
    }, { once: true });
  } else {
    document.querySelectorAll('p').forEach((p) => candidatePs.add(p));
    scheduleAnnotate();
  }
  setupObserver();
})();
