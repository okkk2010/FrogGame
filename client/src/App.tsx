import { useCallback, useState } from "react";
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
  const [stage, setStage] = useState<Stage>("tadpole");
  const [attackHits, setAttackHits] = useState(0);

  const handleStageAdvance = useCallback(() => {
    setStage((prev) => (prev === "tadpole" ? "frog" : "tadpole"));
  }, []);

  const handleHit = useCallback(() => {
    setAttackHits((value) => value + 1);
  }, []);

  return (
    <main>
      <section className="hud">
        <h1>Frog Controls Playtest Build</h1>
        <p className="instructions">
          Use WASD to move and press Space to flick your tongue while in frog form. Use the button below to
          switch life stages. Each hit relocates the target and increments the counter.
        </p>
        <div className="control-panel">
          <button type="button" onClick={handleStageAdvance}>
            {stage === "tadpole" ? "Advance to Stage 2" : "Return to Stage 1"}
          </button>
        </div>
      </section>

      <div className="game-container">
        <FrogGame stage={stage} onHit={handleHit} />
        <div className="game-overlay">
          <div className="status-card">
            <strong>Current Stage</strong>
            <span>{stageLabel[stage]}</span>
            <div>{stageDescription[stage]}</div>
          </div>
          <div className="status-card">
            <strong>Successful Hits</strong>
            <span>{attackHits}</span>
            <div>Press Space to attack with your tongue</div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default App;
