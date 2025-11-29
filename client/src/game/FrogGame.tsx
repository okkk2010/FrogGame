import { useEffect, useRef } from "react";
import { Application, Container, Graphics, Text } from "pixi.js";
import { Bodies, Body, Engine, Runner, Vector, World } from "matter-js";
import { getSocketUrl } from "../config/network";

type Stage = "tadpole" | "frog";

type FrogGameProps = {
  stage: Stage;
  onHit: () => void;
  nickname: string;
  onStageChange?: (stage: Stage) => void;
  onHealthChange?: (hp: number) => void;
  onScoresChange?: (scores: { id: string; nickname: string; score: number; isSelf: boolean }[]) => void;
};

type InputState = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  attack: boolean;
};

type StageUpdate = { x: number; y: number; stage: Stage };
type PlayerSnapshot = { x: number; y: number; stage: Stage; color: number; nickname: string; hp: number; score: number };

type ServerMessage =
  | { type: "players:sync"; payload: { selfId: string; players: Record<string, PlayerSnapshot> } }
  | {
      type: "player:joined";
      payload: { id: string; x: number; y: number; stage: Stage; color: number; nickname: string; hp: number; score: number };
    }
  | {
      type: "player:updated";
      payload: { id: string; x: number; y: number; stage: Stage; hp: number; score: number; color?: number };
    }
  | { type: "player:attack"; payload: { id: string; heading?: { x: number; y: number } } }
  | { type: "player:left"; payload: { id: string } };

type ClientMessage =
  | { type: "player:join"; payload: { x: number; y: number; stage: Stage; nickname: string } }
  | { type: "player:update"; payload: StageUpdate }
  | { type: "player:hit"; payload: { targetId: string } }
  | { type: "food:eat" }
  | { type: "player:attack"; payload: { heading: { x: number; y: number } } };

const ATTACK_DURATION_MS = 220;
const ATTACK_COOLDOWN_MS = 380;

const createInputState = (): InputState => ({
  up: false,
  down: false,
  left: false,
  right: false,
  attack: false
});

const tadpoleSpeed = 0.0028;
const frogSpeed = 0.0042;
const FOOD_COUNT = 5;
const FOOD_RADIUS = 10;

const FrogGame = ({ stage, onHit, nickname, onStageChange, onHealthChange, onScoresChange }: FrogGameProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const runnerRef = useRef<Runner | null>(null);
  const frogBodyRef = useRef<Body | null>(null);
  const frogSpriteRef = useRef<Graphics | null>(null);
  const tongueSpriteRef = useRef<Graphics | null>(null);
  const foodsRef = useRef<{ sprite: Graphics; radius: number }[]>([]);
  const inputsRef = useRef<InputState>(createInputState());
  const stageRef = useRef<Stage>(stage);
  const nicknameRef = useRef<string>(nickname);
  const headingRef = useRef<Vector>(Vector.create(1, 0));
  const attackStateRef = useRef({
    isAttacking: false,
    lastAttackTime: 0,
    queued: false,
    hitSent: false
  });
  const targetRef = useRef<Graphics | null>(null);
  const targetHitStateRef = useRef({
    positionIndex: 0,
    cooldownUntil: 0
  });
  const onHitRef = useRef(onHit);
  const socketRef = useRef<WebSocket | null>(null);
  const selfIdRef = useRef<string | null>(null);
  const remotesRef = useRef<
    Map<
      string,
      {
        body: Graphics;
        label: Text;
        hpLabel: Text;
        hp: number;
        stage: Stage;
        color: number;
        attackLine?: Graphics;
        attackUntil?: number;
        attackHeading?: { x: number; y: number };
      }
    >
  >(new Map());
  const lastSentRef = useRef<number>(0);
  const selfLabelRef = useRef<Text | null>(null);
  const selfHealthRef = useRef<number>(5);
  const scoresRef = useRef<Map<string, { id: string; nickname: string; score: number }>>(new Map());
  const lastSelfStageRendered = useRef<Stage>(stage);
  const selfColorRef = useRef<number>(0x7fff38);

  stageRef.current = stage;
  nicknameRef.current = nickname;
  onHitRef.current = onHit;

  useEffect(() => {
    const getCanvasSize = () => ({
      width: Math.max(window.innerWidth, 640),
      height: Math.max(window.innerHeight, 480)
    });
    const { width: CANVAS_WIDTH, height: CANVAS_HEIGHT } = getCanvasSize();
    const WATER_SURFACE = CANVAS_HEIGHT * 0.42;
    const WATER_FLOOR = CANVAS_HEIGHT - 32;

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const app = new Application({
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      antialias: true,
      backgroundColor: 0x0b1220
    });

    appRef.current = app;
    container.appendChild(app.view as HTMLCanvasElement);

    const engine = Engine.create({
      gravity: { x: 0, y: 0 }
    });
    engineRef.current = engine;

    const runner = Runner.create({ delta: 1000 / 60 });
    runnerRef.current = runner;

    const worldBounds = [
      Bodies.rectangle(CANVAS_WIDTH / 2, -25, CANVAS_WIDTH, 50, { isStatic: true }),
      Bodies.rectangle(CANVAS_WIDTH / 2, CANVAS_HEIGHT + 25, CANVAS_WIDTH, 50, { isStatic: true }),
      Bodies.rectangle(-25, CANVAS_HEIGHT / 2, 50, CANVAS_HEIGHT, { isStatic: true }),
      Bodies.rectangle(CANVAS_WIDTH + 25, CANVAS_HEIGHT / 2, 50, CANVAS_HEIGHT, { isStatic: true })
    ];

    const frogBody = Bodies.circle(CANVAS_WIDTH * 0.25, CANVAS_HEIGHT * 0.7, 18, {
      frictionAir: 0.18,
      friction: 0,
      restitution: 0.4
    });
    frogBodyRef.current = frogBody;

    const stageContainer = new Container();
    app.stage.addChild(stageContainer);

    const water = new Graphics();
    water.beginFill(0x0a5c9e, 0.92);
    water.drawRect(0, WATER_SURFACE, CANVAS_WIDTH, CANVAS_HEIGHT - WATER_SURFACE);
    water.endFill();
    stageContainer.addChild(water);

    const land = new Graphics();
    land.beginFill(0x3b6e22, 1);
    land.drawRect(0, 0, CANVAS_WIDTH, WATER_SURFACE);
    land.endFill();
    stageContainer.addChild(land);

    const lilypad = new Graphics();
    lilypad.beginFill(0x70c048, 1);
    lilypad.drawCircle(CANVAS_WIDTH * 0.65, WATER_SURFACE + 60, 48);
    lilypad.endFill();
    stageContainer.addChild(lilypad);

    const drawStageSprite = (sprite: Graphics, currentStage: Stage, baseColor: number) => {
      sprite.clear();
      if (currentStage === "frog") {
        sprite.beginFill(baseColor);
        sprite.drawCircle(0, 0, 18);
        sprite.endFill();

        const eyeLeft = new Graphics();
        eyeLeft.beginFill(0xffffff);
        eyeLeft.drawCircle(-8, -12, 6);
        eyeLeft.beginFill(0x0f172a);
        eyeLeft.drawCircle(-8, -12, 3);
        eyeLeft.endFill();

        const eyeRight = new Graphics();
        eyeRight.beginFill(0xffffff);
        eyeRight.drawCircle(8, -12, 6);
        eyeRight.beginFill(0x0f172a);
        eyeRight.drawCircle(8, -12, 3);
        eyeRight.endFill();

        sprite.addChild(eyeLeft);
        sprite.addChild(eyeRight);
      } else {
        sprite.beginFill(0x56cfe1);
        sprite.drawEllipse(0, 0, 20, 12);
        sprite.endFill();
        sprite.beginFill(0x3ba6c0);
        sprite.drawEllipse(-16, 4, 10, 6);
        sprite.endFill();
      }
    };

    const frogSprite = new Graphics();
    drawStageSprite(frogSprite, stageRef.current, selfColorRef.current);
    frogSpriteRef.current = frogSprite;
    stageContainer.addChild(frogSprite);

    const selfLabel = new Text(nicknameRef.current || "", {
      fontSize: 14,
      fill: 0xffffff,
      fontFamily: "Arial"
    });
    selfLabel.anchor?.set?.(0.5, 1);
    selfLabelRef.current = selfLabel;
    stageContainer.addChild(selfLabel);

    const tongue = new Graphics();
    tongue.visible = false;
    tongueSpriteRef.current = tongue;
    stageContainer.addChild(tongue);

    const target = new Graphics();
    target.beginFill(0xfbbf24);
    target.drawRoundedRect(-20, -14, 40, 28, 10);
    target.endFill();
    targetRef.current = target;
    stageContainer.addChild(target);

    const randomFoodPosition = () => ({
      x: Math.random() * (CANVAS_WIDTH - 80) + 40,
      y: Math.random() * (CANVAS_HEIGHT - 80) + 40
    });

    const foods: { sprite: Graphics; radius: number }[] = [];
    for (let i = 0; i < FOOD_COUNT; i++) {
      const pos = randomFoodPosition();
      const food = new Graphics();
      food.beginFill(0xfbbf24, 0.95);
      food.drawCircle(0, 0, FOOD_RADIUS);
      food.endFill();
      food.position.set(pos.x, pos.y);
      stageContainer.addChild(food);
      foods.push({ sprite: food, radius: FOOD_RADIUS });
    }
    foodsRef.current = foods;

    // Multiplayer helpers
    const drawRemoteSprite = (g: Graphics, currentStage: Stage, color: number) => {
      g.clear();
      if (currentStage === "frog") {
        g.beginFill(color);
        g.drawCircle(0, 0, 14);
        g.endFill();
        g.lineStyle(2, 0xffffff, 0.6);
        g.moveTo(-6, -6);
        g.lineTo(-3, -9);
        g.moveTo(6, -6);
        g.lineTo(3, -9);
      } else {
        g.beginFill(0x3ba6c0);
        g.drawEllipse(0, 0, 16, 10);
        g.endFill();
        g.beginFill(color);
        g.drawEllipse(-12, 3, 8, 5);
        g.endFill();
      }
    };

    const addRemote = (id: string, x: number, y: number, color: number, remoteNickname: string, hp: number, stageValue: Stage) => {
      if (remotesRef.current.has(id)) return;
      const body = new Graphics();
      drawRemoteSprite(body, stageValue, color);
      body.position.set(x, y);
      const label = new Text(remoteNickname || "", { fontSize: 14, fill: 0xffffff, fontFamily: "Arial" });
      label.anchor?.set?.(0.5, 1);
      label.position.set(x, y - 24);
      const hpLabel = new Text("HP: " + hp, { fontSize: 12, fill: 0xffe4a3, fontFamily: "Arial" });
      hpLabel.anchor?.set?.(0.5, 0);
      hpLabel.position.set(x, y + 18);
      remotesRef.current.set(id, { body, label, hpLabel, hp, stage: stageValue, color });
      stageContainer.addChild(body);
      stageContainer.addChild(label);
      stageContainer.addChild(hpLabel);
    };

    const updateRemote = (id: string, x: number, y: number, hp?: number, stageValue?: Stage, color?: number) => {
      const entry = remotesRef.current.get(id);
      if (!entry) return;
      entry.body.position.set(x, y);
      entry.label.position.set(x, y - 24);
      entry.hpLabel.position.set(x, y + 18);
      if (typeof hp === "number") entry.hp = hp;
      if (stageValue) {
        entry.stage = stageValue;
        if (typeof color === "number") entry.color = color;
        drawRemoteSprite(entry.body, entry.stage, entry.color);
      }
      entry.hpLabel.text = "HP: " + entry.hp;
    };

    const removeRemote = (id: string) => {
      const entry = remotesRef.current.get(id);
      if (!entry) return;
      stageContainer.removeChild(entry.body);
      stageContainer.removeChild(entry.label);
      stageContainer.removeChild(entry.hpLabel);
      if (entry.attackLine) {
        stageContainer.removeChild(entry.attackLine);
        entry.attackLine.destroy(true);
      }
      entry.body.destroy(true);
      entry.label.destroy(true);
      entry.hpLabel.destroy(true);
      remotesRef.current.delete(id);
    };

    Engine.clear(engine);
    World.add(engine.world, worldBounds);
    World.add(engine.world, frogBody);

    const inputState = inputsRef.current;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      switch (event.code) {
        case "KeyW":
          inputState.up = true;
          break;
        case "KeyS":
          inputState.down = true;
          break;
        case "KeyA":
          inputState.left = true;
          break;
        case "KeyD":
          inputState.right = true;
          break;
        case "Space":
          event.preventDefault();
          if (stageRef.current === "frog") {
            attackStateRef.current.queued = true;
            inputState.attack = true;
          }
          break;
        default:
          break;
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      switch (event.code) {
        case "KeyW":
          inputState.up = false;
          break;
        case "KeyS":
          inputState.down = false;
          break;
        case "KeyA":
          inputState.left = false;
          break;
        case "KeyD":
          inputState.right = false;
          break;
        case "Space":
          inputState.attack = false;
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    // WebSocket wiring via env-aware helper
    const socketUrl = getSocketUrl();
    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(socketUrl);
      socketRef.current = socket;
    } catch (error) {
      console.error("Failed to connect to WebSocket server", error);
      socketRef.current = null;
    }

    const sendMessage = (message: ClientMessage) => {
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
      socketRef.current.send(JSON.stringify(message));
    };

    const emitScores = () => {
      if (!onScoresChange) return;
      const list = Array.from(scoresRef.current.values()).map((entry) => ({
        ...entry,
        isSelf: entry.id === selfIdRef.current
      }));
      list.sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname));
      onScoresChange(list);
    };

    socket?.addEventListener("open", () => {
      const fb = frogBodyRef.current;
      sendMessage({
        type: "player:join",
        payload: {
          x: fb?.position.x ?? 240,
          y: fb?.position.y ?? 320,
          stage: stageRef.current,
          nickname: nicknameRef.current
        }
      });
    });

    socket?.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(event.data as string) as ServerMessage;
        switch (parsed.type) {
          case "players:sync": {
            selfIdRef.current = parsed.payload.selfId ?? null;
            for (const [id, s] of Object.entries(parsed.payload.players)) {
              if (id === selfIdRef.current) {
                selfHealthRef.current = s.hp ?? 5;
                onHealthChange?.(selfHealthRef.current);
                if (s.stage && s.stage !== stageRef.current) {
                  stageRef.current = s.stage;
                  onStageChange?.(s.stage);
                }
                scoresRef.current.set(id, { id, nickname: s.nickname, score: s.score ?? 0 });
                if (typeof s.color === "number") selfColorRef.current = s.color;
                continue;
              }
              addRemote(id, s.x, s.y, s.color, s.nickname, s.hp ?? 5, s.stage);
              scoresRef.current.set(id, { id, nickname: s.nickname, score: s.score ?? 0 });
            }
            emitScores();
            break;
          }
          case "player:joined": {
            if (parsed.payload.id === selfIdRef.current) return;
            addRemote(
              parsed.payload.id,
              parsed.payload.x,
              parsed.payload.y,
              parsed.payload.color,
              parsed.payload.nickname,
              parsed.payload.hp ?? 5,
              parsed.payload.stage
            );
            scoresRef.current.set(parsed.payload.id, {
              id: parsed.payload.id,
              nickname: parsed.payload.nickname,
              score: parsed.payload.score ?? 0
            });
            emitScores();
            break;
          }
          case "player:updated": {
            if (parsed.payload.id === selfIdRef.current) {
              selfHealthRef.current = parsed.payload.hp ?? selfHealthRef.current;
              onHealthChange?.(selfHealthRef.current);
              if (parsed.payload.stage && parsed.payload.stage !== stageRef.current) {
                stageRef.current = parsed.payload.stage;
                onStageChange?.(parsed.payload.stage);
              }
              if (typeof parsed.payload.color === "number") {
                selfColorRef.current = parsed.payload.color;
                if (frogSpriteRef.current) {
                  drawStageSprite(frogSpriteRef.current, stageRef.current, selfColorRef.current);
                  lastSelfStageRendered.current = stageRef.current;
                }
              }
              scoresRef.current.set(parsed.payload.id, {
                id: parsed.payload.id,
                nickname: nicknameRef.current,
                score: parsed.payload.score ?? (scoresRef.current.get(parsed.payload.id)?.score ?? 0)
              });
              emitScores();
              return;
            }
            updateRemote(
              parsed.payload.id,
              parsed.payload.x,
              parsed.payload.y,
              parsed.payload.hp,
              parsed.payload.stage,
              typeof parsed.payload.color === "number"
                ? parsed.payload.color
                : remotesRef.current.get(parsed.payload.id)?.color ?? 0x7fff38
            );
            scoresRef.current.set(parsed.payload.id, {
              id: parsed.payload.id,
              nickname: remotesRef.current.get(parsed.payload.id)?.label.text ?? "Player",
              score: parsed.payload.score ?? (scoresRef.current.get(parsed.payload.id)?.score ?? 0)
            });
            emitScores();
            break;
          }
          case "player:attack": {
            if (parsed.payload.id === selfIdRef.current) break;
            const entry = remotesRef.current.get(parsed.payload.id);
            if (!entry) break;
            const heading = parsed.payload.heading ?? { x: 1, y: 0 };
            if (!entry.attackLine) {
              entry.attackLine = new Graphics();
              stageContainer.addChild(entry.attackLine);
            }
            entry.attackHeading = heading;
            entry.attackUntil = performance.now() + ATTACK_DURATION_MS;
            break;
          }
          case "player:left": {
            removeRemote(parsed.payload.id);
            scoresRef.current.delete(parsed.payload.id);
            emitScores();
            break;
          }
          default:
            break;
        }
      } catch (error) {
        console.warn("Failed to parse server message", error);
      }
    });

    const updateHeading = (vx: number, vy: number) => {
      if (Math.abs(vx) < 0.05 && Math.abs(vy) < 0.05) {
        return;
      }
      headingRef.current = Vector.normalise(Vector.create(vx, vy));
    };

    const clampToWater = () => {
      if (!frogBodyRef.current) return;
      const body = frogBodyRef.current;
      if (body.position.y < WATER_SURFACE + 18) {
        Body.setPosition(body, {
          x: body.position.x,
          y: WATER_SURFACE + 18
        });
        Body.setVelocity(body, {
          x: body.velocity.x,
          y: Math.max(body.velocity.y, 0)
        });
      }
      if (body.position.y > WATER_FLOOR) {
        Body.setPosition(body, {
          x: body.position.x,
          y: WATER_FLOOR
        });
        Body.setVelocity(body, {
          x: body.velocity.x,
          y: Math.min(body.velocity.y, 0)
        });
      }
    };

    const handleAttack = (now: number) => {
      const frogBody = frogBodyRef.current;
      const tongueGraphic = tongueSpriteRef.current;
      const attackState = attackStateRef.current;
      if (!frogBody || !tongueGraphic) {
        return;
      }

      if (attackState.queued && !attackState.isAttacking && now - attackState.lastAttackTime > ATTACK_COOLDOWN_MS) {
        attackState.isAttacking = true;
        attackState.lastAttackTime = now;
        attackState.queued = false;
        attackState.hitSent = false;
        sendMessage({ type: "player:attack", payload: { heading: headingRef.current } });
      }

      if (!attackState.isAttacking) {
        tongueGraphic.visible = false;
        return;
      }

      const elapsed = now - attackState.lastAttackTime;
      if (elapsed > ATTACK_DURATION_MS) {
        attackState.isAttacking = false;
        tongueGraphic.visible = false;
        return;
      }

      tongueGraphic.visible = true;
      tongueGraphic.clear();
      tongueGraphic.lineStyle(6, 0xf97316, 1, 0.5, true);

      const heading = headingRef.current;
      const phase = Math.min(elapsed / ATTACK_DURATION_MS, 1);
      const reach = 40 + phase * 70;
      const originX = frogBody.position.x;
      const originY = frogBody.position.y - 8;
      const tipX = originX + heading.x * reach;
      const tipY = originY + heading.y * reach;

      tongueGraphic.moveTo(originX, originY);
      tongueGraphic.lineTo(tipX, tipY);

      const targetGraphic = targetRef.current;
      const targetState = targetHitStateRef.current;
      if (!targetGraphic) {
        return;
      }

      // Hit detection against other players
      if (!attackState.hitSent) {
        for (const [id, entry] of remotesRef.current.entries()) {
          const dist = Math.hypot(tipX - entry.body.position.x, tipY - entry.body.position.y);
          if (dist < 26) {
            sendMessage({ type: "player:hit", payload: { targetId: id } });
            attackState.hitSent = true;
            break;
          }
        }
      }

      // Hit detection against foods
      for (let i = 0; i < foodsRef.current.length; i++) {
        const food = foodsRef.current[i];
        const dist = Math.hypot(tipX - food.sprite.position.x, tipY - food.sprite.position.y);
        if (dist < food.radius + 8) {
          sendMessage({ type: "food:eat" });
          const newPos = randomFoodPosition();
          food.sprite.position.set(newPos.x, newPos.y);
        }
      }
    };

    const tick = (delta: number) => {
      Runner.tick(runner, engine, delta * (1000 / 60));

      const frogBody = frogBodyRef.current;
      const frogSprite = frogSpriteRef.current;
      if (!frogBody || !frogSprite) return;

      const input = inputsRef.current;
      let x = 0;
      let y = 0;
      if (input.up) y -= 1;
      if (input.down) y += 1;
      if (input.left) x -= 1;
      if (input.right) x += 1;

      // Prevent movement while actively attacking
      if (!attackStateRef.current.isAttacking && (x !== 0 || y !== 0)) {
        const normalised = Vector.normalise(Vector.create(x, y));
        const forceScale = stageRef.current === "frog" ? frogSpeed : tadpoleSpeed;
        Body.applyForce(frogBody, frogBody.position, {
          x: normalised.x * forceScale,
          y: normalised.y * forceScale
        });
        updateHeading(normalised.x, normalised.y);
      }

      const maxVelocity = stageRef.current === "frog" ? 6.4 : 4.2;
      if (Vector.magnitude(frogBody.velocity) > maxVelocity) {
        const limited = Vector.mult(Vector.normalise(frogBody.velocity), maxVelocity);
        Body.setVelocity(frogBody, limited);
      }

      if (stageRef.current === "tadpole") {
        clampToWater();
      }

      frogSprite.position.set(frogBody.position.x, frogBody.position.y);
      // update self label
      if (selfLabelRef.current) {
        selfLabelRef.current.position.set(frogBody.position.x, frogBody.position.y - 24);
      }
      frogSprite.rotation = Math.atan2(frogBody.velocity.y, frogBody.velocity.x) * 0.25;

      const now = performance.now();
      handleAttack(now);

      // Body collision with foods
      for (let i = 0; i < foodsRef.current.length; i++) {
        const food = foodsRef.current[i];
        const dist = Math.hypot(frogBody.position.x - food.sprite.position.x, frogBody.position.y - food.sprite.position.y);
        if (dist < food.radius + 18) {
          sendMessage({ type: "food:eat" });
          const newPos = randomFoodPosition();
          food.sprite.position.set(newPos.x, newPos.y);
        }
      }

      // Throttle network updates to ~20Hz
      if (socketRef.current && now - lastSentRef.current > 50 && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: "player:update",
            payload: {
              x: frogBody.position.x,
              y: frogBody.position.y,
              stage: stageRef.current
            }
          } as ClientMessage)
        );
        lastSentRef.current = now;
      }

      // Refresh self sprite if stage changed (e.g., growth/shrink)
      if (stageRef.current !== lastSelfStageRendered.current && frogSpriteRef.current) {
        drawStageSprite(frogSpriteRef.current, stageRef.current, selfColorRef.current);
        lastSelfStageRendered.current = stageRef.current;
      }

      // Update remote attack visuals
      const nowAttack = performance.now();
      for (const entry of remotesRef.current.values()) {
        if (!entry.attackLine || !entry.attackUntil || !entry.attackHeading) continue;
        if (nowAttack > entry.attackUntil) {
          entry.attackLine.clear();
          entry.attackUntil = undefined;
          continue;
        }
        entry.attackLine.clear();
        entry.attackLine.lineStyle(4, 0xf97316, 1, 0.5, true);
        const reach = 100;
        const originX = entry.body.position.x;
        const originY = entry.body.position.y - 8;
        const tipX = originX + entry.attackHeading.x * reach;
        const tipY = originY + entry.attackHeading.y * reach;
        entry.attackLine.moveTo(originX, originY);
        entry.attackLine.lineTo(tipX, tipY);
      }
    };

    app.ticker.add(tick);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      app.ticker.remove(tick);

      // Close socket early to stop outbound sends
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }

      // Remove/destroy sprites before tearing down the app to avoid double-destroy
      for (const [id, entry] of remotesRef.current.entries()) {
        stageContainer.removeChild(entry.body);
        stageContainer.removeChild(entry.label);
        if (entry.hpLabel) stageContainer.removeChild(entry.hpLabel);
        if (entry.attackLine) stageContainer.removeChild(entry.attackLine);
        entry.body.destroy(true);
        entry.label.destroy(true);
        entry.hpLabel.destroy(true);
        entry.attackLine?.destroy(true);
        remotesRef.current.delete(id);
      }
      if (selfLabelRef.current) {
        stageContainer.removeChild(selfLabelRef.current);
        selfLabelRef.current.destroy(true);
        selfLabelRef.current = null;
      }
      if (frogSpriteRef.current) {
        stageContainer.removeChild(frogSpriteRef.current);
        frogSpriteRef.current.destroy(true);
        frogSpriteRef.current = null;
      }
      if (tongueSpriteRef.current) {
        stageContainer.removeChild(tongueSpriteRef.current);
        tongueSpriteRef.current.destroy(true);
        tongueSpriteRef.current = null;
      }
      if (targetRef.current) {
        stageContainer.removeChild(targetRef.current);
        targetRef.current.destroy(true);
        targetRef.current = null;
      }

      app.destroy(true, { children: false });
      Engine.clear(engine);
      frogBodyRef.current = null;
      appRef.current = null;
      engineRef.current = null;
      runnerRef.current = null;
    };
  }, [nickname, onHealthChange, onStageChange, onScoresChange]);

  return <div ref={containerRef} />;
};

export default FrogGame;

