/**
 * Openshore Analytics — single-file system
 * ──────────────────────────────────────────
 * Manages: RGPD consent + PostHog + Clarity + GA4 + Meta Pixel + custom events
 * Public API:
 *   window.os.track(eventName, properties)
 *   window.os.identify(userId, traits)
 *   window.os.consent.grant() / .revoke() / .status()
 *
 * Config injected via window.__osConfig before this file loads:
 *   { posthogKey, posthogHost, clarityId, ga4Id, metaPixelId, page }
 */
(function () {
  'use strict';

  const cfg = window.__osConfig || {};
  const STORAGE_KEY = 'os_consent_v1';
  const DISTINCT_ID_KEY = 'os_distinct_id';
  const queue = [];

  const uuid = () =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });

  const getDistinctId = () => {
    let id = localStorage.getItem(DISTINCT_ID_KEY);
    if (!id) {
      id = uuid();
      try { localStorage.setItem(DISTINCT_ID_KEY, id); } catch (e) {}
    }
    return id;
  };

  const throttle = (fn, wait) => {
    let last = 0;
    return function (...args) {
      const now = Date.now();
      if (now - last >= wait) { last = now; fn.apply(this, args); }
    };
  };

  // ─── Consent state ──────────────────────────────────
  const consent = {
    status() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; }
      catch (e) { return null; }
    },
    save(state) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, ts: Date.now() })); }
      catch (e) {}
    },
    grant(categories = { analytics: true, marketing: true }) {
      this.save({ ...categories, granted: true });
      bootTrackers();
      hideConsentBanner();
      track('consent_granted', categories);
    },
    revoke() {
      this.save({ analytics: false, marketing: false, granted: false });
      hideConsentBanner();
    },
    grantedFor(category) {
      const s = this.status();
      return s && s.granted && s[category] === true;
    },
  };

  // ─── Event tracking ─────────────────────────────────
  function track(eventName, properties = {}) {
    const payload = {
      ...properties,
      $page: cfg.page || location.pathname,
      $url: location.href,
      $referrer: document.referrer || null,
      $viewport: `${window.innerWidth}x${window.innerHeight}`,
      $distinct_id: getDistinctId(),
    };

    if (!consent.grantedFor('analytics')) {
      queue.push({ eventName, payload });
      return;
    }

    if (window.posthog && window.posthog.capture) {
      window.posthog.capture(eventName, payload);
    }

    if (window.gtag) {
      window.gtag('event', eventName, payload);
    } else if (window.dataLayer) {
      window.dataLayer.push({ event: eventName, ...payload });
    }

    if (window.fbq && consent.grantedFor('marketing')) {
      const metaMap = {
        lead_magnet_submitted: 'Lead',
        checkout_initiated: 'InitiateCheckout',
        checkout_completed: 'Purchase',
        cta_calendly_click: 'Schedule',
        cta_whatsapp_click: 'Contact',
        pricing_pack_viewed: 'ViewContent',
      };
      const fbEvent = metaMap[eventName];
      if (fbEvent) window.fbq('track', fbEvent, payload);
    }

    if (window.clarity) {
      try { window.clarity('event', eventName); } catch (e) {}
    }
  }

  function identify(userId, traits = {}) {
    try { localStorage.setItem(DISTINCT_ID_KEY, userId); } catch (e) {}
    if (window.posthog && window.posthog.identify) {
      window.posthog.identify(userId, traits);
    }
    if (window.gtag) window.gtag('set', 'user_properties', traits);
    if (window.clarity) try { window.clarity('identify', userId); } catch (e) {}
  }

  // ─── Tracker bootstrappers ──────────────────────────
  function loadPostHog() {
    if (!cfg.posthogKey || window.posthog) return;
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    window.posthog.init(cfg.posthogKey, {
      api_host: cfg.posthogHost || 'https://eu.i.posthog.com',
      person_profiles: 'identified_only',
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true,
      session_recording: {
        recordCrossOriginIframes: false,
        maskAllInputs: false,
        maskInputOptions: { password: true, email: false },
      },
      loaded: (ph) => {
        ph.identify(getDistinctId());
        ph.register({ os_site: 'openshore.eu', os_page: cfg.page || location.pathname });
      },
    });
  }

  function loadClarity() {
    if (!cfg.clarityId || window.clarity) return;
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', cfg.clarityId);
  }

  function loadGA4() {
    if (!cfg.ga4Id || window.gtag) return;
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(cfg.ga4Id);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', cfg.ga4Id, { anonymize_ip: true, send_page_view: true });
  }

  function loadMetaPixel() {
    if (!cfg.metaPixelId || window.fbq) return;
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', cfg.metaPixelId);
    window.fbq('track', 'PageView');
  }

  function loadVercelAnalytics() {
    if (window.va) return;
    window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    const s = document.createElement('script');
    s.defer = true;
    s.src = '/_vercel/insights/script.js';
    document.head.appendChild(s);
  }

  function bootTrackers() {
    if (consent.grantedFor('analytics')) {
      loadPostHog();
      loadClarity();
      loadGA4();
    }
    if (consent.grantedFor('marketing')) {
      loadMetaPixel();
    }
    while (queue.length > 0) {
      const { eventName, payload } = queue.shift();
      track(eventName, payload);
    }
  }

  // ─── Consent banner UI (built with DOM methods, no innerHTML) ───
  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const k in props) {
        if (k === 'style') Object.assign(node.style, props[k]);
        else if (k.startsWith('data-')) node.setAttribute(k, props[k]);
        else if (k === 'class') node.className = props[k];
        else if (k === 'text') node.textContent = props[k];
        else if (k in node) node[k] = props[k];
        else node.setAttribute(k, props[k]);
      }
    }
    if (children) children.forEach((c) => c && node.appendChild(c));
    return node;
  }

  function buildConsentBanner() {
    if (document.getElementById('os-consent')) return;
    if (consent.status() && consent.status().granted !== undefined) return;

    const style = document.createElement('style');
    style.textContent = '#os-consent{position:fixed;bottom:16px;left:16px;right:16px;max-width:560px;margin:0 auto;background:#0F0B09;color:#F5F2EE;padding:20px 22px;border-radius:14px;box-shadow:0 12px 48px rgba(0,0,0,.35);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;line-height:1.5;z-index:99999;animation:os-c-in .4s ease-out}@keyframes os-c-in{from{transform:translateY(20px);opacity:0}to{transform:none;opacity:1}}#os-consent .os-c-title{font-weight:600;margin-bottom:6px;color:#fff}#os-consent .os-c-text{color:#bbb;margin-bottom:14px;font-size:13px}#os-consent .os-c-text a{color:#F47B3B;text-decoration:underline}#os-consent .os-c-btns{display:flex;gap:8px;flex-wrap:wrap}#os-consent button{flex:1;min-width:110px;padding:10px 14px;border-radius:8px;border:0;cursor:pointer;font-weight:600;font-size:13px;font-family:inherit;transition:opacity .15s}#os-consent button:hover{opacity:.85}#os-consent .os-c-accept{background:#F47B3B;color:#fff}#os-consent .os-c-essential{background:transparent;color:#bbb;border:1px solid #333}#os-consent .os-c-customize{background:transparent;color:#888;font-size:12px;text-decoration:underline;padding:6px 0;flex:0 0 100%;text-align:center}#os-consent-detail{margin-top:14px;padding-top:14px;border-top:1px solid #2a2520;display:none}#os-consent-detail.show{display:block}#os-consent-detail label{display:flex;align-items:center;gap:10px;padding:8px 0;cursor:pointer;color:#ddd}#os-consent-detail input{accent-color:#F47B3B;cursor:pointer}#os-consent-detail .os-c-meta{font-size:11px;color:#777;margin-left:24px}@media (max-width:480px){#os-consent{left:8px;right:8px;bottom:8px;padding:16px}}';
    document.head.appendChild(style);

    const wrapper = el('div', { id: 'os-consent', role: 'dialog', 'aria-label': 'Préférences cookies' });

    wrapper.appendChild(el('div', { class: 'os-c-title', text: 'On respecte ton choix.' }));

    const textDiv = el('div', { class: 'os-c-text' });
    textDiv.appendChild(document.createTextNode('Openshore utilise des cookies pour analyser l\'usage du site (PostHog, Clarity, GA4) et améliorer ton expérience. Aucun tracking marketing par défaut. '));
    const link = el('a', { href: '/politique-confidentialite.html', text: 'En savoir plus →' });
    textDiv.appendChild(link);
    wrapper.appendChild(textDiv);

    const btns = el('div', { class: 'os-c-btns' });
    const btnEssential = el('button', { type: 'button', class: 'os-c-essential', 'data-act': 'essential', text: 'Essentiel uniquement' });
    const btnAccept = el('button', { type: 'button', class: 'os-c-accept', 'data-act': 'accept', text: 'Tout accepter' });
    const btnCustomize = el('button', { type: 'button', class: 'os-c-customize', 'data-act': 'customize', text: 'Personnaliser' });
    btns.appendChild(btnEssential);
    btns.appendChild(btnAccept);
    btns.appendChild(btnCustomize);
    wrapper.appendChild(btns);

    const detail = el('div', { id: 'os-consent-detail' });

    const labelEss = el('label');
    const cbEss = el('input', { type: 'checkbox', checked: true, disabled: true });
    const spanEss = document.createElement('span');
    spanEss.appendChild(el('b', { text: 'Essentiel' }));
    spanEss.appendChild(document.createTextNode(' — fonctionnement du site'));
    labelEss.appendChild(cbEss);
    labelEss.appendChild(spanEss);
    detail.appendChild(labelEss);
    detail.appendChild(el('div', { class: 'os-c-meta', text: 'Toujours actif. Aucun tracking.' }));

    const labelAna = el('label');
    const cbAna = el('input', { type: 'checkbox', id: 'os-c-analytics', checked: true });
    const spanAna = document.createElement('span');
    spanAna.appendChild(el('b', { text: 'Analytics' }));
    spanAna.appendChild(document.createTextNode(' — PostHog, Clarity, GA4'));
    labelAna.appendChild(cbAna);
    labelAna.appendChild(spanAna);
    detail.appendChild(labelAna);
    detail.appendChild(el('div', { class: 'os-c-meta', text: 'Comprendre comment tu utilises le site (anonymisé).' }));

    const labelMkt = el('label');
    const cbMkt = el('input', { type: 'checkbox', id: 'os-c-marketing' });
    const spanMkt = document.createElement('span');
    spanMkt.appendChild(el('b', { text: 'Marketing' }));
    spanMkt.appendChild(document.createTextNode(' — Meta Pixel'));
    labelMkt.appendChild(cbMkt);
    labelMkt.appendChild(spanMkt);
    detail.appendChild(labelMkt);
    detail.appendChild(el('div', { class: 'os-c-meta', text: 'Reciblage publicitaire Facebook/Instagram.' }));

    wrapper.appendChild(detail);
    document.body.appendChild(wrapper);

    let customizing = false;
    wrapper.addEventListener('click', (e) => {
      const target = e.target.closest('button');
      if (!target) return;
      const act = target.getAttribute('data-act');
      if (act === 'accept') {
        consent.grant({ analytics: true, marketing: true });
      } else if (act === 'essential') {
        consent.grant({ analytics: false, marketing: false });
      } else if (act === 'customize') {
        if (!customizing) {
          detail.classList.add('show');
          btnCustomize.textContent = 'Valider mon choix';
          customizing = true;
        } else {
          const ana = document.getElementById('os-c-analytics').checked;
          const mkt = document.getElementById('os-c-marketing').checked;
          consent.grant({ analytics: ana, marketing: mkt });
        }
      }
    });
  }

  function hideConsentBanner() {
    const el = document.getElementById('os-consent');
    if (el) el.remove();
  }

  // ─── Auto-tracking: scroll depth ────────────────────
  const scrollMilestones = [25, 50, 75, 100];
  const scrollFired = new Set();
  const onScroll = throttle(() => {
    const doc = document.documentElement;
    const scrollTop = window.scrollY || doc.scrollTop;
    const scrollHeight = doc.scrollHeight - doc.clientHeight;
    if (scrollHeight <= 0) return;
    const pct = Math.round((scrollTop / scrollHeight) * 100);
    for (const m of scrollMilestones) {
      if (pct >= m && !scrollFired.has(m)) {
        scrollFired.add(m);
        track('scroll_depth', { depth_pct: m });
      }
    }
  }, 400);

  // ─── Auto-tracking: section visibility ──────────────
  const sectionMap = {
    'hero': 'section_hero_viewed',
    'cards': 'section_realisations_viewed',
    'process': 'section_process_viewed',
    'testi': 'section_testimonials_viewed',
    'pricing': 'section_pricing_viewed',
    'faq': 'section_faq_viewed',
    'osp-ba': 'section_case_fixlyy_viewed',
  };
  const sectionFired = new Set();
  function observeSections() {
    if (!('IntersectionObserver' in window)) return;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
          const id = entry.target.id || (entry.target.className || '').toString().split(' ')[0];
          const evt = sectionMap[id];
          if (evt && !sectionFired.has(evt)) {
            sectionFired.add(evt);
            track(evt, { section_id: id });
          }
        }
      });
    }, { threshold: 0.5 });
    Object.keys(sectionMap).forEach((sel) => {
      document.querySelectorAll('#' + CSS.escape(sel) + ', .' + CSS.escape(sel)).forEach((el) => obs.observe(el));
    });
  }

  // ─── Auto-tracking: data-track clicks + smart CTA detection ───
  function bindClickTracking() {
    document.addEventListener('click', (e) => {
      const tracked = e.target.closest('[data-track]');
      if (tracked) {
        const eventName = tracked.getAttribute('data-track');
        const props = {};
        const ds = tracked.dataset || {};
        Object.keys(ds).forEach((k) => {
          if (k.startsWith('trackProp')) {
            const key = k.replace('trackProp', '').toLowerCase();
            props[key] = ds[k];
          }
        });
        track(eventName, props);
      }

      const onclickEl = e.target.closest('[onclick]');
      if (onclickEl) {
        const code = onclickEl.getAttribute('onclick') || '';
        const text = (onclickEl.textContent || '').trim().slice(0, 60);
        if (code.indexOf('Calendly') !== -1) {
          track('cta_calendly_click', { source_text: text });
        } else if (code.indexOf('showCommande') !== -1) {
          track('cta_commande_click', { source_text: text });
        } else if (code.indexOf('showRecrutement') !== -1) {
          track('cta_recrutement_click');
        } else if (code.indexOf('loadVSL') !== -1) {
          track('vsl_play_click');
        } else if (code.indexOf('navTo') !== -1) {
          const m = code.match(/navTo\('([^']+)'\)/);
          if (m) track('nav_click', { target: m[1] });
        }
      }

      const link = e.target.closest('a[href]');
      if (link && link.href) {
        const href = link.href;
        if (href.indexOf('mailto:') === 0) {
          track('cta_email_click', { href });
        } else if (href.indexOf('tel:') === 0) {
          track('cta_phone_click', { href });
        } else if (href.indexOf('wa.me') !== -1 || href.indexOf('whatsapp') !== -1) {
          track('cta_whatsapp_click', { href });
        } else if (href.indexOf(location.origin) !== 0 && href.indexOf('#') !== 0) {
          let host = null;
          try { host = new URL(href).hostname; } catch (err) {}
          if (host && host !== location.hostname) {
            track('outbound_click', { url: href, host });
          }
        }
      }
    }, true);
  }

  // ─── Auto-tracking: rage clicks ─────────────────────
  let rageClickBuffer = [];
  function detectRageClicks() {
    document.addEventListener('click', (e) => {
      const now = Date.now();
      rageClickBuffer.push({ t: now, x: e.clientX, y: e.clientY });
      rageClickBuffer = rageClickBuffer.filter((c) => now - c.t < 1000);
      if (rageClickBuffer.length >= 3) {
        const last = rageClickBuffer[rageClickBuffer.length - 1];
        const sameZone = rageClickBuffer.every((c) => Math.abs(c.x - last.x) < 40 && Math.abs(c.y - last.y) < 40);
        if (sameZone) {
          const target = e.target.closest('a,button,[onclick]') || e.target;
          track('rage_click', {
            element: target.tagName,
            text: (target.textContent || '').trim().slice(0, 60),
            id: target.id || null,
            class: target.className ? String(target.className) : null,
          });
          rageClickBuffer = [];
        }
      }
    });
  }

  // ─── Auto-tracking: dead clicks ─────────────────────
  function detectDeadClicks() {
    document.addEventListener('click', (e) => {
      const target = e.target;
      const isClickable = target.closest('a,button,[onclick],input[type="submit"],input[type="button"],label,select,[role="button"]');
      if (!isClickable && (target.tagName === 'IMG' || target.tagName === 'SPAN' || target.tagName === 'DIV')) {
        const cursor = getComputedStyle(target).cursor;
        if (cursor !== 'pointer') return;
        track('dead_click', {
          element: target.tagName,
          text: (target.textContent || '').trim().slice(0, 60),
          id: target.id || null,
        });
      }
    });
  }

  // ─── Auto-tracking: JS errors ───────────────────────
  function trackErrors() {
    window.addEventListener('error', (e) => {
      track('js_error', {
        message: e.message,
        source: e.filename,
        line: e.lineno,
        col: e.colno,
      });
    });
    window.addEventListener('unhandledrejection', (e) => {
      track('js_promise_rejection', { reason: String(e.reason).slice(0, 200) });
    });
  }

  // ─── Auto-tracking: form interactions ───────────────
  function trackForms() {
    document.addEventListener('focusin', (e) => {
      if (e.target.matches && e.target.matches('input,textarea,select')) {
        const form = e.target.closest('form');
        if (!form) return;
        if (!form.dataset.osFormStarted) {
          form.dataset.osFormStarted = '1';
          track('form_started', {
            form_id: form.id || form.name || 'unknown',
            first_field: e.target.name || e.target.id,
          });
        }
      }
    });

    document.addEventListener('submit', (e) => {
      const form = e.target;
      track('form_submitted', {
        form_id: form.id || form.name || 'unknown',
        action: form.action || null,
      });
    });
  }

  // ─── Time on page ───────────────────────────────────
  const pageStart = Date.now();
  const pageBuckets = new Set();
  const timeBuckets = [10, 30, 60, 120, 300];
  setInterval(() => {
    const elapsed = Math.floor((Date.now() - pageStart) / 1000);
    for (const b of timeBuckets) {
      if (elapsed >= b && !pageBuckets.has(b)) {
        pageBuckets.add(b);
        track('time_on_page', { seconds: b });
      }
    }
  }, 5000);

  window.addEventListener('pagehide', () => {
    track('page_left', { duration_s: Math.floor((Date.now() - pageStart) / 1000) });
  });

  // ─── Init ───────────────────────────────────────────
  function init() {
    loadVercelAnalytics();

    if (consent.status() && consent.status().granted !== undefined) {
      bootTrackers();
    } else {
      buildConsentBanner();
    }

    observeSections();
    bindClickTracking();
    detectRageClicks();
    detectDeadClicks();
    trackErrors();
    trackForms();
    window.addEventListener('scroll', onScroll, { passive: true });

    track('page_view', {
      title: document.title,
      path: location.pathname,
      search: location.search,
    });
  }

  window.os = { track, identify, consent };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
