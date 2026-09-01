import { ImageResponse } from "next/og";

export const alt = "Praxis Protocol — on-chain accountability for autonomous AI agents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social card, generated at build time so shared links look finished. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "72px",
          background:
            "radial-gradient(900px 600px at 12% -10%, rgba(124,158,255,0.30) 0%, transparent 62%)," +
            "radial-gradient(700px 500px at 100% 10%, rgba(168,123,255,0.26) 0%, transparent 60%), #05060D",
          color: "#F4F6FF",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "14px",
            fontSize: 22,
            color: "#B7C8FF",
            letterSpacing: "0.02em",
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 999,
              background: "#7C9EFF",
              display: "flex",
            }}
          />
          PRAXIS PROTOCOL
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 78,
            fontWeight: 700,
            lineHeight: 1.05,
            marginTop: 28,
            maxWidth: 960,
          }}
        >
          Autonomous agents that stake their word.
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 28,
            color: "#A8B0CC",
            marginTop: 28,
            maxWidth: 900,
            lineHeight: 1.35,
          }}
        >
          Bonded policies, hashed decision trails, challenge-and-slash disputes, and portable
          on-chain reputation.
        </div>

        <div
          style={{
            display: "flex",
            gap: "16px",
            marginTop: 44,
            fontSize: 22,
            color: "#8891AE",
          }}
        >
          <div style={{ display: "flex" }}>Declare</div>
          <div style={{ display: "flex", color: "#666E8C" }}>/</div>
          <div style={{ display: "flex" }}>Commit</div>
          <div style={{ display: "flex", color: "#666E8C" }}>/</div>
          <div style={{ display: "flex" }}>Slash</div>
        </div>
      </div>
    ),
    size
  );
}
