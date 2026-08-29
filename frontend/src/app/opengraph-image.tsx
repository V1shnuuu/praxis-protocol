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
            "radial-gradient(900px 600px at 12% -10%, rgba(47,107,255,0.14) 0%, transparent 62%)," +
            "radial-gradient(700px 500px at 100% 10%, rgba(167,139,250,0.13) 0%, transparent 60%), #FBFBF9",
          color: "#14161A",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "14px",
            fontSize: 22,
            color: "#1D4FD8",
            letterSpacing: "0.02em",
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 999,
              background: "#2F6BFF",
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
            color: "#545A63",
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
            color: "#767C86",
          }}
        >
          <div style={{ display: "flex" }}>Declare</div>
          <div style={{ display: "flex", color: "#D5D5CD" }}>/</div>
          <div style={{ display: "flex" }}>Commit</div>
          <div style={{ display: "flex", color: "#D5D5CD" }}>/</div>
          <div style={{ display: "flex" }}>Slash</div>
        </div>
      </div>
    ),
    size
  );
}
