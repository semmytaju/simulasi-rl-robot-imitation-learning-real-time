/**
 * DatasetPreprocessor.js
 * Prepares human-motion demonstration transitions for Dual-Head Behavior Cloning:
 *   - Policy head: classifies 9 human motion classes (0..8)
 *   - Pose head: regresses 10 continuous kinematic joint targets from next_state[2..11]
 *   - Splits train / validation BY DEMONSTRATION EPISODE (never random frame split) to avoid leakage
 *   - Computes z-score feature normalization parameters on training set only
 */
import { StateObserver, STATE_DIM, STATE_FEATURE_NAMES } from './StateObserver.js';
import { ACTION_COUNT } from './MotionInterpreter.js';

export const POSE_TARGET_DIM = 10;

export class DatasetPreprocessor {
    constructor(options = {}) {
        this.stateDim = options.stateDim || STATE_DIM;
        this.actionDim = options.actionDim || ACTION_COUNT || 9;
        this.poseDim = POSE_TARGET_DIM;
        this.valSplitRatio = options.valSplitRatio ?? 0.20;
    }

    /**
     * Group transitions by (demonstration_id, episode_id) and split cleanly without leakage.
     */
    prepare(rawTransitions, options = {}) {
        const valRatio = Math.max(0.10, Math.min(0.40, options.valSplitRatio ?? this.valSplitRatio));
        const validSamples = [];
        let rejectedCount = 0;

        for (let i = 0; i < rawTransitions.length; i++) {
            const t = rawTransitions[i];
            const action = parseInt(t?.action, 10);
            const state = t?.state;
            if (
                !Array.isArray(state) ||
                state.length !== this.stateDim ||
                !StateObserver.isValidStateVector(state, this.stateDim) ||
                isNaN(action) || action < 0 || action >= this.actionDim
            ) {
                rejectedCount++;
                continue;
            }
            const nextState = (
                Array.isArray(t?.next_state) &&
                t.next_state.length === this.stateDim &&
                StateObserver.isValidStateVector(t.next_state, this.stateDim)
            ) ? t.next_state : state;

            const poseTarget = [];
            for (let j = 0; j < this.poseDim; j++) {
                const rawVal = Number(nextState[2 + j] ?? state[2 + j] ?? 0);
                poseTarget.push(Number.isFinite(rawVal) ? Math.max(-1, Math.min(1, rawVal)) : 0);
            }

            validSamples.push({
                demoId: parseInt(t.demonstration_id ?? 0, 10),
                episodeId: parseInt(t.episode_id ?? 1, 10),
                stepNumber: parseInt(t.step_number ?? i, 10),
                state: state.map(Number),
                poseTarget,
                action
            });
        }

        if (validSamples.length < 10) {
            const hint = rejectedCount > 0
                ? ` (${rejectedCount} legacy/incompatible samples skipped due to ${this.stateDim}-dim kinematic schema.)`
                : '';
            throw new Error(`Too few valid samples (${validSamples.length}). Record at least 10 human demonstration steps in Step 1 first.${hint}`);
        }

        // Group strictly by (demonstration_id, episode_id)
        const episodeMap = new Map();
        for (const s of validSamples) {
            const key = `${s.demoId}:${s.episodeId}`;
            if (!episodeMap.has(key)) episodeMap.set(key, []);
            episodeMap.get(key).push(s);
        }

        const episodeKeys = Array.from(episodeMap.keys());
        let trainSamples = [];
        let valSamples = [];
        let splitMode = 'episode_grouped';
        let splitWarning = null;

        if (episodeKeys.length >= 2) {
            // Deterministic or shuffled episode order (never frame-level shuffling across split!)
            const shuffledKeys = [...episodeKeys];
            for (let i = shuffledKeys.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffledKeys[i], shuffledKeys[j]] = [shuffledKeys[j], shuffledKeys[i]];
            }
            const valEpisodeCount = Math.max(1, Math.round(shuffledKeys.length * valRatio));
            const valKeySet = new Set(shuffledKeys.slice(0, valEpisodeCount));

            for (const key of shuffledKeys) {
                const group = episodeMap.get(key);
                if (valKeySet.has(key)) {
                    valSamples = valSamples.concat(group);
                } else {
                    trainSamples = trainSamples.concat(group);
                }
            }
        } else {
            // Only 1 episode exists: hold out contiguous tail segment (chronological block)
            splitMode = 'single_episode_contiguous_tail';
            splitWarning = 'Only 1 demonstration episode exists. Holding out the final 20% chronological tail segment for validation. Record >= 2 episodes for proper cross-episode validation.';
            const splitIdx = Math.max(5, Math.floor(validSamples.length * (1 - valRatio)));
            trainSamples = validSamples.slice(0, splitIdx);
            valSamples = validSamples.slice(splitIdx);
        }

        if (valSamples.length === 0) {
            valSamples = trainSamples.slice(-Math.max(1, Math.floor(trainSamples.length * 0.2)));
        }

        // Compute normalization stats (mean & std) exclusively from TRAINING split
        const mean = new Array(this.stateDim).fill(0);
        const std = new Array(this.stateDim).fill(0);
        const min = new Array(this.stateDim).fill(Infinity);
        const max = new Array(this.stateDim).fill(-Infinity);

        for (const s of trainSamples) {
            for (let d = 0; d < this.stateDim; d++) {
                const v = s.state[d];
                mean[d] += v;
                if (v < min[d]) min[d] = v;
                if (v > max[d]) max[d] = v;
            }
        }
        for (let d = 0; d < this.stateDim; d++) {
            mean[d] /= trainSamples.length;
        }
        for (const s of trainSamples) {
            for (let d = 0; d < this.stateDim; d++) {
                const diff = s.state[d] - mean[d];
                std[d] += diff * diff;
            }
        }
        for (let d = 0; d < this.stateDim; d++) {
            std[d] = Math.max(0.05, Math.sqrt(std[d] / trainSamples.length));
            mean[d] = Number(mean[d].toFixed(6));
            std[d] = Number(std[d].toFixed(6));
            min[d] = Number(min[d].toFixed(6));
            max[d] = Number(max[d].toFixed(6));
        }

        const normalizeVec = (vec) => {
            const out = new Array(this.stateDim);
            for (let d = 0; d < this.stateDim; d++) {
                const z = (vec[d] - mean[d]) / std[d];
                out[d] = Math.max(-6.0, Math.min(6.0, z));
            }
            return out;
        };

        // Analyze overall & train class distribution and compute balanced class weights
        const trainClassCounts = new Array(this.actionDim).fill(0);
        const totalClassCounts = new Array(this.actionDim).fill(0);
        for (const s of trainSamples) trainClassCounts[s.action]++;
        for (const s of validSamples) totalClassCounts[s.action]++;

        const activeClasses = trainClassCounts.filter(c => c > 0).length || 1;
        const classWeight = {};
        for (let c = 0; c < this.actionDim; c++) {
            if (trainClassCounts[c] > 0) {
                const rawW = trainSamples.length / (activeClasses * trainClassCounts[c]);
                classWeight[c] = Number(Math.max(0.4, Math.min(4.0, rawW)).toFixed(3));
            } else {
                classWeight[c] = 1.0;
            }
        }

        const xTrain = new Float32Array(trainSamples.length * this.stateDim);
        const yTrain = new Int32Array(trainSamples.length);
        const yPoseTrain = new Float32Array(trainSamples.length * this.poseDim);
        trainSamples.forEach((s, idx) => {
            const norm = normalizeVec(s.state);
            xTrain.set(norm, idx * this.stateDim);
            yTrain[idx] = s.action;
            yPoseTrain.set(s.poseTarget, idx * this.poseDim);
        });

        const xVal = new Float32Array(valSamples.length * this.stateDim);
        const yVal = new Int32Array(valSamples.length);
        const yPoseVal = new Float32Array(valSamples.length * this.poseDim);
        valSamples.forEach((s, idx) => {
            const norm = normalizeVec(s.state);
            xVal.set(norm, idx * this.stateDim);
            yVal[idx] = s.action;
            yPoseVal.set(s.poseTarget, idx * this.poseDim);
        });

        const meta = typeof StateObserver.getBaseSchemaMetadata === 'function'
            ? StateObserver.getBaseSchemaMetadata()
            : { schemaVersion: '2.0.0-kinematics', stateDim: this.stateDim };

        const normalization = {
            ...meta,
            featureNames: [...STATE_FEATURE_NAMES],
            featureCount: this.stateDim,
            poseTargetDim: this.poseDim,
            actionDim: this.actionDim,
            scaling: 'zscore_on_kinematics_env',
            mean,
            std,
            min,
            max
        };

        return {
            xTrain,
            yTrain,
            yPoseTrain,
            xVal,
            yVal,
            yPoseVal,
            stateDim: this.stateDim,
            actionDim: this.actionDim,
            poseDim: this.poseDim,
            trainCount: trainSamples.length,
            valCount: valSamples.length,
            totalValidCount: validSamples.length,
            rejectedCount,
            episodeCount: episodeKeys.length,
            splitMode,
            splitWarning,
            trainClassCounts,
            totalClassCounts,
            classWeight,
            normalization
        };
    }

    static normalizeSingleState(vec, normalization) {
        if (!Array.isArray(vec) || !normalization || !Array.isArray(normalization.mean) || !Array.isArray(normalization.std)) {
            return vec;
        }
        const mean = normalization.mean;
        const std = normalization.std;
        const out = new Array(vec.length);
        for (let i = 0; i < vec.length; i++) {
            const m = mean[i] ?? 0;
            const s = Math.max(1e-4, std[i] ?? 1);
            out[i] = Math.max(-6.0, Math.min(6.0, (vec[i] - m) / s));
        }
        return out;
    }
}
