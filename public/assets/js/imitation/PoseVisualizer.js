/**
 * PoseVisualizer.js
 * Renders detected MoveNet 17-keypoint skeleton, confidence indicators,
 * calibration guide, and current recognized gesture onto a 2D overlay canvas.
 */
import { POSE_SKELETON_EDGES } from './PoseDetector.js';

export class PoseVisualizer {
    constructor(options = {}) {
        this.canvas = options.canvas || null;
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.mirrored = options.mirrored !== undefined ? Boolean(options.mirrored) : true;
    }

    setCanvas(canvas) {
        this.canvas = canvas;
        this.ctx = canvas ? canvas.getContext('2d') : null;
    }

    setMirrored(mirrored) {
        this.mirrored = Boolean(mirrored);
    }

    clear() {
        if (!this.canvas || !this.ctx) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    render(pose, gestureState = {}, calibration = null) {
        if (!this.canvas || !this.ctx) return;

        const srcW = pose?.frameWidth || 480;
        const srcH = pose?.frameHeight || 360;
        const scale = Math.min(1, 400 / Math.max(1, srcW));
        const w = Math.round(srcW * scale);
        const h = Math.round(srcH * scale);
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }

        const ctx = this.ctx;
        ctx.clearRect(0, 0, w, h);

        const mapX = (x) => (this.mirrored ? (w - x * scale) : (x * scale));
        const mapY = (y) => y * scale;

        // Draw subtle calibration neutral crosshair if calibrated
        if (calibration && calibration.shoulderCenter) {
            const cx = mapX(calibration.shoulderCenter.x);
            const cy = mapY(calibration.shoulderCenter.y);
            ctx.save();
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(cx, 12);
            ctx.lineTo(cx, h - 12);
            ctx.moveTo(cx - 42, cy);
            ctx.lineTo(cx + 42, cy);
            ctx.stroke();
            ctx.restore();
        }

        if (!pose || !pose.detected || !pose.keypointMap) {
            this._drawHudBadge(ctx, w, 'NO POSE / NETRAL', 0, pose?.fps || 0, '#ef4444');
            return;
        }

        const kpMap = pose.keypointMap;

        // Draw skeleton connections
        ctx.save();
        ctx.lineWidth = 2.6;
        ctx.lineCap = 'round';
        POSE_SKELETON_EDGES.forEach(([fromName, toName]) => {
            const a = kpMap[fromName];
            const b = kpMap[toName];
            if (!a || !b || a.score < 0.20 || b.score < 0.20) return;

            const avgScore = (a.score + b.score) * 0.5;
            ctx.strokeStyle = avgScore >= 0.60
                ? 'rgba(56, 189, 248, 0.90)'
                : 'rgba(250, 204, 21, 0.80)';

            ctx.beginPath();
            ctx.moveTo(mapX(a.x), mapY(a.y));
            ctx.lineTo(mapX(b.x), mapY(b.y));
            ctx.stroke();
        });
        ctx.restore();

        // Draw keypoints
        pose.keypoints.forEach(kp => {
            if (kp.score < 0.20) return;
            const px = mapX(kp.x);
            const py = mapY(kp.y);
            const color = kp.score >= 0.65 ? '#10b981' : (kp.score >= 0.40 ? '#f59e0b' : '#ef4444');

            ctx.beginPath();
            ctx.arc(px, py, 4, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.lineWidth = 1.2;
            ctx.strokeStyle = '#0f172a';
            ctx.stroke();
        });

        // Draw shoulder-to-hip spine vector
        if (pose.metrics) {
            const scX = mapX(pose.metrics.shoulderCenter.x);
            const scY = mapY(pose.metrics.shoulderCenter.y);
            const hcX = mapX(pose.metrics.hipCenter.x);
            const hcY = mapY(pose.metrics.hipCenter.y);

            ctx.save();
            ctx.strokeStyle = '#a855f7';
            ctx.lineWidth = 3.2;
            ctx.beginPath();
            ctx.moveTo(hcX, hcY);
            ctx.lineTo(scX, scY);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(scX, scY, 5.5, 0, Math.PI * 2);
            ctx.fillStyle = '#e879f9';
            ctx.fill();
            ctx.restore();
        }

        const gestureLabel = gestureState.code || gestureState.label || 'NEUTRAL';
        const badgeColor = gestureLabel === 'NEUTRAL'
            ? '#94a3b8'
            : (gestureLabel === 'BOTH_ARMS_UP' || gestureLabel === 'FORWARD' ? '#10b981' : '#38bdf8');

        this._drawHudBadge(ctx, w, gestureState.label || gestureLabel, pose.confidence || 0, pose.fps || 0, badgeColor);
    }

    _drawHudBadge(ctx, width, gestureLabel, confidence, fps, accentColor) {
        ctx.save();
        ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 2;

        const padX = 10;
        const boxW = Math.min(width - 20, 290);
        const boxH = 34;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(padX, 10, boxW, boxH, 8);
        } else {
            ctx.rect(padX, 10, boxW, boxH);
        }
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = accentColor;
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.fillText(`GESTURE: ${gestureLabel}`, padX + 10, 31);

        ctx.fillStyle = '#cbd5e1';
        ctx.font = '11px monospace';
        const confText = `${Math.round(confidence * 100)}% | ${Math.round(fps)} FPS`;
        ctx.fillText(confText, padX + boxW - 102, 31);
        ctx.restore();
    }
}
