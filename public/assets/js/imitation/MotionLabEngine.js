/**
 * MotionLabEngine.js
 * High-performance pure-JS Kinematics & Simulation Engine for the Imitation Learning Studio.
 * Replaces the heavy DQN physics Web Worker with zero TensorFlow/worker contention,
 * smooth 35 Hz interpolation of 10 biomechanical joints + podium locomotion,
 * and strict circular mocap podium constraints.
 */
import {
    IMITATION_ACTIONS,
    ACTION_COUNT,
    NEUTRAL_JOINTS,
    getArchetypeJointsForAction
} from './MotionInterpreter.js';

export class MotionLabEngine {
    constructor(options = {}) {
        this.podiumRadius = options.podiumRadius ?? 3.1;
        this.tickMs = options.tickMs ?? 28; // ~35.7 Hz smooth update

        this.onTick = options.onTick || (() => {});
        this.onActionTelemetry = options.onActionTelemetry || (() => {});

        this._timer = null;
        this._lastTickAt = 0;

        // World Transform on Mocap Podium (+X forward facing Studio Front camera, +Y up, -Z left)
        this.posX = 0;
        this.posZ = 0;
        this.yaw = 0;
        this.linearSpeed = 0;
        this.angularSpeed = 0;

        // Cyclic Sequence Phase [0..1)
        this.seqPhase = 0;
        this.stepCount = 0;

        // Articulated 10-Joint State (Current interpolated + Target)
        this.joints = { ...NEUTRAL_JOINTS };
        this.targetJoints = { ...NEUTRAL_JOINTS };

        // Walking Leg Gait State
        this.walkPhase = 0;
        this.walkIntensity = 0;

        // Current Active Command
        this.activeAction = 0;
        this.activeActionCode = 'NEUTRAL';
        this.activeActionLabel = 'Neutral / Ready Stance';
        this.activeSource = 'SYSTEM';
        this.activeConfidence = 1.0;
        this.activeMode = 'HUMAN_DEMO';

        this.isSimulationRunning = true;
    }

    start() {
        if (this._timer) return;
        this._lastTickAt = performance.now();
        this._timer = setInterval(() => this._step(), this.tickMs);
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    setMode(mode) {
        this.activeMode = mode;
    }

    resetPose() {
        this.posX = 0;
        this.posZ = 0;
        this.yaw = 0;
        this.linearSpeed = 0;
        this.angularSpeed = 0;
        this.walkIntensity = 0;
        this.walkPhase = 0;
        this.seqPhase = 0;
        this.activeAction = 0;
        this.activeActionCode = IMITATION_ACTIONS[0].code;
        this.activeActionLabel = IMITATION_ACTIONS[0].label;
        this.activeConfidence = 1.0;
        this.targetJoints = { ...NEUTRAL_JOINTS };
        this.joints = { ...NEUTRAL_JOINTS };
    }

    /**
     * Applies an Imitation action (0..8) with optional continuous 10-joint targets.
     */
    setCommand(actionId, meta = {}) {
        const safeAction = (Number.isInteger(actionId) && actionId >= 0 && actionId < ACTION_COUNT)
            ? actionId
            : 0;
        const actDef = IMITATION_ACTIONS[safeAction] || IMITATION_ACTIONS[0];

        this.activeAction = safeAction;
        this.activeActionCode = actDef.code;
        this.activeActionLabel = meta.label || actDef.label;
        this.activeSource = meta.source || 'SYSTEM';
        this.activeConfidence = Number(meta.confidence ?? 1.0);

        if (meta.continuousJoints && typeof meta.continuousJoints === 'object') {
            const merged = {};
            for (const key of Object.keys(NEUTRAL_JOINTS)) {
                const v = Number(meta.continuousJoints[key]);
                merged[key] = Number.isFinite(v) ? v : NEUTRAL_JOINTS[key];
            }
            this.targetJoints = merged;
        } else {
            this.targetJoints = getArchetypeJointsForAction(safeAction);
        }
    }

    _step() {
        const now = performance.now();
        const dt = Math.min(0.08, Math.max(0.005, (now - this._lastTickAt) / 1000));
        this._lastTickAt = now;
        this.stepCount++;

        // Advance sequence clock smoothly when active simulation modes run
        if (this.isSimulationRunning) {
            this.seqPhase = (this.seqPhase + dt * 0.14) % 1.0;
        }

        // Smooth joint exponential convergence (crisp ~13 rad/s responsiveness)
        const jointBlend = 1 - Math.exp(-dt * 13.0);
        for (const key of Object.keys(NEUTRAL_JOINTS)) {
            const cur = this.joints[key] ?? NEUTRAL_JOINTS[key];
            const tgt = this.targetJoints[key] ?? NEUTRAL_JOINTS[key];
            this.joints[key] = cur + (tgt - cur) * jointBlend;
        }

        // Locomotion velocity targets derived from discrete motion class
        let tgtLinear = 0;
        let tgtAngular = 0;
        let tgtWalk = 0;

        if (this.activeMode !== 'BC_TRAINING') {
            switch (this.activeAction) {
                case 1: // FORWARD
                    tgtLinear = 1.45;
                    tgtWalk = 1.0;
                    break;
                case 2: // BACKWARD
                    tgtLinear = -0.95;
                    tgtWalk = 0.85;
                    break;
                case 3: // TURN_LEFT
                    tgtLinear = 0.25;
                    tgtAngular = 1.65;
                    tgtWalk = 0.45;
                    break;
                case 4: // TURN_RIGHT
                    tgtLinear = 0.25;
                    tgtAngular = -1.65;
                    tgtWalk = 0.45;
                    break;
                default:
                    tgtLinear = 0;
                    tgtAngular = 0;
                    tgtWalk = 0;
                    break;
            }
        }

        const velBlend = 1 - Math.exp(-dt * 9.0);
        this.linearSpeed += (tgtLinear - this.linearSpeed) * velBlend;
        this.angularSpeed += (tgtAngular - this.angularSpeed) * velBlend;
        this.walkIntensity += (tgtWalk - this.walkIntensity) * velBlend;

        if (this.walkIntensity > 0.04) {
            const gaitDir = this.linearSpeed < -0.05 ? -1 : 1;
            this.walkPhase = (this.walkPhase + dt * 7.2 * gaitDir * Math.max(0.4, this.walkIntensity)) % (Math.PI * 2);
        }

        // Integrate yaw & world translation along robot +X forward axis
        this.yaw += this.angularSpeed * dt;
        const moveStep = this.linearSpeed * dt;
        this.posX += Math.cos(this.yaw) * moveStep;
        this.posZ -= Math.sin(this.yaw) * moveStep;

        // Smooth circular mocap podium clamp (radius = 3.1m)
        const dist = Math.hypot(this.posX, this.posZ);
        let atBoundary = false;
        if (dist > this.podiumRadius) {
            const scale = this.podiumRadius / dist;
            this.posX *= scale;
            this.posZ *= scale;
            atBoundary = true;
        }

        const stateSnapshot = this.getMotionState(atBoundary);
        this.onTick(stateSnapshot);
    }

    getMotionState(atBoundary = false) {
        return {
            seqPhase: this.seqPhase,
            stepCount: this.stepCount,
            posX: this.posX,
            posZ: this.posZ,
            yaw: this.yaw,
            linearSpeed: this.linearSpeed,
            angularSpeed: this.angularSpeed,
            walkPhase: this.walkPhase,
            walkIntensity: this.walkIntensity,
            atBoundary,
            action: this.activeAction,
            actionCode: this.activeActionCode,
            actionLabel: this.activeActionLabel,
            inputSource: this.activeSource,
            confidence: this.activeConfidence,
            joints: { ...this.joints }
        };
    }
}
