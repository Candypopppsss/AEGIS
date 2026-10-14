import React, { useEffect, useRef, useState } from 'react';

function drawLines(paths, progress) {
  const shield = [[210, 38], [318, 80], [305, 172], [210, 262], [115, 172], [102, 80], [210, 38]];
  const reveal = Math.max(0, Math.min(1, (progress - .55) / .45));
  const blend = reveal * reveal * (3 - 2 * reveal);
  const fold = Math.sin(progress * Math.PI);
  for (const [index, path] of paths.entries()) {
    const band = index - (paths.length - 1) / 2;
    const scale = .48 + index / (paths.length - 1) * .52;
    let previousY;
    const points = Array.from({ length: 61 }, (_, point) => {
      const u = point / 60;
      const wave = Math.sin(u * Math.PI * 2 + progress * Math.PI + band * .07);
      const x = 30 + u * 360;
      const y = 150 + band * 10 + wave * (20 + fold * 30);
      const edge = Math.min(5, Math.floor(u * 6));
      const t = u * 6 - edge;
      const targetX = 210 + (shield[edge][0] + (shield[edge + 1][0] - shield[edge][0]) * t - 210) * scale;
      const targetY = 145 + (shield[edge][1] + (shield[edge + 1][1] - shield[edge][1]) * t - 145) * scale;
      const currentX = x + (targetX - x) * blend;
      const currentY = y + (targetY - y) * blend;
      const stepX = Math.round(currentX / 6) * 6;
      const stepY = Math.round(currentY / 6) * 6;
      const lineX = stepX + (currentX - stepX) * blend;
      const lineY = stepY + (currentY - stepY) * blend;
      const cornerY = point ? previousY + (lineY - previousY) * blend : lineY;
      previousY = lineY;
      return point
        ? `L${lineX.toFixed(1)},${cornerY.toFixed(1)} L${lineX.toFixed(1)},${lineY.toFixed(1)}`
        : `M${lineX.toFixed(1)},${lineY.toFixed(1)}`;
    });
    path.setAttribute('d', points.join(' ') + (blend === 1 ? ' Z' : ''));
  }
}

export default function Landing({ onSignIn }) {
  const root = useRef(null);
  const navigation = useRef(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const header = root.current.querySelector('.landing-header');
    const runway = root.current.querySelector('.landing-runway');
    const viewport = root.current.querySelector('.landing-viewport');
    const illustration = root.current.querySelector('.line-weave');
    const paths = [...illustration.querySelectorAll('.line-contours path')];
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame, headerHeight, distance;
    function drawScene(progress) {
      drawLines(paths, progress);
      illustration.style.opacity = .65 - Math.sin(progress * Math.PI) * .45;
    }
    function measure() {
      headerHeight = header.offsetHeight;
      root.current.style.setProperty('--header-height', `${headerHeight}px`);
      distance = viewport.clientWidth * 2;
      runway.style.height = `${viewport.clientHeight + (motion.matches ? 0 : distance)}px`;
      if (motion.matches) drawScene(1);
      update();
    }
    function update() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (motion.matches) return;
        const offset = Math.min(distance, Math.max(0, headerHeight - runway.getBoundingClientRect().top));
        viewport.scrollLeft = offset;
        const progress = offset / distance;
        drawScene(progress);
        setActive(Math.min(2, Math.round(offset / viewport.clientWidth)));
      });
    }
    function goTo(index) {
      const target = Math.max(0, Math.min(2, index));
      if (motion.matches) {
        viewport.scrollLeft = target * viewport.clientWidth;
        setActive(target);
      } else {
        const top = window.scrollY + runway.getBoundingClientRect().top - headerHeight;
        window.scrollTo({ top: top + target * viewport.clientWidth, behavior: 'auto' });
      }
    }
    function focus(event) {
      const slide = event.target.closest('.landing-slide');
      if (slide) goTo(Number(slide.dataset.index));
    }
    function horizontalScroll() {
      if (motion.matches) setActive(Math.min(2, Math.round(viewport.scrollLeft / viewport.clientWidth)));
    }
    navigation.current = goTo;
    measure();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', measure);
    motion.addEventListener('change', measure);
    viewport.addEventListener('focusin', focus);
    viewport.addEventListener('scroll', horizontalScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      navigation.current = null;
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', measure);
      motion.removeEventListener('change', measure);
      viewport.removeEventListener('focusin', focus);
      viewport.removeEventListener('scroll', horizontalScroll);
    };
  }, []);

  return (
    <div className="landing" ref={root}>
      <header className="landing-header">
        <button className="brand home-button" onClick={() => navigation.current?.(0)}>AEGIS</button>
        <button className="nav-link" onClick={() => navigation.current?.(1)}>How it works</button>
        <button className="primary" onClick={onSignIn}>Sign in</button>
      </header>
      <svg className="line-weave" viewBox="0 0 420 300" aria-hidden="true" focusable="false">
        <defs><linearGradient id="line-accent" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#a7a7a7" /><stop offset=".3" stopColor="#c4c4c4" /><stop offset=".65" stopColor="#9e9e9e" /><stop offset="1" stopColor="#bababa" /></linearGradient></defs>
        <g className="line-contours">{Array.from({ length: 12 }, (_, index) => <path key={index} fill="none" stroke="url(#line-accent)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}</g>
      </svg>
      <main className="landing-runway">
        <div className="landing-viewport">
          <div className="landing-track">
            <section className="landing-slide landing-intro" data-index="0" aria-labelledby="intro-title">
              <div className="slide-content">
                <p className="eyebrow">Decision load and protected time</p>
                <h1 id="intro-title">Track your daily decision load.</h1>
                <p className="intro-description">Log digital activities, review their estimated cost, and schedule time for focused work.</p>
                <div className="hero-actions"><button className="primary" onClick={onSignIn}>Get started</button><button className="text-button" onClick={() => navigation.current?.(1)}>Explore AEGIS</button></div>
              </div>
            </section>
            <section className="landing-slide landing-details" data-index="1" aria-labelledby="details-title">
              <div className="slide-content">
                <p className="eyebrow">How it works</p>
                <h2 id="details-title">Log activities. Schedule focus time.</h2>
                <div className="feature-grid">
                  <article><span className="feature-number">01</span><h3>Understand your load</h3><p>Log notifications, app switches, replies, and form inputs. See their estimated cost in your daily decision battery.</p></article>
                  <article><span className="feature-number">02</span><h3>Protect your time</h3><p>Schedule a protect zone. Notification records are held from 15 minutes before it starts and released as one batch when it ends.</p></article>
                  <article><span className="feature-number">03</span><h3>Review your day</h3><p>See where your points went in your daily summary. Your battery resets each day in your timezone.</p></article>
                </div>
                <p className="product-note">Events are logged manually. AEGIS does not monitor other apps or silence device notifications.</p>
              </div>
            </section>
            <section className="landing-slide landing-finish" data-index="2" aria-labelledby="finish-title">
              <div className="slide-content">
                <p className="eyebrow">Start with AEGIS</p>
                <h2 id="finish-title">Start logging your day.</h2>
                <p className="intro-description">Create an account to log activities and schedule your first protect zone.</p>
                <button className="primary" onClick={onSignIn}>Start with AEGIS</button>
                <footer className="landing-footer"><span className="brand">AEGIS</span><span>Daily activity tracking and focus planning.</span></footer>
              </div>
            </section>
          </div>
        </div>
        <nav className="slide-controls" aria-label="Landing page sections">
          <div><button disabled={active === 0} onClick={() => navigation.current?.(active - 1)} aria-label="Previous section">Previous</button><span aria-live="polite">0{active + 1} / 03</span><button disabled={active === 2} onClick={() => navigation.current?.(active + 1)} aria-label="Next section">Next</button></div>
        </nav>
      </main>
    </div>
  );
}
