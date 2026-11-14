/**
 * BehaviorCloningModel.js
 * Orchestrates Dual-Head Behavior Cloning training via a dedicated Web Worker
 * (Policy Classifier 9-class + Continuous Pose Regressor 10-joint) and manages
 * model persistence, listing, downloading, and activation through PHP MVC APIs.
 */
import { DatasetPreprocessor, POSE_TARGET_DIM } from './DatasetPreprocessor.js';
import { ModelEvaluator } from './ModelEvaluator.js';
import { STATE_DIM } from './StateObserver.js';
import { ACTION_COUNT, IMITATION_ACTIONS } from './MotionInterpreter.js';

export class BehaviorCloningModel {
    constructor(options = {}) {
        this.appPath = options.appPath || '';
        this.csrfToken = options.csrfToken || '';
        this.datasetManager = options.datasetManager;

        this.onEpochProgress = options.onEpochProgress || (() => {});
        this.onTrainingComplete = options.onTrainingComplete || (() => {});
        this.onTrainingCancelled = options.onTrainingCancelled || (() => {});
        this.onError = options.onError || (() => {});

        this.worker = null;
        this.isTraining = false;
        this.activeSessionId = null;
        this.lastPrepared = null;
        this.lastTrainedArtifact = null;
    }

    setCsrfToken(token) {
        if (token) this.csrfToken = token;
    }

    async _request(endpoint, method = 'GET', body = null) {
        const headers = { 'Accept': 'application/json' };
        if (this.csrfToken) {
            headers['X-CSRF-TOKEN'] = this.csrfToken;
        }
        const opts = { method, headers, credentials: 'same-origin' };
        if (body !== null && method !== 'GET') {
            headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify({
                csrf_token: this.csrfToken,
                ...body
            });
        }

        const resp = await fetch(`${this.appPath}${endpoint}`, opts);
        let data = null;
        try {
            data = await resp.json();
        } catch (e) {
            throw new Error(`Invalid server response (HTTP ${resp.status}).`);
        }
        if (!resp.ok || !data || data.success === false) {
            throw new Error(data?.message || `API request failed (HTTP ${resp.status}).`);
        }
        return data;
    }

    async loadAndInspectDatasets(demonstrationIds, valSplitRatio = 0.20) {
        if (!Array.isArray(demonstrationIds) || demonstrationIds.length === 0) {
            throw new Error('Select at least one demonstration dataset.');
        }

        let combinedTransitions = [];
        for (const demoId of demonstrationIds) {
            const loaded = await this.datasetManager.loadReplayTransitions(demoId);
            const transitions = Array.isArray(loaded.transitions) ? loaded.transitions : [];
            for (const t of transitions) {
                combinedTransitions.push({
                    ...t,
                    demonstration_id: t.demonstration_id ?? demoId
                });
            }
        }

        const preprocessor = new DatasetPreprocessor({
            stateDim: STATE_DIM,
            actionDim: ACTION_COUNT,
            valSplitRatio
        });

        const prepared = preprocessor.prepare(combinedTransitions, { valSplitRatio });
        const warnings = [];
        if (prepared.splitWarning) {
            warnings.push(prepared.splitWarning);
        }
        const activeClasses = prepared.totalClassCounts.filter((c) => c >= 3).length;
        if (activeClasses < 2) {
            warnings.push('Dataset contains fewer than 2 active motion classes. Record diverse poses (e.g., Raise Arms, Squat, Turn, Forward) for richer imitation.');
        }
        if (prepared.rejectedCount > 0) {
            warnings.push(`${prepared.rejectedCount} non-${STATE_DIM}D samples were automatically skipped.`);
        }

        prepared.warnings = warnings;
        prepared.actionLabels = IMITATION_ACTIONS.map((a) => a.label);
        this.lastPrepared = prepared;
        return prepared;
    }

    async startTraining(config = {}) {
        if (this.isTraining) {
            throw new Error('Behavior Cloning training is already running.');
        }

        const demonstrationIds = config.demonstrationIds || [];
        const valSplitRatio = config.valSplitRatio ?? 0.20;
        const epochs = config.epochs || 50;
        const batchSize = config.batchSize || 32;
        const learningRate = config.learningRate || 0.001;
        const useClassWeights = config.useClassWeights !== false;
        const modelName = String(config.modelName || `ImitationNet-${new Date().toLocaleTimeString('en-US')}`).trim();

        const prepared = await this.loadAndInspectDatasets(demonstrationIds, valSplitRatio);
        this.isTraining = true;
        this.activeSessionId = null;

        // Log session creation in MariaDB (aligned with api.php training/create schema)
        try {
            const created = await this._request('/api/training/create', 'POST', {
                demonstration_ids: demonstrationIds,
                model_name: modelName,
                architecture: {
                    inputDim: prepared.stateDim,
                    hiddenLayers: [128, 64],
                    outputActions: prepared.actionDim,
                    poseDim: prepared.poseDim || POSE_TARGET_DIM
                },
                hyperparams: { epochs, batchSize, learningRate },
                normalization: prepared.normalization,
                total_samples: prepared.totalValidCount,
                train_samples: prepared.trainCount,
                val_samples: prepared.valCount,
                epochs_planned: epochs,
                class_distribution: prepared.totalClassCounts
            });
            this.activeSessionId = created.training_session_id || created.session_id || created.id || null;
        } catch (err) {
            console.warn('Info: sesi training DB optional tidak tercatat:', err.message);
        }

        this._ensureWorker();

        const workerUrlTf = `${window.location.origin}${this.appPath}/public/assets/vendor/tfjs/tf.min.js`;
        const xTrainBuf = prepared.xTrain.buffer.slice(0);
        const yTrainBuf = prepared.yTrain.buffer.slice(0);
        const yPoseTrainBuf = prepared.yPoseTrain.buffer.slice(0);
        const xValBuf = prepared.xVal.buffer.slice(0);
        const yValBuf = prepared.yVal.buffer.slice(0);
        const yPoseValBuf = prepared.yPoseVal.buffer.slice(0);

        this._pendingConfig = {
            demonstrationIds,
            modelName,
            epochs,
            batchSize,
            learningRate,
            prepared
        };

        this.worker.postMessage(
            {
                cmd: 'START_TRAINING',
                tfScriptUrl: workerUrlTf,
                stateDim: prepared.stateDim,
                actionDim: prepared.actionDim,
                poseDim: prepared.poseDim || POSE_TARGET_DIM,
                epochs,
                batchSize,
                learningRate,
                poseLearningRate: 0.0015,
                hidden1: 128,
                hidden2: 64,
                earlyStoppingPatience: 15,
                useClassWeights,
                classWeight: prepared.classWeight,
                trainCount: prepared.trainCount,
                valCount: prepared.valCount,
                xTrainBuffer: xTrainBuf,
                yTrainBuffer: yTrainBuf,
                yPoseTrainBuffer: yPoseTrainBuf,
                xValBuffer: xValBuf,
                yValBuffer: yValBuf,
                yPoseValBuffer: yPoseValBuf
            },
            [xTrainBuf, yTrainBuf, yPoseTrainBuf, xValBuf, yValBuf, yPoseValBuf]
        );

        return prepared;
    }

    _ensureWorker() {
        if (this.worker) return;
        const workerPath = `${this.appPath}/public/assets/js/imitation/bc-training-worker.js`;
        this.worker = new Worker(workerPath);

        this.worker.onmessage = async (e) => {
            const msg = e.data || {};
            if (msg.type === 'EPOCH_PROGRESS') {
                if (this.activeSessionId && (msg.epoch % 5 === 0 || msg.epoch === msg.totalEpochs)) {
                    this._request('/api/training/update-metrics', 'POST', {
                        training_session_id: this.activeSessionId,
                        metrics: [{
                            epoch: msg.epoch,
                            loss: msg.loss,
                            accuracy: msg.accuracy,
                            val_loss: msg.val_loss,
                            val_accuracy: msg.val_accuracy,
                            learning_rate: msg.learningRate
                        }]
                    }).catch(() => {});
                }
                this.onEpochProgress(msg);
            } else if (msg.type === 'TRAINING_COMPLETE') {
                this.isTraining = false;
                const ctx = this._pendingConfig || {};
                const prepared = ctx.prepared || this.lastPrepared;
                const evaluation = ModelEvaluator.evaluate(
                    msg.yValTrue || [],
                    msg.yValPred || [],
                    prepared?.actionDim || ACTION_COUNT,
                    { poseValMse: msg.poseValMse }
                );

                this.lastTrainedArtifact = {
                    modelName: ctx.modelName || 'ImitationNet-BC',
                    sessionId: this.activeSessionId,
                    demonstrationIds: ctx.demonstrationIds || [],
                    stateDim: prepared?.stateDim || STATE_DIM,
                    actionDim: prepared?.actionDim || ACTION_COUNT,
                    poseDim: prepared?.poseDim || POSE_TARGET_DIM,
                    normalization: prepared?.normalization || {},
                    architecture: msg.architecture,
                    weights: msg.weights,
                    poseWeights: msg.poseWeights || null,
                    metrics: {
                        epochsCompleted: msg.epochsCompleted,
                        bestEpoch: msg.bestEpoch,
                        finalLoss: msg.finalLoss,
                        finalAccuracy: msg.finalAccuracy,
                        finalValLoss: msg.finalValLoss,
                        finalValAccuracy: msg.finalValAccuracy,
                        poseValMse: msg.poseValMse ?? null,
                        evaluation,
                        splitMode: prepared?.splitMode || 'episode_grouped',
                        totalClassCounts: prepared?.totalClassCounts || []
                    }
                };

                if (this.activeSessionId) {
                    this._request('/api/training/complete', 'POST', {
                        training_session_id: this.activeSessionId,
                        epochs_completed: msg.epochsCompleted,
                        best_epoch: msg.bestEpoch,
                        final_loss: msg.finalLoss,
                        final_accuracy: msg.finalAccuracy,
                        final_val_loss: msg.finalValLoss,
                        final_val_accuracy: msg.finalValAccuracy,
                        metrics: this.lastTrainedArtifact.metrics,
                        confusion_matrix: evaluation.confusionMatrix,
                        status: 'completed'
                    }).catch(() => {});
                }

                this.onTrainingComplete(this.lastTrainedArtifact, evaluation, prepared);
            } else if (msg.type === 'TRAINING_CANCELLED') {
                this.isTraining = false;
                if (this.activeSessionId) {
                    this._request('/api/training/complete', 'POST', {
                        training_session_id: this.activeSessionId,
                        status: 'cancelled'
                    }).catch(() => {});
                }
                this.onTrainingCancelled(msg);
            } else if (msg.type === 'TRAINING_ERROR') {
                this.isTraining = false;
                this.onError(msg.message || 'Failed to run Behavior Cloning training.');
            }
        };

        this.worker.onerror = (err) => {
            this.isTraining = false;
            this.onError(`BC Web Worker error: ${err?.message || 'Unknown error'}`);
        };
    }

    cancelTraining() {
        if (this.worker && this.isTraining) {
            this.worker.postMessage({ cmd: 'CANCEL_TRAINING' });
        }
    }

    async saveTrainedModelToServer(modelNameOverride = null, activateAfterSave = true) {
        if (!this.lastTrainedArtifact || !Array.isArray(this.lastTrainedArtifact.weights)) {
            throw new Error('No trained Behavior Cloning result is ready to save yet.');
        }

        const art = this.lastTrainedArtifact;
        const name = String(modelNameOverride || art.modelName || 'ImitationNet-BC').trim();

        return await this._request('/api/models/upload', 'POST', {
            model_name: name,
            version: '2.0.0',
            training_session_id: art.sessionId || null,
            demonstration_ids: art.demonstrationIds || [],
            state_dim: art.stateDim || STATE_DIM,
            action_dim: art.actionDim || ACTION_COUNT,
            architecture: art.architecture,
            normalization: art.normalization,
            metrics: art.metrics,
            activate: Boolean(activateAfterSave),
            model_artifact: {
                architecture: art.architecture,
                normalization: art.normalization,
                weights: art.weights,
                poseWeights: art.poseWeights || null,
                metrics: art.metrics
            }
        });
    }

    async listModels() {
        return await this._request('/api/models/list', 'GET');
    }

    async activateModel(modelId) {
        return await this._request('/api/models/activate', 'POST', { model_id: modelId });
    }

    async downloadModelArtifact(modelId) {
        return await this._request(`/api/models/download/${modelId}`, 'GET');
    }

    async deleteModel(modelId) {
        return await this._request('/api/models/delete', 'POST', { model_id: modelId });
    }

    async fetchTrainingHistory() {
        return await this._request('/api/training/history', 'GET');
    }
}
