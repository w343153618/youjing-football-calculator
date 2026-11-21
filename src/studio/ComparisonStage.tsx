import { useEffect, useRef, useState } from "react";
import {
  STUDIO_SKIN_OPTIONS,
  STUDIO_STAGE_ACTIONS,
} from "../mobile/cabins/cabinViewModels";
import { initHighPressureAntiReverseShield } from "../security/antiReverseShield";

export { STUDIO_SKIN_OPTIONS, STUDIO_STAGE_ACTIONS };

export function ComparisonStage({ onExitStage }: { onExitStage?: () => void }) {
  const [viewMode, setViewMode] = useState<string>("all8");
  const [activeAction, setActiveAction] = useState<string>("match");
  const [slowMo, setSlowMo] = useState<boolean>(false);
  const stageRef = useRef<HTMLElement>(null);
  const base = import.meta.env.BASE_URL || "/";

  useEffect(() => {
    initHighPressureAntiReverseShield(false);
  }, []);

  const broadcast = (msg: { cmd: string; value: unknown }) => {
    const frames = stageRef.current?.querySelectorAll("iframe") ?? [];
    frames.forEach((f) => {
      f.contentWindow?.postMessage(msg, "*");
    });
  };

  const handleAction = (act: (typeof STUDIO_STAGE_ACTIONS)[number]) => {
    setActiveAction(act.id);
    broadcast({ cmd: act.cmd, value: act.value });
  };

  const handleToggleSlow = () => {
    const next = !slowMo;
    setSlowMo(next);
    broadcast({ cmd: "timeScale", value: next ? 0.25 : 1 });
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#E9EAEC",
        color: "#0F172A",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", sans-serif',
      }}
    >
      {/* Top Frosted Studio Control Bar */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          minHeight: 50,
          padding: "6px 20px",
          background: "rgba(255,255,255,0.88)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(15,23,42,0.06)",
        }}
      >
        <div
          style={{
            maxWidth: 1800,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          {/* Left: Back to Workbench + 8 Skins Filter */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexWrap: "wrap",
            }}
          >
            {onExitStage && (
              <button
                type="button"
                onClick={onExitStage}
                style={pillStyle(true, "#0284c7")}
              >
                ← 返回优竞体育内部专用工作台
              </button>
            )}
            <button
              type="button"
              onClick={() => setViewMode("all8")}
              style={pillStyle(viewMode === "all8")}
            >
              优竞体育内部专用 · 8 套手机皮肤墙
            </button>
            <span
              style={{
                width: 1,
                height: 18,
                background: "rgba(15,23,42,0.1)",
                margin: "0 6px",
              }}
            />
            {STUDIO_SKIN_OPTIONS.map((sk) => (
              <button
                key={sk.id}
                type="button"
                onClick={() => setViewMode(sk.id)}
                style={pillStyle(viewMode === sk.id)}
              >
                {sk.name}
              </button>
            ))}
          </div>

          {/* Right: Synchronized Screen & Spring Slow-Mo Controls */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              flexWrap: "wrap",
            }}
          >
            {STUDIO_STAGE_ACTIONS.map((act) => (
              <button
                key={act.id}
                type="button"
                onClick={() => handleAction(act)}
                style={pillStyle(activeAction === act.id)}
              >
                {act.label}
              </button>
            ))}
            <span
              style={{
                width: 1,
                height: 18,
                background: "rgba(15,23,42,0.1)",
                margin: "0 6px",
              }}
            />
            <button
              type="button"
              onClick={handleToggleSlow}
              style={pillStyle(slowMo, slowMo ? "#E5484D" : undefined)}
              title="0.25x 慢速播放 240Hz 弹簧物理动效"
            >
              {slowMo ? "慢放 0.25×" : "慢放"}
            </button>
          </div>
        </div>
      </header>

      {/* 8-Device Showcase Grid */}
      <main
        ref={stageRef}
        style={{
          maxWidth: 1800,
          margin: "0 auto",
          padding: "28px 20px 60px",
          display: "flex",
          justifyContent: "center",
          gap: "36px 28px",
          flexWrap: "wrap",
        }}
      >
        {STUDIO_SKIN_OPTIONS.map((sk) => {
          const visible = viewMode === "all8" || viewMode === sk.id;
          return (
            <div
              key={sk.id}
              style={{
                display: visible ? "flex" : "none",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "#475569",
                  letterSpacing: "0.02em",
                  display: "flex",
                  gap: 8,
                  alignItems: "baseline",
                }}
              >
                <b style={{ fontWeight: 600, color: "#0F172A" }}>
                  {sk.code} · {sk.name}
                </b>
                <i
                  style={{
                    fontStyle: "normal",
                    color: "#94A3B8",
                    fontSize: 11,
                  }}
                >
                  {sk.en}
                </i>
              </div>

              <div
                style={{
                  width: 392,
                  height: 836,
                  borderRadius: 48,
                  background: "#0B0D12",
                  padding: 9,
                  boxShadow:
                    "0 22px 54px rgba(15, 23, 42, 0.16), 0 0 0 1px rgba(15,23,42,0.08)",
                }}
              >
                <iframe
                  title={`${sk.name} (${sk.en})`}
                  src={`${base}?s=${sk.id}&embed=1`}
                  style={{
                    width: "100%",
                    height: "100%",
                    border: 0,
                    borderRadius: sk.id === "swiss" ? 0 : 40,
                    display: "block",
                    background: "#fff",
                  }}
                />
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
}

function pillStyle(active: boolean, customBg?: string): React.CSSProperties {
  return {
    height: 30,
    padding: "0 12px",
    borderRadius: 99,
    border: 0,
    background: active ? (customBg ?? "#0F172A") : "transparent",
    color: active ? "#FFFFFF" : "#64748B",
    fontSize: 12.5,
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.14s ease",
    whiteSpace: "nowrap",
  };
}
