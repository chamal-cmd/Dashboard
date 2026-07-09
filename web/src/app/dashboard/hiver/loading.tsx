export default function HiverLoading() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        gap: 16,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          border: "3px solid #1e2230",
          borderTopColor: "#4f8ef7",
          animation: "dp-spin 0.8s linear infinite",
        }}
      />
      <div style={{ color: "#6b7280", fontSize: 13, fontWeight: 600 }}>Loading Hiver data…</div>
      <style>{`@keyframes dp-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
