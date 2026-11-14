/**
 * PoseCalibration.js
 * Neutral-pose calibration and scale-invariant feature normalization.
 * Computes baseline shoulder center, hip center, shoulder-to-hip distance,
 * body center, and neutral inclination so thresholds adapt to any user or camera distance.
 */
export class PoseCalibration {
    constructor(options = {}) {
        this.targetFrames = options.targetFrames || 24;
        this.minConfidence = options.minConfidence || 0.35;

        this.isCalibrating = false;
        this.samples = [];
        this.baseline = null;

        this.onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
        this.onComplete = typeof options.onComplete === 'function' ? options.onComplete : () => {};
    }

    isCalibrated() {
        return Boolean(this.baseline);
    }

    getBaseline() {
        return this.baseline ? { ...this.baseline } : null;
    }

    startCalibration() {
        this.samples = [];
        this.isCalibrating = true;
        this.onProgress(0, this.targetFrames, 'Stand upright facing the camera...');
    }

    cancelCalibration() {
        this.isCalibrating = false;
        this.samples = [];
    }

    resetCalibration() {
        this.isCalibrating = false;
        this.samples = [];
        this.baseline = null;
    }

    /**
     * Feed a pose frame during calibration; returns true if calibration just finished.
     */
    addCalibrationFrame(pose) {
        if (!this.isCalibrating) return false;
        if (!pose || !pose.detected || !pose.metrics || pose.confidence < this.minConfidence) {
            return false;
        }

        this.samples.push(pose);
        this.onProgress(this.samples.length, this.targetFrames, `Calibrating neutral posture (${this.samples.length}/${this.targetFrames})...`);

        if (this.samples.length >= this.targetFrames) {
            this.baseline = this._computeBaselineFromSamples(this.samples);
            this.isCalibrating = false;
            this.samples = [];
            this.onComplete(this.baseline);
            return true;
        }
        return false;
    }

    /**
     * Auto-seed a fallback baseline from a single valid frame if user starts without manual calibration.
     */
    seedFallbackIfNeeded(pose) {
        if (this.baseline || !pose || !pose.detected || !pose.metrics || pose.confidence < this.minConfidence) {
            return false;
        }
        this.baseline = this._computeBaselineFromSamples([pose]);
        this.baseline.isAutoSeeded = true;
        return true;
    }

    _computeBaselineFromSamples(samples) {
        const avg = (getter) => samples.reduce((acc, s) => acc + getter(s), 0) / samples.length;

        const shoulderCenter = {
            x: avg(s => s.metrics.shoulderCenter.x),
            y: avg(s => s.metrics.shoulderCenter.y)
        };
        const hipCenter = {
            x: avg(s => s.metrics.hipCenter.x),
            y: avg(s => s.metrics.hipCenter.y)
        };
        const bodyCenter = {
            x: avg(s => s.metrics.bodyCenter.x),
            y: avg(s => s.metrics.bodyCenter.y)
        };

        const shoulderWidth = Math.max(16, avg(s => s.metrics.shoulderWidth));
        const shoulderToHipDist = Math.max(24, avg(s => s.metrics.shoulderToHipDist));
        const neutralLateralInclination = avg(s => s.metrics.lateralInclination);
        const neutralVerticalRatio = avg(s => s.metrics.verticalTorsoRatio);
        const neutralNoseRatio = avg(s => s.metrics.noseToShoulderDy / Math.max(16, s.metrics.shoulderWidth));
        const neutralShoulderYNorm = avg(s => s.metrics.shoulderCenterYNorm);
        const neutralShoulderWidthNorm = avg(s => s.metrics.shoulderWidthNorm);
        const neutralBodyCenterXNorm = bodyCenter.x / (samples[0].frameWidth || 480);
        const neutralHeadYaw = avg(s => s.metrics.headYawProxy || 0);
        const hasHipsCount = samples.filter(s => s.metrics.hasHips).length;

        return {
            calibratedAt: Date.now(),
            isAutoSeeded: false,
            mode: hasHipsCount >= Math.ceil(samples.length * 0.5) ? 'full_body' : 'upper_body',
            hasHips: hasHipsCount >= Math.ceil(samples.length * 0.5),
            shoulderCenter,
            hipCenter,
            bodyCenter,
            shoulderWidth,
            shoulderToHipDist,
            neutralLateralInclination,
            neutralVerticalRatio,
            neutralNoseRatio,
            neutralShoulderYNorm,
            neutralShoulderWidthNorm,
            neutralBodyCenterXNorm,
            neutralHeadYaw
        };
    }

    /**
     * Normalize live pose relative to calibrated body dimensions.
     * Exposes torso lean, lateral lean, head yaw, squat depth, and articulated left/right arm targets.
     */
    normalizePose(pose, mirrored = true) {
        if (!pose || !pose.detected || !pose.metrics) {
            return null;
        }
        if (!this.baseline) {
            this.seedFallbackIfNeeded(pose);
        }
        if (!this.baseline) return null;

        const m = pose.metrics;
        const b = this.baseline;
        const frameW = pose.frameWidth || 480;

        // 1. Lateral lean (scale-invariant: relative to torso height & shoulder width)
        const rawTorsoLateral = m.lateralInclination - b.neutralLateralInclination;
        const rawShiftX = ((m.shoulderCenter.x / frameW) - b.neutralBodyCenterXNorm) * (frameW / b.shoulderWidth);
        let lateralScore = rawTorsoLateral * 0.72 + rawShiftX * 0.45;
        let headYaw = ((m.headYawProxy || 0) - (b.neutralHeadYaw || 0)) * 2.1;

        if (mirrored) {
            lateralScore = -lateralScore;
            headYaw = -headYaw;
        }

        // 2. Forward / Backward lean & Squat depth separation
        const scaleExpansion = (m.shoulderWidthNorm - b.neutralShoulderWidthNorm) / Math.max(0.05, b.neutralShoulderWidthNorm);
        const currentNoseRatio = m.noseToShoulderDy / Math.max(16, m.shoulderWidth);
        const noseDrop = b.neutralNoseRatio - currentNoseRatio;
        const shoulderDropY = m.shoulderCenterYNorm - b.neutralShoulderYNorm;

        const forwardScore = (scaleExpansion * 1.25) + (noseDrop * 0.90);
        const squatScore = Math.max(0, (shoulderDropY - Math.max(0, scaleExpansion) * 0.35) * 4.2);

        // 3. Arm kinematics (When front-facing mirror is active, visual left/right matches screen reflection)
        const rawL = m.leftArm || { valid: false, raise: 0.15, abduct: 0, elbowFlex: 0.4 };
        const rawR = m.rightArm || { valid: false, raise: 0.15, abduct: 0, elbowFlex: 0.4 };
        const armLeft = mirrored ? rawL : rawR;
        const armRight = mirrored ? rawR : rawL;

        return {
            lateralScore,   // negative = LEFT, positive = RIGHT
            forwardScore,   // positive = FORWARD, negative = BACKWARD
            squatScore: Math.min(1.0, squatScore),
            headYaw: Math.max(-0.75, Math.min(0.75, headYaw)),
            armLeft,
            armRight,
            scaleRatio: m.shoulderWidthNorm / Math.max(0.05, b.neutralShoulderWidthNorm),
            confidence: pose.confidence
        };
    }
}
