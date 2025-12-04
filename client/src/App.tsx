import { useCallback, useEffect, useState } from "react";
import FrogGame from "./game/FrogGame";

type Stage = "tadpole" | "frog";

function App() {
  const [nickname, setNickname] = useState<string>("");
  const [nicknameInput, setNicknameInput] = useState<string>("");
  const [stage, setStage] = useState<Stage>("tadpole");
  const [health, setHealth] = useState<number>(5);
  const [scores, setScores] = useState<{ id: string; nickname: string; score: number; isSelf: boolean }[]>([]);
  const [highscores, setHighscores] = useState<{ nickname: string; score: number }[]>([]);
  const [isHighscoreOpen, setHighscoreOpen] = useState(false);
  const [isHighscoreLoading, setHighscoreLoading] = useState(false);
  const [highscoreError, setHighscoreError] = useState<string | null>(null);
  const [deathInfo, setDeathInfo] = useState<{ score: number; mapRank: number | null; overallRank: number | null } | null>(
    null
  );
  const [respawnToken, setRespawnToken] = useState(0);

  useEffect(() => {
    const saved = localStorage.getItem("frog_nickname");
    if (saved) setNicknameInput(saved);
  }, []);

  const handleLogin = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      const name = String(formData.get("nickname") || nicknameInput || "").trim();
      if (name.length > 0) {
        setNickname(name);
        setNicknameInput(name);
        localStorage.setItem("frog_nickname", name);
      }
    },
    [nicknameInput]
  );

  const handleHit = useCallback(() => {}, []);
  const handleDeath = useCallback((summary: { score: number; mapRank: number | null; overallRank: number | null }) => {
    setDeathInfo({
      score: summary.score ?? 0,
      mapRank: summary.mapRank ?? null,
      overallRank: summary.overallRank ?? null
    });
    setHealth(0);
  }, []);

  const handleRespawn = useCallback(() => {
    setDeathInfo(null);
    setRespawnToken((token) => token + 1);
    setHealth(5);
    setStage("tadpole");
  }, []);

  const getApiBase = () => {
    const explicit = (import.meta.env.VITE_API_URL as string | undefined) || "";
    if (explicit) return explicit.replace(/\/$/, "");
    if (import.meta.env.DEV) return "http://localhost:3000";
    return "";
  };

  const openHighscores = useCallback(async () => {
    setHighscoreOpen(true);
    setHighscoreLoading(true);
    setHighscoreError(null);
    try {
      const base = getApiBase();
      const res = await fetch(`${base}/api/highscores`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { nickname: string; score: number }[];
      setHighscores(data);
    } catch (error) {
      setHighscoreError("Failed to load highscores");
    } finally {
      setHighscoreLoading(false);
    }
  }, []);

  const closeHighscores = useCallback(() => {
    setHighscoreOpen(false);
  }, []);

  if (!nickname) {
    return (
      <main>
        <section className="hud">
          <h1>Enter Nickname</h1>
          <p className="instructions">Pick a name to show above your frog.</p>
          <form onSubmit={handleLogin} className="control-panel">
            <input
              type="text"
              name="nickname"
              placeholder="Nickname"
              maxLength={16}
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              required
            />
            <button type="submit">Start</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <div className="game-root">
      <FrogGame
        stage={stage}
        onHit={handleHit}
        nickname={nickname}
        onStageChange={setStage}
        onHealthChange={setHealth}
        onScoresChange={setScores}
        onDeath={handleDeath}
        respawnToken={respawnToken}
      />
      <div className="hud-hearts" aria-label="health">
        {"\u2665".repeat(Math.max(0, Math.min(health, 5))).padEnd(5, "\u2661")}
      </div>
      <div className="hud-score" aria-label="score">
        <div className="score-title">My Score</div>
        <div className="score-value">{scores.find((s) => s.isSelf)?.score ?? 0}</div>
      </div>
      <div className="hud-leaderboard" aria-label="leaderboard">
        <div className="lb-header">
          <div className="lb-title">Top 5</div>
          <button type="button" className="lb-button" onClick={openHighscores}>
            View All
          </button>
        </div>
        {scores.slice(0, 5).map((entry, index) => (
          <div
            key={entry.id}
            className={`lb-row ${index === 0 ? "first" : index === 1 ? "second" : index === 2 ? "third" : ""} ${
              entry.isSelf ? "self" : ""
            }`}
          >
            <span className="lb-rank">#{index + 1}</span>
            <span className="lb-name">{entry.nickname}</span>
            <span className="lb-score">{entry.score}</span>
          </div>
        ))}
      </div>

      {deathInfo ? (
        <div className="modal-backdrop">
          <div className="modal death-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>체력이 0이 되었어요</h2>
                <div className="modal-subtitle">다시 시작할까요?</div>
              </div>
            </div>
            <div className="death-stats">
              <div className="death-stat">
                <div className="death-label">이번 점수</div>
                <div className="death-value">{deathInfo.score}</div>
              </div>
              <div className="death-stat">
                <div className="death-label">현재 맵 등수</div>
                <div className="death-value">#{deathInfo.mapRank ?? "?"}</div>
              </div>
              <div className="death-stat">
                <div className="death-label">전체 누적 등수</div>
                <div className="death-value">#{deathInfo.overallRank ?? "?"}</div>
              </div>
            </div>
            <div className="death-actions">
              <button type="button" className="primary-button" onClick={handleRespawn}>
                다시 할래요
              </button>
              <button type="button" className="ghost-button" onClick={() => setDeathInfo(null)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isHighscoreOpen ? (
        <div className="modal-backdrop" onClick={closeHighscores}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>High Rankings</h2>
              <button type="button" className="modal-close" onClick={closeHighscores}>
                ×
              </button>
            </div>
            <div className="modal-body">
              {isHighscoreLoading ? (
                <div className="modal-loading">Loading...</div>
              ) : highscoreError ? (
                <div className="modal-error">{highscoreError}</div>
              ) : (
                <div className="modal-list">
                  {highscores.length === 0 ? (
                    <div className="modal-empty">No scores yet</div>
                  ) : (
                    highscores.slice(0, 20).map((entry, index) => (
                      <div key={`${entry.nickname}-${index}`} className="modal-row">
                        <span className="modal-rank">#{index + 1}</span>
                        <span className="modal-name">{entry.nickname}</span>
                        <span className="lb-score">{entry.score}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
