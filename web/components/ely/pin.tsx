"use client";
// Pinning of the $ARKHAM coin (first place in Trending / Fresh board + blue tick) is switched OFF: set PIN_ON to true to bring it back.
const PIN_ON = false;
export const PIN_ADDR = "0x17f46686ffc4b6e01d1ec530d07f3705b76bcf1e";
export const isPinned = (a?: string | null) => PIN_ON && (a || "").toLowerCase() === PIN_ADDR;

export function BlueTick({ address }: { address?: string | null }) {
  if (!isPinned(address)) return null;
  return (
    <svg className="e-vtick" viewBox="0 0 24 24" width="16" height="16" role="img" aria-label="Official ArkhamPad coin" style={{ verticalAlign: "-3px", marginLeft: 4, flex: "none" }}>
      <title>Official ArkhamPad coin</title>
      <circle cx="12" cy="12" r="11" fill="#1D9BF0" />
      <path d="M7 12.5l3.4 3.4L17.2 9" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
