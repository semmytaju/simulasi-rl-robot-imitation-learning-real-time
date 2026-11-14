/**
 * MotionInterpreter.js
 * Translates calibrated & normalized human pose features into:
 *   1. Discrete Human Motion Classes (0..8):
 *      0: NEUTRAL       (Neutral Standing)
 *      1: FORWARD       (Lean Forward / Step Forward)
 *      2: BACKWARD      (Lean Backward / Step Back)
 *      3: TURN_LEFT     (Lean Left / Turn Left)
 *      4: TURN_RIGHT    (Lean Right / Turn Right)
 *      5: WAVE_LEFT_ARM (Raise Left Arm)
 *      6: WAVE_RIGHT_ARM(Raise Right Arm)
 *      7: BOTH_ARMS_UP  (Raise Both Arms)
 *      8: SQUAT_CROUCH  (Squat / Crouch Down)
 *   2. Continuous 10-Joint Target Pose (torsoPitch, torsoRoll, headYaw, armRaise/Abduct/Elbow L&R, squatDepth)
 *      so the 3D humanoid robot directly mirrors live human movements AND Behavior Cloning learns full body motion.
 */
export const IMITATION_ACTIONS = [
    { id: 0, code: 'NEUTRAL', label: 'Neutral Stance', badge: 'secondary' },
    { id: 1, code: 'FORWARD', label: 'Forward / Lean Forward', badge: 'success' },
    { id: 2, code: 'BACKWARD', label: 'Backward / Lean Back', badge: 'warning' },
    { id: 3, code: 'TURN_LEFT', label: 'Turn Left / Lean Left', badge: 'info' },
    { id: 4, code: 'TURN_RIGHT', label: 'Turn Right / Lean Right', badge: 'info' },
    { id: 5, code: 'WAVE_LEFT_ARM', label: 'Raise Left Arm', badge: 'primary' },
    { id: 6, code: 'WAVE_RIGHT_ARM', label: 'Raise Right Arm', badge: 'primary' },
    { id: 7, code: 'BOTH_ARMS_UP', label: 'Raise Both Arms', badge: 'success' },
    { id: 8, code: 'SQUAT_CROUCH', label: 'Squat / Crouch', badge: 'warning' }
];

export const ACTION_COUNT = IMITATION_ACTIONS.length;

export const NEUTRAL_JOINTS = {
    torsoPitch: 0.0,
    torsoRoll: 0.0,
    headYaw: 0.0,
    armRaiseL: 0.14,
    armAbductL: 0.06,
    elbowL: 0.35,
    armRaiseR: 0.14,
    armAbductR: 0.06,
    elbowR: 0.35,
    squatDepth: 0.0
};

export function getArchetypeJointsForAction(actionId) {
    switch (actionId) {
        case 1: // FORWARD
            return { ...NEUTRAL_JOINTS, torsoPitch: -0.22, armRaiseL: 0.45, armRaiseR: -0.20, elbowL: 0.65, elbowR: 0.55 };
        case 2: // BACKWARD
            return { ...NEUTRAL_JOINTS, torsoPitch: 0.18, armRaiseL: -0.25, armRaiseR: 0.25, elbowL: 0.5, elbowR: 0.5 };
        case 3: // TURN_LEFT
            return { ...NEUTRAL_JOINTS, torsoRoll: -0.18, headYaw: 0.35, armAbductL: 0.32 };
        case 4: // TURN_RIGHT
            return { ...NEUTRAL_JOINTS, torsoRoll: 0.18, headYaw: -0.35, armAbductR: 0.32 };
        case 5: // WAVE_LEFT_ARM
            return { ...NEUTRAL_JOINTS, headYaw: 0.22, armRaiseL: 1.45, armAbductL: 1.15, elbowL: 1.25 };
        case 6: // WAVE_RIGHT_ARM
            return { ...NEUTRAL_JOINTS, headYaw: -0.22, armRaiseR: 1.45, armAbductR: 1.15, elbowR: 1.25 };
        case 7: // BOTH_ARMS_UP
            return { ...NEUTRAL_JOINTS, armRaiseL: 1.85, armAbductL: 0.95, elbowL: 0.85, armRaiseR: 1.85, armAbductR: 0.95, elbowR: 0.85 };
        case 8: // SQUAT_CROUCH
            return { ...NEUTRAL_JOINTS, torsoPitch: -0.28, armRaiseL: 0.95, armRaiseR: 0.95, elbowL: 0.90, elbowR: 0.90, squatDepth: 0.78 };
        default: // 0 NEUTRAL
            return { ...NEUTRAL_JOINTS };
    }
}

export class MotionInterpreter {
    constructor(options = {}) {
        this.thresholds = {
            forwardEnter: options.forwardEnter ?? 0.15,
            backwardEnter: options.backwardEnter ?? 0.15,
            lateralEnter: options.lateralEnter ?? 0.18,
            armRaiseEnter: options.armRaiseEnter ?? 1.05,
            squatEnter: options.squatEnter ?? 0.36,
            hysteresisRatio: options.hysteresisRatio ?? 0.65,
            minPoseConfidence: options.minPoseConfidence ?? 0.35,
            smoothingAlpha: options.smoothingAlpha ?? 0.42,
            minHoldMs: options.minHoldMs ?? 120
        };

        this.smoothedForward = 0;
        this.smoothedLateral = 0;
        this.smoothedSquat = 0;
        this.smoothedJoints = { ...NEUTRAL_JOINTS };
        this.currentAction = 0; // NEUTRAL
        this.lastSwitchTs = 0;
    }

    updateThresholds(partial = {}) {
        Object.assign(this.thresholds, partial);
    }

    getThresholds() {
        return { ...this.thresholds };
    }

    reset() {
        this.smoothedForward = 0;
        this.smoothedLateral = 0;
        this.smoothedSquat = 0;
        this.smoothedJoints = { ...NEUTRAL_JOINTS };
        this.currentAction = 0;
        this.lastSwitchTs = 0;
    }

    _smoothJoint(cur, target, alpha) {
        return cur + (target - cur) * alpha;
    }

    interpret(pose, calibration, mirrored = true) {
        const now = performance.now();
        const alpha = Math.max(0.15, Math.min(0.85, this.thresholds.smoothingAlpha));

        if (!pose || !pose.detected || pose.confidence < this.thresholds.minPoseConfidence) {
            this.smoothedForward *= 0.6;
            this.smoothedLateral *= 0.6;
            this.smoothedSquat *= 0.6;
            for (const k of Object.keys(this.smoothedJoints)) {
                this.smoothedJoints[k] = this._smoothJoint(this.smoothedJoints[k], NEUTRAL_JOINTS[k], 0.25);
            }
            this.currentAction = 0;
            return {
                action: 0,
                code: 'NEUTRAL',
                label: 'Neutral (Invalid Pose / Low Confidence)',
                confidence: pose?.confidence || 0,
                isValidPose: false,
                continuousJoints: { ...this.smoothedJoints },
                smoothedForward: this.smoothedForward,
                smoothedLateral: this.smoothedLateral
            };
        }

        const norm = calibration.normalizePose(pose, mirrored);
        if (!norm) {
            this.currentAction = 0;
            return {
                action: 0,
                code: 'NEUTRAL',
                label: 'Neutral (Awaiting Calibration)',
                confidence: pose.confidence,
                isValidPose: false,
                continuousJoints: { ...this.smoothedJoints },
                smoothedForward: 0,
                smoothedLateral: 0
            };
        }

        this.smoothedForward = this._smoothJoint(this.smoothedForward, norm.forwardScore, alpha);
        this.smoothedLateral = this._smoothJoint(this.smoothedLateral, norm.lateralScore, alpha);
        this.smoothedSquat = this._smoothJoint(this.smoothedSquat, norm.squatScore || 0, alpha);

        // Build target continuous robot joints smoothly mirroring human
        const targetPitch = Math.max(-0.48, Math.min(0.45, -this.smoothedForward * 0.85));
        const targetRoll = Math.max(-0.40, Math.min(0.40, this.smoothedLateral * 0.72));
        const aL = norm.armLeft || { raise: 0.14, abduct: 0.06, elbowFlex: 0.35 };
        const aR = norm.armRight || { raise: 0.14, abduct: 0.06, elbowFlex: 0.35 };

        const targets = {
            torsoPitch: targetPitch,
            torsoRoll: targetRoll,
            headYaw: norm.headYaw || 0,
            armRaiseL: Math.max(-0.4, Math.min(2.6, aL.raise)),
            armAbductL: Math.max(0.04, Math.min(2.2, aL.abduct)),
            elbowL: Math.max(0.15, Math.min(2.2, aL.elbowFlex)),
            armRaiseR: Math.max(-0.4, Math.min(2.6, aR.raise)),
            armAbductR: Math.max(0.04, Math.min(2.2, aR.abduct)),
            elbowR: Math.max(0.15, Math.min(2.2, aR.elbowFlex)),
            squatDepth: Math.max(0.0, Math.min(0.95, this.smoothedSquat))
        };

        for (const k of Object.keys(this.smoothedJoints)) {
            this.smoothedJoints[k] = this._smoothJoint(this.smoothedJoints[k], targets[k], alpha);
        }

        // Classify dominant expressive motion skill with hysteresis
        const armThresh = this.thresholds.armRaiseEnter;
        const leftElev = this.smoothedJoints.armRaiseL + this.smoothedJoints.armAbductL * 0.8;
        const rightElev = this.smoothedJoints.armRaiseR + this.smoothedJoints.armAbductR * 0.8;
        const isLeftRaised = leftElev > armThresh;
        const isRightRaised = rightElev > armThresh;

        let candidate = 0; // NEUTRAL

        if (isLeftRaised && isRightRaised) {
            candidate = 7; // BOTH_ARMS_UP
        } else if (isLeftRaised) {
            candidate = 5; // WAVE_LEFT_ARM
        } else if (isRightRaised) {
            candidate = 6; // WAVE_RIGHT_ARM
        } else if (this.smoothedSquat > this.thresholds.squatEnter) {
            candidate = 8; // SQUAT_CROUCH
        } else {
            const absFwd = Math.abs(this.smoothedForward);
            const absLat = Math.abs(this.smoothedLateral);
            const fwdEnter = this.thresholds.forwardEnter;
            const bwdEnter = this.thresholds.backwardEnter;
            const latEnter = this.thresholds.lateralEnter;

            if (absFwd >= absLat * 0.9) {
                if (this.smoothedForward >= fwdEnter) candidate = 1;
                else if (this.smoothedForward <= -bwdEnter) candidate = 2;
            } else {
                if (this.smoothedLateral <= -latEnter) candidate = 3;
                else if (this.smoothedLateral >= latEnter) candidate = 4;
            }
        }

        // Keep current action until minHoldMs elapses
        if (candidate !== this.currentAction) {
            if ((now - this.lastSwitchTs) >= this.thresholds.minHoldMs || candidate === 0) {
                this.currentAction = candidate;
                this.lastSwitchTs = now;
            }
        }

        const meta = IMITATION_ACTIONS[this.currentAction] || IMITATION_ACTIONS[0];
        return {
            action: this.currentAction,
            code: meta.code,
            label: meta.label,
            confidence: pose.confidence,
            isValidPose: true,
            continuousJoints: { ...this.smoothedJoints },
            smoothedForward: Number(this.smoothedForward.toFixed(3)),
            smoothedLateral: Number(this.smoothedLateral.toFixed(3))
        };
    }
}
