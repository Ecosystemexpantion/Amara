// Apple-style "Liquid Glass" layer applied on top of both sales page templates.
// Keeps every section of the original page; only the look changes.
export const LIQUID_GLASS_CSS = `<style id="liquid-glass">
:root{
  --lg-fill:linear-gradient(135deg,rgba(255,255,255,.16),rgba(255,255,255,.05));
  --lg-edge:rgba(255,255,255,.22);
  --lg-shine:inset 0 1px 0 rgba(255,255,255,.45),inset 0 -1px 0 rgba(255,255,255,.06);
  --lg-drop:0 12px 40px rgba(0,0,0,.35);
  --lg-blur:blur(22px) saturate(180%);
}
html{background:#04060c}
body{
  background:transparent!important;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Helvetica Neue",Figtree,sans-serif!important;
  -webkit-font-smoothing:antialiased;letter-spacing:-.01em;
}
body::before{
  content:"";position:fixed;inset:-25%;z-index:-1;pointer-events:none;
  background:
    radial-gradient(40% 35% at 18% 20%,rgba(16,185,129,.55),transparent 70%),
    radial-gradient(35% 30% at 82% 15%,rgba(99,102,241,.45),transparent 70%),
    radial-gradient(45% 40% at 70% 75%,rgba(245,166,35,.35),transparent 70%),
    radial-gradient(40% 35% at 15% 85%,rgba(56,189,248,.35),transparent 70%),
    #04060c;
  filter:blur(30px);animation:lgDrift 26s ease-in-out infinite alternate;
}
@keyframes lgDrift{from{transform:translate3d(-3%,-2%,0) scale(1)}to{transform:translate3d(3%,2%,0) scale(1.08)}}

/* Sections become clear so the glass floats over the colour field */
.hero,.sp-strip,.nums-strip,.testi-section,.urgency-section,.final-section,.proof-strip,.what-section,
.trust-bar,.ticker,footer{background:transparent!important;border-color:rgba(255,255,255,.08)!important}
.hero-grid,.hero-dots,.hero-glow{display:none!important}

/* Glass surfaces */
.pnum,.video-card,.proof-card,.num-card,.stack-card,.tools-box,.testi-card,.coach-card,.urgency-box,
.victor-card,.domain-card,.tl-content,.victor-promise,.timer-wrap,.top-timer,.slot-tracker,.float-slot,
.proof-bar,.exclusive-badge,.t-block,.top-t-block,.pay-modal,#pay-modal-box,.fs-alert{
  background:var(--lg-fill)!important;
  -webkit-backdrop-filter:var(--lg-blur);backdrop-filter:var(--lg-blur);
  border:1px solid var(--lg-edge)!important;
  box-shadow:var(--lg-shine),var(--lg-drop)!important;
  border-radius:26px!important;
}
.pnum,.t-block,.top-t-block{border-radius:18px!important}
.proof-bar,.exclusive-badge{border-radius:999px!important}
.stack-card::before{display:none}
.vc-top,.pc-header,.pc-footer,.testi-footer,.tool-row{border-color:rgba(255,255,255,.1)!important}
.proof-imgs img,.video-card iframe{border-radius:18px!important;border:1px solid rgba(255,255,255,.14)!important}
.urgency-box{background:linear-gradient(135deg,rgba(255,92,92,.18),rgba(255,255,255,.04))!important}

/* Top bar: frosted, like iOS */
nav{
  background:rgba(12,16,24,.42)!important;
  -webkit-backdrop-filter:var(--lg-blur);backdrop-filter:var(--lg-blur);
  border-bottom:1px solid rgba(255,255,255,.12)!important;
  box-shadow:inset 0 -1px 0 rgba(255,255,255,.05);
}

/* Buttons: glossy capsules */
.dl-btn,.nav-btn,.float-btn,.pay-modal-btn,#pay-submit{
  border-radius:999px!important;
  background:linear-gradient(180deg,rgba(74,222,128,.98) 0%,rgba(16,185,129,.92) 55%,rgba(5,150,105,.95) 100%)!important;
  border:1px solid rgba(255,255,255,.55)!important;
  color:#03140b!important;
  box-shadow:inset 0 1.5px 0 rgba(255,255,255,.75),inset 0 -2px 6px rgba(0,0,0,.18),0 10px 30px rgba(16,185,129,.45)!important;
  overflow:hidden;
}
.dl-btn,.nav-btn,.pay-modal-btn,#pay-submit{position:relative}
.dl-btn::after,.float-btn::after{
  content:"";position:absolute;top:0;left:12%;right:12%;height:45%;
  border-radius:0 0 50% 50%/0 0 100% 100%;
  background:linear-gradient(180deg,rgba(255,255,255,.55),rgba(255,255,255,0));pointer-events:none;
}
.dl-btn:active,.float-btn:active{transform:scale(.97)}

/* Pills and tags */
.save-badge,.ttag{border-radius:999px!important;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.pc-avatar,.tavi,.coach-av{box-shadow:inset 0 1px 0 rgba(255,255,255,.5),0 6px 16px rgba(0,0,0,.3)}

/* Text tuned for glass */
.pc-story,.testi-text{color:rgba(255,255,255,.82)!important}
.stack-desc,.coach-desc,.num-label,.vc-sub,.btn-note,.pc-meta,.t-meta{color:rgba(255,255,255,.62)!important}

@media (prefers-reduced-motion:reduce){body::before{animation:none}}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
  .pnum,.video-card,.proof-card,.num-card,.stack-card,.tools-box,.testi-card,.coach-card,.urgency-box,
  .victor-card,.domain-card,.tl-content,.victor-promise,.timer-wrap,.top-timer,.slot-tracker,nav{background:rgba(20,26,38,.88)!important}
}
</style>`;
