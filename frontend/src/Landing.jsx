import React from 'react';

export default function Landing({ onSignIn }) {
  return (
    <div className="landing">
      <header className="landing-header">
        <a className="brand" href="#intro">AEGIS</a>
        <a className="nav-link" href="#how-it-works">How it works</a>
        <button className="primary" onClick={onSignIn}>Sign in</button>
      </header>
      <main>
        <section className="landing-intro" id="intro" aria-labelledby="intro-title">
          <p className="eyebrow">Activity tracking and focus planning</p>
          <h1 id="intro-title">Track your daily decision load.</h1>
          <p className="intro-description">Log notifications, app switches, replies, and form inputs. See their estimated cost and plan time for focused work.</p>
          <button className="primary" onClick={onSignIn}>Get started</button>
        </section>
        <section className="landing-details" id="how-it-works" aria-labelledby="details-title">
          <h2 id="details-title">How it works</h2>
          <div className="feature-grid">
            <article><h3>Log activities</h3><p>Your daily battery starts at 100 points. Each activity reduces it by its assigned cost.</p></article>
            <article><h3>Schedule focus time</h3><p>Protect zones hold notification records from 15 minutes before they start. When a zone ends, those records count as one batch.</p></article>
            <article><h3>Review your day</h3><p>Check your activity history and daily summary. Your battery resets at midnight in your timezone.</p></article>
          </div>
          <p className="product-note">Activities are logged manually. AEGIS does not monitor other apps or silence device notifications. Battery points are an estimate.</p>
        </section>
      </main>
      <footer className="landing-footer"><span className="brand">AEGIS</span><span>Activity tracking and focus planning.</span></footer>
    </div>
  );
}
