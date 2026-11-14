/**
 * DemonstrationReplay.js
 * Loads a saved MySQL demonstration trajectory and plays back both the
 * 9 discrete human motion classes AND continuous 10-joint poses smoothly in 3D.
 */
import { StateObserver, STATE_DIM } from './StateObserver.js';
import { IMITATION_ACTIONS, ACTION_COUNT, getArchetypeJointsForAction } from './MotionInterpreter.js';
import { CONTROL_MODES } from './RobotActionController.js';

export class DemonstrationReplay {
    constructor(options = {}) {
        this.datasetManager = options.datasetManager;
        this.actionController = options.actionController;

        this.onProgress = options.onProgress || (() => {});
        this.onComplete = options.onComplete || (() => {});
        this.onError = options.onError || (() => {});

        this.demonstration = null;
        this.transitions = [];
        this.cursor = 0;
        this.speedMultiplier = 1.0;
        this.isPlaying = false;
        this.isPaused = false;
        this._timer = null;
    }

    async load(demonstrationId) {
        this.stop();
        try {
            const res = await this.datasetManager.loadReplayTransitions(demonstrationId);
            this.demonstration = res.demonstration || { id: demonstrationId };
            this.transitions = Array.isArray(res.transitions) ? res.transitions : [];
            this.cursor = 0;
            this.onProgress({
                index: 0,
                total: this.transitions.length,
                isPlaying: false,
                demonstration: this.demonstration
            });
            return { demonstration: this.demonstration, count: this.transitions.length };
        } catch (err) {
            this.onError(`Failed to load replay dataset: ${err.message}`);
            return null;
        }
    }

    setSpeed(multiplier) {
        const s = Number(multiplier);
        if (Number.isFinite(s) && s >= 0.25 && s <= 4.0) {
            this.speedMultiplier = s;
        }
    }

    start() {
        if (!this.transitions || this.transitions.length === 0) {
            this.onError('No demonstration samples loaded to play.');
            return false;
        }
        if (this.cursor >= this.transitions.length) {
            this.cursor = 0;
        }
        this.isPlaying = true;
        this.isPaused = false;
        this.actionController.setMode(CONTROL_MODES.REPLAY, 'REPLAY');
        this._scheduleNext();
        return true;
    }

    pause() {
        this.isPaused = true;
        this.isPlaying = false;
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        this.actionController.emergencyStop('REPLAY');
        this.onProgress({
            index: this.cursor,
            total: this.transitions.length,
            isPlaying: false,
            demonstration: this.demonstration
        });
    }

    stop() {
        this.isPlaying = false;
        this.isPaused = false;
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        this.cursor = 0;
        if (this.actionController?.activeMode === CONTROL_MODES.REPLAY) {
            this.actionController.emergencyStop('REPLAY');
        }
        this.onProgress({
            index: 0,
            total: this.transitions.length,
            isPlaying: false,
            demonstration: this.demonstration
        });
    }

    _scheduleNext() {
        if (!this.isPlaying || this.isPaused) return;
        if (this.cursor >= this.transitions.length) {
            this.isPlaying = false;
            this.actionController.emergencyStop('REPLAY');
            this.onComplete(this.demonstration);
            return;
        }

        const t = this.transitions[this.cursor];
        const actId = Math.max(0, Math.min(ACTION_COUNT - 1, parseInt(t.action ?? 0, 10) || 0));
        const actDef = IMITATION_ACTIONS[actId] || IMITATION_ACTIONS[0];

        // Extract continuous 10-joint targets when state vector matches 12-dim motion schema
        let continuousJoints = null;
        const vec = Array.isArray(t.next_state) && t.next_state.length >= STATE_DIM
            ? t.next_state
            : (Array.isArray(t.state) && t.state.length >= STATE_DIM ? t.state : null);

        if (vec) {
            continuousJoints = StateObserver.jointsFromPoseSlice(vec.slice(2, 12));
        } else {
            continuousJoints = getArchetypeJointsForAction(actId);
        }

        this.actionController.dispatchImitationAction(actId, 'REPLAY', {
            confidence: Number(t.confidence ?? 1.0),
            label: actDef.label,
            continuousJoints
        });

        this.cursor++;
        this.onProgress({
            index: this.cursor,
            total: this.transitions.length,
            isPlaying: true,
            actionCode: actDef.code,
            actionLabel: actDef.label,
            demonstration: this.demonstration
        });

        const baseHz = Number(this.demonstration?.sample_rate_hz || 8);
        const intervalMs = Math.max(25, Math.round((1000 / Math.max(2, baseHz)) / this.speedMultiplier));
        this._timer = setTimeout(() => this._scheduleNext(), intervalMs);
    }
}
