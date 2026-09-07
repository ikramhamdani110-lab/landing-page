/* TALORA — animation & interaction system */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Sidebar ---------- */
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

// Close sidebar when clicking on a link
const navLinks = document.querySelectorAll('.mobile-nav a');
navLinks.forEach(link => {
    link.addEventListener('click', () => {
        sideBar.classList.remove("open-sidebar");
        document.body.style.overflow = 'auto';
    });
});

// Smooth scrolling + hero replay on Home
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
                // give the scroll time to land, then replay the hero timeline
                setTimeout(playHero, reduceMotion ? 0 : 800);
            }
        }
    });
});

/* ---------- Hero typewriter removed ---------- */
// Typing animation removed per user request

/* ---------- Studio timeline reveals (GSAP ScrollTrigger) ---------- */
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

/* ---------- Build With TALORA — orbital cards ---------- */
const caps = document.querySelectorAll('#orbitalCards .cap-card');
const capCount = caps.length;
let activeCap = 0;
let orbitTimer = null;
let orbitAnimating = false;

function layoutOrbit(animate = true) {
    caps.forEach((card, i) => {
        const offset = ((i - activeCap) % capCount + capCount) % capCount; // 0 = front, 1..3 behind
        const angles = [0, 155, 180, 205];
        const angle = angles[offset] * (Math.PI / 180);
        const vw = window.innerWidth;
        // Cards positioned ON the orbital path - match the ring dimensions (1200x580)
        const radiusX = offset === 0 ? 0 : (vw < 640 ? 150 : vw < 900 ? 250 : vw < 1200 ? 380 : 500);
        const radiusY = offset === 0 ? 0 : (vw < 640 ? 75 : vw < 900 ? 125 : vw < 1200 ? 185 : 250);
        const x = Math.sin(angle) * radiusX;
        const y = -Math.cos(angle) * radiusY;
        // Use opacity instead of blur for better performance on background cards
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

// Swipe support for Build section
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

    // Trackpad/mouse swipe support
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
            // Swipe right - previous
            setActiveCap(activeCap - 1);
        } else {
            // Swipe left - next
            setActiveCap(activeCap + 1);
        }
    }
}

layoutOrbit(false);
restartOrbitTimer();

// Debounced resize handler for better performance
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => layoutOrbit(false), 150);
});

/* ---------- Join TALORA — simple auto-rotating card ---------- */
const joinStates = [
    { title: 'Meaningful Projects', text: 'Work on real client projects matched to what you do best, in close collaboration.' },
    { title: 'Grow & Earn', text: 'Build experience with every project and get paid for the work you complete.' }
];
const joinCard = document.getElementById('joinCard');
const joinTitle = document.getElementById('joinTitle');
const joinText = document.getElementById('joinText');
const joinDots = document.querySelectorAll('.join-dot');
let joinIdx = 0, joinTimer = null, joinAnimating = false, joinHover = false;

function setJoinContent(i) {
    joinTitle.textContent = joinStates[i].title;
    joinText.textContent = joinStates[i].text;
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

    // one physical card slides DOWN out of view, content swaps, card returns from above
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

/* ---------- Contact audience selector ---------- */
const audienceBtns = document.querySelectorAll('.audience-btn');
const audienceInput = document.getElementById('audienceInput');

audienceBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        audienceBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        audienceInput.value = btn.dataset.audience;
    });
});

/* ---------- Mobile adjustments ---------- */
function isMobileDevice() {
    return (typeof window.orientation !== 'undefined') || navigator.userAgent.indexOf('IEMobile') !== -1;
}

if (isMobileDevice()) {
    document.documentElement.classList.add('mobile-device');
    document.querySelectorAll('.autoBlur').forEach(el => {
        el.style.animation = 'none';
    });
}

/* ---------- Play hero on load ---------- */
window.addEventListener('load', playHero);