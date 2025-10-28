import { useEffect, useRef } from "react";
import { Application, Container, Graphics, Text } from "pixi.js";
import { Bodies, Body, Engine, Runner, Vector, World } from "matter-js";
import { io, Socket } from "socket.io-client";
import { getSocketUrl } from "../config/network";

type Stage = "tadpole" | "frog";

type FrogGameProps = {
  stage: Stage;
  onHit: () => void;
  nickname: string;
};

type InputState = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  attack: boolean;
};

const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 540;
const WATER_SURFACE = CANVAS_HEIGHT * 0.42;
const WATER_FLOOR = CANVAS_HEIGHT - 32;
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

const FrogGame = ({ stage, onHit, nickname }: FrogGameProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const runnerRef = useRef<Runner | null>(null);
  const frogBodyRef = useRef<Body | null>(null);
  const frogSpriteRef = useRef<Graphics | null>(null);
  const tongueSpriteRef = useRef<Graphics | null>(null);
  const inputsRef = useRef<InputState>(createInputState());
  const stageRef = useRef<Stage>(stage);
  const nicknameRef = useRef<string>(nickname);
  const headingRef = useRef<Vector>(Vector.create(1, 0));
  const attackStateRef = useRef({
    isAttacking: false,
    lastAttackTime: 0,
    queued: false
  });
  const targetRef = useRef<Graphics | null>(null);
  const targetHitStateRef = useRef({
    positionIndex: 0,
    cooldownUntil: 0
  });
  const onHitRef = useRef(onHit);
  const socketRef = useRef<Socket | null>(null);
  const selfIdRef = useRef<string | null>(null);
  const remotesRef = useRef<Map<string, { body: Graphics; label: Text }>>(new Map());
  const lastSentRef = useRef<number>(0);
  const selfLabelRef = useRef<Text | null>(null);

  stageRef.current = stage;
  nicknameRef.current = nickname;
  onHitRef.current = onHit;

  useEffect(() => {
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

    const frogSprite = new Graphics();
    frogSprite.beginFill(0x7fff38);
    frogSprite.drawCircle(0, 0, 18);
    frogSprite.endFill();

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

    frogSprite.addChild(eyeLeft);
    frogSprite.addChild(eyeRight);

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

    const targetPositions = [
      { x: CANVAS_WIDTH * 0.68, y: WATER_SURFACE - 40 },
      { x: CANVAS_WIDTH * 0.82, y: WATER_SURFACE + 120 },
      { x: CANVAS_WIDTH * 0.52, y: CANVAS_HEIGHT * 0.75 }
    ];

    const resetTarget = (index: number) => {
      const position = targetPositions[index % targetPositions.length];
      target.position.set(position.x, position.y);
      targetHitStateRef.current.positionIndex = index % targetPositions.length;
    };
    resetTarget(0);

    // Multiplayer helpers
    const addRemote = (
      id: string,
      x: number,
      y: number,
      color: number,
      remoteNickname: string
    ) => {
      if (remotesRef.current.has(id)) return;
      const body = new Graphics();
      body.beginFill(color);
      body.drawCircle(0, 0, 14);
      body.endFill();
      body.position.set(x, y);
      const label = new Text(remoteNickname || "", { fontSize: 14, fill: 0xffffff, fontFamily: "Arial" });
      label.anchor?.set?.(0.5, 1);
      label.position.set(x, y - 24);
      remotesRef.current.set(id, { body, label });
      stageContainer.addChild(body);
      stageContainer.addChild(label);
    };

    const updateRemote = (id: string, x: number, y: number) => {
      const entry = remotesRef.current.get(id);
      if (!entry) return;
      entry.body.position.set(x, y);
      entry.label.position.set(x, y - 24);
    };

    const removeRemote = (id: string) => {
      const entry = remotesRef.current.get(id);
      if (!entry) return;
      stageContainer.removeChild(entry.body);
      stageContainer.removeChild(entry.label);
      entry.body.destroy(true);
      entry.label.destroy(true);
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

    // Socket.IO wiring via env-aware helper
    const socket = io(getSocketUrl(), { transports: ["websocket"], autoConnect: true });
    socketRef.current = socket;

    socket.on("connect", () => {
      selfIdRef.current = socket.id ?? null;
      const fb = frogBodyRef.current;
      socket.emit("player:join", {
        x: fb?.position.x ?? 240,
        y: fb?.position.y ?? 320,
        stage: stageRef.current,
        nickname: nicknameRef.current
      });
    });

    socket.on(
      "players:sync",
      (snapshot: Record<string, { x: number; y: number; color: number; nickname: string }>) => {
        const selfId = selfIdRef.current;
        for (const id of Object.keys(snapshot)) {
          if (id === selfId) continue;
          const s = snapshot[id];
          addRemote(id, s.x, s.y, s.color, s.nickname);
        }
      }
    );

    socket.on(
      "player:joined",
      (payload: { id: string; x: number; y: number; color: number; nickname: string }) => {
        if (payload.id === selfIdRef.current) return;
        addRemote(payload.id, payload.x, payload.y, payload.color, payload.nickname);
      }
    );

    socket.on("player:updated", (payload: { id: string; x: number; y: number }) => {
      if (payload.id === selfIdRef.current) return;
      updateRemote(payload.id, payload.x, payload.y);
    });

    socket.on("player:left", (payload: { id: string }) => {
      removeRemote(payload.id);
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

      const distance = Math.hypot(tipX - targetGraphic.x, tipY - targetGraphic.y);
      if (distance < 32 && now > targetState.cooldownUntil) {
        targetState.cooldownUntil = now + 600;
        const nextIndex = targetState.positionIndex + 1;
        const { x, y } = targetPositions[nextIndex % targetPositions.length];
        targetGraphic.position.set(x, y);
        targetState.positionIndex = nextIndex % targetPositions.length;
        onHitRef.current();
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

      if (x !== 0 || y !== 0) {
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

      // Throttle network updates to ~20Hz
      if (socketRef.current && now - lastSentRef.current > 50) {
        socketRef.current.emit("player:update", {
          x: frogBody.position.x,
          y: frogBody.position.y,
          stage: stageRef.current
        });
        lastSentRef.current = now;
      }

      const targetGraphic = targetRef.current;
      if (targetGraphic && stageRef.current === "tadpole") {
        const { x: tx, y: ty } = targetGraphic.position;
        const targetY = Math.max(ty, WATER_SURFACE + 24);
        targetGraphic.position.set(tx, targetY);
      }
    };

    app.ticker.add(tick);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      app.ticker.remove(tick);
      app.destroy(true, { children: true });
      Engine.clear(engine);
      frogBodyRef.current = null;
      frogSpriteRef.current = null;
      tongueSpriteRef.current = null;
      targetRef.current = null;
      appRef.current = null;
      engineRef.current = null;
      runnerRef.current = null;

      // Cleanup socket and remote sprites
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      for (const [id, entry] of remotesRef.current.entries()) {
        stageContainer.removeChild(entry.body);
        stageContainer.removeChild(entry.label);
        entry.body.destroy(true);
        entry.label.destroy(true);
        remotesRef.current.delete(id);
      }
      if (selfLabelRef.current) {
        stageContainer.removeChild(selfLabelRef.current);
        selfLabelRef.current.destroy(true);
        selfLabelRef.current = null;
      }
    };
  }, [nickname]);

  return <div ref={containerRef} />;
};

export default FrogGame;

