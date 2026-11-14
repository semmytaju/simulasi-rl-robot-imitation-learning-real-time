/**
 * RobotActionController.js
 * Unified action arbitration layer ensuring single active control source across:
 *   - HUMAN_DEMO (WEBCAM pose mimicry or KEYBOARD / UI_BUTTON manual control)
 *   - BC_TRAINING (safe neutral pose lock during Web Worker training)
 *   - BC_AUTONOMOUS (Behavior Cloning neural inference without webcam)
 *   - REPLAY (Saved MySQL demonstration playback)
 */
import { IMITATION_ACTIONS, ACTION_COUNT } from './MotionInterpreter.js';

export const CONTROL_MODES = {
    HUMAN_DEMO: 'HUMAN_DEMO',
    BC_TRAINING: 'BC_TRAINING',
    BC_AUTONOMOUS: 'BC_AUTONOMOUS',
    REPLAY: 'REPLAY'
};

export class RobotActionController {
    constructor(options = {}) {
        this.engine = options.engine || null;
        this.activeMode = CONTROL_MODES.HUMAN_DEMO;
        this.activeInputSource = 'KEYBOARD'; // WEBCAM | KEYBOARD | UI_BUTTON | BC_AGENT | REPLAY

        this.onModeChange = options.onModeChange || (() => {});
        this.onActionDispatched = options.onActionDispatched || (() => {});

        this.lastAction = 0;
        this.lastActionCode = 'NEUTRAL';
        this.lastActionLabel = IMITATION_ACTIONS[0].label;
    }

    setEngine(engine) {
        this.engine = engine;
    }

    setMode(mode, inputSource = null) {
        if (!Object.values(CONTROL_MODES).includes(mode)) {
            throw new Error(`Mode kontrol tidak dikenal: ${mode}`);
        }
        this.activeMode = mode;

        if (mode === CONTROL_MODES.HUMAN_DEMO) {
            this.activeInputSource = inputSource || 'KEYBOARD';
        } else if (mode === CONTROL_MODES.BC_AUTONOMOUS) {
            this.activeInputSource = 'BC_AGENT';
        } else if (mode === CONTROL_MODES.REPLAY) {
            this.activeInputSource = 'REPLAY';
        } else {
            this.activeInputSource = 'SYSTEM';
        }

        if (this.engine) {
            this.engine.setMode(mode);
            if (mode === CONTROL_MODES.BC_TRAINING) {
                this.engine.setCommand(0, { source: 'SYSTEM', confidence: 1.0, label: 'Training Mode' });
            }
        }

        this.onModeChange(this.activeMode, this.activeInputSource);
    }

    setHumanInputSource(source) {
        if (this.activeMode !== CONTROL_MODES.HUMAN_DEMO) return;
        this.activeInputSource = source;
        this.onModeChange(this.activeMode, this.activeInputSource);
    }

    /**
     * Dispatch a unified 9-class human imitation action + optional 10-joint continuous pose.
     * Strictly enforces single active control source arbitration per mode.
     */
    dispatchImitationAction(actionId, source = 'WEBCAM', meta = {}) {
        if (!this.engine) return false;

        if (this.activeMode === CONTROL_MODES.BC_TRAINING) {
            return false;
        }
        if (this.activeMode === CONTROL_MODES.BC_AUTONOMOUS && source !== 'BC_AGENT') {
            return false;
        }
        if (this.activeMode === CONTROL_MODES.REPLAY && source !== 'REPLAY') {
            return false;
        }
        if (this.activeMode === CONTROL_MODES.HUMAN_DEMO && source !== this.activeInputSource) {
            // Allow manual UI_BUTTON / KEYBOARD override when triggered explicitly
            if ((source === 'KEYBOARD' || source === 'UI_BUTTON') && meta.allowOverride !== false) {
                this.activeInputSource = source;
            } else {
                return false;
            }
        }

        const safeAction = (Number.isInteger(actionId) && actionId >= 0 && actionId < ACTION_COUNT)
            ? actionId
            : 0;
        const actDef = IMITATION_ACTIONS[safeAction] || IMITATION_ACTIONS[0];

        this.lastAction = safeAction;
        this.lastActionCode = actDef.code;
        this.lastActionLabel = meta.label || actDef.label;

        this.engine.setCommand(safeAction, {
            source,
            confidence: meta.confidence ?? 1.0,
            label: this.lastActionLabel,
            continuousJoints: meta.continuousJoints || null
        });

        this.onActionDispatched(safeAction, source, {
            ...meta,
            code: actDef.code,
            label: this.lastActionLabel
        });
        return true;
    }

    emergencyStop(source = 'SYSTEM') {
        if (!this.engine) return;
        this.lastAction = 0;
        this.lastActionCode = 'NEUTRAL';
        this.lastActionLabel = IMITATION_ACTIONS[0].label;
        this.engine.setCommand(0, {
            source,
            confidence: 1.0,
            label: 'Posisi Netral'
        });
    }
}
