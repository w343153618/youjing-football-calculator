import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  askManualAssistant,
  type ManualAskResponse,
} from "../security/secureClient";
import { playTactileCue } from "../spring/tactileSymphony";
import {
  MANUAL_TOPICS,
  QUICK_QA_PILLS,
  matchManualTopics,
  resolveManualNavigation,
  type ManualNavigationState,
  type ManualSectionId,
} from "./manualCatalog";
import {
  ManualChapterContent,
  ManualQaSection,
  type ManualPresetScenarioKind,
} from "./manualChapters";

export { MANUAL_TOPICS, QUICK_QA_PILLS, type ManualSectionId };

export function UserManualModal({
  open,
  initialSection = "sandbox",
  onClose,
  onQuotaUpdate,
  onLoadPresetScenario,
}: {
  open: boolean;
  initialSection?: ManualSectionId;
  onClose: () => void;
  onQuotaUpdate?: (remaining?: number) => void;
  onLoadPresetScenario?: (kind: ManualPresetScenarioKind) => void;
}) {
  const [navState, setNavState] = useState<ManualNavigationState>({
    activeSec: initialSection,
    query: "",
    scrollSeq: 0,
    highlightSec: null,
  });
  const bodyRef = useRef<HTMLDivElement>(null);

  const [askInput, setAskInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [qaHistory, setQaHistory] = useState<
    Array<{ id: string; q: string; res: ManualAskResponse }>
  >([]);
  const [qaError, setQaError] = useState<string | null>(null);

  useEffect(() => {
    if (open && initialSection) {
      setNavState((prev) => ({
        ...prev,
        activeSec: initialSection,
        scrollSeq: prev.scrollSeq + 1,
        highlightSec: null,
      }));
    }
  }, [open, initialSection]);

  useEffect(() => {
    if (!open || !bodyRef.current) return;
    bodyRef.current.scrollTo({ top: 0, behavior: "smooth" });
  }, [open, navState.scrollSeq]);

  useEffect(() => {
    if (!navState.highlightSec) return;
    const timer = window.setTimeout(() => {
      setNavState((prev) => ({ ...prev, highlightSec: null }));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [navState.highlightSec, navState.scrollSeq]);

  if (!open) return null;

  const matchedTopics = matchManualTopics(navState.query, MANUAL_TOPICS);
  const currentTopic =
    MANUAL_TOPICS.find((t) => t.id === navState.activeSec) ?? MANUAL_TOPICS[0];

  const handleJumpSection = (
    targetSec: ManualSectionId,
    fromJumpBtn = false
  ) => {
    playTactileCue("tap-on");
    setNavState((prev) =>
      resolveManualNavigation(prev, {
        type: fromJumpBtn ? "jump" : "select-tab",
        targetSec,
      })
    );
  };

  const submitManualQuestion = async (rawQ: string) => {
    const clean = rawQ.trim();
    if (!clean || asking) return;
    setAsking(true);
    setQaError(null);
    setNavState((prev) =>
      resolveManualNavigation(prev, { type: "select-tab", targetSec: "qa" })
    );
    playTactileCue("radar-ping");
    try {
      const res = await askManualAssistant(clean);
      onQuotaUpdate?.(res.remainingQuota);
      setQaHistory((prev) => [
        { id: `qa_${Date.now()}`, q: clean, res },
        ...prev.slice(0, 14),
      ]);
      setAskInput("");
      playTactileCue(res.warningStrike ? "tap-off" : "radar-lock");
    } catch (err) {
      playTactileCue("tap-off");
      setQaError((err as Error)?.message || "说明书问答繁忙，请稍后重试");
    } finally {
      setAsking(false);
    }
  };

  const handleQaForm = (e: FormEvent) => {
    e.preventDefault();
    void submitManualQuestion(askInput);
  };

  return (
    <div className="manual-backdrop" onClick={onClose}>
      <div
        className="manual-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="优竞体育内部专用 百科级图文精算说明书"
      >
        <div className="manual-head">
          <div className="manual-head-title">
            <span className="manual-pill">📘 百科图文手册 + 智能问答</span>
            <div>
              <h2>优竞体育内部专用 · 实战百科说明书</h2>
              <p>
                每个滑块怎么拉、每个百分比什么含义、每种买法怎么算账 —— 图文案例
                + 实时提问
              </p>
            </div>
          </div>
          <button
            type="button"
            className="round-key"
            onClick={onClose}
            title="关闭说明书"
          >
            ✕
          </button>
        </div>

        <div className="manual-toolbar">
          <div className="manual-search-wrap">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="20" y1="20" x2="16.2" y2="16.2" />
            </svg>
            <input
              type="text"
              value={navState.query}
              onChange={(e) =>
                setNavState((prev) =>
                  resolveManualNavigation(prev, {
                    type: "search",
                    query: e.target.value,
                  })
                )
              }
              placeholder="快速搜章节：一球小胜卡盘、3+1精算配单、旋转矩阵、错价雷达空仓、10元预算..."
            />
            {navState.query && (
              <button
                type="button"
                className="manual-clear"
                onClick={() =>
                  setNavState((prev) =>
                    resolveManualNavigation(prev, { type: "clear-search" })
                  )
                }
              >
                清空
              </button>
            )}
          </div>

          <div className="manual-tabs">
            {MANUAL_TOPICS.map((t) => {
              const isHit = matchedTopics.some((m) => m.id === t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleJumpSection(t.id, false)}
                  className={`manual-tab ${currentTopic.id === t.id ? "on" : ""} ${!isHit ? "dim" : ""}`}
                >
                  {t.shortTitle}
                </button>
              );
            })}
          </div>
        </div>

        <div className="manual-body" ref={bodyRef}>
          <div
            className={`manual-hero-banner ${
              navState.highlightSec === currentTopic.id
                ? "jump-focus-pulse"
                : ""
            }`}
          >
            <span className="manual-sec-badge">{currentTopic.badge}</span>
            <h3>{currentTopic.title}</h3>
            <p>{currentTopic.subtitle}</p>
          </div>

          {currentTopic.id === "qa" ? (
            <ManualQaSection
              askInput={askInput}
              asking={asking}
              qaError={qaError}
              qaHistory={qaHistory}
              onAskInputChange={setAskInput}
              onSubmitForm={handleQaForm}
              onSubmitPill={(q) => void submitManualQuestion(q)}
              onJumpSection={(sec) => handleJumpSection(sec, true)}
            />
          ) : (
            <ManualChapterContent
              sectionId={currentTopic.id}
              onLoadPresetScenario={onLoadPresetScenario}
              onClose={onClose}
            />
          )}
        </div>

        <div className="manual-foot">
          <span>
            优竞体育内部专用 · 严格对齐中国体彩官方规则（四舍六入五成双 /
            法定限赔 / 1~8关）
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            {currentTopic.id !== "qa" && (
              <button
                type="button"
                className="key sm"
                onClick={() => handleJumpSection("qa", false)}
              >
                💬 还有疑问？点此智能提问
              </button>
            )}
            <button type="button" className="key dark sm" onClick={onClose}>
              我已看懂，返回计算器
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
