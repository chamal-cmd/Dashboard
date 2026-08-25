// Tiny "?" badge — hover (or focus, for keyboard/touch) to reveal an
// explanation of what the tile it sits next to actually means/computes.
export function InfoTip({ text }: { text: string }) {
  return (
    <span className="infoTip" tabIndex={0}>
      ?
      <span className="infoTipBubble">{text}</span>
    </span>
  );
}
