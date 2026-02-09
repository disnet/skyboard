<script lang="ts">
  import LoginForm from "./LoginForm.svelte";

  const features = [
    {
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
      title: "Own Your Data",
      description:
        "All boards are public and stored in your AT Protocol Personal Data Server. No vendor lock-in \u2014 take your data anywhere.",
    },
    {
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
      title: "Real-time Collaboration",
      description:
        "Changes sync instantly between collaborators. Everyone sees the same board, updated live.",
    },
    {
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>`,
      title: "Works Offline",
      description:
        "Full offline support with local storage. Make changes anytime and they sync when you reconnect.",
    },
    {
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
      title: "Trust & Permissions",
      description:
        "Granular control over who can create, edit, or move tasks. Per-column rules and a trust-based approval system.",
    },
    {
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
      title: "Public by Default",
      description:
        "Every board is public and linkable. Anyone can view your boards without signing in \u2014 no account required to browse.",
    },
    {
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><circle cx="4" cy="12" r="2"/><circle cx="20" cy="12" r="2"/><line x1="6" y1="12" x2="10" y2="12"/><line x1="14" y1="12" x2="18" y2="12"/><circle cx="12" cy="4" r="2"/><circle cx="12" cy="20" r="2"/><line x1="12" y1="6" x2="12" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/></svg>`,
      title: "Open & Decentralized",
      description:
        "Built on open AT Protocol standards. No central server. Interoperable with the Bluesky ecosystem.",
    },
  ];

  const steps = [
    {
      title: "Sign in",
      description:
        "Use your Bluesky handle or any AT Protocol identity. OAuth keeps your credentials safe.",
    },
    {
      title: "Create & collaborate",
      description:
        "Make boards with customizable columns. Share a link and work together in real time.",
    },
    {
      title: "You own it",
      description:
        "Everything is stored in your Personal Data Server. Export, migrate, or build on top of your own data.",
    },
  ];
</script>

<div class="landing">
  <header class="landing-header">
    <span class="logo">Skyboard</span>
  </header>

  <section class="hero">
    <div class="hero-content">
      <div class="hero-text">
        <h1>Kanban boards you actually own</h1>
        <p class="hero-subtitle">
          Collaborative project management built on the AT Protocol. All boards
          are public and stored in your Personal Data Server &mdash; transparent
          by default, owned by you.
        </p>
      </div>
      <div class="hero-form">
        <LoginForm />
      </div>
    </div>
  </section>

  <section class="features">
    <div class="section-content">
      <h2>Why Skyboard</h2>
      <div class="features-grid">
        {#each features as feature}
          <div class="feature-card">
            <div class="feature-icon">
              {@html feature.icon}
            </div>
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="how-it-works">
    <div class="section-content">
      <h2>How it works</h2>
      <div class="steps">
        {#each steps as step, i}
          <div class="step">
            <div class="step-number">{i + 1}</div>
            <h3>{step.title}</h3>
            <p>{step.description}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <footer class="landing-footer">
    <p>
      Built on <a
        href="https://atproto.com"
        target="_blank"
        rel="noopener noreferrer">AT Protocol</a
      >
      &middot;
      <a
        href="https://github.com/disnet/skyboard"
        target="_blank"
        rel="noopener noreferrer">GitHub</a
      >
    </p>
  </footer>
</div>

<style>
  .landing {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  /* Header */
  .landing-header {
    display: flex;
    align-items: center;
    padding: 0 1.5rem;
    height: 56px;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .logo {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--color-primary);
  }

  /* Hero */
  .hero {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 56px);
    padding: 3rem 1.5rem;
    background: var(--color-bg);
  }

  .hero-content {
    display: grid;
    grid-template-columns: 1fr 400px;
    gap: 3rem;
    align-items: center;
    max-width: 900px;
    width: 100%;
  }

  .hero-text h1 {
    margin: 0 0 1rem;
    font-size: 2.25rem;
    font-weight: 700;
    color: var(--color-text);
    line-height: 1.2;
  }

  .hero-subtitle {
    margin: 0;
    font-size: 1.125rem;
    color: var(--color-text-secondary);
    line-height: 1.6;
  }

  /* Features */
  .features {
    padding: 4rem 1.5rem;
    background: var(--color-surface);
  }

  .section-content {
    max-width: 900px;
    margin: 0 auto;
  }

  .features h2,
  .how-it-works h2 {
    text-align: center;
    margin: 0 0 2rem;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--color-text);
  }

  .features-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1.5rem;
  }

  .feature-card {
    background: var(--color-bg);
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-lg);
    padding: 1.5rem;
    transition: box-shadow 0.15s;
  }

  .feature-card:hover {
    box-shadow: var(--shadow-sm);
  }

  .feature-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-md);
    background: var(--color-primary-alpha);
    color: var(--color-primary);
  }

  .feature-card h3 {
    margin: 0.75rem 0 0.375rem;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .feature-card p {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    line-height: 1.5;
  }

  /* How it works */
  .how-it-works {
    padding: 4rem 1.5rem;
    background: var(--color-bg);
  }

  .steps {
    display: flex;
    justify-content: center;
    gap: 2.5rem;
  }

  .step {
    flex: 1;
    max-width: 240px;
    text-align: center;
  }

  .step-number {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--color-primary);
    color: white;
    font-size: 0.875rem;
    font-weight: 600;
  }

  .step h3 {
    margin: 0.75rem 0 0.375rem;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .step p {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    line-height: 1.5;
  }

  /* Footer */
  .landing-footer {
    padding: 2rem 1.5rem;
    border-top: 1px solid var(--color-border-light);
    text-align: center;
    margin-top: auto;
  }

  .landing-footer p {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .landing-footer a {
    color: var(--color-text-secondary);
    text-decoration: underline;
    transition: color 0.15s;
  }

  .landing-footer a:hover {
    color: var(--color-text);
  }

  /* Responsive */
  @media (max-width: 768px) {
    .hero {
      min-height: auto;
      padding: 2.5rem 1.5rem;
    }

    .hero-content {
      grid-template-columns: 1fr;
      gap: 2rem;
    }

    .hero-text h1 {
      font-size: 1.75rem;
    }

    .hero-subtitle {
      font-size: 1rem;
    }

    .features-grid {
      grid-template-columns: 1fr;
    }

    .steps {
      flex-direction: column;
      align-items: center;
      gap: 1.5rem;
    }

    .step {
      max-width: 100%;
    }
  }

  @media (min-width: 769px) and (max-width: 1024px) {
    .features-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
