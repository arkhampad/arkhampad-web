import type { CSSProperties } from "react";
type P = { size?: number; color?: string; w?: number; style?: CSSProperties };
const mk = (paths: React.ReactNode) => ({ size = 18, color = "currentColor", w = 2, style }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">{paths}</svg>
);
export const ISearch = mk(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>);
export const IBell = mk(<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>);
export const ISpark = mk(<><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>);
export const IFire = mk(<path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-4 5-4 7-1-1-2-2-2-4-2 2-3 5-3 9 0 4 3 7 7 7z" />);
export const IHome = mk(<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></>);
export const IChart = mk(<><path d="M3 20h18" /><path d="M6 16l4-5 3 3 5-7" /></>);
export const IUser = mk(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" /></>);
export const IPlus = mk(<path d="M12 5v14M5 12h14" />);
export const ICopy = mk(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>);
export const IShare = mk(<><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" /><path d="M12 3v13" /><path d="M7 8l5-5 5 5" /></>);
export const ILock = mk(<><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>);
export const ICheck = mk(<path d="M5 12l5 5L20 7" />);
export const IAlert = mk(<><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.5" /></>);
export const IShield = mk(<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />);
export const IX = mk(<path d="M4 4l16 16M20 4L4 20" />);
export const IGlobe = mk(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>);
export const IBack = mk(<path d="M15 5l-7 7 7 7" />);
export const INext = mk(<path d="M9 5l7 7-7 7" />);
export const IDown = mk(<path d="M6 9l6 6 6-6" />);
export const ISend = mk(<path d="M5 12h14M13 6l6 6-6 6" />);
export const IFilter = mk(<path d="M4 6h16M7 12h10M10 18h4" />);
export const IWallet = mk(<><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M16 12.5h2" /><path d="M3 9h15a3 3 0 0 0 3-3" /></>);
export const IScan = mk(<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />);
export const IRocket = mk(<><path d="M5 19c2-6 6-11 14-14-3 8-8 12-14 14z" /><path d="M9 15l-3 3" /></>);
export const IArrowDown = mk(<path d="M12 5v14M5 12l7 7 7-7" />);
export const IDollar = mk(<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />);
export const IStar = mk(<path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2l.9-5.5-4-3.9 5.5-.8z" />);
export const IGear = mk(<><circle cx="12" cy="12" r="3" /><path d="M19 12h2M3 12h2M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></>);
export const IUp = mk(<><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></>);
export function GoogleIcon() {
  return (<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" fill="#4285F4" /><path d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" fill="#34A853" /><path d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2z" fill="#FBBC05" /><path d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.4L6.4 10c.8-2.3 3-4.1 5.6-4.1z" fill="#EA4335" /></svg>);
}
