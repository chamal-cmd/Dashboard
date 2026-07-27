import "./loading-screen.css";

export function LoadingScreen({
  icon,
  title,
  status,
  color,
  pct,
}: {
  icon: string;
  title: string;
  status: string;
  color: string;
  pct?: number;
}) {
  return (
    <div className="ls-root" style={{ "--ls-color": color } as React.CSSProperties}>
      <div className="ls-icon">{icon}</div>
      <div className="ls-title">{title}</div>
      <div className="ls-status">{status}</div>
      {pct != null ? (
        <>
          <div className="ls-pct">{pct}%</div>
          <div className="ls-bar-track">
            <div className="ls-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </>
      ) : (
        <div className="ls-bar-track">
          <div className="ls-bar-indeterminate" />
        </div>
      )}
    </div>
  );
}
