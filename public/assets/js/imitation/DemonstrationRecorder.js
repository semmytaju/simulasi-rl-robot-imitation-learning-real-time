/**
 * DemonstrationRecorder.js
 * Captures synchronized (state_t, action_t, reward_t, next_state_{t+1}, done_t) tuples
 * at a fixed 8 Hz rate for Dual-Head Behavior Cloning (9 motion classes + 10 continuous joints).
 */
import { StateObserver, STATE_DIM } from './StateObserver.js';
import { ACTION_COUNT } from './MotionInterpreter.js';

export class DemonstrationRecorder {
    constructor(options = {}) {
        this.stateObserver = options.stateObserver;
        this.datasetManager = options.datasetManager;
        this.sampleRateHz = options.sampleRateHz || 8;
        this.sampleIntervalMs = Math.round(1000 / this.sampleRateHz);
        this.minConfidence = options.minConfidence ?? 0.35;

        this.onStatsUpdate = options.onStatsUpdate || (() => {});
        this.onError = options.onError || (() => {});

        this.resetLocalState();
    }

    resetLocalState() {
        this.activeDemoId = null;
        this.demoTitle = '';
        this.isRecording = false;
        this.isPaused = false;
        this.episodeId = 1;
        this.stepNumber = 0;
        this.episodeCount = 0;
        this.totalRecordedSteps = 0;
        this.totalRewardSum = 0;
        this.successEpisodes = 0;
        this.confidenceSum = 0;
        this.actionCounts = new Array(ACTION_COUNT).fill(0);

        this._buffer = [];
        this._pendingSample = null;
        this._lastCaptureAt = 0;
        this._consecutiveNeutralCount = 0;
        this._isFlushing = false;
    }

    getStats() {
        const avgConf = this.totalRecordedSteps > 0
            ? Number((this.confidenceSum / this.totalRecordedSteps).toFixed(3))
            : 0;
        const epTotal = Math.max(this.episodeCount, this.totalRecordedSteps > 0 ? 1 : 0);
        const successRate = epTotal > 0 ? Math.round((this.successEpisodes / epTotal) * 100) : 100;

        return {
            demoId: this.activeDemoId,
            title: this.demoTitle,
            isRecording: this.isRecording,
            isPaused: this.isPaused,
            episodeCount: epTotal,
            totalSteps: this.totalRecordedSteps,
            totalReward: Number(this.totalRewardSum.toFixed(2)),
            successEpisodes: this.successEpisodes,
            successRate,
            avgConfidence: avgConf,
            actionCounts: [...this.actionCounts]
        };
    }

    async startRecording(meta = {}) {
        if (this.isRecording) return false;
        this.resetLocalState();

        const title = String(meta.title || `Motion Demo ${new Date().toLocaleTimeString('en-US')}`).trim();
        const demonstrator = String(meta.demonstratorName || 'Human Operator').trim();
        const inputSource = meta.inputSource || 'WEBCAM';

        try {
            const res = await this.datasetManager.createDemonstration({
                title,
                demonstrator_name: demonstrator,
                input_source: inputSource,
                state_dim: STATE_DIM,
                action_dim: ACTION_COUNT,
                sample_rate_hz: this.sampleRateHz,
                calibration_json: meta.calibration || null
            });

            this.activeDemoId = res.demonstration_id || res.id;
            this.demoTitle = title;
            this.isRecording = true;
            this.isPaused = false;
            this._lastCaptureAt = 0;
            this._emitStats();
            return true;
        } catch (err) {
            this.onError(`Failed to start demonstration recording: ${err.message}`);
            return false;
        }
    }

    pauseRecording() {
        if (!this.isRecording) return;
        this.isPaused = true;
        this._pendingSample = null;
        this._emitStats();
    }

    resumeRecording() {
        if (!this.isRecording) return;
        this.isPaused = false;
        this._lastCaptureAt = 0;
        this._emitStats();
    }

    async stopRecording(finalMotionState = null) {
        if (!this.isRecording) return null;

        // Flush final pending transition cleanly so even short demos retain full sequence
        if (this._pendingSample && finalMotionState) {
            const obs = this.stateObserver.observe(finalMotionState);
            if (obs && StateObserver.isValidStateVector(obs.vector, STATE_DIM)) {
                this._commitTransition({
                    ...this._pendingSample,
                    next_state: obs.vector,
                    done: 1
                });
            }
        }
        if (this.totalRecordedSteps > 0) {
            this.episodeCount = Math.max(1, this.episodeCount);
            this.successEpisodes = this.episodeCount;
        }

        this.isRecording = false;
        this.isPaused = false;
        this._pendingSample = null;

        await this.flushBuffer(true);
        const finalStats = this.getStats();
        this._emitStats();
        return finalStats;
    }

    /**
     * Synchronized 8 Hz motion capture hook called on every MotionLabEngine tick.
     */
    onControlStep(motionState, latestActionMeta = {}) {
        if (!this.isRecording || this.isPaused || !this.activeDemoId) return;

        const now = performance.now();
        if (now - this._lastCaptureAt < this.sampleIntervalMs) {
            return;
        }
        this._lastCaptureAt = now;

        const confidence = Number(latestActionMeta.confidence ?? motionState?.confidence ?? 1.0);
        const inputSource = latestActionMeta.inputSource || motionState?.inputSource || 'KEYBOARD';
        const actionId = parseInt(latestActionMeta.action ?? motionState?.action ?? 0, 10);
        const safeAction = (isNaN(actionId) || actionId < 0 || actionId >= ACTION_COUNT) ? 0 : actionId;

        if (inputSource === 'WEBCAM' && confidence < this.minConfidence) {
            return;
        }

        const obs = this.stateObserver.observe(motionState);
        if (!obs || !StateObserver.isValidStateVector(obs.vector, STATE_DIM)) {
            return;
        }
        const curState = obs.vector;

        // Quality filter: prevent flooding dataset with > 20 identical stationary NEUTRAL frames
        if (safeAction === 0 && this._pendingSample && this._vectorsNearlyEqual(curState, this._pendingSample.state, 0.015)) {
            this._consecutiveNeutralCount++;
            if (this._consecutiveNeutralCount > 20) {
                return;
            }
        } else {
            this._consecutiveNeutralCount = 0;
        }

        // Genuine kinematic imitation quality reward
        const qualityReward = Number((
            (safeAction === 0 ? 0.15 : 0.45) * Math.max(0.3, Math.min(1.0, confidence))
            - (motionState?.atBoundary ? 0.10 : 0)
        ).toFixed(4));

        if (this._pendingSample) {
            this._commitTransition({
                ...this._pendingSample,
                reward: qualityReward,
                next_state: curState,
                done: 0
            });

            if (this._buffer.length >= 40 && !this._isFlushing) {
                this.flushBuffer(false);
            }
        }

        this.stepNumber++;
        this._pendingSample = {
            episode_id: this.episodeId,
            step_number: this.stepNumber,
            timestamp_ms: Math.round(now),
            state: curState,
            action: safeAction,
            confidence: Number(confidence.toFixed(4)),
            reward: qualityReward,
            flag_corner: 0
        };
    }

    markNewEpisode(finalMotionState = null) {
        if (!this.isRecording) return;
        if (this._pendingSample && finalMotionState) {
            const obs = this.stateObserver.observe(finalMotionState);
            if (obs && StateObserver.isValidStateVector(obs.vector, STATE_DIM)) {
                this._commitTransition({
                    ...this._pendingSample,
                    next_state: obs.vector,
                    done: 1
                });
            }
        }
        this.episodeCount++;
        this.successEpisodes = this.episodeCount;
        this._pendingSample = null;
        this._consecutiveNeutralCount = 0;
        this.episodeId++;
        this.stepNumber = 0;
        this.flushBuffer(false);
        this._emitStats();
    }

    _commitTransition(sample) {
        if (!sample || !StateObserver.isValidStateVector(sample.state, STATE_DIM) || !StateObserver.isValidStateVector(sample.next_state, STATE_DIM)) {
            return;
        }
        this._buffer.push(sample);
        this.totalRecordedSteps++;
        this.totalRewardSum += sample.reward;
        this.confidenceSum += sample.confidence;
        if (sample.action >= 0 && sample.action < ACTION_COUNT) {
            this.actionCounts[sample.action]++;
        }
        this._emitStats();
    }

    async flushBuffer(markSaved = false) {
        if (this._isFlushing || !this.activeDemoId) return;
        if (this._buffer.length === 0 && !markSaved) return;

        this._isFlushing = true;
        const chunk = this._buffer.splice(0, this._buffer.length);
        const stats = this.getStats();

        try {
            const summary = {
                total_episodes: Math.max(1, stats.episodeCount),
                episode_count: Math.max(1, stats.episodeCount),
                total_steps: stats.totalSteps,
                total_reward: stats.totalReward,
                success_episodes: stats.successEpisodes,
                success_rate: stats.successRate,
                avg_confidence: stats.avgConfidence,
                action_distribution: stats.actionCounts,
                status: markSaved ? 'saved' : 'recording'
            };

            if (chunk.length > 0) {
                await this.datasetManager.saveBatch(this.activeDemoId, chunk, summary);
            }
        } catch (err) {
            this._buffer = chunk.concat(this._buffer);
            this.onError(`Failed to save demonstration batch: ${err.message}`);
        } finally {
            this._isFlushing = false;
            this._emitStats();
        }
    }

    _vectorsNearlyEqual(a, b, eps = 1e-4) {
        if (!a || !b || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (Math.abs(a[i] - b[i]) > eps) return false;
        }
        return true;
    }

    _emitStats() {
        this.onStatsUpdate(this.getStats());
    }
}
