/** Shown on every page while ArkhamPad moves to Elysium. */
export function Soon() {
  return (
    <main className="ely-soon">
      <div className="ely-soon__glow" aria-hidden="true" />
      <div className="ely-soon__inner">
        <div className="ely-soon__brand">
          <img src="/icon-192.png" alt="" width={44} height={44} style={{ borderRadius: 12 }} />
          <span>ArkhamPad</span>
        </div>
        <p className="ely-soon__kicker">Elysium launchpad</p>
        <h1>Launch, trade, repeat.</h1>
        <p className="ely-soon__lede">Every Elysium token in one place. Launch a coin in seconds, trade with HYPE or USDC, log in with email.</p>
        <div className="ely-soon__row">
          <span className="ely-soon__pill"><i />Opening soon</span>
          <a className="ely-soon__x" href="https://x.com/Arkhampad" target="_blank" rel="noopener noreferrer">Follow @Arkhampad</a>
        </div>
      </div>
      <style>{`
        .ely-soon{min-height:100dvh;display:grid;place-items:center;background:#05080c;color:#eef3f7;position:relative;overflow:hidden;padding:24px;font-family:inherit}
        .ely-soon__glow{position:absolute;inset:-30%;background:radial-gradient(40% 35% at 50% 40%,rgba(64,196,190,.18),transparent 70%),radial-gradient(30% 30% at 70% 70%,rgba(80,120,255,.12),transparent 70%);animation:elyGlow 12s ease-in-out infinite alternate}
        @keyframes elyGlow{to{transform:translate3d(-4%,3%,0) scale(1.05)}}
        @media (prefers-reduced-motion:reduce){.ely-soon__glow{animation:none}}
        .ely-soon__inner{position:relative;max-width:620px;text-align:center}
        .ely-soon__brand{display:inline-flex;align-items:center;gap:12px;font-weight:700;font-size:22px;letter-spacing:-.01em}
        .ely-soon__kicker{margin:36px 0 10px;color:#6fd6cf;font-size:13px;font-weight:600;letter-spacing:.16em;text-transform:uppercase}
        .ely-soon h1{margin:0;font-size:clamp(40px,7vw,68px);line-height:1.02;letter-spacing:-.03em;font-weight:700}
        .ely-soon__lede{margin:18px auto 0;max-width:46ch;color:#9fb0bd;font-size:17px;line-height:1.55}
        .ely-soon__row{margin-top:34px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
        .ely-soon__pill{display:inline-flex;align-items:center;gap:10px;height:44px;padding:0 18px;border-radius:999px;border:1px solid rgba(111,214,207,.35);color:#cfeeea;font-weight:600}
        .ely-soon__pill i{width:8px;height:8px;border-radius:50%;background:#6fd6cf;box-shadow:0 0 0 0 rgba(111,214,207,.6);animation:elyPulse 1.8s infinite}
        @keyframes elyPulse{70%{box-shadow:0 0 0 10px rgba(111,214,207,0)}100%{box-shadow:0 0 0 0 rgba(111,214,207,0)}}
        .ely-soon__x{display:inline-flex;align-items:center;height:44px;padding:0 20px;border-radius:999px;background:#eef3f7;color:#05080c;font-weight:700;text-decoration:none}
        .ely-soon__x:hover{background:#fff}
      `}</style>
    </main>
  );
}
