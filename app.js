const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const sideBar = document.querySelector('.sidebar');
const menu = document.querySelector('.menu-icon');
const closeIcon = document.querySelector('.close-icon');

menu.addEventListener("click", function() {
    sideBar.classList.add("open-sidebar");
    document.body.style.overflow = 'hidden';
});

closeIcon.addEventListener("click", function() {
    sideBar.classList.remove("open-sidebar");
    document.body.style.overflow = 'auto';
});

const navLinks = document.querySelectorAll('.mobile-nav a');
navLinks.forEach(link => {
    link.addEventListener('click', () => {
        sideBar.classList.remove("open-sidebar");
        document.body.style.overflow = 'auto';
    });
});

function playHero() {
    if (reduceMotion) return;
    gsap.killTweensOf('.hero-info > *');
    gsap.set('.hero-constellation span', { clearProps: 'all' });
    gsap.timeline()
        .from('.hero-badge', { y: -20, opacity: 0, duration: 0.7, ease: 'power2.out' })
        .from('.hero-headline', { y: 40, opacity: 0, duration: 1, ease: 'power3.out' }, '-=0.3')
        .from('.hero-description', { opacity: 0, duration: 0.6 }, '-=0.4')
        .from('.hero-constellation span', {
            scale: 0, opacity: 0, duration: 0.8, stagger: 0.08, ease: 'back.out(1.5)'
        }, '-=0.6');
}

document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
        e.preventDefault();

        const targetId = this.getAttribute('href');
        if (targetId === '#') return;

        const targetElement = document.querySelector(targetId);
        if (targetElement) {
            window.scrollTo({
                top: targetElement.offsetTop - 70,
                behavior: reduceMotion ? 'auto' : 'smooth'
            });
            if (targetId === '#home') {
                setTimeout(playHero, reduceMotion ? 0 : 800);
            }
        }
    });
});

/* Scroll spy: highlight nav link (blue underline) for the section in view */
(function initScrollSpy() {
    const navLinks = document.querySelectorAll('.desktop-nav li a[href^="#"], .mobile-nav li a[href^="#"]');
    if (!navLinks.length) return;

    const sections = [...navLinks]
        .map(a => document.querySelector(a.getAttribute('href')))
        .filter(Boolean);

    function setActive(id) {
        navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === id));
    }

    function update() {
        const probe = window.scrollY + window.innerHeight * 0.35;
        let current = sections[0];
        for (const s of sections) {
            if (s.offsetTop <= probe) current = s;
        }
        setActive(current ? '#' + current.id : '');
    }

    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
})();

if (window.gsap && window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);

    if (!reduceMotion) {
        document.querySelectorAll('.timeline-item').forEach(item => {
            const fromX = item.classList.contains('left') ? -60 : 60;
            gsap.from(item.querySelector('.timeline-content'), {
                x: fromX, opacity: 0, scale: 0.96, duration: 0.9, ease: 'power2.out',
                scrollTrigger: { trigger: item, start: 'top 80%', toggleActions: 'play none none reverse' }
            });
        });

        gsap.fromTo('.timeline-line', { scaleY: 0, transformOrigin: 'top center' }, {
            scaleY: 1, ease: 'none',
            scrollTrigger: { trigger: '.timeline', start: 'top 70%', end: 'bottom 70%', scrub: 0.5 }
        });
    }
}

const caps = document.querySelectorAll('#orbitalCards .cap-card');
const capCount = caps.length;
let activeCap = 0;
let orbitTimer = null;
let orbitAnimating = false;

function layoutOrbit(animate = true) {
    caps.forEach((card, i) => {
        const offset = ((i - activeCap) % capCount + capCount) % capCount;
        const angles = [0, 155, 180, 205];
        const angle = angles[offset] * (Math.PI / 180);
        const vw = window.innerWidth;
        const radiusX = offset === 0 ? 0 : (vw < 640 ? 150 : vw < 900 ? 250 : vw < 1200 ? 380 : 500);
        const radiusY = offset === 0 ? 0 : (vw < 640 ? 75 : vw < 900 ? 125 : vw < 1200 ? 185 : 250);
        const x = Math.sin(angle) * radiusX;
        const y = -Math.cos(angle) * radiusY;
        const cfg = offset === 0
            ? { scale: 1, opacity: 1, filter: 'blur(0px)', zIndex: 10 }
            : { scale: 0.78, opacity: 0.25, filter: 'blur(0px)', zIndex: 5 - offset };
        if (card._capTween) card._capTween.kill();
        card._capTween = gsap.to(card, { x, y, ...cfg, duration: animate && !reduceMotion ? 1.1 : 0, ease: 'power2.inOut' });
    });
}

function setActiveCap(index) {
    if (orbitAnimating) return;
    orbitAnimating = true;
    activeCap = ((index % capCount) + capCount) % capCount;
    layoutOrbit(true);
    setTimeout(() => { orbitAnimating = false; }, reduceMotion ? 50 : 1150);
    restartOrbitTimer();
}

function restartOrbitTimer() {
    clearTimeout(orbitTimer);
    if (!reduceMotion) orbitTimer = setTimeout(() => setActiveCap(activeCap + 1), 4500);
}

let touchStartX = 0;
let touchEndX = 0;
const orbitalStage = document.querySelector('.orbital-stage');

if (orbitalStage) {
    orbitalStage.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    orbitalStage.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }, { passive: true });

    let mouseDown = false;
    let mouseStartX = 0;

    orbitalStage.addEventListener('mousedown', (e) => {
        mouseDown = true;
        mouseStartX = e.clientX;
    });

    orbitalStage.addEventListener('mouseup', (e) => {
        if (mouseDown) {
            const deltaX = e.clientX - mouseStartX;
            if (Math.abs(deltaX) > 50) {
                if (deltaX > 0) setActiveCap(activeCap - 1);
                else setActiveCap(activeCap + 1);
            }
        }
        mouseDown = false;
    });

    orbitalStage.addEventListener('mouseleave', () => {
        mouseDown = false;
    });
}

function handleSwipe() {
    const swipeThreshold = 50;
    const deltaX = touchEndX - touchStartX;

    if (Math.abs(deltaX) > swipeThreshold) {
        if (deltaX > 0) {
            setActiveCap(activeCap - 1);
        } else {
            setActiveCap(activeCap + 1);
        }
    }
}

layoutOrbit(false);
restartOrbitTimer();

let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => layoutOrbit(false), 150);
});

const joinStates = [
    { title: 'Meaningful Projects', text: 'Work on real client projects matched to what you do best, in close collaboration.' },
    { title: 'Grow & Earn', text: 'Build experience with every project and get paid for the work you complete.' }
];
// CMS-managed join states (set by site-content.js from the database)
const joinStateSource = () => (window.TALORA_JOIN_STATES || joinStates);
const joinCard = document.getElementById('joinCard');
const joinTitle = document.getElementById('joinTitle');
const joinText = document.getElementById('joinText');
const joinDots = document.querySelectorAll('.join-dot');
let joinIdx = 0, joinTimer = null, joinAnimating = false, joinHover = false;

function setJoinContent(i) {
    const states = joinStateSource();
    const idx = ((i % states.length) + states.length) % states.length;
    joinTitle.textContent = states[idx].title;
    joinText.textContent = states[idx].text;
    joinDots.forEach((d, k) => d.classList.toggle('active', k === i));
}

function gotoJoinState(i) {
    if (joinAnimating) return;
    const next = ((i % joinStates.length) + joinStates.length) % joinStates.length;
    const changed = next !== joinIdx || !joinCard.dataset.initialized;
    joinCard.dataset.initialized = '1';
    joinIdx = next;
    restartJoinTimer();

    if (!changed) return;
    if (reduceMotion) { setJoinContent(next); return; }

    joinAnimating = true;
    gsap.to(joinCard, {
        y: 120, opacity: 0, duration: 0.55, ease: 'power2.in',
        onComplete: () => {
            setJoinContent(next);
            gsap.fromTo(joinCard,
                { y: -120, opacity: 0 },
                { y: 0, opacity: 1, duration: 0.65, ease: 'power2.out',
                  onComplete: () => { joinAnimating = false; } }
            );
        }
    });
}

function restartJoinTimer() {
    clearTimeout(joinTimer);
    if (!reduceMotion && !joinHover) joinTimer = setTimeout(() => gotoJoinState(joinIdx + 1), 4200);
}

joinDots.forEach(d => d.addEventListener('click', () => gotoJoinState(parseInt(d.dataset.state))));
joinCard.addEventListener('mouseenter', () => { joinHover = true; clearTimeout(joinTimer); });
joinCard.addEventListener('mouseleave', () => { joinHover = false; restartJoinTimer(); });
setJoinContent(0);
restartJoinTimer();

const audienceBtns = document.querySelectorAll('.audience-btn');
const audienceInput = document.getElementById('audienceInput');

audienceBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        audienceBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        audienceInput.value = btn.dataset.audience;
    });
});

/* ---- Contact form submission (POST /api/contact) ---- */
const contactForm = document.getElementById('contact-form');
const submitBtn = contactForm.querySelector('button[type="submit"]');
const toast = document.getElementById('taloraToast');
const toastTitle = document.getElementById('toastTitle');
const toastText = document.getElementById('toastText');
const toastIcon = document.getElementById('toastIcon');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
let isSubmitting = false;
let toastTimer = null;

function showToast(success, title, text) {
    toastTitle.textContent = title;
    toastText.textContent = text;
    toast.classList.toggle('error', !success);
    toastIcon.innerHTML = success ? "<i class='bx bx-check'></i>" : "<i class='bx bx-error'></i>";
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add('visible'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 6000);
}

function hideToast() {
    toast.classList.remove('visible');
    setTimeout(() => { toast.hidden = true; }, 350);
}

document.getElementById('toastClose').addEventListener('click', hideToast);

contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmitting) return; // prevent duplicate submissions

    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const message = document.getElementById('message').value.trim();
    const subjectField = document.getElementById('subject');
    const subject = (subjectField && subjectField.value.trim())
        || (audienceInput.value === 'join' ? 'Join TALORA' : 'Start a Project');

    if (!name || !email || !message || !subject) {
        showToast(false, 'Please complete all required fields.', 'Fill in your name, email, and message before sending.');
        return;
    }
    if (!EMAIL_RE.test(email)) {
        showToast(false, 'Please enter a valid email address.', 'The email you entered does not look right. Please check it and try again.');
        return;
    }

    isSubmitting = true;
    const originalHtml = submitBtn.innerHTML;
    submitBtn.classList.add('sending');
    submitBtn.innerHTML = "Sending... <i class='bx bx-loader-alt bx-spin'></i>";
    hideToast();

    try {
        const res = await fetch('/api/contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, subject, message })
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok && data.success) {
            contactForm.reset();
            const t = window.TALORA_TOAST_SUCCESS || {};
            showToast(true, t.title || 'Message Sent Successfully', t.text || 'Thank you for reaching out to TALORA. Your inquiry has been received.');
        } else if (res.status === 400) {
            showToast(false, data.message || 'Please complete all required fields.', 'Please check your details and try again.');
        } else {
            showToast(false, 'Unable to send your message.', 'Something went wrong on our side. Please try again in a moment.');
        }
    } catch {
        showToast(false, 'Unable to send your message.', 'A network error occurred. Please check your connection and try again.');
    } finally {
        isSubmitting = false;
        submitBtn.classList.remove('sending');
        submitBtn.innerHTML = originalHtml;
    }
});

function isMobileDevice() {
    return (typeof window.orientation !== 'undefined') || navigator.userAgent.indexOf('IEMobile') !== -1;
}

if (isMobileDevice()) {
    document.documentElement.classList.add('mobile-device');
    document.querySelectorAll('.autoBlur').forEach(el => {
        el.style.animation = 'none';
    });
}

window.addEventListener('load', playHero);
/* ---------- Navbar authentication state ----------
   Checks the existing token (if any) against GET /api/auth/me.
   Logged in  -> shows Account / Logout
   Logged out -> shows Log In / Sign Up                                   */
(function () {
    const TOKEN_KEY = 'talora_user_token';
    const loggedOut = document.querySelectorAll('.auth-nav');
    const loggedIn = document.querySelectorAll('.auth-nav-logged-in');

    function setState(authed) {
        loggedOut.forEach(el => { el.style.display = authed ? 'none' : ''; });
        loggedIn.forEach(el => { el.style.display = authed ? '' : 'none'; });
    }

    async function logout() {
        try {
            const token = sessionStorage.getItem(TOKEN_KEY);
            if (token) {
                await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
            }
        } catch (_) { /* best effort — clear locally regardless */ }
        try { sessionStorage.removeItem(TOKEN_KEY); } catch (_) {}
        setState(false);
        window.location.href = 'index.html';
    }

    document.querySelectorAll('#navLogoutBtn, .nav-logout-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            logout();
        });
    });

    (async function init() {
        let token = null;
        try { token = sessionStorage.getItem(TOKEN_KEY); } catch (_) {}
        if (!token) { setState(false); return; }
        try {
            const res = await fetch('/api/auth/me', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            // Valid user session -> Account / Logout; anything else (401, expired,
            // revoked, or an admin token) -> Log In / Sign Up
            if (res.ok) {
                const data = await res.json();
                if (data && data.user) { setState(true); return; }
            }
            setState(false);
        } catch (_) {
            setState(false); // network issue — show default logged-out nav
        }
    })();
})();

/* ============================================================
   Services (Task 6) — loaded dynamically from the backend.
   DATABASE -> GET /api/services -> this section.
   No hardcoded service list: the database is the source of truth.
   ============================================================ */
(function () {
    'use strict';

    const grid = document.getElementById('servicesGrid');
    if (!grid) return;

    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    function showState(html) {
        grid.innerHTML = '<div class="services-state">' + html + '</div>';
    }

    function renderServices(items) {
        if (!items.length) {
            showState('<i class=\'bx bx-package\'></i> No services are currently available.');
            return;
        }
        grid.innerHTML = items.map(s => `
            <article class="service-card">
                <div class="cap-icon"><i class='bx ${esc(s.icon) || 'bx-customize'}'></i></div>
                <h3>${esc(s.title)}</h3>
                <p>${esc(s.description)}</p>
            </article>`).join('');
    }

    (async function loadServices() {
        showState('<i class=\'bx bx-loader-alt bx-spin\'></i> Loading services…');
        try {
            const res = await fetch('/api/services');
            if (!res.ok) throw new Error('status ' + res.status);
            const data = await res.json();
            renderServices(Array.isArray(data.items) ? data.items : []);
        } catch (_) {
            // Never expose internal errors to visitors
            showState('<i class=\'bx bx-cloud-lightning\'></i> Services are temporarily unavailable. Please try again later.');
        }
    })();
})();
