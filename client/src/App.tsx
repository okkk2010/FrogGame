import { useCallback, useEffect, useState } from "react";
import FrogGame from "./game/FrogGame";

type Stage = "tadpole" | "frog";

const stageLabel: Record<Stage, string> = {
  tadpole: "Stage 1: Tadpole",
  frog: "Stage 2: Frog"
};

const stageDescription: Record<Stage, string> = {
  tadpole: "Swim through the pond with WASD while you remain a tadpole.",
  frog: "Hop across land and water as a frog and lash out with Space!"
};

function App() {
  const [nickname, setNickname] = useState<string>("");
  const [nicknameInput, setNicknameInput] = useState<string>("");
  const [stage, setStage] = useState<Stage>("tadpole");
  const [health, setHealth] = useState<number>(5);
  const [scores, setScores] = useState<{ id: string; nickname: string; score: number; isSelf: boolean }[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("frog_nickname");
    if (saved) setNicknameInput(saved);
  }, []);

  const handleLogin = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = String(formData.get("nickname") || nicknameInput || "").trim();
    if (name.length > 0) {
      setNickname(name);
       setNicknameInput(name);
      localStorage.setItem("frog_nickname", name);
    }
  }, [nicknameInput]);

  const handleHit = useCallback(() => {}, []);

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
      />
      <div className="hud-hearts" aria-label="health">
        {"♥".repeat(Math.max(0, Math.min(health, 5))).padEnd(5, "♡")}
      </div>
      <div className="hud-score" aria-label="score">
        <div className="score-title">My Score</div>
        <div className="score-value">{scores.find((s) => s.isSelf)?.score ?? 0}</div>
      </div>
      <div className="hud-leaderboard" aria-label="leaderboard">
        <div className="lb-title">Top 5</div>
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
    </div>
  );
}

export default App;

