/**
 * ImitationStudioApp.js
 * Frontend Orchestrator for Clone Agent AI — Imitation Learning (Learning by Demonstration):
 *   Step 1: Human Demo Capture (480x360 -> 256x192 WebGL MoveNet + 9-Pose Pad + 8 Hz Recorder + Replay)
 *   Step 2: Dual-Head Behavior Cloning Training (Web Worker: 9-class Policy + 10-joint Pose Regressor)
 *   Step 3: Zero-Webcam Autonomous Agent Inference & High-FPS 3D Mocap Lab
 */
import { MotionLabEngine } from './MotionLabEngine.js';
import { ImitationLab3DView } from './ImitationLab3DView.js';
import { CameraManager } from './CameraManager.js';
import { PoseDetector } from './PoseDetector.js';
import { PoseCalibration } from './PoseCalibration.js';
import { PoseVisualizer } from './PoseVisualizer.js';
import { MotionInterpreter, IMITATION_ACTIONS, ACTION_COUNT } from './MotionInterpreter.js';
import { StateObserver } from './StateObserver.js';
import { RobotActionController, CONTROL_MODES } from './RobotActionController.js';
import { DatasetManager } from './DatasetManager.js';
import { DemonstrationRecorder } from './DemonstrationRecorder.js';
import { DemonstrationReplay } from './DemonstrationReplay.js';
import { BehaviorCloningModel } from './BehaviorCloningModel.js';
import { AutonomousAgent } from './AutonomousAgent.js';

const SHORT_CLASS_LABELS = ['NEU', 'FWD', 'BWD', 'LFT', 'RGT', 'ARM_L', 'ARM_R', 'BOTH', 'SQT'];

class ImitationStudioApp {
    constructor() {
        this.bootData = window.BALANCE_AI_BOOT_DATA || {};
        this.appPath = this.bootData.appPath || '';
        this.csrfToken = this.bootData.csrfToken || '';

        this.uiMode = 'HUMAN_DEMO'; // HUMAN_DEMO | BC_TRAINING | BC_AUTONOMOUS
        this.savedDemonstrations = [];
        this.savedBcModels = Array.isArray(this.bootData.savedModels) ? this.bootData.savedModels : [];
        this.latestActionMeta = {
            action: 0,
            confidence: 1.0,
            inputSource: 'KEYBOARD',
            label: IMITATION_ACTIONS[0].label
        };

        this.bcDistChart = null;
        this.bcTrainChart = null;
        this._heldKeyCode = null;
        this._lastHudActionRendered = -1;

        // 1. Initialize Light 3D Mocap View & Pure-JS Kinematics Engine
        this.lab3d = new ImitationLab3DView({
            canvas: document.getElementById('imitationLabCanvas'),
            container: document.getElementById('lab3dContainer'),
            onHudUpdate: (hud) => this._render3dHud(hud)
        });

        this.engine = new MotionLabEngine({
            podiumRadius: 3.1,
            tickMs: 28,
            onTick: (motionState) => this._onEngineTick(motionState)
        });

        // 2. Initialize Core Imitation Subsystems
        this.stateObserver = new StateObserver();
        this.actionController = new RobotActionController({
            engine: this.engine,
            onModeChange: (mode, src) => this._onControlModeChanged(mode, src),
            onActionDispatched: (actId, src, meta) => this._onActionDispatched(actId, src, meta)
        });

        this.datasetManager = new DatasetManager({
            appPath: this.appPath,
            csrfToken: this.csrfToken
        });

        this.recorder = new DemonstrationRecorder({
            stateObserver: this.stateObserver,
            datasetManager: this.datasetManager,
            sampleRateHz: 8,
            minConfidence: 0.35,
            onStatsUpdate: (stats) => this._renderRecorderStats(stats),
            onError: (msg) => this.showToast('Demonstration Recorder', msg, 'danger')
        });

        this.replay = new DemonstrationReplay({
            datasetManager: this.datasetManager,
            actionController: this.actionController,
            onProgress: (prog) => this._renderReplayProgress(prog),
            onComplete: (demo) => {
                this.showToast('Replay Finished', `Playback of "${demo?.title || 'Dataset'}" completed.`, 'success');
                this.actionController.setMode(CONTROL_MODES.HUMAN_DEMO, this.cameraManager.isActive() ? 'WEBCAM' : 'KEYBOARD');
            },
            onError: (msg) => this.showToast('Replay Error', msg, 'danger')
        });

        this.bcModel = new BehaviorCloningModel({
            appPath: this.appPath,
            csrfToken: this.csrfToken,
            datasetManager: this.datasetManager,
            onEpochProgress: (msg) => this._onBcEpochProgress(msg),
            onTrainingComplete: (art, evaluation, prepared) => this._onBcTrainingComplete(art, evaluation, prepared),
            onTrainingCancelled: () => this._onBcTrainingCancelled(),
            onError: (msg) => {
                this._setTrainingButtonsState(false);
                this.showToast('BC Training Failed', msg, 'danger');
            }
        });

        this.autonomousAgent = new AutonomousAgent({
            stateObserver: this.stateObserver,
            actionController: this.actionController,
            bcModelManager: this.bcModel,
            confidenceThreshold: 0.45,
            onPrediction: (pred) => this._renderAutonomousPrediction(pred),
            onStatsUpdate: (stats) => this._renderAutonomousStats(stats),
            onStatusChange: (status, meta) => this._onAutonomousStatusChange(status, meta),
            onError: (msg) => this.showToast('Autonomous Agent', msg, 'danger')
        });

        // 3. Optimized Webcam & MoveNet Subsystems (480x360 cam -> 256x192 WebGL downsampling)
        this.cameraManager = new CameraManager({
            videoElement: document.getElementById('ilWebcamVideo'),
            width: 480,
            height: 360,
            idealFps: 24,
            mirrored: true,
            onStatusChange: (status, msg) => this._onCamStatusChange(status, msg),
            onError: (msg) => this.showToast('Webcam Camera', msg, 'danger')
        });

        this.poseCalibration = new PoseCalibration({
            targetFrames: 24,
            minConfidence: 0.35,
            onProgress: (cur, tot, msg) => this._renderCalibrationProgress(cur, tot, msg, cur >= tot),
            onComplete: (baseline) => {
                this._renderCalibrationProgress(24, 24, `Calibrated (${baseline.mode === 'upper_body' ? 'Upper Body' : 'Full Body'})`, true);
                this.showToast('Calibration Complete', 'Neutral posture saved. Raise your arms, lean your torso, or squat in front of the camera.', 'success');
            }
        });

        this.poseVisualizer = new PoseVisualizer({
            canvas: document.getElementById('ilPoseCanvas'),
            mirrored: true
        });

        this.motionInterpreter = new MotionInterpreter();

        this.poseDetector = new PoseDetector({
            appPath: this.appPath,
            targetFps: 18,
            onPose: (pose) => this._onPoseFrame(pose),
            onStatus: (status, msg) => {
                const fpsBadge = document.getElementById('ilPoseFpsBadge');
                if (fpsBadge && status === 'loading') fpsBadge.textContent = 'Loading AI...';
                if (fpsBadge && status === 'ready') fpsBadge.textContent = 'MoveNet Ready';
                if (status === 'error') this.showToast('MoveNet Pose', msg, 'danger');
            }
        });

        this._bindEvents();
        this._initCharts();
        this.engine.start();
        this.switchUiMode('HUMAN_DEMO');
        this.refreshDemonstrationsList();
        this.refreshBcModelsList();
    }

    // =========================================================================
    // ENGINE & HUD SYNCHRONIZATION
    // =========================================================================

    _onEngineTick(motionState) {
        this.lab3d.applyMotionState(motionState);

        if (this.recorder.isRecording && this.actionController.activeMode === CONTROL_MODES.HUMAN_DEMO) {
            this.recorder.onControlStep(motionState, this.latestActionMeta);
        }

        if (this.autonomousAgent.status === 'running' && this.actionController.activeMode === CONTROL_MODES.BC_AUTONOMOUS) {
            this.autonomousAgent.step(motionState);
        }
    }

    _render3dHud({ fps, motionState }) {
        const fpsBadge = document.getElementById('hudFpsBadge');
        if (fpsBadge) {
            fpsBadge.innerHTML = `<i class="bi bi-speedometer2 me-1"></i>${fps} FPS`;
        }
        if (!motionState) return;

        const posEl = document.getElementById('hudPosCoords');
        const yawEl = document.getElementById('hudYawText');
        if (posEl) posEl.textContent = `${motionState.posX.toFixed(2)}, ${motionState.posZ.toFixed(2)} m`;
        if (yawEl) yawEl.textContent = `${Math.round((motionState.yaw * 180) / Math.PI)}°`;

        const j = motionState.joints || {};
        const armLPct = Math.min(100, Math.round((Math.max(0, j.armRaiseL || 0) / 2.6) * 100));
        const armRPct = Math.min(100, Math.round((Math.max(0, j.armRaiseR || 0) / 2.6) * 100));
        const torsoDeg = Math.round(((j.torsoPitch || 0) * 180) / Math.PI);
        const torsoPct = Math.min(100, Math.round((Math.abs(j.torsoPitch || 0) / 0.55) * 100));
        const squatPct = Math.min(100, Math.round(Math.max(0, j.squatDepth || 0) * 100));

        const setText = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        const setWidth = (id, pct) => { const e = document.getElementById(id); if (e) e.style.width = `${pct}%`; };

        setText('hudValArmL', `${armLPct}%`);
        setWidth('hudBarArmL', armLPct);
        setText('hudValArmR', `${armRPct}%`);
        setWidth('hudBarArmR', armRPct);
        setText('hudValTorso', `${torsoDeg}°`);
        setWidth('hudBarTorso', torsoPct);
        setText('hudValSquat', `${squatPct}%`);
        setWidth('hudBarSquat', squatPct);
    }

    // =========================================================================
    // UI EVENTS & WORKFLOW STEPPER
    // =========================================================================

    _bindEvents() {
        // Horizontal 3-Step Workflow Stepper
        document.querySelectorAll('.step-pill-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const mode = btn.getAttribute('data-step-mode');
                if (mode) this.switchUiMode(mode);
            });
        });

        document.getElementById('btnGoToStep3')?.addEventListener('click', () => this.switchUiMode('BC_AUTONOMOUS'));

        // Reset Robot Podium Position
        document.getElementById('btnResetRobotPose')?.addEventListener('click', () => {
            this.engine.resetPose();
            this.showToast('Stage Reset', 'Robot returned to the center of the motion-capture podium.', 'info');
        });

        // Camera Presets & Follow & Fullscreen
        document.querySelectorAll('.btn-cam-preset').forEach((btn) => {
            btn.addEventListener('click', () => {
                const preset = btn.getAttribute('data-preset');
                this.lab3d.setCameraPreset(preset);
                document.querySelectorAll('.btn-cam-preset').forEach((b) => {
                    const isActive = b.getAttribute('data-preset') === preset;
                    b.className = `btn btn-sm ${isActive ? 'btn-info' : 'btn-outline-light'} cam-chip btn-cam-preset`;
                });
            });
        });

        document.getElementById('btnToggleFollowRobot')?.addEventListener('click', (e) => {
            const btn = e.currentTarget;
            const next = !this.lab3d.followRobot;
            this.lab3d.setFollowRobot(next);
            btn.className = `btn btn-sm ${next ? 'btn-info' : 'btn-outline-secondary'} cam-chip`;
        });

        document.getElementById('btnLabFullscreen')?.addEventListener('click', () => {
            const box = document.getElementById('lab3dContainer');
            if (!box) return;
            if (!document.fullscreenElement) {
                box.requestFullscreen?.().catch(() => {});
            } else {
                document.exitFullscreen?.().catch(() => {});
            }
        });

        // Webcam & Calibration Controls
        document.getElementById('btnIlCamToggle')?.addEventListener('click', () => this.toggleWebcam());
        document.getElementById('btnIlCalibrate')?.addEventListener('click', () => {
            if (!this.cameraManager.isActive()) {
                this.showToast('Pose Calibration', 'Enable the webcam first before calibrating your neutral posture.', 'info');
                return;
            }
            this.poseCalibration.startCalibration();
        });

        const chkMirror = document.getElementById('chkIlMirror');
        if (chkMirror) {
            chkMirror.addEventListener('change', () => {
                const m = chkMirror.checked;
                this.cameraManager.setMirrored(m);
                this.poseVisualizer.setMirrored(m);
            });
        }

        // Motion Threshold Sliders inside Settings Modal
        this._bindSlider('sliderIlFwdThresh', 'valIlFwdThresh', (v) => {
            this.motionInterpreter.updateThresholds({ forwardEnter: v, backwardEnter: v });
        });
        this._bindSlider('sliderIlLatThresh', 'valIlLatThresh', (v) => {
            this.motionInterpreter.updateThresholds({ lateralEnter: v });
        });
        this._bindSlider('sliderIlSmoothing', 'valIlSmoothing', (v) => {
            this.motionInterpreter.updateThresholds({ smoothingAlpha: v });
        });

        // Quick Pose Pad (9 Classes)
        document.querySelectorAll('.btn-il-manual').forEach((btn) => {
            btn.addEventListener('click', () => {
                const actId = parseInt(btn.getAttribute('data-il-action'), 10);
                if (!isNaN(actId)) this.triggerManualDemoAction(actId, 'UI_BUTTON');
            });
        });

        // Keyboard Human Demo Bindings (W/A/S/D/Q/E/R/C/Space + Arrows)
        window.addEventListener('keydown', (e) => this._handleKeyDown(e));
        window.addEventListener('keyup', (e) => this._handleKeyUp(e));

        // Recorder Controls
        document.getElementById('btnDemoRecStart')?.addEventListener('click', () => this.startDemoRecording());
        document.getElementById('btnDemoRecPause')?.addEventListener('click', () => this.togglePauseDemoRecording());
        document.getElementById('btnDemoRecStop')?.addEventListener('click', () => this.stopAndSaveDemoRecording());
        document.getElementById('btnRefreshDemos')?.addEventListener('click', () => this.refreshDemonstrationsList());

        // Replay Controls
        document.getElementById('btnReplayPlay')?.addEventListener('click', () => this.replay.start());
        document.getElementById('btnReplayPause')?.addEventListener('click', () => this.replay.pause());
        document.getElementById('btnReplayStop')?.addEventListener('click', () => this.replay.stop());
        document.getElementById('selectReplaySpeed')?.addEventListener('change', (e) => {
            this.replay.setSpeed(parseFloat(e.target.value) || 1.0);
        });

        // BC Training Controls
        document.getElementById('btnBcRefreshDatasets')?.addEventListener('click', () => this.refreshDemonstrationsList());
        document.getElementById('btnBcInspectDatasets')?.addEventListener('click', () => this.inspectSelectedDatasets());
        document.getElementById('btnBcStartTrain')?.addEventListener('click', () => this.startBcTraining());
        document.getElementById('btnBcCancelTrain')?.addEventListener('click', () => this.bcModel.cancelTraining());
        document.getElementById('btnBcSaveModel')?.addEventListener('click', () => this.saveTrainedBcModel());

        // Autonomous Agent Controls
        document.getElementById('btnAutoRefreshModels')?.addEventListener('click', () => this.refreshBcModelsList());
        document.getElementById('btnAutoLoadModel')?.addEventListener('click', () => this.loadSelectedBcModel());
        document.getElementById('btnAutoDeleteModel')?.addEventListener('click', () => this.deleteSelectedBcModel());
        document.getElementById('btnAutoStart')?.addEventListener('click', () => this.startAutonomousAgent());
        document.getElementById('btnAutoPause')?.addEventListener('click', () => this.autonomousAgent.pause());
        document.getElementById('btnAutoStop')?.addEventListener('click', () => this.autonomousAgent.stop());
        document.getElementById('btnAutoResetStats')?.addEventListener('click', () => this.autonomousAgent.resetStats());

        const sliderConf = document.getElementById('sliderAutoConfThreshold');
        const valConf = document.getElementById('valAutoConfThreshold');
        if (sliderConf) {
            sliderConf.addEventListener('input', () => {
                const v = parseFloat(sliderConf.value) || 0.45;
                this.autonomousAgent.setConfidenceThreshold(v);
                if (valConf) valConf.textContent = `${Math.round(v * 100)}%`;
            });
        }

        // Settings History Tab Lazy Load
        document.getElementById('tab-history-btn')?.addEventListener('shown.bs.tab', () => this.loadSettingsHistory());
        document.getElementById('btnSettingsRefreshHistory')?.addEventListener('click', () => this.loadSettingsHistory());
    }

    _bindSlider(sliderId, valId, cb) {
        const s = document.getElementById(sliderId);
        const vEl = document.getElementById(valId);
        if (!s) return;
        s.addEventListener('input', () => {
            const val = parseFloat(s.value);
            if (vEl) vEl.textContent = val.toFixed(2);
            cb(val);
        });
    }

    async switchUiMode(mode) {
        if (!['HUMAN_DEMO', 'BC_TRAINING', 'BC_AUTONOMOUS'].includes(mode)) return;

        if (this.uiMode !== mode) {
            if (this.replay.isPlaying) this.replay.stop();
            if (this.autonomousAgent.status === 'running' && mode !== 'BC_AUTONOMOUS') {
                this.autonomousAgent.stop();
            }
            if (mode === 'BC_AUTONOMOUS' && this.cameraManager.isActive()) {
                this._stopWebcamPipeline();
            }
        }

        this.uiMode = mode;
        this.lab3d.setAccentTheme(mode);

        document.querySelectorAll('.step-pill-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.getAttribute('data-step-mode') === mode);
        });

        const paneDemo = document.getElementById('paneStepDemo');
        const paneTrain = document.getElementById('paneStepTrain');
        const paneAuto = document.getElementById('paneStepAuto');
        if (paneDemo) paneDemo.classList.toggle('d-none', mode !== 'HUMAN_DEMO');
        if (paneTrain) paneTrain.classList.toggle('d-none', mode !== 'BC_TRAINING');
        if (paneAuto) paneAuto.classList.toggle('d-none', mode !== 'BC_AUTONOMOUS');

        const pill = document.getElementById('hudActiveModePill');
        if (mode === 'HUMAN_DEMO') {
            if (pill) {
                pill.className = 'badge bg-info text-dark';
                pill.textContent = 'STEP 1: HUMAN DEMONSTRATION';
            }
            this.actionController.setMode(CONTROL_MODES.HUMAN_DEMO, this.cameraManager.isActive() ? 'WEBCAM' : 'KEYBOARD');
        } else if (mode === 'BC_TRAINING') {
            if (pill) {
                pill.className = 'badge bg-warning text-dark';
                pill.textContent = 'STEP 2: TRAIN BEHAVIOR CLONING';
            }
            this.actionController.setMode(CONTROL_MODES.BC_TRAINING, 'SYSTEM');
            this.refreshDemonstrationsList();
        } else if (mode === 'BC_AUTONOMOUS') {
            if (pill) {
                pill.className = 'badge bg-success text-white';
                pill.textContent = 'STEP 3: AUTONOMOUS AGENT (NO WEBCAM)';
            }
            this.actionController.setMode(CONTROL_MODES.BC_AUTONOMOUS, 'BC_AGENT');
            await this.refreshBcModelsList();
            if (!this.autonomousAgent.hasLoadedModel() && this.savedBcModels.length > 0) {
                const activeRow = this.savedBcModels.find((m) => Number(m.is_active) === 1) || this.savedBcModels[0];
                if (activeRow?.id) {
                    try {
                        await this.autonomousAgent.loadModelById(activeRow.id);
                        this._unlockAutonomousButtons(true);
                    } catch (e) { /* Ignore silent autoload issue */ }
                }
            }
        }
    }

    _onControlModeChanged(mode, src) {
        const srcBadge = document.getElementById('hudInputSourceBadge');
        if (srcBadge) srcBadge.textContent = `Source: ${src}`;
    }

    _onActionDispatched(actId, src, meta = {}) {
        const actMeta = IMITATION_ACTIONS[actId] || IMITATION_ACTIONS[0];
        this.latestActionMeta = {
            action: actId,
            inputSource: src || 'UI_BUTTON',
            confidence: meta.confidence ?? 1.0,
            label: meta.label || actMeta.label
        };

        const hudAct = document.getElementById('hudActionBadge');
        const hudSrc = document.getElementById('hudInputSourceBadge');
        const hudConf = document.getElementById('hudConfidenceText');

        if (hudAct) hudAct.textContent = `POSE: ${actMeta.code}`;
        if (hudSrc) hudSrc.textContent = `Source: ${src}`;
        if (hudConf) hudConf.textContent = `Conf: ${Math.round((meta.confidence ?? 1.0) * 100)}%`;

        if (this._lastHudActionRendered !== actId) {
            this._lastHudActionRendered = actId;
            document.querySelectorAll('.btn-il-manual').forEach((btn) => {
                const bAct = parseInt(btn.getAttribute('data-il-action'), 10);
                btn.classList.toggle('active-pose', bAct === actId);
            });
        }
    }

    // =========================================================================
    // MANUAL QUICK POSE PAD & KEYBOARD SHORTCUTS
    // =========================================================================

    _handleKeyDown(e) {
        const tag = e.target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) {
            return;
        }
        if (this.uiMode !== 'HUMAN_DEMO') return;

        const keyMap = {
            KeyW: 1, ArrowUp: 1,
            KeyS: 2, ArrowDown: 2,
            KeyA: 3, ArrowLeft: 3,
            KeyD: 4, ArrowRight: 4,
            KeyQ: 5,
            KeyE: 6,
            KeyR: 7,
            KeyC: 8,
            Space: 0, KeyX: 0
        };

        const actId = keyMap[e.code];
        if (actId === undefined) return;
        e.preventDefault();

        if (this._heldKeyCode === e.code) return;
        this._heldKeyCode = e.code;
        this.triggerManualDemoAction(actId, 'KEYBOARD');
    }

    _handleKeyUp(e) {
        if (this._heldKeyCode && e.code === this._heldKeyCode && this.uiMode === 'HUMAN_DEMO') {
            this._heldKeyCode = null;
            if (!this.cameraManager.isActive()) {
                this.triggerManualDemoAction(0, 'KEYBOARD');
            }
        }
    }

    triggerManualDemoAction(actId, src = 'UI_BUTTON') {
        if (this.uiMode !== 'HUMAN_DEMO') {
            this.switchUiMode('HUMAN_DEMO');
        }
        this.actionController.setMode(CONTROL_MODES.HUMAN_DEMO, src);
        this.actionController.dispatchImitationAction(actId, src, {
            confidence: 1.0,
            allowOverride: true
        });
    }

    // =========================================================================
    // OPTIMIZED WEBCAM + MOVENET + CALIBRATION PIPELINE
    // =========================================================================

    async toggleWebcam() {
        const btn = document.getElementById('btnIlCamToggle');
        if (this.cameraManager.isActive()) {
            this._stopWebcamPipeline();
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Starting...';
        }

        const ok = await this.cameraManager.start();
        if (!ok) {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="bi bi-camera-video-fill me-1"></i>Enable Webcam';
            }
            return;
        }

        document.getElementById('ilWebcamPlaceholder')?.classList.add('d-none');

        const startedPose = await this.poseDetector.startLoop(document.getElementById('ilWebcamVideo'));
        if (startedPose) {
            this.actionController.setMode(CONTROL_MODES.HUMAN_DEMO, 'WEBCAM');
            if (!this.poseCalibration.isCalibrated()) {
                this.poseCalibration.startCalibration();
            }
        }

        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-camera-video-off-fill me-1"></i>Disable Webcam';
            btn.className = 'btn btn-sm btn-outline-danger fw-semibold px-2 py-1';
        }
    }

    _stopWebcamPipeline() {
        this.poseDetector.stopLoop();
        this.cameraManager.stop();
        this.poseVisualizer.clear();
        this.motionInterpreter.reset();
        document.getElementById('ilWebcamPlaceholder')?.classList.remove('d-none');

        if (this.actionController.activeMode === CONTROL_MODES.HUMAN_DEMO && this.actionController.activeInputSource === 'WEBCAM') {
            this.actionController.setHumanInputSource('KEYBOARD');
            this.actionController.emergencyStop('KEYBOARD');
        }

        const btn = document.getElementById('btnIlCamToggle');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-camera-video-fill me-1"></i>Enable Webcam';
            btn.className = 'btn btn-sm btn-info fw-semibold px-2 py-1';
        }
        const fpsBadge = document.getElementById('ilPoseFpsBadge');
        if (fpsBadge) fpsBadge.textContent = 'MoveNet Ready';
    }

    _onCamStatusChange(status, msg) {
        const txt = document.getElementById('ilCamStatusText');
        if (txt) {
            txt.textContent = status === 'connected'
                ? 'Live 480x360 -> 256x192 WebGL'
                : (status === 'initializing' ? 'Connecting Camera...' : (status === 'error' ? 'Camera Error' : 'Camera Off'));
        }
        if (status === 'error' && msg) {
            this.showToast('Camera Status', msg, 'danger');
        }
    }

    _onPoseFrame(pose) {
        if (!pose) return;

        if (this.poseCalibration.isCalibrating) {
            this.poseCalibration.addCalibrationFrame(pose);
        } else if (pose.detected && !this.poseCalibration.isCalibrated()) {
            if (this.poseCalibration.seedFallbackIfNeeded(pose)) {
                this._renderCalibrationProgress(24, 24, 'Auto-calibration active (click Calibrate for full precision)', true);
            }
        }

        const mirrored = document.getElementById('chkIlMirror')?.checked ?? true;
        const gesture = this.motionInterpreter.interpret(pose, this.poseCalibration, mirrored);

        this.poseVisualizer.render(pose, gesture, this.poseCalibration.getBaseline());

        const fpsBadge = document.getElementById('ilPoseFpsBadge');
        if (fpsBadge) {
            fpsBadge.textContent = `${this.poseDetector.fps || 0} FPS (${String(this.poseDetector.backend || 'webgl').toUpperCase()})`;
        }

        const gBadge = document.getElementById('ilDetectedGestureBadge');
        if (gBadge) {
            const pct = Math.round((pose.confidence || 0) * 100);
            gBadge.textContent = `Pose: ${gesture.code} (${pct}%)`;
            gBadge.className = gesture.action === 0 ? 'badge bg-secondary' : 'badge bg-success';
        }

        if (this.uiMode === 'HUMAN_DEMO' && this.cameraManager.isActive()) {
            if (this.actionController.activeInputSource === 'WEBCAM' || (gesture.isValidPose && gesture.action !== 0)) {
                this.actionController.setHumanInputSource('WEBCAM');
                this.actionController.dispatchImitationAction(gesture.action, 'WEBCAM', {
                    confidence: pose.confidence,
                    label: gesture.label,
                    continuousJoints: gesture.continuousJoints
                });
            }
        }
    }

    _renderCalibrationProgress(cur, tot, msg, done = false) {
        const txt = document.getElementById('ilCalibStatusText');
        const bar = document.getElementById('ilCalibProgressBar');
        if (txt) {
            txt.textContent = msg;
            txt.className = done ? 'text-emerald fw-semibold text-truncate' : 'text-info text-truncate';
        }
        if (bar) {
            const pct = tot > 0 ? Math.min(100, Math.round((cur / tot) * 100)) : 0;
            bar.style.width = `${pct}%`;
            bar.className = done ? 'progress-bar bg-success' : 'progress-bar bg-warning';
        }
    }

    // =========================================================================
    // DEMONSTRATION RECORDING & REPLAY
    // =========================================================================

    async startDemoRecording() {
        const titleEl = document.getElementById('inputDemoTitle');
        this.actionController.setMode(CONTROL_MODES.HUMAN_DEMO, this.cameraManager.isActive() ? 'WEBCAM' : 'KEYBOARD');

        const started = await this.recorder.startRecording({
            title: titleEl ? titleEl.value : '',
            demonstratorName: 'Human Studio Operator',
            inputSource: this.cameraManager.isActive() ? 'webcam' : 'keyboard',
            calibration: this.poseCalibration.getBaseline()
        });

        if (started) {
            this._syncRecorderButtons(true, false);
            this.showToast('Recording Demonstration', '8 Hz capture active! Move your body or use the Pose Pad, then click Save.', 'info');
        }
    }

    togglePauseDemoRecording() {
        if (!this.recorder.isRecording) return;
        if (this.recorder.isPaused) {
            this.recorder.resumeRecording();
            this._syncRecorderButtons(true, false);
        } else {
            this.recorder.pauseRecording();
            this._syncRecorderButtons(true, true);
        }
    }

    async stopAndSaveDemoRecording() {
        const btnStop = document.getElementById('btnDemoRecStop');
        if (btnStop) btnStop.disabled = true;

        const finalMotion = this.engine.getMotionState();
        const stats = await this.recorder.stopRecording(finalMotion);
        this._syncRecorderButtons(false, false);

        if (stats && stats.totalSteps > 0) {
            this.showToast('Dataset Saved', `"${stats.title}" saved successfully (${stats.totalSteps} samples to MySQL).`, 'success');
        } else {
            this.showToast('Recording Stopped', 'No valid samples were recorded.', 'warning');
        }
        await this.refreshDemonstrationsList();
    }

    _syncRecorderButtons(active, paused) {
        const start = document.getElementById('btnDemoRecStart');
        const pause = document.getElementById('btnDemoRecPause');
        const stop = document.getElementById('btnDemoRecStop');
        const badge = document.getElementById('recStatusBadge');

        if (start) start.disabled = active;
        if (pause) {
            pause.disabled = !active;
            pause.innerHTML = paused ? '<i class="bi bi-play-fill"></i>' : '<i class="bi bi-pause-fill"></i>';
        }
        if (stop) stop.disabled = !active;
        if (badge) {
            if (!active) {
                badge.className = 'badge bg-secondary';
                badge.textContent = 'Ready to Record';
            } else if (paused) {
                badge.className = 'badge bg-warning text-dark';
                badge.textContent = 'Paused';
            } else {
                badge.className = 'badge bg-danger';
                badge.textContent = 'Recording ●';
            }
        }
    }

    _renderRecorderStats(stats) {
        const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
        set('recStatsSteps', stats.totalSteps);
        set('recStatsEpisodes', stats.episodeCount);
        set('recStatsConfidence', `${Math.round((stats.avgConfidence || 0) * 100)}%`);
        if (Array.isArray(stats.actionCounts)) {
            stats.actionCounts.forEach((cnt, idx) => set(`recActionChip_${idx}`, cnt));
        }
    }

    async refreshDemonstrationsList() {
        try {
            const rawDemos = await this.datasetManager.listDemonstrations(60);
            const demos = Array.isArray(rawDemos) ? rawDemos : (rawDemos?.demonstrations || rawDemos?.data || []);
            this.savedDemonstrations = demos;

            const kpiBadge = document.getElementById('kpiDemosCountBadge');
            if (kpiBadge) kpiBadge.textContent = `${demos.length} Demo`;

            const listEl = document.getElementById('savedDemosListContainer');
            if (listEl) {
                if (demos.length === 0) {
                    listEl.innerHTML = '<div class="text-secondary small text-center py-2">No saved datasets yet. Click Record to start.</div>';
                } else {
                    listEl.innerHTML = demos.map((d) => `
                        <div class="d-flex justify-content-between align-items-center p-1 px-2 rounded bg-dark bg-opacity-50 border border-secondary border-opacity-25 mb-1">
                            <div class="text-truncate me-2 demo-item-summary">
                                <div class="text-white fw-semibold text-truncate fs-72" title="${this._esc(d.title)}">${this._esc(d.title)}</div>
                                <div class="text-secondary fs-65">
                                    ${Number(d.total_steps)} samp &bull; ${Number(d.state_dim || 12)}D &rarr; ${Number(d.action_dim || 9)} pose
                                </div>
                            </div>
                            <div class="btn-group btn-group-sm flex-shrink-0">
                                <button type="button" class="btn btn-outline-info py-0 px-2 btn-load-demo-replay" data-demo-id="${d.id}" title="Load into Replay">
                                    <i class="bi bi-play-btn"></i>
                                </button>
                                <button type="button" class="btn btn-outline-danger py-0 px-1 btn-del-demo" data-demo-id="${d.id}" title="Delete Dataset">
                                    <i class="bi bi-trash"></i>
                                </button>
                            </div>
                        </div>
                    `).join('');

                    listEl.querySelectorAll('.btn-load-demo-replay').forEach((b) => {
                        b.addEventListener('click', () => this.loadDemoForReplay(parseInt(b.getAttribute('data-demo-id'), 10)));
                    });
                    listEl.querySelectorAll('.btn-del-demo').forEach((b) => {
                        b.addEventListener('click', () => this.deleteDemoDataset(parseInt(b.getAttribute('data-demo-id'), 10)));
                    });
                }
            }

            // Also sync Step 2 Dataset Checkboxes
            const bcBox = document.getElementById('bcDatasetCheckboxes');
            if (bcBox) {
                const prevChecked = new Set(
                    Array.from(bcBox.querySelectorAll('input[type="checkbox"]:checked')).map((i) => String(i.value))
                );
                if (demos.length === 0) {
                    bcBox.innerHTML = '<div class="text-secondary small text-center py-2">Record a demonstration in Step 1 first.</div>';
                } else {
                    bcBox.innerHTML = demos.map((d, idx) => {
                        const compat = Number(d.state_dim || 12) === 12;
                        const checked = prevChecked.size > 0 ? prevChecked.has(String(d.id)) : (compat && idx < 4);
                        return `
                            <label class="d-flex justify-content-between align-items-center p-1 px-2 rounded bg-dark bg-opacity-50 mb-1 cursor-pointer fs-71">
                                <span class="text-truncate me-2">
                                    <input class="form-check-input me-1 bc-demo-checkbox" type="checkbox" value="${d.id}" ${checked ? 'checked' : ''}>
                                    <span class="text-white">${this._esc(d.title)}</span>
                                </span>
                                <span class="badge ${compat ? 'bg-info-subtle text-info' : 'bg-secondary'} flex-shrink-0">${Number(d.total_steps)} samples</span>
                            </label>
                        `;
                    }).join('');
                }
            }
        } catch (err) {
            console.warn('Failed to load demonstrations list:', err);
        }
    }

    async loadDemoForReplay(demoId) {
        const res = await this.replay.load(demoId);
        if (!res) return;
        const lbl = document.getElementById('replayLoadedTitle');
        if (lbl) lbl.textContent = `${res.demonstration?.title || 'Demo'} (${res.count} samp)`;
        document.getElementById('btnReplayPlay').disabled = false;
        document.getElementById('btnReplayPause').disabled = false;
        document.getElementById('btnReplayStop').disabled = false;
        this.showToast('Replay Ready', `Dataset loaded (${res.count} pose transitions). Click Play to start playback.`, 'info');
    }

    _renderReplayProgress(prog) {
        const txt = document.getElementById('replayProgressText');
        const bar = document.getElementById('replayProgressBar');
        const total = prog.total || 0;
        const cur = prog.index || 0;
        const pct = total > 0 ? Math.min(100, Math.round((cur / total) * 100)) : 0;
        if (txt) txt.textContent = `${cur} / ${total}`;
        if (bar) bar.style.width = `${pct}%`;
    }

    async deleteDemoDataset(demoId) {
        try {
            await this.datasetManager.deleteDemonstration(demoId);
            this.showToast('Dataset Deleted', `Demonstration #${demoId} deleted from MySQL.`, 'info');
            await this.refreshDemonstrationsList();
        } catch (err) {
            this.showToast('Delete Failed', err.message, 'danger');
        }
    }

    // =========================================================================
    // STEP 2: DUAL-HEAD BEHAVIOR CLONING TRAINING
    // =========================================================================

    _initCharts() {
        if (typeof Chart === 'undefined') return;

        const distCanvas = document.getElementById('bcActionDistChart');
        if (distCanvas) {
            this.bcDistChart = new Chart(distCanvas, {
                type: 'bar',
                data: {
                    labels: SHORT_CLASS_LABELS,
                    datasets: [{
                        label: 'Sampel',
                        data: new Array(ACTION_COUNT).fill(0),
                        backgroundColor: [
                            '#94a3b8', '#10b981', '#f59e0b', '#22d3ee', '#3b82f6',
                            '#2dd4bf', '#818cf8', '#34d399', '#fbbf24'
                        ],
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: '#cbd5e1', font: { size: 9 } }, grid: { display: false } },
                        y: { ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { color: 'rgba(148,163,184,0.1)' }, beginAtZero: true }
                    }
                }
            });
        }

        const trainCanvas = document.getElementById('bcTrainingChart');
        if (trainCanvas) {
            this.bcTrainChart = new Chart(trainCanvas, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        { label: 'Policy Loss', data: [], borderColor: '#f59e0b', tension: 0.25, pointRadius: 1, yAxisID: 'yLoss' },
                        { label: 'Val Loss', data: [], borderColor: '#ef4444', borderDash: [4, 3], tension: 0.25, pointRadius: 1, yAxisID: 'yLoss' },
                        { label: 'Val Acc', data: [], borderColor: '#10b981', tension: 0.25, pointRadius: 1, yAxisID: 'yAcc' }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { labels: { color: '#cbd5e1', boxWidth: 10, font: { size: 9 } } } },
                    scales: {
                        x: { ticks: { color: '#94a3b8', font: { size: 9 }, maxTicksLimit: 10 }, grid: { display: false } },
                        yLoss: { position: 'left', ticks: { color: '#f59e0b', font: { size: 9 } }, grid: { color: 'rgba(148,163,184,0.08)' }, beginAtZero: true },
                        yAcc: { position: 'right', min: 0, max: 1, ticks: { color: '#10b981', font: { size: 9 } }, grid: { drawOnChartArea: false } }
                    }
                }
            });
        }
    }

    _getSelectedBcDatasetIds() {
        return Array.from(document.querySelectorAll('.bc-demo-checkbox:checked'))
            .map((cb) => parseInt(cb.value, 10))
            .filter((n) => !isNaN(n) && n > 0);
    }

    async inspectSelectedDatasets() {
        const ids = this._getSelectedBcDatasetIds();
        const valSplit = parseFloat(document.getElementById('inputBcValSplit')?.value) || 0.20;
        const sumBadge = document.getElementById('bcDatasetSummaryBadge');
        const warnAlert = document.getElementById('bcDatasetWarningAlert');

        if (ids.length === 0) {
            this.showToast('Select Dataset', 'Check at least one demonstration dataset.', 'warning');
            return null;
        }

        try {
            const prepared = await this.bcModel.loadAndInspectDatasets(ids, valSplit);
            if (sumBadge) {
                sumBadge.textContent = `Valid: ${prepared.totalValidCount} samples (Train ${prepared.trainCount} / Val ${prepared.valCount})`;
            }
            if (warnAlert) {
                if (prepared.warnings && prepared.warnings.length > 0) {
                    warnAlert.textContent = prepared.warnings.join(' ');
                    warnAlert.classList.remove('d-none');
                } else {
                    warnAlert.classList.add('d-none');
                }
            }
            if (this.bcDistChart) {
                this.bcDistChart.data.datasets[0].data = prepared.totalClassCounts;
                this.bcDistChart.update();
            }
            return prepared;
        } catch (err) {
            this.showToast('Dataset Analysis Failed', err.message, 'danger');
            return null;
        }
    }

    async startBcTraining() {
        const ids = this._getSelectedBcDatasetIds();
        if (ids.length === 0) {
            this.showToast('Empty Dataset', 'Select at least one demonstration dataset above first.', 'warning');
            return;
        }

        const epochs = parseInt(document.getElementById('inputBcEpochs')?.value, 10) || 55;
        const batchSize = parseInt(document.getElementById('inputBcBatchSize')?.value, 10) || 32;
        const learningRate = parseFloat(document.getElementById('inputBcLearningRate')?.value) || 0.001;
        const valSplitRatio = parseFloat(document.getElementById('inputBcValSplit')?.value) || 0.20;
        const useClassWeights = document.getElementById('chkBcClassWeights')?.checked ?? true;
        const modelName = document.getElementById('inputBcModelName')?.value || `ImitationNet-${new Date().toLocaleTimeString('en-US')}`;

        document.getElementById('bcEvaluationBox')?.classList.add('d-none');
        if (this.bcTrainChart) {
            this.bcTrainChart.data.labels = [];
            this.bcTrainChart.data.datasets.forEach((ds) => { ds.data = []; });
            this.bcTrainChart.update();
        }
        this._setTrainingButtonsState(true);

        try {
            const prepared = await this.bcModel.startTraining({
                demonstrationIds: ids,
                modelName,
                epochs,
                batchSize,
                learningRate,
                valSplitRatio,
                useClassWeights
            });
            if (this.bcDistChart && prepared) {
                this.bcDistChart.data.datasets[0].data = prepared.totalClassCounts;
                this.bcDistChart.update();
            }
            const sumBadge = document.getElementById('bcDatasetSummaryBadge');
            if (sumBadge && prepared) {
                sumBadge.textContent = `Valid: ${prepared.totalValidCount} (Train ${prepared.trainCount} / Val ${prepared.valCount})`;
            }
        } catch (err) {
            this._setTrainingButtonsState(false);
            this.showToast('Failed to Start Training', err.message, 'danger');
        }
    }

    _setTrainingButtonsState(running) {
        const btnStart = document.getElementById('btnBcStartTrain');
        const btnCancel = document.getElementById('btnBcCancelTrain');
        const statusTxt = document.getElementById('bcTrainStatusText');
        if (btnStart) btnStart.disabled = running;
        if (btnCancel) btnCancel.disabled = !running;
        if (statusTxt && running) statusTxt.textContent = 'Training Policy + Pose Network in Web Worker...';
    }

    _onBcEpochProgress(msg) {
        const pct = Math.min(100, Math.round((msg.epoch / Math.max(1, msg.totalEpochs)) * 100));
        const bar = document.getElementById('bcTrainProgressBar');
        const txt = document.getElementById('bcTrainStatusText');
        if (bar) bar.style.width = `${pct}%`;
        if (txt) {
            const poseMseTxt = msg.poseValMse !== null && msg.poseValMse !== undefined ? ` | Pose MSE: ${Number(msg.poseValMse).toFixed(4)}` : '';
            txt.textContent = `Ep ${msg.epoch}/${msg.totalEpochs} | Val Acc: ${(msg.val_accuracy * 100).toFixed(1)}%${poseMseTxt}`;
        }
        if (this.bcTrainChart) {
            this.bcTrainChart.data.labels.push(`E${msg.epoch}`);
            this.bcTrainChart.data.datasets[0].data.push(msg.loss);
            this.bcTrainChart.data.datasets[1].data.push(msg.val_loss);
            this.bcTrainChart.data.datasets[2].data.push(msg.val_accuracy);
            this.bcTrainChart.update('none');
        }
    }

    _onBcTrainingComplete(artifact, evaluation) {
        this._setTrainingButtonsState(false);
        const evalBox = document.getElementById('bcEvaluationBox');
        const evalTxt = document.getElementById('bcEvalSummaryText');
        const cmBox = document.getElementById('bcConfusionMatrixContainer');
        const f1Box = document.getElementById('bcPerClassF1Container');

        if (evalBox) evalBox.classList.remove('d-none');
        if (evalTxt) {
            const poseMseBadge = evaluation.poseMse !== null && evaluation.poseMse !== undefined
                ? ` &bull; Pose MSE: <strong class="text-cyan">${Number(evaluation.poseMse).toFixed(4)}</strong>`
                : '';
            const warningsHtml = Array.isArray(evaluation.warnings) && evaluation.warnings.length > 0
                ? `<div class="text-warning mt-1"><i class="bi bi-exclamation-triangle me-1"></i>${this._esc(evaluation.warnings.join(' '))}</div>`
                : '';
            evalTxt.innerHTML = `
                Best Ep: <strong>${artifact.metrics.bestEpoch}</strong> &bull;
                Val Acc: <strong class="text-emerald">${(evaluation.accuracy * 100).toFixed(1)}%</strong> &bull;
                Macro-F1: <strong class="text-info">${(evaluation.macroF1 * 100).toFixed(1)}%</strong>${poseMseBadge}
                ${warningsHtml}
            `;
        }

        if (cmBox && Array.isArray(evaluation.confusionMatrix)) {
            let html = '<table class="table table-dark table-bordered cm-table mb-0"><thead><tr><th>T\\P</th>';
            SHORT_CLASS_LABELS.forEach((l) => { html += `<th>${l}</th>`; });
            html += '</tr></thead><tbody>';
            evaluation.confusionMatrix.forEach((row, rIdx) => {
                html += `<tr><th class="text-cyan">${SHORT_CLASS_LABELS[rIdx] || rIdx}</th>`;
                row.forEach((val, cIdx) => {
                    const cls = rIdx === cIdx && val > 0
                        ? 'text-emerald fw-bold bg-success bg-opacity-10'
                        : (val > 0 ? 'text-warning' : 'text-secondary');
                    html += `<td class="${cls}">${val}</td>`;
                });
                html += '</tr>';
            });
            html += '</tbody></table>';
            cmBox.innerHTML = html;
        }

        if (f1Box && Array.isArray(evaluation.perClass)) {
            f1Box.innerHTML = evaluation.perClass
                .filter((c) => c.support > 0)
                .map((c) => `
                    <span class="badge bg-dark border border-secondary me-1 mb-1">
                        ${c.code}: F1 ${(c.f1 * 100).toFixed(0)}% (n=${c.support})
                    </span>
                `).join('');
        }

        this.showToast('BC Training Complete', `Val Acc ${(evaluation.accuracy * 100).toFixed(1)}%. Click Save BC Model to Server.`, 'success');
    }

    _onBcTrainingCancelled() {
        this._setTrainingButtonsState(false);
        const txt = document.getElementById('bcTrainStatusText');
        if (txt) txt.textContent = 'Training cancelled by user.';
    }

    async saveTrainedBcModel() {
        const btn = document.getElementById('btnBcSaveModel');
        const nameInput = document.getElementById('inputBcModelName');
        const activateChk = document.getElementById('chkBcActivateAfterSave');
        if (btn) btn.disabled = true;

        try {
            const res = await this.bcModel.saveTrainedModelToServer(nameInput?.value, activateChk?.checked ?? true);
            await this.refreshBcModelsList();
            const savedId = res?.model_id || res?.model?.id;
            if (savedId && (activateChk?.checked ?? true)) {
                await this.autonomousAgent.loadModelById(savedId);
                this._unlockAutonomousButtons(true);
            }
            this.showToast('BC Model Saved', `Dual-Head Behavior Cloning model saved & ready for Step 3 (No Webcam)!`, 'success');
        } catch (err) {
            this.showToast('Save Model Failed', err.message, 'danger');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // =========================================================================
    // STEP 3: AUTONOMOUS AGENT (WEBCAM FREE)
    // =========================================================================

    async refreshBcModelsList() {
        try {
            const res = await this.bcModel.listModels();
            const models = res.models || [];
            this.savedBcModels = models;

            const sel = document.getElementById('autoModelSelect');
            if (!sel) return;
            if (models.length === 0) {
                sel.innerHTML = '<option value="">-- No saved BC models yet --</option>';
                return;
            }
            sel.innerHTML = models.map((m) => {
                const metrics = m.metrics || (m.metrics_json ? (typeof m.metrics_json === 'string' ? JSON.parse(m.metrics_json) : m.metrics_json) : {});
                const acc = metrics?.evaluation?.accuracy ?? metrics?.finalValAccuracy;
                const accTxt = acc !== undefined ? `Val ${(acc * 100).toFixed(0)}%` : '';
                const activeTag = Number(m.is_active) === 1 ? '★ ACTIVE - ' : '';
                return `<option value="${m.id}" ${Number(m.is_active) === 1 ? 'selected' : ''}>${activeTag}${this._esc(m.model_name)} (${accTxt})</option>`;
            }).join('');
        } catch (err) {
            console.warn('Failed to load BC models:', err);
        }
    }

    async loadSelectedBcModel() {
        const sel = document.getElementById('autoModelSelect');
        const id = parseInt(sel?.value || '', 10);
        if (!id) {
            this.showToast('Select Model', 'No Behavior Cloning model selected yet.', 'warning');
            return;
        }
        try {
            await this.bcModel.activateModel(id);
            const meta = await this.autonomousAgent.loadModelById(id);
            this._unlockAutonomousButtons(true);
            this.showToast('BC Model Active', `"${meta.modelName}" is ready to run autonomously without webcam!`, 'success');
        } catch (err) {
            this.showToast('Load Model Failed', err.message, 'danger');
        }
    }

    async deleteSelectedBcModel() {
        const sel = document.getElementById('autoModelSelect');
        const id = parseInt(sel?.value || '', 10);
        if (!id) return;
        try {
            await this.bcModel.deleteModel(id);
            this.showToast('Model Deleted', `BC Model #${id} deleted from server.`, 'info');
            await this.refreshBcModelsList();
        } catch (err) {
            this.showToast('Delete Model Failed', err.message, 'danger');
        }
    }

    startAutonomousAgent() {
        if (this.cameraManager.isActive()) {
            this._stopWebcamPipeline();
        }
        try {
            this.autonomousAgent.start();
        } catch (err) {
            this.showToast('Autonomous Agent', err.message, 'warning');
        }
    }

    _unlockAutonomousButtons(enabled) {
        const s = document.getElementById('btnAutoStart');
        const p = document.getElementById('btnAutoPause');
        const st = document.getElementById('btnAutoStop');
        if (s) s.disabled = !enabled;
        if (p) p.disabled = !enabled;
        if (st) st.disabled = !enabled;
    }

    _onAutonomousStatusChange(status, meta) {
        const nameEl = document.getElementById('autoLoadedModelName');
        const metaEl = document.getElementById('autoLoadedModelMeta');
        const badge = document.getElementById('autoAgentStatusBadge');

        if (meta && nameEl) nameEl.textContent = meta.modelName || 'ImitationNet-BC';
        if (meta && metaEl) {
            const acc = meta.metrics?.evaluation?.accuracy ?? meta.metrics?.finalValAccuracy;
            const headTxt = meta.hasPoseHead ? 'Policy + 10-Joint Pose Head' : 'Policy Head';
            metaEl.textContent = `${meta.stateDim}D -> ${meta.actionDim} Pose (${headTxt})${acc !== undefined ? ` | Val ${(acc * 100).toFixed(0)}%` : ''}`;
        }
        if (badge) {
            const map = {
                running: ['badge bg-success', 'Autonomous Active'],
                paused: ['badge bg-warning text-dark', 'Paused'],
                model_loaded: ['badge bg-info text-dark', 'Model Ready'],
                idle: ['badge bg-secondary', 'Idle']
            };
            const [cls, txt] = map[status] || map.idle;
            badge.className = cls;
            badge.textContent = txt;
        }
    }

    _renderAutonomousPrediction(pred) {
        const lat = document.getElementById('autoLatencyMs');
        const act = document.getElementById('autoActiveActionBadge');
        const conf = document.getElementById('autoConfidenceText');
        const fb = document.getElementById('autoFallbackBadge');

        if (lat) lat.textContent = `${pred.latencyMs.toFixed(1)} ms`;
        if (act) act.textContent = pred.code;
        if (conf) conf.textContent = `${(pred.confidence * 100).toFixed(0)}%`;
        if (fb) fb.classList.toggle('d-none', !pred.usedFallback);

        if (Array.isArray(pred.probs)) {
            pred.probs.forEach((p, idx) => {
                const pct = Math.round(p * 100);
                const bar = document.getElementById(`autoProbBar_${idx}`);
                const txt = document.getElementById(`autoProbVal_${idx}`);
                if (txt) txt.textContent = `${pct}%`;
                if (bar) {
                    bar.style.width = `${pct}%`;
                    bar.className = idx === pred.action ? 'progress-bar bg-success' : 'progress-bar bg-info';
                }
            });
        }
    }

    _renderAutonomousStats(stats) {
        const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        set('autoStatsSteps', stats.steps);
        set('autoStatsCycles', stats.cycles);
        set('autoStatsStabilityRate', `${stats.stabilityRate}%`);
        set('autoStatsAvgLatency', `${stats.avgLatencyMs}ms`);
    }

    // =========================================================================
    // SETTINGS MODAL HISTORY & TOASTS
    // =========================================================================

    async loadSettingsHistory() {
        const box = document.getElementById('settingsHistoryContainer');
        if (!box) return;
        box.innerHTML = '<div class="text-info py-2">Loading training history &amp; models from MySQL...</div>';
        try {
            const [histRes, modRes] = await Promise.all([
                this.bcModel.fetchTrainingHistory().catch(() => ({ training_sessions: [] })),
                this.bcModel.listModels().catch(() => ({ models: [] }))
            ]);
            const sessions = histRes.training_sessions || histRes.sessions || [];
            const models = modRes.models || [];

            let html = `<div class="mb-3"><strong class="text-white d-block mb-1">Saved BC Models (${models.length})</strong>`;
            if (models.length === 0) {
                html += '<div class="text-secondary">No saved BC models yet.</div>';
            } else {
                html += '<div class="list-group list-group-flush">';
                models.slice(0, 8).forEach((m) => {
                    html += `<div class="list-group-item bg-transparent border-secondary text-light px-2 py-1 d-flex justify-content-between">
                        <span>${Number(m.is_active) === 1 ? '★ ' : ''}${this._esc(m.model_name)}</span>
                        <span class="text-secondary">${m.state_dim}D &rarr; ${m.action_dim} pose</span>
                    </div>`;
                });
                html += '</div>';
            }
            html += `</div><div><strong class="text-white d-block mb-1">Training Session History (${sessions.length})</strong>`;
            if (sessions.length === 0) {
                html += '<div class="text-secondary">No training session history yet.</div>';
            } else {
                html += '<div class="table-responsive"><table class="table table-dark table-sm mb-0"><thead><tr><th>Model</th><th>Epochs</th><th>Val Acc</th><th>Status</th></tr></thead><tbody>';
                sessions.slice(0, 10).forEach((s) => {
                    const acc = s.final_val_accuracy !== undefined && s.final_val_accuracy !== null
                        ? `${(Number(s.final_val_accuracy) * 100).toFixed(1)}%`
                        : '-';
                    html += `<tr><td>${this._esc(s.model_name || s.id)}</td><td>${Number(s.epochs_completed || s.total_epochs || 0)}</td><td class="text-emerald">${acc}</td><td>${this._esc(s.status || 'done')}</td></tr>`;
                });
                html += '</tbody></table></div>';
            }
            html += '</div>';
            box.innerHTML = html;
        } catch (err) {
            box.innerHTML = `<div class="text-danger">Failed to load history: ${this._esc(err.message)}</div>`;
        }
    }

    showToast(title, message, variant = 'info') {
        const container = document.getElementById('studioToastContainer');
        if (!container || typeof window.bootstrap === 'undefined') return;

        const colorMap = {
            success: 'border-success text-bg-dark',
            danger: 'border-danger text-bg-dark',
            warning: 'border-warning text-bg-dark',
            info: 'border-info text-bg-dark'
        };
        const el = document.createElement('div');
        el.className = `toast align-items-center ${colorMap[variant] || colorMap.info} border`;
        el.setAttribute('role', 'alert');
        el.innerHTML = `
            <div class="d-flex">
                <div class="toast-body small">
                    <strong class="d-block text-white">${this._esc(title)}</strong>
                    <span class="text-secondary">${this._esc(message)}</span>
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Tutup"></button>
            </div>
        `;
        container.appendChild(el);
        const toast = new window.bootstrap.Toast(el, { delay: 4200 });
        el.addEventListener('hidden.bs.toast', () => el.remove());
        toast.show();
    }

    _esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.imitationStudioApp = new ImitationStudioApp();
});
