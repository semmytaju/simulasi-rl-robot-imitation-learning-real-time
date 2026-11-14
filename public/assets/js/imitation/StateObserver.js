/**
 * StateObserver.js
 * Canonical 12-feature Human-Motion & Kinematic Observation Extractor for Imitation Learning.
 * Indices:
 *   0: sin(2*PI*seqPhase)   [-1, 1]  Temporal sequence phase sin
 *   1: cos(2*PI*seqPhase)   [-1, 1]  Temporal sequence phase cos
 *   2: torsoPitchNorm       [-1, 1]  Forward/Back lean
 *   3: torsoRollNorm        [-1, 1]  Side tilt
 *   4: headYawNorm          [-1, 1]  Head turn L/R
 *   5: armRaiseLNorm        [-1, 1]  Left upper-arm forward elevation
 *   6: armAbductLNorm       [-1, 1]  Left upper-arm lateral abduction
 *   7: elbowLNorm           [-1, 1]  Left elbow bend
 *   8: armRaiseRNorm        [-1, 1]  Right upper-arm forward elevation
 *   9: armAbductRNorm       [-1, 1]  Right upper-arm lateral abduction
 *  10: elbowRNorm           [-1, 1]  Right elbow bend
 *  11: squatDepthNorm       [-1, 1]  Crouch/squat height modulation
 */
export const STATE_DIM = 12;

export const STATE_FEATURE_NAMES = [
    'phase_sin',
    'phase_cos',
    'torso_pitch',
    'torso_roll',
    'head_yaw',
    'arm_raise_left',
    'arm_abduct_left',
    'elbow_left',
    'arm_raise_right',
    'arm_abduct_right',
    'elbow_right',
    'squat_depth'
];

function clamp(v, min = -1, max = 1) {
    return Math.max(min, Math.min(max, v));
}

export class StateObserver {
    constructor() {
        this.cycleDurationSec = 10.0;
    }

    observe(motionState) {
        if (!motionState) return null;

        const seqPhase = typeof motionState.seqPhase === 'number' ? motionState.seqPhase : 0;
        const angle = Math.PI * 2 * seqPhase;
        const j = motionState.joints || motionState;

        const vec = [
            clamp(Math.sin(angle)),
            clamp(Math.cos(angle)),
            clamp((j.torsoPitch || 0) / 0.55),
            clamp((j.torsoRoll || 0) / 0.45),
            clamp((j.headYaw || 0) / 0.75),
            clamp(((j.armRaiseL ?? 0.14) - 0.9) / 1.7),
            clamp((j.armAbductL || 0) / 2.2),
            clamp(((j.elbowL ?? 0.35) - 1.1) / 1.15),
            clamp(((j.armRaiseR ?? 0.14) - 0.9) / 1.7),
            clamp((j.armAbductR || 0) / 2.2),
            clamp(((j.elbowR ?? 0.35) - 1.1) / 1.15),
            clamp(((j.squatDepth || 0) * 2.0) - 1.0)
        ];

        const cleanVec = vec.map(v => Number(v.toFixed(5)));
        return {
            vector: cleanVec,
            raw: { ...j, seqPhase }
        };
    }

    /**
     * Converts normalized 10-joint output vector (elements 2..11 of state OR 10-dim pose prediction)
     * back into physical Three.js joint angles (radians / squat ratio).
     */
    static jointsFromPoseSlice(slice10) {
        if (!Array.isArray(slice10) || slice10.length < 10) return null;
        return {
            torsoPitch: clamp(slice10[0], -1, 1) * 0.55,
            torsoRoll: clamp(slice10[1], -1, 1) * 0.45,
            headYaw: clamp(slice10[2], -1, 1) * 0.75,
            armRaiseL: clamp(slice10[3], -1, 1) * 1.7 + 0.9,
            armAbductL: Math.max(0, clamp(slice10[4], -1, 1)) * 2.2,
            elbowL: Math.max(0.15, clamp(slice10[5], -1, 1) * 1.15 + 1.1),
            armRaiseR: clamp(slice10[6], -1, 1) * 1.7 + 0.9,
            armAbductR: Math.max(0, clamp(slice10[7], -1, 1)) * 2.2,
            elbowR: Math.max(0.15, clamp(slice10[8], -1, 1) * 1.15 + 1.1),
            squatDepth: Math.max(0, Math.min(0.95, (clamp(slice10[9], -1, 1) + 1.0) * 0.5))
        };
    }

    static isValidStateVector(vec, expectedDim = STATE_DIM) {
        if (!Array.isArray(vec) || vec.length !== expectedDim) return false;
        for (let i = 0; i < vec.length; i++) {
            const val = vec[i];
            if (typeof val !== 'number' || !Number.isFinite(val) || Math.abs(val) > 5.0) {
                return false;
            }
        }
        return true;
    }
}
