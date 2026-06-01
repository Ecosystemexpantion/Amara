export const PREMIUM_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tech Stack — EEM26 | Only 3 Slots Left</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Figtree:wght@400;600;700;900&display=swap" rel="stylesheet">
<script src="https://js.paystack.co/v1/inline.js"></script>
<script type="text/javascript" src="https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --gold:#F5A623;--gold2:#FFD700;
  --green:#22C55E;--green2:#16A34A;
  --accent:#6C63FF;--accent2:#4F46E5;
  --dark:#06060A;--card:#0E0E14;--card2:#12121A;
  --border:#1E1E2E;--text:#fff;--muted:#7A7A9A;--red:#f87171;
}
html{scroll-behavior:smooth}
body{background:var(--dark);color:var(--text);font-family:'Figtree',sans-serif;overflow-x:hidden}

.ticker{background:#03030A;border-bottom:1px solid var(--border);padding:8px 0;overflow:hidden;white-space:nowrap}
.ticker-inner{display:inline-block;animation:tick 22s linear infinite;font-size:.68rem;letter-spacing:3px;color:var(--red);font-weight:700}
@keyframes tick{from{transform:translateX(100vw)}to{transform:translateX(-100%)}}

nav{position:sticky;top:0;z-index:100;background:rgba(6,6,10,.98);backdrop-filter:blur(24px);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:13px 20px}
.nav-logo{font-family:'Bebas Neue',cursive;font-size:1.4rem;color:var(--gold);letter-spacing:3px}
.nav-btn{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;font-weight:900;font-size:.72rem;letter-spacing:.5px;padding:11px 18px;border-radius:7px;text-decoration:none;transition:all .2s;border:none;cursor:pointer;font-family:'Figtree',sans-serif;box-shadow:0 4px 18px rgba(108,99,255,.35)}
.nav-btn:hover{transform:translateY(-2px);box-shadow:0 8px 28px rgba(108,99,255,.5)}

.top-timer{background:linear-gradient(135deg,rgba(248,113,113,.12),rgba(248,113,113,.06));border-bottom:2px solid rgba(248,113,113,.4);padding:14px 20px;text-align:center}
.top-timer-label{font-size:.6rem;letter-spacing:4px;text-transform:uppercase;color:var(--red);font-weight:700;margin-bottom:8px}
.top-timer-row{display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap}
.top-t-block{text-align:center}
.top-t-num{font-family:'Bebas Neue',cursive;font-size:2.8rem;color:var(--red);line-height:1;text-shadow:0 0 24px rgba(248,113,113,.6)}
.top-t-unit{font-size:.52rem;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-top:2px}
.top-t-sep{font-family:'Bebas Neue',cursive;font-size:2.4rem;color:var(--red);opacity:.5;padding-bottom:10px}
.top-timer-slots{font-size:.72rem;color:var(--red);font-weight:700;letter-spacing:1px;animation:blink 1.2s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.35}}

.slot-tracker{background:linear-gradient(135deg,#0d0a2a,#0a0818);border-bottom:1px solid var(--border);padding:18px 20px}
.slot-inner{max-width:500px;margin:0 auto;text-align:center}
.slot-label{font-size:.62rem;letter-spacing:3px;text-transform:uppercase;color:var(--muted);margin-bottom:12px;font-weight:700}
.slot-dots{display:flex;justify-content:center;gap:10px;margin-bottom:10px}
.slot-dot{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',cursive;font-size:1.1rem;font-weight:900;border:2px solid}
.slot-dot.taken{background:rgba(248,113,113,.15);border-color:var(--red);color:var(--red)}
.slot-dot.taken::after{content:'✗'}
.slot-dot.open{background:rgba(34,197,94,.1);border-color:var(--green);color:var(--green)}
.slot-dot.open::after{content:'✓'}
.slot-dot.you{background:rgba(245,166,35,.15);border-color:var(--gold);color:var(--gold);animation:goldPulse 2s infinite;font-size:.65rem}
.slot-dot.you::after{content:'YOU'}
@keyframes goldPulse{0%,100%{box-shadow:0 0 0 0 rgba(245,166,35,.4)}50%{box-shadow:0 0 0 8px rgba(245,166,35,0)}}
.slot-caption{font-size:.78rem;color:var(--muted);line-height:1.5}
.slot-caption strong{color:var(--red)}

.hero{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px 20px 50px;background:radial-gradient(ellipse 90% 60% at 50% 0%,#0d0a2a 0%,transparent 65%),var(--dark);position:relative;overflow:hidden}
.hero-dots{position:absolute;inset:0;background-image:radial-gradient(circle,rgba(108,99,255,.07) 1px,transparent 1px);background-size:34px 34px;pointer-events:none}
.hero-glow{position:absolute;top:-80px;left:50%;transform:translateX(-50%);width:600px;height:400px;border-radius:50%;background:radial-gradient(circle,rgba(108,99,255,.1) 0%,transparent 70%);pointer-events:none}

.exclusive-badge{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,rgba(245,166,35,.15),rgba(245,166,35,.05));border:1px solid rgba(245,166,35,.4);color:var(--gold);font-size:.68rem;font-weight:700;letter-spacing:3px;text-transform:uppercase;padding:9px 22px;border-radius:4px;margin-bottom:26px}

.hero h1{font-family:'Bebas Neue',cursive;font-size:clamp(3rem,16vw,8.5rem);line-height:.88;margin-bottom:10px}
.line1{display:block;color:var(--text)}
.line2{display:block;color:var(--gold)}
.line3{display:block;color:var(--accent);font-size:clamp(1.3rem,4.5vw,3rem);letter-spacing:5px;margin-top:6px}

.hero-sub{font-size:clamp(.9rem,2.2vw,1.02rem);color:var(--muted);max-width:480px;margin:20px auto 0;line-height:1.75;font-weight:500}
.hero-sub strong{color:var(--text);font-weight:700}

.victor-promise{background:linear-gradient(135deg,rgba(245,166,35,.1),rgba(245,166,35,.04));border:1px solid rgba(245,166,35,.3);border-left:4px solid var(--gold);border-radius:0 12px 12px 0;padding:22px;margin:28px 0;text-align:left;max-width:520px;width:100%}
.vp-label{font-size:.6rem;letter-spacing:3px;text-transform:uppercase;color:var(--gold);font-weight:700;margin-bottom:8px}
.vp-text{font-size:.95rem;line-height:1.7;color:var(--text);font-weight:600}
.vp-text span{color:var(--gold)}

.cta-stack{display:flex;flex-direction:column;align-items:center;gap:14px;width:100%;max-width:480px;margin-top:28px}
.price-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap;justify-content:center}
.old-price{font-size:1rem;color:var(--muted);text-decoration:line-through}
.new-price{font-family:'Bebas Neue',cursive;font-size:3.5rem;color:var(--gold);line-height:1}
.save-badge{background:var(--red);color:#fff;font-size:.65rem;font-weight:900;letter-spacing:1px;padding:5px 13px;border-radius:50px}
.dl-btn{width:100%;display:flex;align-items:center;justify-content:center;gap:10px;background:linear-gradient(135deg,var(--green),var(--green2));color:#fff;font-weight:900;font-size:1.05rem;padding:20px 36px;border-radius:10px;text-decoration:none;border:none;cursor:pointer;font-family:'Figtree',sans-serif;transition:all .25s;box-shadow:0 0 50px rgba(34,197,94,.28);animation:btnPulse 2.8s ease-in-out infinite}
.dl-btn:hover{transform:translateY(-3px);box-shadow:0 0 75px rgba(34,197,94,.55);animation:none}
@keyframes btnPulse{0%,100%{box-shadow:0 0 50px rgba(34,197,94,.28)}50%{box-shadow:0 0 80px rgba(34,197,94,.55)}}
.btn-note{font-size:.7rem;color:var(--muted);letter-spacing:.5px;text-align:center}

.trust-bar{background:var(--card);border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:14px 20px;display:flex;align-items:center;justify-content:center;gap:20px;flex-wrap:wrap}
.trust-item{display:flex;align-items:center;gap:6px;font-size:.7rem;font-weight:700;color:var(--muted)}

.what-section{padding:56px 20px;max-width:560px;margin:0 auto}
.section-tag{font-size:.6rem;font-weight:700;letter-spacing:4px;color:var(--accent);text-transform:uppercase;margin-bottom:10px}
.section-title{font-family:'Bebas Neue',cursive;font-size:clamp(2rem,7vw,3.5rem);line-height:.93;margin-bottom:8px}
.section-title span{color:var(--gold)}
.divider-line{width:40px;height:3px;background:linear-gradient(90deg,var(--accent),transparent);border-radius:2px;margin:14px 0 24px}

.timeline{display:flex;flex-direction:column;gap:0;margin-top:28px}
.tl-item{display:flex;gap:16px;position:relative}
.tl-item:not(:last-child)::after{content:'';position:absolute;left:19px;top:44px;width:2px;height:calc(100% - 8px);background:linear-gradient(180deg,var(--accent),transparent)}
.tl-day{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--accent2),var(--accent));display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',cursive;font-size:1rem;color:#fff;flex-shrink:0;border:2px solid rgba(108,99,255,.4);margin-top:2px}
.tl-day.gold{background:linear-gradient(135deg,#a07000,var(--gold));border-color:rgba(245,166,35,.5)}
.tl-content{padding-bottom:28px;flex:1}
.tl-title{font-weight:900;font-size:.92rem;color:var(--text);margin-bottom:4px}
.tl-desc{font-size:.82rem;color:var(--muted);line-height:1.6}
.tl-desc strong{color:var(--gold)}

.victor-card{background:linear-gradient(135deg,rgba(245,166,35,.08),rgba(245,166,35,.03));border:1px solid rgba(245,166,35,.25);border-radius:16px;padding:28px 22px;margin:28px 0;text-align:center}
.vc-crown{font-size:2rem;margin-bottom:10px;display:block}
.vc-role{font-size:.6rem;letter-spacing:3px;text-transform:uppercase;color:var(--gold);font-weight:700;margin-bottom:8px}
.vc-name{font-family:'Bebas Neue',cursive;font-size:2.2rem;color:var(--text);letter-spacing:2px;margin-bottom:10px}
.vc-promise{font-size:.92rem;line-height:1.75;color:#ccc}
.vc-promise strong{color:var(--gold)}
.vc-promise em{color:var(--green);font-style:normal;font-weight:700}

.domain-card{background:var(--card);border:1px solid var(--border);border-top:2px solid var(--accent);border-radius:12px;padding:22px;margin:16px 0;display:flex;align-items:flex-start;gap:14px}
.dc-icon{font-size:1.8rem;flex-shrink:0}
.dc-title{font-weight:900;font-size:.88rem;color:var(--text);margin-bottom:4px}
.dc-desc{font-size:.8rem;color:var(--muted);line-height:1.6}
.dc-desc strong{color:var(--accent)}

.proof-strip{padding:50px 20px;background:linear-gradient(180deg,#040409,#07070F);border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.proof-inner{max-width:560px;margin:0 auto}
.proof-nums{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:24px}
.pnum{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px 14px;text-align:center}
.pnum strong{font-family:'Bebas Neue',cursive;font-size:2rem;color:var(--gold);display:block;line-height:1}
.pnum span{font-size:.58rem;color:var(--muted);letter-spacing:2px;text-transform:uppercase;display:block;margin-top:3px}

.video-section{padding:50px 20px;max-width:560px;margin:0 auto}
.video-card{background:var(--card);border:1px solid var(--border);border-top:2px solid var(--gold);border-radius:14px;overflow:hidden}
.vc-top{padding:16px 20px 12px;border-bottom:1px solid var(--border)}
.vc-label{font-size:.58rem;font-weight:700;letter-spacing:2.5px;color:var(--gold);text-transform:uppercase;margin-bottom:5px}
.vc-title{font-size:.92rem;font-weight:700;line-height:1.4;color:var(--text)}
.vc-sub{font-size:.78rem;color:var(--muted);margin-top:4px;line-height:1.5}
.vf-wide{position:relative;padding-top:56.25%}
.vf-wide iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:none}

.urgency-section{padding:40px 20px;background:rgba(248,113,113,.04);border-top:1px solid rgba(248,113,113,.2);border-bottom:1px solid rgba(248,113,113,.2)}
.urgency-inner{max-width:520px;margin:0 auto;text-align:center}
.urgency-title{font-family:'Bebas Neue',cursive;font-size:clamp(2rem,8vw,3.8rem);color:var(--red);margin-bottom:16px;letter-spacing:1px}
.urgency-box{background:rgba(248,113,113,.05);border:1px solid rgba(248,113,113,.18);border-radius:12px;padding:20px;text-align:left}
.urgency-item{display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid rgba(248,113,113,.08)}
.urgency-item:last-child{border-bottom:none}
.u-icon{flex-shrink:0;margin-top:2px}
.u-text{font-size:.86rem;line-height:1.65;color:var(--text)}
.u-text strong{color:var(--red)}

.final-section{padding:80px 20px;text-align:center;background:radial-gradient(ellipse 80% 55% at 50% 100%,#0d0a2a 0%,transparent 65%),var(--dark)}
.final-section h2{font-family:'Bebas Neue',cursive;font-size:clamp(2.5rem,10vw,6rem);line-height:.9;margin-bottom:18px}
.final-section h2 span{color:var(--green)}
.final-sub{color:var(--muted);max-width:420px;margin:0 auto 36px;font-size:.9rem;line-height:1.75}
.timer-wrap{display:inline-block;background:rgba(248,113,113,.07);border:1px solid rgba(248,113,113,.25);border-radius:14px;padding:18px 32px;margin-bottom:24px}
.timer-label{font-size:.6rem;letter-spacing:4px;text-transform:uppercase;color:var(--red);margin-bottom:10px;font-weight:700}
.timer-row{display:flex;gap:16px;align-items:center;justify-content:center}
.t-block{text-align:center}
.t-num{font-family:'Bebas Neue',cursive;font-size:3.8rem;color:var(--red);line-height:1;text-shadow:0 0 30px rgba(248,113,113,.5)}
.t-unit{font-size:.56rem;letter-spacing:2.5px;text-transform:uppercase;color:var(--muted);margin-top:3px}
.t-sep{font-family:'Bebas Neue',cursive;font-size:3.2rem;color:var(--red);opacity:.5;padding-bottom:12px}
.slots-txt{font-size:.76rem;color:var(--red);font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:28px;animation:blink 1.2s infinite}

.float-btn{position:fixed;bottom:20px;right:16px;z-index:200;background:linear-gradient(135deg,var(--green),var(--green2));color:#fff;display:flex;align-items:center;gap:8px;padding:13px 20px;border-radius:50px;font-weight:900;font-size:.8rem;text-decoration:none;box-shadow:0 6px 32px rgba(34,197,94,.45);animation:floatPop 2.5s ease-in-out infinite;transition:transform .15s;border:none;cursor:pointer;font-family:'Figtree',sans-serif}
.float-btn:hover{transform:scale(1.05);animation:none}
@keyframes floatPop{0%,100%{box-shadow:0 6px 32px rgba(34,197,94,.45)}50%{box-shadow:0 6px 55px rgba(34,197,94,.75)}}

.reveal{opacity:0;transform:translateY(16px);transition:opacity .55s,transform .55s}
.reveal.visible{opacity:1;transform:none}
footer{background:#030306;text-align:center;padding:16px;font-size:.6rem;color:#2a2a3a;letter-spacing:2px;border-top:1px solid var(--border)}

#pay-modal{display:none;position:fixed;inset:0;z-index:999;background:rgba(6,6,10,.93);backdrop-filter:blur(14px);align-items:center;justify-content:center;padding:20px}
#pay-modal.active{display:flex}
#pay-modal-box{background:var(--card);border:1px solid var(--border);border-top:3px solid var(--gold);border-radius:16px;padding:36px 28px;max-width:430px;width:100%;position:relative}
#pay-modal-close{position:absolute;top:14px;right:18px;background:none;border:none;color:var(--muted);font-size:1.4rem;cursor:pointer;line-height:1}
#pay-modal-close:hover{color:var(--text)}
#pay-modal-tag{font-size:.58rem;letter-spacing:3px;color:var(--gold);font-weight:700;text-transform:uppercase;margin-bottom:8px}
#pay-modal-title{font-family:'Bebas Neue',cursive;font-size:2.2rem;color:var(--text);letter-spacing:1px;margin-bottom:14px;line-height:1}
#pay-modal-sub{font-size:.9rem;color:#ccc;line-height:1.78;margin-bottom:24px}
#pay-email{width:100%;padding:14px 16px;background:var(--dark);border:1.5px solid var(--border);border-radius:8px;color:var(--text);font-family:'Figtree',sans-serif;font-size:.92rem;outline:none;transition:border-color .2s;margin-bottom:14px}
#pay-email:focus{border-color:var(--gold)}
#pay-email.error{border-color:var(--red)}
#pay-submit{width:100%;background:linear-gradient(135deg,var(--green),var(--green2));color:#fff;font-weight:900;font-size:.98rem;padding:18px 24px;border-radius:10px;border:none;cursor:pointer;font-family:'Figtree',sans-serif;transition:all .2s;box-shadow:0 0 40px rgba(34,197,94,.3)}
#pay-submit:hover{transform:translateY(-2px);box-shadow:0 0 60px rgba(34,197,94,.55)}
#pay-submit:disabled{opacity:.6;cursor:not-allowed;transform:none}
#pay-modal-foot{text-align:center;font-size:.65rem;color:var(--muted);margin-top:12px;letter-spacing:.5px}
</style>
</head>
<body>

<a href="#" class="float-btn buy-trigger">⚡ Download the Premium Version Now</a>

<div class="ticker"><div class="ticker-inner">🔴 ONLY 3 SLOTS REMAINING &nbsp;•&nbsp; 2 OF 5 ALREADY TAKEN &nbsp;•&nbsp; COACH VICTOR PERSONALLY HANDLES YOUR FINAL SETUP &nbsp;•&nbsp; 4 DAYS — SETUP COMPLETE &nbsp;•&nbsp; START EARNING IMMEDIATELY AFTER &nbsp;&nbsp;&nbsp;&nbsp;🔴 ONLY 3 SLOTS REMAINING &nbsp;•&nbsp; 2 OF 5 ALREADY TAKEN &nbsp;•&nbsp; COACH VICTOR PERSONALLY HANDLES YOUR FINAL SETUP &nbsp;•&nbsp; 4 DAYS — SETUP COMPLETE &nbsp;•&nbsp; START EARNING IMMEDIATELY AFTER &nbsp;&nbsp;&nbsp;&nbsp;</div></div>

<nav>
  <div class="nav-logo">EEM26</div>
  <a href="#" class="nav-btn buy-trigger">⚡ Download the Premium Version Now</a>
</nav>

<!-- TOP TIMER -->
<div class="top-timer">
  <div class="top-timer-label">⏳ This Slot Closes In</div>
  <div class="top-timer-row">
    <div class="top-t-block"><div class="top-t-num" id="top-mins">05</div><div class="top-t-unit">Minutes</div></div>
    <div class="top-t-sep">:</div>
    <div class="top-t-block"><div class="top-t-num" id="top-secs">00</div><div class="top-t-unit">Seconds</div></div>
    <div class="top-timer-slots">🔴 3 Slots Left — 2 Taken</div>
  </div>
</div>

<!-- SLOT TRACKER -->
<div class="slot-tracker">
  <div class="slot-inner">
    <div class="slot-label">5 Exclusive Slots — Live Status</div>
    <div class="slot-dots">
      <div class="slot-dot taken"></div>
      <div class="slot-dot taken"></div>
      <div class="slot-dot you"></div>
      <div class="slot-dot open"></div>
      <div class="slot-dot open"></div>
    </div>
    <div class="slot-caption"><strong>2 slots are gone.</strong> The one marked YOU is yours — but only if you act right now.</div>
  </div>
</div>

<!-- HERO -->
<section class="hero">
  <div class="hero-dots"></div>
  <div class="hero-glow"></div>
  <div class="exclusive-badge reveal">◆ Exclusive — 5 People Only ◆</div>
  <h1 class="reveal">
    <span class="line1">TECH</span>
    <span class="line2">STACK</span>
    <span class="line3">Premium Setup</span>
  </h1>
  <p class="hero-sub reveal">You're not buying a product. You're getting a <strong>complete done-with-you setup</strong> — AI systems, premium tools, and <strong>4 personal coaches</strong> who work with you every day for <strong>4 days</strong> until you're earning.</p>

  <div class="victor-promise reveal">
    <div class="vp-label">◆ The Victor Guarantee</div>
    <div class="vp-text">Your final and most important setup stage is handled by <span>Coach Victor himself</span> — the EEM26 founder. Not a team member. Victor. Personally.</div>
  </div>

  <div class="cta-stack reveal">
    <div class="price-row">
      <span class="old-price">₦70,000</span>
      <span class="new-price">₦39,820</span>
      <span class="save-badge">3 LEFT</span>
    </div>
    <a href="#" class="dl-btn buy-trigger">⚡ Download the Premium Version Now</a>
    <div class="btn-note">🔒 Secure Checkout · Paystack & Flutterwave · Instant Access</div>
  </div>
</section>

<div class="trust-bar">
  <div class="trust-item">✅ Instant Access</div>
  <div class="trust-item">👑 Victor Handles Day 4</div>
  <div class="trust-item">⚡ 4 Days To Complete</div>
  <div class="trust-item">💰 Earn Immediately After</div>
</div>

<!-- 4 DAY SETUP -->
<div class="what-section">
  <div class="section-tag reveal">What Happens After You Secure Your Slot</div>
  <div class="divider-line reveal"></div>
  <h2 class="section-title reveal">Your <span>4-Day</span> Setup</h2>

  <div class="timeline">
    <div class="tl-item reveal">
      <div class="tl-day">1</div>
      <div class="tl-content">
        <div class="tl-title">SRE + AAM Systems Configured</div>
        <div class="tl-desc">Your Smart Reply Engine and AI Acquisition Model are built and activated. <strong>Your AI starts working for you from day one.</strong></div>
      </div>
    </div>
    <div class="tl-item reveal">
      <div class="tl-day">2</div>
      <div class="tl-content">
        <div class="tl-title">Full Integration & Tools Setup</div>
        <div class="tl-desc">Every tool connected. Every system linked. Our coaches handle everything that needs to be done on our end so you don't have to.</div>
      </div>
    </div>
    <div class="tl-item reveal">
      <div class="tl-day">3</div>
      <div class="tl-content">
        <div class="tl-title">Your Sales Page Goes Live</div>
        <div class="tl-desc">You get a <strong>domain hosted sales page</strong> — the exact same type Coach Victor himself uses. Professional. Fast. Built to convert automatically.</div>
      </div>
    </div>
    <div class="tl-item reveal">
      <div class="tl-day gold">4</div>
      <div class="tl-content">
        <div class="tl-title">👑 Coach Victor — Your Final Setup</div>
        <div class="tl-desc"><strong>The most important stage.</strong> Coach Victor personally handles and completes your final setup. After this — you start earning. Same day. This is why only 5 people get this.</div>
      </div>
    </div>
  </div>

  <div class="victor-card reveal">
    <span class="vc-crown">👑</span>
    <div class="vc-role">EEM26 Founder — Lead Coach</div>
    <div class="vc-name">Coach Victor</div>
    <div class="vc-promise">Your final setup is handled by Coach Victor <strong>personally.</strong> Not a team member. Not an assistant. <em>Victor himself.</em> This is what makes these 5 slots different from everything else EEM26 offers. He cannot do this for everyone — which is why only 5 people get access.</div>
  </div>

  <div class="domain-card reveal">
    <div class="dc-icon">🌐</div>
    <div>
      <div class="dc-title">Your Own Domain Hosted Sales Page</div>
      <div class="dc-desc">You get the <strong>exact same type of hosted sales page</strong> Coach Victor himself uses to run EEM26. Built on Day 3. Selling for you automatically from Day 4 onwards.</div>
    </div>
  </div>
</div>

<!-- PROOF NUMBERS -->
<div class="proof-strip">
  <div class="proof-inner">
    <div class="section-tag reveal">The Numbers</div>
    <div class="divider-line reveal"></div>
    <h2 class="section-title reveal">What <span>Students Have Done</span></h2>
    <div class="proof-nums reveal">
      <div class="pnum"><strong>₦51M+</strong><span>Student Sales</span></div>
      <div class="pnum"><strong>8+</strong><span>Currencies Earned</span></div>
      <div class="pnum"><strong>4 Days</strong><span>Setup Time</span></div>
      <div class="pnum"><strong>Day 4</strong><span>First Earning</span></div>
    </div>
  </div>
</div>

<!-- COACH VICTOR VIDEO -->
<div class="video-section">
  <div class="section-tag reveal">See The Proof</div>
  <div class="divider-line reveal"></div>
  <h2 class="section-title reveal">Coach Victor<br><span>₦1M+ Withdrawn Live.</span></h2>
  <p class="reveal" style="color:var(--muted);font-size:.88rem;line-height:1.7;margin-bottom:20px">The man who will personally handle your final setup — watch what his system generates.</p>
  <div class="video-card reveal">
    <div class="vc-top">
      <div class="vc-label">◆ Live Withdrawal — Real Proof</div>
      <div class="vc-title">Coach Victor — EEM26 Founder</div>
      <div class="vc-sub">Your Day 4 coach. On camera. Showing you exactly what's possible.</div>
    </div>
    <div class="vf-wide"><iframe src="https://www.youtube.com/embed/Xp1q8xigFO8" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture" loading="lazy"></iframe></div>
  </div>
  <div style="text-align:center;margin-top:28px" class="reveal">
    <a href="#" class="dl-btn buy-trigger" style="max-width:480px;margin:0 auto;display:flex">⚡ Download the Premium Version Now</a>
    <p style="font-size:.7rem;color:var(--muted);margin-top:10px;letter-spacing:.5px">Only 3 slots left · ₦39,820 · Victor handles Day 4</p>
  </div>
</div>

<!-- URGENCY -->
<div class="urgency-section">
  <div class="urgency-inner">
    <div class="urgency-title reveal">⚠ 3 Slots. That's It.</div>
    <div class="urgency-box reveal">
      <div class="urgency-item"><div class="u-icon">🚫</div><div class="u-text"><strong>Only 5 slots exist.</strong> 2 are already taken. Once the last 3 go — Coach Victor closes this permanently. No waitlist. No second batch.</div></div>
      <div class="urgency-item"><div class="u-icon">👑</div><div class="u-text">Coach Victor cannot personally handle more than 5 setups at a time. <strong>This exclusivity is the entire point.</strong> You get his direct attention on Day 4.</div></div>
      <div class="urgency-item"><div class="u-icon">💸</div><div class="u-text">Every second you wait, someone else gets closer to taking your slot. <strong>The slot marked YOU disappears the moment someone else clicks first.</strong></div></div>
    </div>
  </div>
</div>

<!-- FINAL CTA -->
<section class="final-section">
  <div class="exclusive-badge" style="margin-bottom:24px">◆ 3 Slots Remaining ◆</div>
  <h2 class="reveal">YOUR SLOT IS<br><span>WAITING.</span></h2>
  <p class="final-sub reveal">4 days. Coach Victor personally on Day 4. Your own hosted sales page. Your AI running. You earning. This is not a course. This is your complete setup — done with you, start to finish.</p>

  <div class="timer-wrap reveal">
    <div class="timer-label">⏳ Slot Closes In</div>
    <div class="timer-row">
      <div class="t-block"><div class="t-num" id="mins">05</div><div class="t-unit">Minutes</div></div>
      <div class="t-sep">:</div>
      <div class="t-block"><div class="t-num" id="secs">00</div><div class="t-unit">Seconds</div></div>
    </div>
  </div>

  <div class="slots-txt reveal">🔴 2 TAKEN — 3 LEFT — INCLUDING YOURS</div>

  <div class="cta-stack reveal" style="margin:0 auto;max-width:480px">
    <div class="price-row">
      <span class="old-price">₦70,000</span>
      <span class="new-price">₦39,820</span>
      <span class="save-badge">TODAY ONLY</span>
    </div>
    <a href="#" class="dl-btn buy-trigger">⚡ Download the Premium Version Now</a>
    <div class="btn-note">🔒 Paystack & Flutterwave &nbsp;·&nbsp; ✅ Instant Access &nbsp;·&nbsp; 👑 Victor on Day 4</div>
  </div>
</section>

<footer>© 2025 ECOSYSTEM EXPANSION MODEL (EEM26) &nbsp;·&nbsp; ALL RIGHTS RESERVED &nbsp;·&nbsp; EXCLUSIVE — 5 SLOTS ONLY</footer>

<!-- PAYMENT MODAL -->
<div id="pay-modal" role="dialog" aria-modal="true" aria-labelledby="pay-modal-title">
  <div id="pay-modal-box">
    <button id="pay-modal-close" onclick="closePayModal()" aria-label="Close">✕</button>
    <div id="pay-modal-tag">◆ EEM26 Tech Stack — Premium</div>
    <div id="pay-modal-title">SECURE YOUR SLOT</div>
    <p id="pay-modal-sub">This is the last decision you make manually. After this, your AI handles everything. Enter your email — your access arrives instantly.</p>
    <input type="email" id="pay-email" placeholder="Enter your email address" autocomplete="email" required>
    <button id="pay-submit" onclick="initiatePaystack()">🔒 Pay ₦39,820 Securely</button>
    <div id="pay-modal-foot">Powered by Paystack &nbsp;·&nbsp; 256-bit Encrypted &nbsp;·&nbsp; Instant Access</div>
  </div>
</div>

<script>
// Intercept createElement so every iframe gets clipboard-write BEFORE src is set
(function(){
  var _orig = document.createElement.bind(document);
  document.createElement = function(tag){
    var el = _orig(tag);
    if(typeof tag === 'string' && tag.toLowerCase() === 'iframe'){
      el.allow = 'clipboard-read; clipboard-write';
    }
    return el;
  };
})();

let total = 5 * 60;
const minsEl = document.getElementById('mins');
const secsEl = document.getElementById('secs');
const topMins = document.getElementById('top-mins');
const topSecs = document.getElementById('top-secs');
const tick = setInterval(() => {
  if (total <= 0) {
    clearInterval(tick);
    [minsEl, secsEl, topMins, topSecs].forEach(el => { if(el) el.textContent = '00'; });
    return;
  }
  total--;
  const m = String(Math.floor(total/60)).padStart(2,'0');
  const s = String(total%60).padStart(2,'0');
  minsEl.textContent = m; secsEl.textContent = s;
  topMins.textContent = m; topSecs.textContent = s;
}, 1000);

emailjs.init('P6vjGqbInRNLni8GS');

function openPayModal() {
  document.getElementById('pay-modal').classList.add('active');
  document.getElementById('pay-email').focus();
  document.body.style.overflow = 'hidden';
}
function closePayModal() {
  document.getElementById('pay-modal').classList.remove('active');
  document.body.style.overflow = '';
}
document.getElementById('pay-modal').addEventListener('click', function(e) {
  if (e.target === this) closePayModal();
});

function initiatePaystack() {
  const emailInput = document.getElementById('pay-email');
  const submitBtn = document.getElementById('pay-submit');
  const email = emailInput.value.trim();
  if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
    emailInput.classList.add('error');
    emailInput.focus();
    return;
  }
  emailInput.classList.remove('error');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Opening Secure Checkout…';

  var handler = PaystackPop.setup({
    key: 'pk_live_d4b401792b62d34e6664a0180eb4e0eb036ebe16',
    email: email,
    amount: 3982000,
    currency: 'NGN',
    ref: 'EEM26_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
    label: 'EEM26 Tech Stack Premium',
    metadata: {
      custom_fields: [
        { display_name: 'Product', variable_name: 'product', value: 'EEM26 Tech Stack' }
      ]
    },
    callback: function(response) {
      closePayModal();
      emailjs.send('service_ab7fo9g', 'template_fnqmdxw', {
        to_email: email,
        product_name: 'EEM26 Tech Stack',
        product_link: 'https://ecosystemexpantion.github.io/Product_page/',
        payment_ref: response.reference
      }).finally(function() {
        window.location.href = 'https://ecosystemexpantion.github.io/Product_page/';
      });
    },
    onClose: function() {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '🔒 Pay ₦39,820 Securely';
    }
  });
  handler.openIframe();
}

document.querySelectorAll('.buy-trigger').forEach(el => {
  el.addEventListener('click', function(e) {
    e.preventDefault();
    openPayModal();
  });
});

const obs = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if(e.isIntersecting){ e.target.classList.add('visible'); obs.unobserve(e.target); }
  });
}, { threshold: 0.07 });
document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
</script>
</body>
</html>
`;
