/* TALORA — Public website content binding.
   Fetches the published content map from the backend (GET /api/website-content, no auth)
   and applies every managed value to the website. Any key not present simply leaves
   the hardcoded HTML default in place — graceful fallback if the API is unavailable.
   Draft/hidden values are never returned by the API, so they never appear publicly. */
(async () => {
  'use strict';

  // Keys rendered as HTML (they may contain <span class="gradient">…</span>)
  const HTML_KEYS = new Set([
    'hero_title', 'hero_desc',
    'eco_title', 'bwith_title', 'bwith_sub', 'join_title', 'join_eyebrow',
    'contact_title', 'contact_sub', 'contact_question', 'audience_join',
    'social_github_desc', 'social_linkedin_desc', 'nav_build', 'nav_join', 'footer_text'
  ]);
  // Keys applied as element attributes / special behaviour
  const LINK_KEYS = {
    link_github: { sel: '[data-tc-link="github"]', attr: 'href' },
    link_linkedin: { sel: '[data-tc-link="linkedin"]', attr: 'href' },
    link_join_cta: { sel: '[data-tc-link="join-cta"]', attr: 'href' }
  };

  // Every text value is escaped; only keys listed in HTML_KEYS may contain markup.
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function applyValue(key, value) {
    if (value == null || value === '') return;
    const el = document.querySelector('[data-tc="' + key + '"]');
    if (el) {
      if (HTML_KEYS.has(key)) el.innerHTML = value; // trusted: authored via the auth-protected CMS
      else el.textContent = value;
    }
    const link = LINK_KEYS[key];
    if (link) {
      document.querySelectorAll(link.sel).forEach(a => a.setAttribute(link.attr, value));
    }
  }

  function applySpecial(v) {
    // Hero video source
    const video = document.querySelector('.skills-video');
    if (video && v.link_hero_video) video.setAttribute('src', v.link_hero_video);
    // Email card: address line + mailto href
    if (v.link_email) {
      const email = v.link_email;
      document.querySelectorAll('[data-tc-link="email"]').forEach(a => a.setAttribute('href', 'mailto:' + email));
      const line = document.querySelector('[data-tc="social_email_sub"]');
      if (line) line.textContent = email;
    }
    // Join card rotating states are controlled by app.js
    if (v.join_state1_title || v.join_state1_text || v.join_state2_title || v.join_state2_text) {
      window.TALORA_JOIN_STATES = [
        { title: v.join_state1_title || '', text: v.join_state1_text || '' },
        { title: v.join_state2_title || '', text: v.join_state2_text || '' }
      ];
      // Update the visible state immediately (app.js re-renders on rotation)
      const t = document.getElementById('joinTitle');
      const x = document.getElementById('joinText');
      if (t && v.join_state1_title) t.textContent = v.join_state1_title;
      if (x && v.join_state1_text) x.textContent = v.join_state1_text;
    }
    // Contact form success toast
    if (v.toast_success_title || v.toast_success_text) {
      window.TALORA_TOAST_SUCCESS = { title: v.toast_success_title, text: v.toast_success_text };
    }
    // Capability lists (one item per line)
    [['cap_design_list', 'design'], ['cap_eng_list', 'engineering'],
     ['cap_creative_list', 'creative'], ['cap_strategy_list', 'strategy']].forEach(([key, cap]) => {
      if (!v[key]) return;
      const card = document.querySelector('.cap-card[data-cap="' + cap + '"] ul');
      if (!card) return;
      card.innerHTML = v[key].split('\n').map(s => s.trim()).filter(Boolean)
        .map(s => '<li>' + esc(s) + '</li>').join('');
    });
  }

  try {
    const res = await fetch('/api/website-content');
    if (!res.ok) return;
    const data = await res.json();
    const v = data && data.values;
    if (!v || typeof v !== 'object') return;
    Object.entries(v).forEach(([k, val]) => applyValue(k, val));
    applySpecial(v);
  } catch (err) {
    // Fail silently — the hardcoded content remains as fallback
  }
})();
