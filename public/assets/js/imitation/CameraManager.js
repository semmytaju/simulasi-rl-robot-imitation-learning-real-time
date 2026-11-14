/**
 * CameraManager.js
 * Manages HTML5 MediaDevices webcam access, 640x480 stream lifecycle,
 * permission/device error handling, and clean track release.
 */
export class CameraManager {
    constructor(options = {}) {
        this.videoElement = options.videoElement || null;
        this.width = options.width || 480;
        this.height = options.height || 360;
        this.facingMode = options.facingMode || 'user';
        this.mirrored = options.mirrored !== undefined ? Boolean(options.mirrored) : true;

        this.stream = null;
        this.status = 'disconnected'; // disconnected | initializing | connected | error
        this.lastError = null;

        this.onStatusChange = typeof options.onStatusChange === 'function' ? options.onStatusChange : () => {};
        this.onError = typeof options.onError === 'function' ? options.onError : () => {};

        this._handlePageHide = () => this.stop();
        window.addEventListener('beforeunload', this._handlePageHide);
    }

    setVideoElement(el) {
        this.videoElement = el;
        this.applyMirrorStyle();
    }

    setMirrored(mirrored) {
        this.mirrored = Boolean(mirrored);
        this.applyMirrorStyle();
    }

    applyMirrorStyle() {
        if (this.videoElement) {
            this.videoElement.style.transform = this.mirrored ? 'scaleX(-1)' : 'none';
        }
    }

    isActive() {
        return Boolean(
            this.stream &&
            this.status === 'connected' &&
            this.stream.getVideoTracks().some(t => t.readyState === 'live')
        );
    }

    async start() {
        if (this.isActive()) {
            return true;
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            const msg = 'Browser tidak mendukung navigator.mediaDevices.getUserMedia(). Gunakan Chrome/Edge/Firefox modern pada localhost atau HTTPS.';
            this._setError(msg);
            return false;
        }

        this._setStatus('initializing', 'Meminta izin webcam (480x360 optimal)...');

        const constraints = {
            audio: false,
            video: {
                width: { ideal: this.width, max: 640 },
                height: { ideal: this.height, max: 480 },
                facingMode: this.facingMode,
                frameRate: { ideal: 24, max: 24 }
            }
        };

        try {
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);

            if (!this.videoElement) {
                throw new Error('Elemen video webcam tidak ditemukan di DOM.');
            }

            this.videoElement.srcObject = this.stream;
            this.videoElement.playsInline = true;
            this.videoElement.muted = true;
            this.applyMirrorStyle();

            await new Promise((resolve, reject) => {
                const onLoaded = () => {
                    cleanup();
                    resolve();
                };
                const onErr = (err) => {
                    cleanup();
                    reject(err);
                };
                const cleanup = () => {
                    this.videoElement.removeEventListener('loadedmetadata', onLoaded);
                    this.videoElement.removeEventListener('error', onErr);
                };
                if (this.videoElement.readyState >= 1) {
                    resolve();
                } else {
                    this.videoElement.addEventListener('loadedmetadata', onLoaded, { once: true });
                    this.videoElement.addEventListener('error', onErr, { once: true });
                }
            });

            await this.videoElement.play();

            const track = this.stream.getVideoTracks()[0];
            const settings = track && typeof track.getSettings === 'function' ? track.getSettings() : {};
            const actualW = settings.width || this.videoElement.videoWidth || this.width;
            const actualH = settings.height || this.videoElement.videoHeight || this.height;

            if (track) {
                track.addEventListener('ended', () => {
                    this.stop();
                }, { once: true });
            }

            this.lastError = null;
            this._setStatus('connected', `Camera active (${actualW}x${actualH})`);
            return true;
        } catch (err) {
            this.stop(true);
            const friendly = this._translateMediaError(err);
            this._setError(friendly);
            return false;
        }
    }

    stop(silent = false) {
        if (this.stream) {
            try {
                this.stream.getTracks().forEach(track => {
                    try { track.stop(); } catch (e) {}
                });
            } catch (e) {}
            this.stream = null;
        }
        if (this.videoElement) {
            try {
                this.videoElement.pause();
                this.videoElement.srcObject = null;
            } catch (e) {}
        }
        if (!silent) {
            this._setStatus('disconnected', 'Camera off');
        }
    }

    getVideoDimensions() {
        if (!this.videoElement) {
            return { width: this.width, height: this.height };
        }
        return {
            width: this.videoElement.videoWidth || this.width,
            height: this.videoElement.videoHeight || this.height
        };
    }

    destroy() {
        this.stop(true);
        window.removeEventListener('beforeunload', this._handlePageHide);
    }

    _setStatus(status, message) {
        this.status = status;
        this.onStatusChange(status, message);
    }

    _setError(message) {
        this.lastError = message;
        this.status = 'error';
        this.onStatusChange('error', message);
        this.onError(message);
    }

    _translateMediaError(err) {
        const name = err?.name || '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
            return 'Webcam permission was denied by the user or browser. Please allow camera access via the lock/camera icon in the address bar.';
        }
        if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
            return 'No webcam device was found. Please verify that your camera is connected and enabled.';
        }
        if (name === 'NotReadableError' || name === 'TrackStartError') {
            return 'The webcam is currently in use by another application (Zoom/Meet/OBS) or encountered a hardware error.';
        }
        if (name === 'OverconstrainedError') {
            return 'The requested webcam resolution is not supported by the camera device.';
        }
        return `Failed to initialize webcam: ${err?.message || 'Unknown error'}`;
    }
}
