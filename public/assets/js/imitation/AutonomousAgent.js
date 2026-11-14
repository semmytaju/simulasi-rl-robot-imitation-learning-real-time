/**
 * AutonomousAgent.js
 * Zero-webcam Autonomous Imitation Agent powered by TensorFlow.js Dual-Head Behavior Cloning:
 *   - Policy Head predicts 9 human motion classes + probability confidence
 *   - Pose Regressor Head predicts 10 continuous biomechanical joint targets
 * Runs purely from environment/kinematic state (StateObserver 12-dim), NEVER requiring webcam input.
 */
import { StateObserver, STATE_DIM } from './StateObserver.js';
import { DatasetPreprocessor, POSE_TARGET_DIM } from './DatasetPreprocessor.js';
import { CONTROL_MODES } from './RobotActionController.js';
import {
    IMITATION_ACTIONS,
    ACTION_COUNT,
    NEUTRAL_JOINTS,
    getArchetypeJointsForAction
} from './MotionInterpreter.js';

export class AutonomousAgent {
    constructor(options = {}) {
        this.stateObserver = options.stateObserver;
        this.actionController = options.actionController;
        this.bcModelManager = options.bcModelManager;

        this.confidenceThreshold = options.confidenceThreshold ?? 0.45;
        this.onPrediction = options.onPrediction || (() => {});
        this.onStatsUpdate = options.onStatsUpdate || (() => {});
        this.onStatusChange = options.onStatusChange || (() => {});
        this.onError = options.onError || (() => {});

        this.tfModel = null;
        this.poseTfModel = null;
        this.normalization = null;
        this.modelMeta = null;
        this.stateDim = STATE_DIM;
        this.actionDim = ACTION_COUNT;

        this.status = 'idle'; // idle | model_loaded | running | paused
        this.lastInferAt = 0;
        this.minInferIntervalMs = 55; // ~18 Hz smooth inference without frame drops

        this.inferenceCount = 0;
        this.fallbackCount = 0;
        this.cyclesCompleted = 0;
        this.avgLatencyMs = 0;
        this.lastPhase = 0;
        this.lastHudAt = 0;
    }

    hasLoadedModel() {
        return Boolean(this.tfModel);
    }

    setConfidenceThreshold(val) {
        const clamped = Math.max(0.20, Math.min(0.95, Number(val) || 0.45));
        this.confidenceThreshold = clamped;
    }

    async _ensureTfReady() {
        if (typeof window.tf === 'undefined') {
            throw new Error('TensorFlow.js is not loaded yet.');
        }
        await window.tf.ready();
    }

    _disposeModels() {
        if (this.tfModel) {
            try { this.tfModel.dispose(); } catch (e) {}
            this.tfModel = null;
        }
        if (this.poseTfModel) {
            try { this.poseTfModel.dispose(); } catch (e) {}
            this.poseTfModel = null;
        }
    }

    async loadModelFromArtifact(artifact, meta = {}) {
        if (!artifact || !Array.isArray(artifact.weights) || artifact.weights.length === 0) {
            throw new Error('Behavior Cloning model artifact does not contain valid network weights.');
        }
        await this._ensureTfReady();

        const tf = window.tf;
        const arch = artifact.architecture || {};
        const stateDim = arch.inputDim || meta.stateDim || STATE_DIM;
        const actionDim = arch.outputActions || meta.actionDim || ACTION_COUNT;
        const hidden = Array.isArray(arch.hiddenLayers) ? arch.hiddenLayers : [128, 64];

        this._disposeModels();

        // 1. Rebuild Policy Classifier Head
        const policyModel = tf.sequential();
        policyModel.add(tf.layers.dense({
            inputShape: [stateDim],
            units: hidden[0] || 128,
            activation: 'relu'
        }));
        policyModel.add(tf.layers.dense({
            units: hidden[1] || 64,
            activation: 'relu'
        }));
        policyModel.add(tf.layers.dense({
            units: actionDim,
            activation: 'softmax'
        }));

        tf.tidy(() => {
            const weightTensors = artifact.weights.map((w) => tf.tensor(w.data, w.shape));
            policyModel.setWeights(weightTensors);
        });
        this.tfModel = policyModel;

        // 2. Rebuild Continuous Pose Regressor Head (when available)
        if (Array.isArray(artifact.poseWeights) && artifact.poseWeights.length >= 4) {
            const poseDim = arch.poseDim || POSE_TARGET_DIM;
            const pHidden = Array.isArray(arch.poseHiddenLayers) && arch.poseHiddenLayers.length >= 2
                ? arch.poseHiddenLayers
                : [96, 48];
            const poseModel = tf.sequential();
            poseModel.add(tf.layers.dense({
                inputShape: [stateDim],
                units: pHidden[0] || 96,
                activation: 'relu'
            }));
            poseModel.add(tf.layers.dense({
                units: pHidden[1] || 48,
                activation: 'relu'
            }));
            poseModel.add(tf.layers.dense({
                units: poseDim,
                activation: arch.poseActivation || 'tanh'
            }));
            tf.tidy(() => {
                const pwTensors = artifact.poseWeights.map((w) => tf.tensor(w.data, w.shape));
                poseModel.setWeights(pwTensors);
            });
            this.poseTfModel = poseModel;
        }

        // One-shot WebGL shader warmup so live loop stays jitter-free
        tf.tidy(() => {
            const dummy = tf.zeros([1, stateDim]);
            this.tfModel.predict(dummy).dataSync();
            if (this.poseTfModel) {
                this.poseTfModel.predict(dummy).dataSync();
            }
        });

        this.stateDim = stateDim;
        this.actionDim = actionDim;
        this.normalization = artifact.normalization || {};
        this.modelMeta = {
            modelId: meta.modelId || null,
            modelName: meta.modelName || 'ImitationNet-BC',
            stateDim,
            actionDim,
            hasPoseHead: Boolean(this.poseTfModel),
            metrics: artifact.metrics || meta.metrics || {}
        };

        this.status = 'model_loaded';
        this.onStatusChange('model_loaded', this.modelMeta);
        return this.modelMeta;
    }

    async loadModelById(modelId) {
        if (!this.bcModelManager) {
            throw new Error('Dataset/Model manager is not available.');
        }
        const res = await this.bcModelManager.downloadModelArtifact(modelId);
        const rec = res?.model;
        if (!rec || !rec.artifact) {
            throw new Error('Model artifact was not found on the server.');
        }
        return await this.loadModelFromArtifact(rec.artifact, {
            modelId: rec.id,
            modelName: rec.model_name,
            stateDim: rec.state_dim,
            actionDim: rec.action_dim,
            metrics: rec.metrics
        });
    }

    start() {
        if (!this.hasLoadedModel()) {
            throw new Error('Please load an active Behavior Cloning model first.');
        }
        this.status = 'running';
        this.actionController.setMode(CONTROL_MODES.BC_AUTONOMOUS, 'BC_AGENT');
        this.onStatusChange('running', this.modelMeta);
    }

    pause() {
        if (this.status === 'running') {
            this.status = 'paused';
            this.actionController.emergencyStop('BC_AGENT');
            this.onStatusChange('paused', this.modelMeta);
        }
    }

    stop() {
        this.status = this.hasLoadedModel() ? 'model_loaded' : 'idle';
        this.actionController.emergencyStop('BC_AGENT');
        this.onStatusChange(this.status, this.modelMeta);
    }

    resetStats() {
        this.inferenceCount = 0;
        this.fallbackCount = 0;
        this.cyclesCompleted = 0;
        this.avgLatencyMs = 0;
        this._emitStats();
    }

    /**
     * Executes one closed-loop autonomous imitation inference tick without webcam.
     */
    step(motionState) {
        if (this.status !== 'running' || !this.tfModel) return;

        const now = performance.now();
        if (now - this.lastInferAt < this.minInferIntervalMs) return;
        this.lastInferAt = now;

        const seqPhase = Number(motionState?.seqPhase ?? 0);
        if (seqPhase < this.lastPhase - 0.5) {
            this.cyclesCompleted++;
        }
        this.lastPhase = seqPhase;

        const obs = this.stateObserver.observe(motionState);
        if (!obs || !Array.isArray(obs.vector) || obs.vector.length !== this.stateDim) {
            return;
        }

        const normalized = DatasetPreprocessor.normalizeSingleState(obs.vector, this.normalization);
        const tf = window.tf;
        const t0 = performance.now();

        let probs = [];
        let poseSlice = null;

        tf.tidy(() => {
            const xT = tf.tensor2d([normalized], [1, this.stateDim]);
            const predTensor = this.tfModel.predict(xT);
            probs = Array.from(predTensor.dataSync());
            if (this.poseTfModel) {
                poseSlice = Array.from(this.poseTfModel.predict(xT).dataSync());
            }
        });

        const latencyMs = performance.now() - t0;
        this.avgLatencyMs = this.inferenceCount === 0
            ? latencyMs
            : (this.avgLatencyMs * 0.85 + latencyMs * 0.15);

        let bestAction = 0;
        let maxProb = -1;
        for (let i = 0; i < probs.length; i++) {
            if (probs[i] > maxProb) {
                maxProb = probs[i];
                bestAction = i;
            }
        }

        const usedFallback = maxProb < this.confidenceThreshold;
        const finalAction = usedFallback ? 0 : Math.min(ACTION_COUNT - 1, bestAction);
        const actDef = IMITATION_ACTIONS[finalAction] || IMITATION_ACTIONS[0];

        // Reconstruct continuous joint target vector
        let targetJoints;
        if (poseSlice && poseSlice.length >= 10) {
            const regressed = StateObserver.jointsFromPoseSlice(poseSlice);
            const arch = getArchetypeJointsForAction(finalAction);
            targetJoints = {};
            for (const key of Object.keys(NEUTRAL_JOINTS)) {
                const regVal = regressed[key] ?? NEUTRAL_JOINTS[key];
                const guideVal = usedFallback ? NEUTRAL_JOINTS[key] : (arch[key] ?? regVal);
                const weightGuide = usedFallback ? 0.55 : 0.18;
                targetJoints[key] = regVal * (1 - weightGuide) + guideVal * weightGuide;
            }
        } else {
            targetJoints = getArchetypeJointsForAction(finalAction);
        }

        this.actionController.dispatchImitationAction(finalAction, 'BC_AGENT', {
            confidence: maxProb,
            label: actDef.label,
            usedFallback,
            continuousJoints: targetJoints
        });

        this.inferenceCount++;
        if (usedFallback) this.fallbackCount++;

        if (now - this.lastHudAt >= 90) {
            this.lastHudAt = now;
            this.onPrediction({
                action: finalAction,
                code: actDef.code,
                label: actDef.label,
                confidence: maxProb,
                probs,
                usedFallback,
                latencyMs
            });
            this._emitStats();
        }
    }

    _emitStats() {
        const confidentCount = Math.max(0, this.inferenceCount - this.fallbackCount);
        const stabilityPct = this.inferenceCount > 0
            ? Math.round((confidentCount / this.inferenceCount) * 100)
            : 100;
        this.onStatsUpdate({
            steps: this.inferenceCount,
            cycles: this.cyclesCompleted,
            confidentSteps: confidentCount,
            fallbackSteps: this.fallbackCount,
            stabilityRate: stabilityPct,
            avgLatencyMs: Number(this.avgLatencyMs.toFixed(1))
        });
    }
}
