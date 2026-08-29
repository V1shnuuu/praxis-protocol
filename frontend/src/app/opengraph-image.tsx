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
            "radial-gradient(1200px 700px at 15% -10%, #0d2740 0%, transparent 60%), #050912",
          color: "#EAF2FB",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "14px",
            fontSize: 22,
            color: "#38E0F5",
            letterSpacing: "0.02em",
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 999,
              background: "#38E0F5",
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
            color: "#A9BCD4",
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
            color: "#6E829E",
          }}
        >
          <div style={{ display: "flex" }}>Declare</div>
          <div style={{ display: "flex", color: "#25395C" }}>/</div>
          <div style={{ display: "flex" }}>Commit</div>
          <div style={{ display: "flex", color: "#25395C" }}>/</div>
          <div style={{ display: "flex" }}>Slash</div>
        </div>
      </div>
    ),
    size
  );
}
