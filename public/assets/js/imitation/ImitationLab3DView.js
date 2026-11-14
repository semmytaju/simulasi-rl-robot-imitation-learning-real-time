/**
 * ImitationLab3DView.js
 * Futuristic AI Motion-Capture Studio for Clone Agent AI in Three.js.
 * Performance-engineered for smooth 60 FPS co-execution alongside live Webcam MoveNet:
 *   - Zero continuous shadow-map passes (uses lightweight contact shadow blobs)
 *   - Capped devicePixelRatio (<= 1.35) & shared geometries/materials (~55 draw calls)
 *   - Full 10-joint biomechanical articulation + squat IK + walking leg gait
 */

export class ImitationLab3DView {
    constructor(options = {}) {
        this.canvas = options.canvas;
        this.container = options.container || this.canvas?.parentElement;
        this.onHudUpdate = options.onHudUpdate || (() => {});

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.animId = null;
        this.isDisposed = false;

        // Camera spherical orbit state (centered on studio podium focus)
        this.camViewMode = 'front';
        this.camTheta = 0.0;        // 0 = looking from +X toward -X (mirror facing Studio Front)
        this.camPhi = 1.24;         // elevation polar angle
        this.camRadius = 4.65;
        this.camTarget = null;
        this.followRobot = false;

        // Pointer interaction state
        this._isDragging = false;
        this._lastMouse = { x: 0, y: 0 };

        // Robot Rig References
        this.robotRoot = null;
        this.pelvisGroup = null;
        this.upperBodyGroup = null;
        this.headGroup = null;
        this.leftArm = null;
        this.rightArm = null;
        this.leftLeg = null;
        this.rightLeg = null;

        // Dynamic Studio Materials / Accents (reactive to Step 1 / 2 / 3)
        this.accentMaterials = [];
        this.haloRingMesh = null;
        this.floorReticleGroup = null;
        this.footShadowL = null;
        this.footShadowR = null;

        // Latest simulation snapshot from MotionLabEngine
        this.latestMotionState = null;

        // FPS + HUD budget throttles
        this._fpsFrames = 0;
        this._fpsLastAt = performance.now();
        this._currentFps = 60;
        this._lastHudEmitAt = 0;

        this._init();
    }

    _init() {
        if (!this.canvas || typeof window.THREE === 'undefined') {
            console.error('Three.js or canvas missing for ImitationLab3DView.');
            return;
        }
        const THREE = window.THREE;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x060b16);
        this.scene.fog = new THREE.FogExp2(0x060b16, 0.042);

        const w = Math.max(320, this.container?.clientWidth || 800);
        const h = Math.max(260, this.container?.clientHeight || 520);

        this.camera = new THREE.PerspectiveCamera(44, w / h, 0.1, 60);
        this.camTarget = new THREE.Vector3(0, 0.96, 0);

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
        this.renderer.setSize(w, h, false);
        this.renderer.shadowMap.enabled = false;
        if ('outputColorSpace' in this.renderer && THREE.SRGBColorSpace) {
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        }

        this._buildStudioLighting();
        this._buildMocapStudioEnvironment();
        this._buildModernHumanoidRobot();

        this.setCameraPreset('front');
        this._bindPointerControls();

        this._resizeObserver = new ResizeObserver(() => this.resize());
        if (this.container) this._resizeObserver.observe(this.container);
        window.addEventListener('resize', this._onWinResize = () => this.resize());

        this._startRenderLoop();
    }

    _buildStudioLighting() {
        const THREE = window.THREE;
        const hemi = new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 0.85);
        this.scene.add(hemi);

        const keyLight = new THREE.DirectionalLight(0xf8fafc, 1.25);
        keyLight.position.set(4.5, 7.5, 3.8);
        this.scene.add(keyLight);

        const rimCyan = new THREE.DirectionalLight(0x22d3ee, 0.72);
        rimCyan.position.set(-4.2, 4.0, -3.5);
        this.scene.add(rimCyan);

        const fillIndigo = new THREE.PointLight(0x6366f1, 0.65, 14);
        fillIndigo.position.set(2.5, 2.2, -3.2);
        this.scene.add(fillIndigo);
    }

    _buildMocapStudioEnvironment() {
        const THREE = window.THREE;

        // Subtle dark technical floor grid
        const grid = new THREE.GridHelper(18, 24, 0x1e293b, 0x0f172a);
        grid.position.y = -0.02;
        this.scene.add(grid);

        const floorPlane = new THREE.Mesh(
            new THREE.PlaneGeometry(36, 36),
            new THREE.MeshStandardMaterial({ color: 0x050914, roughness: 0.92, metalness: 0.1 })
        );
        floorPlane.rotation.x = -Math.PI / 2;
        floorPlane.position.y = -0.025;
        this.scene.add(floorPlane);

        // Raised Circular Motion-Capture Podium (radius 3.3m)
        const podiumBase = new THREE.Mesh(
            new THREE.CylinderGeometry(3.35, 3.55, 0.10, 48),
            new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.55, roughness: 0.45 })
        );
        podiumBase.position.y = -0.05;
        this.scene.add(podiumBase);

        const stageDeck = new THREE.Mesh(
            new THREE.CylinderGeometry(3.22, 3.22, 0.02, 48),
            new THREE.MeshStandardMaterial({ color: 0x111c33, metalness: 0.3, roughness: 0.7 })
        );
        stageDeck.position.y = -0.005;
        this.scene.add(stageDeck);

        const accentEmissiveMat = new THREE.MeshStandardMaterial({
            color: 0x22d3ee,
            emissive: 0x06b6d4,
            emissiveIntensity: 1.4,
            roughness: 0.2
        });
        this.accentMaterials.push(accentEmissiveMat);

        // Outer neon calibration ring + inner target rings
        const outerRing = new THREE.Mesh(
            new THREE.TorusGeometry(3.26, 0.024, 10, 64),
            accentEmissiveMat
        );
        outerRing.rotation.x = Math.PI / 2;
        outerRing.position.y = 0.01;
        this.scene.add(outerRing);

        const midRing = new THREE.Mesh(
            new THREE.RingGeometry(1.75, 1.78, 48),
            new THREE.MeshBasicMaterial({ color: 0x334155, side: THREE.DoubleSide })
        );
        midRing.rotation.x = -Math.PI / 2;
        midRing.position.y = 0.008;
        this.scene.add(midRing);

        // Calibration X/Z stage laser axes
        const axisMat = new THREE.MeshBasicMaterial({ color: 0x1e293b });
        const xAxis = new THREE.Mesh(new THREE.PlaneGeometry(6.3, 0.025), axisMat);
        xAxis.rotation.x = -Math.PI / 2;
        xAxis.position.y = 0.009;
        this.scene.add(xAxis);
        const zAxis = new THREE.Mesh(new THREE.PlaneGeometry(0.025, 6.3), axisMat);
        zAxis.rotation.x = -Math.PI / 2;
        zAxis.position.y = 0.009;
        this.scene.add(zAxis);

        // Overhead Studio Ring Halo above Robot Center
        this.haloRingMesh = new THREE.Mesh(
            new THREE.TorusGeometry(2.15, 0.028, 10, 56),
            accentEmissiveMat
        );
        this.haloRingMesh.rotation.x = Math.PI / 2;
        this.haloRingMesh.position.set(0, 3.25, 0);
        this.scene.add(this.haloRingMesh);

        // 4 Corner Optical Motion-Capture Camera Pillars
        const pillarPositions = [
            [3.2, 3.2], [3.2, -3.2], [-3.2, 3.2], [-3.2, -3.2]
        ];
        const trussGeo = new THREE.BoxGeometry(0.11, 2.75, 0.11);
        const trussMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.35 });
        const camHeadGeo = new THREE.BoxGeometry(0.24, 0.16, 0.20);
        const camLensGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.05, 16);

        pillarPositions.forEach(([px, pz]) => {
            const pGroup = new THREE.Group();
            pGroup.position.set(px, 0, pz);
            pGroup.lookAt(0, 0, 0);

            const post = new THREE.Mesh(trussGeo, trussMat);
            post.position.y = 1.375;
            pGroup.add(post);

            const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.12, 16), trussMat);
            foot.position.y = 0.06;
            pGroup.add(foot);

            const camBox = new THREE.Mesh(camHeadGeo, trussMat);
            camBox.position.set(0, 2.65, 0.08);
            camBox.rotation.x = 0.38;
            pGroup.add(camBox);

            const lens = new THREE.Mesh(camLensGeo, accentEmissiveMat);
            lens.rotation.x = Math.PI / 2;
            lens.position.set(0, 2.61, 0.19);
            pGroup.add(lens);

            const strip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.8, 0.03), accentEmissiveMat);
            strip.position.set(0, 1.15, 0.06);
            pGroup.add(strip);

            this.scene.add(pGroup);
        });

        // Curved Holographic Lab Backdrop Wall (behind -X side so Studio Front views it gracefully)
        const backdropGroup = new THREE.Group();
        const pillarBackMat = new THREE.MeshStandardMaterial({ color: 0x0b1222, metalness: 0.6, roughness: 0.4 });
        const finGeo = new THREE.BoxGeometry(0.14, 3.4, 0.32);
        const ledGeo = new THREE.BoxGeometry(0.035, 2.8, 0.04);

        for (let i = -3; i <= 3; i++) {
            const ang = i * 0.24;
            const radius = 5.4;
            const bx = -Math.cos(ang) * radius;
            const bz = Math.sin(ang) * radius;
            const fin = new THREE.Mesh(finGeo, pillarBackMat);
            fin.position.set(bx, 1.7, bz);
            fin.lookAt(0, 1.7, 0);
            backdropGroup.add(fin);

            const led = new THREE.Mesh(ledGeo, accentEmissiveMat);
            led.position.set(-Math.cos(ang) * (radius - 0.17), 1.7, Math.sin(ang) * (radius - 0.17));
            led.lookAt(0, 1.7, 0);
            backdropGroup.add(led);
        }
        this.scene.add(backdropGroup);

        // Lightweight Dynamic Tracking Floor Reticle + Foot Contact Shadows
        this.floorReticleGroup = new THREE.Group();
        const lockRing = new THREE.Mesh(
            new THREE.RingGeometry(0.46, 0.50, 36),
            new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
        );
        lockRing.rotation.x = -Math.PI / 2;
        lockRing.position.y = 0.014;
        this.floorReticleGroup.add(lockRing);

        const bodyShadow = new THREE.Mesh(
            new THREE.CircleGeometry(0.42, 24),
            new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42 })
        );
        bodyShadow.rotation.x = -Math.PI / 2;
        bodyShadow.position.y = 0.011;
        this.floorReticleGroup.add(bodyShadow);
        this.scene.add(this.floorReticleGroup);
    }

    _buildModernHumanoidRobot() {
        const THREE = window.THREE;

        // Shared High-Tech Materials
        const armorWhiteMat = new THREE.MeshStandardMaterial({
            color: 0xe2e8f0, metalness: 0.45, roughness: 0.26
        });
        const chassisDarkMat = new THREE.MeshStandardMaterial({
            color: 0x1e293b, metalness: 0.65, roughness: 0.35
        });
        const jointTitaniumMat = new THREE.MeshStandardMaterial({
            color: 0x475569, metalness: 0.78, roughness: 0.24
        });
        const visorMat = new THREE.MeshStandardMaterial({
            color: 0x020617, metalness: 0.9, roughness: 0.12
        });
        const coreAccentMat = new THREE.MeshStandardMaterial({
            color: 0x22d3ee, emissive: 0x06b6d4, emissiveIntensity: 1.65, roughness: 0.2
        });
        this.accentMaterials.push(coreAccentMat);

        const leftMarkerMat = new THREE.MeshStandardMaterial({
            color: 0x2dd4bf, emissive: 0x14b8a6, emissiveIntensity: 1.2
        });
        const rightMarkerMat = new THREE.MeshStandardMaterial({
            color: 0x818cf8, emissive: 0x6366f1, emissiveIntensity: 1.2
        });

        // Root placed at floor (y = 0), local +X is robot nose/front, +Y up, -Z anatomical Left, +Z anatomical Right
        this.robotRoot = new THREE.Group();
        this.scene.add(this.robotRoot);

        // Pelvis Group (vertical squat displacement moves pelvisGroup.position.y)
        this.pelvisGroup = new THREE.Group();
        this.pelvisGroup.position.y = 0.92; // nominal standing hip center height (thigh 0.44 + shin 0.43 + foot 0.05)
        this.robotRoot.add(this.pelvisGroup);

        const pelvisCore = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.34), chassisDarkMat);
        this.pelvisGroup.add(pelvisCore);
        const waistBelt = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.36), armorWhiteMat);
        waistBelt.position.y = 0.06;
        this.pelvisGroup.add(waistBelt);

        // Articulated Upper Body Pivot (at waist y = +0.10 above pelvis)
        this.upperBodyGroup = new THREE.Group();
        this.upperBodyGroup.position.y = 0.10;
        this.pelvisGroup.add(this.upperBodyGroup);

        // Abdomen spine column
        const waistCol = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.10, 0.16, 16), jointTitaniumMat);
        waistCol.position.y = 0.08;
        this.upperBodyGroup.add(waistCol);

        // Chest Armor Shell
        const chestFrame = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.34, 0.40), chassisDarkMat);
        chestFrame.position.y = 0.30;
        this.upperBodyGroup.add(chestFrame);

        const chestPlateFront = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.28, 0.36), armorWhiteMat);
        chestPlateFront.position.set(0.12, 0.32, 0);
        this.upperBodyGroup.add(chestPlateFront);

        // Back telemetry spine fins
        const backPack = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 0.24), chassisDarkMat);
        backPack.position.set(-0.14, 0.31, 0);
        this.upperBodyGroup.add(backPack);
        const spineLed = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.05), coreAccentMat);
        spineLed.position.set(-0.20, 0.31, 0);
        this.upperBodyGroup.add(spineLed);

        // Glowing Arc Reactor Core on Chest
        const reactorHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.04, 20), jointTitaniumMat);
        reactorHousing.rotation.z = Math.PI / 2;
        reactorHousing.position.set(0.165, 0.34, 0);
        this.upperBodyGroup.add(reactorHousing);

        const reactorCore = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.045, 20), coreAccentMat);
        reactorCore.rotation.z = Math.PI / 2;
        reactorCore.position.set(0.168, 0.34, 0);
        this.upperBodyGroup.add(reactorCore);

        // Expressive AI Head Group (mounted above upper chest y = 0.50)
        this.headGroup = new THREE.Group();
        this.headGroup.position.set(0.01, 0.50, 0);
        this.upperBodyGroup.add(this.headGroup);

        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.10, 14), jointTitaniumMat);
        neck.position.y = 0.04;
        this.headGroup.add(neck);

        const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.22), armorWhiteMat);
        helmet.position.y = 0.18;
        this.headGroup.add(helmet);

        const visor = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.19), visorMat);
        visor.position.set(0.11, 0.18, 0);
        this.headGroup.add(visor);

        // Glowing dual optical eyes (+forward +X)
        const eyeGeo = new THREE.BoxGeometry(0.02, 0.032, 0.052);
        const eyeL = new THREE.Mesh(eyeGeo, coreAccentMat);
        eyeL.position.set(0.132, 0.185, -0.048);
        this.headGroup.add(eyeL);
        const eyeR = new THREE.Mesh(eyeGeo, coreAccentMat);
        eyeR.position.set(0.132, 0.185, 0.048);
        this.headGroup.add(eyeR);

        // Ear sensor pods
        const earGeo = new THREE.CylinderGeometry(0.048, 0.048, 0.04, 16);
        const earL = new THREE.Mesh(earGeo, coreAccentMat);
        earL.rotation.x = Math.PI / 2;
        earL.position.set(0, 0.18, -0.12);
        this.headGroup.add(earL);
        const earR = new THREE.Mesh(earGeo, coreAccentMat);
        earR.rotation.x = Math.PI / 2;
        earR.position.set(0, 0.18, 0.12);
        this.headGroup.add(earR);

        // Dual-Axis Articulated Arms
        const createArm = (sideSign, markerMat) => {
            // sideSign: -1 = Anatomical Left (-Z), +1 = Anatomical Right (+Z)
            const shoulderSocket = new THREE.Group();
            shoulderSocket.position.set(0.0, 0.44, sideSign * 0.255);
            this.upperBodyGroup.add(shoulderSocket);

            const pauldron = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.11, 0.12), armorWhiteMat);
            pauldron.position.set(0, 0.03, sideSign * 0.02);
            shoulderSocket.add(pauldron);

            const shoulderBall = new THREE.Mesh(new THREE.SphereGeometry(0.068, 16, 12), jointTitaniumMat);
            shoulderSocket.add(shoulderBall);

            // Outer Abduct Pivot (X-axis) -> Inner Pitch Pivot (Z-axis)
            const abductGroup = new THREE.Group();
            shoulderSocket.add(abductGroup);

            const pitchGroup = new THREE.Group();
            abductGroup.add(pitchGroup);

            const upperArmMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.042, 0.28, 14), chassisDarkMat);
            upperArmMesh.position.y = -0.15;
            pitchGroup.add(upperArmMesh);

            const upperSleeve = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.17, 0.095), armorWhiteMat);
            upperSleeve.position.y = -0.14;
            pitchGroup.add(upperSleeve);

            // Elbow Pivot
            const elbowGroup = new THREE.Group();
            elbowGroup.position.y = -0.30;
            pitchGroup.add(elbowGroup);

            const elbowJoint = new THREE.Mesh(new THREE.SphereGeometry(0.050, 14, 10), jointTitaniumMat);
            elbowGroup.add(elbowJoint);

            const forearmMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.034, 0.26, 14), armorWhiteMat);
            forearmMesh.position.y = -0.14;
            elbowGroup.add(forearmMesh);

            const wristBand = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 14), markerMat);
            wristBand.position.y = -0.25;
            elbowGroup.add(wristBand);

            const hand = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.09, 0.055), chassisDarkMat);
            hand.position.y = -0.30;
            elbowGroup.add(hand);

            return { abductGroup, pitchGroup, elbowGroup };
        };

        this.leftArm = createArm(-1, leftMarkerMat);
        this.rightArm = createArm(+1, rightMarkerMat);

        // Articulated Legs (supports both squat kinematics + walking gait)
        const createLeg = (sideSign, markerMat) => {
            const hipGroup = new THREE.Group();
            hipGroup.position.set(0, -0.05, sideSign * 0.125);
            this.pelvisGroup.add(hipGroup);

            const hipSphere = new THREE.Mesh(new THREE.SphereGeometry(0.068, 14, 10), jointTitaniumMat);
            hipGroup.add(hipSphere);

            const thighArmor = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.36, 0.13), armorWhiteMat);
            thighArmor.position.y = -0.21;
            hipGroup.add(thighArmor);

            const kneeGroup = new THREE.Group();
            kneeGroup.position.y = -0.43;
            hipGroup.add(kneeGroup);

            const kneeJoint = new THREE.Mesh(new THREE.SphereGeometry(0.060, 14, 10), jointTitaniumMat);
            kneeGroup.add(kneeJoint);

            const shinFrame = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.38, 0.11), chassisDarkMat);
            shinFrame.position.y = -0.21;
            kneeGroup.add(shinFrame);

            const shinGuard = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.09), armorWhiteMat);
            shinGuard.position.set(0.045, -0.19, 0);
            kneeGroup.add(shinGuard);

            const ankleStripe = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.03, 0.12), markerMat);
            ankleStripe.position.y = -0.37;
            kneeGroup.add(ankleStripe);

            const ankleGroup = new THREE.Group();
            ankleGroup.position.y = -0.42;
            kneeGroup.add(ankleGroup);

            const footMesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.065, 0.135), chassisDarkMat);
            footMesh.position.set(0.045, -0.025, 0);
            ankleGroup.add(footMesh);

            return { hipGroup, kneeGroup, ankleGroup };
        };

        this.leftLeg = createLeg(-1, leftMarkerMat);
        this.rightLeg = createLeg(+1, rightMarkerMat);
    }

    /**
     * Updates robot pose & locomotion cleanly from MotionLabEngine snapshot.
     */
    applyMotionState(state) {
        if (!state || !this.robotRoot) return;
        this.latestMotionState = state;

        // World Transform on Podium
        this.robotRoot.position.set(state.posX || 0, 0, state.posZ || 0);
        this.robotRoot.rotation.y = state.yaw || 0;

        if (this.floorReticleGroup) {
            this.floorReticleGroup.position.set(state.posX || 0, 0, state.posZ || 0);
        }

        const j = state.joints || {};
        const squat = Math.max(0, Math.min(1, Number(j.squatDepth ?? 0)));

        // Squat vertical drop + inverse kinematic hip/knee/ankle bend
        const standHipY = 0.92;
        const squatDrop = squat * 0.28;

        // Gentle walking vertical bob
        const walkI = Number(state.walkIntensity ?? 0);
        const walkP = Number(state.walkPhase ?? 0);
        const walkBob = walkI * Math.abs(Math.sin(walkP)) * 0.025;

        this.pelvisGroup.position.y = standHipY - squatDrop + walkBob;

        // Torso pitch (+forward -> negative rotZ), roll (tilt), and slight forward lean on squat
        const torsoPitch = Number(j.torsoPitch ?? 0) + squat * 0.24;
        const torsoRoll = Number(j.torsoRoll ?? 0);
        this.upperBodyGroup.rotation.z = -torsoPitch;
        this.upperBodyGroup.rotation.x = torsoRoll;

        // Head yaw & counter-pitch so gaze stays level during squat
        if (this.headGroup) {
            this.headGroup.rotation.y = Number(j.headYaw ?? 0);
            this.headGroup.rotation.z = Math.max(-0.35, Math.min(0.45, torsoPitch * 0.45));
        }

        // Arms: Left (-Z -> +abduct opens outward), Right (+Z -> -abduct opens outward)
        // +pitch.rotation.z swings arm FORWARD (+X) & UP (+Y)
        if (this.leftArm) {
            this.leftArm.abductGroup.rotation.x = Math.max(-0.15, Number(j.armAbductL ?? 0.08));
            const walkArmSwingL = walkI * Math.sin(walkP + Math.PI) * 0.35;
            this.leftArm.pitchGroup.rotation.z = Number(j.armRaiseL ?? 0) + walkArmSwingL;
            this.leftArm.elbowGroup.rotation.z = Math.max(0, Number(j.elbowL ?? 0.15));
        }
        if (this.rightArm) {
            this.rightArm.abductGroup.rotation.x = -Math.max(-0.15, Number(j.armAbductR ?? 0.08));
            const walkArmSwingR = walkI * Math.sin(walkP) * 0.35;
            this.rightArm.pitchGroup.rotation.z = Number(j.armRaiseR ?? 0) + walkArmSwingR;
            this.rightArm.elbowGroup.rotation.z = Math.max(0, Number(j.elbowR ?? 0.15));
        }

        // Legs: Squat symmetrical knee/hip flex blended with alternating walking stride
        const squatHipAngle = squat * 0.85;   // >0 swings thigh FORWARD (+Z rot)
        const squatKneeAngle = -squat * 1.65; // <0 folds shin BACKWARD
        const squatAnkleAngle = squat * 0.80; // keeps foot sole flat on podium!

        const strideHipL = walkI * Math.sin(walkP) * 0.48;
        const strideKneeL = -Math.max(0, -Math.cos(walkP)) * walkI * 0.55;
        const strideHipR = walkI * Math.sin(walkP + Math.PI) * 0.48;
        const strideKneeR = -Math.max(0, Math.cos(walkP)) * walkI * 0.55;

        if (this.leftLeg) {
            this.leftLeg.hipGroup.rotation.z = squatHipAngle + strideHipL;
            this.leftLeg.kneeGroup.rotation.z = squatKneeAngle + strideKneeL;
            this.leftLeg.ankleGroup.rotation.z = squatAnkleAngle - strideHipL * 0.4 - strideKneeL * 0.4;
        }
        if (this.rightLeg) {
            this.rightLeg.hipGroup.rotation.z = squatHipAngle + strideHipR;
            this.rightLeg.kneeGroup.rotation.z = squatKneeAngle + strideKneeR;
            this.rightLeg.ankleGroup.rotation.z = squatAnkleAngle - strideHipR * 0.4 - strideKneeR * 0.4;
        }
    }

    /**
     * Dynamically shifts lab accent LEDs by Step / Mode.
     */
    setAccentTheme(mode) {
        const themes = {
            HUMAN_DEMO: { color: 0x22d3ee, emissive: 0x06b6d4 },
            REPLAY: { color: 0x38bdf8, emissive: 0x0284c7 },
            BC_TRAINING: { color: 0xfbbf24, emissive: 0xd97706 },
            BC_AUTONOMOUS: { color: 0x10b981, emissive: 0x059669 }
        };
        const t = themes[mode] || themes.HUMAN_DEMO;
        for (const mat of this.accentMaterials) {
            mat.color.setHex(t.color);
            mat.emissive.setHex(t.emissive);
        }
    }

    setCameraPreset(preset) {
        this.camViewMode = preset;
        switch (preset) {
            case 'front': // Mirror-style Studio Front facing robot's +X front
                this.camTheta = 0.0;
                this.camPhi = 1.30;
                this.camRadius = 4.35;
                this.camTarget.set(0, 1.0, 0);
                break;
            case 'iso': // 3/4 Studio Perspective
                this.camTheta = 0.68;
                this.camPhi = 1.12;
                this.camRadius = 4.95;
                this.camTarget.set(0, 0.96, 0);
                break;
            case 'side': // Side Profile for Squat & Lean Analysis
                this.camTheta = Math.PI / 2;
                this.camPhi = 1.38;
                this.camRadius = 4.45;
                this.camTarget.set(0, 0.95, 0);
                break;
            case 'top': // Overhead Stage Floor
                this.camTheta = 0.0;
                this.camPhi = 0.25;
                this.camRadius = 6.2;
                this.camTarget.set(0, 0.4, 0);
                break;
        }
        this._updateCameraTransform();
    }

    setFollowRobot(enabled) {
        this.followRobot = Boolean(enabled);
    }

    _updateCameraTransform() {
        if (!this.camera || !this.camTarget) return;
        let tx = this.camTarget.x;
        let ty = this.camTarget.y;
        let tz = this.camTarget.z;

        if (this.followRobot && this.robotRoot) {
            tx = this.robotRoot.position.x * 0.7;
            tz = this.robotRoot.position.z * 0.7;
        }

        const sinPhi = Math.sin(this.camPhi);
        const cx = tx + this.camRadius * sinPhi * Math.cos(this.camTheta);
        const cy = ty + this.camRadius * Math.cos(this.camPhi);
        const cz = tz + this.camRadius * sinPhi * Math.sin(this.camTheta);

        this.camera.position.set(cx, Math.max(0.35, cy), cz);
        this.camera.lookAt(tx, ty, tz);
    }

    _bindPointerControls() {
        this.canvas.addEventListener('pointerdown', (e) => {
            this._isDragging = true;
            this._lastMouse = { x: e.clientX, y: e.clientY };
        });

        window.addEventListener('pointermove', this._onPtrMove = (e) => {
            if (!this._isDragging) return;
            const dx = e.clientX - this._lastMouse.x;
            const dy = e.clientY - this._lastMouse.y;
            this._lastMouse = { x: e.clientX, y: e.clientY };

            this.camTheta += dx * 0.008;
            this.camPhi = Math.max(0.18, Math.min(1.48, this.camPhi - dy * 0.007));
        });

        window.addEventListener('pointerup', this._onPtrUp = () => {
            this._isDragging = false;
        });

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.camRadius = Math.max(2.3, Math.min(9.5, this.camRadius + e.deltaY * 0.004));
        }, { passive: false });

        this.canvas.addEventListener('dblclick', () => {
            this.setCameraPreset(this.camViewMode || 'front');
        });
    }

    resize() {
        if (!this.renderer || !this.camera || !this.container) return;
        const w = Math.max(280, this.container.clientWidth);
        const h = Math.max(240, this.container.clientHeight);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h, false);
    }

    _startRenderLoop() {
        const render = () => {
            if (this.isDisposed) return;
            this.animId = requestAnimationFrame(render);

            const now = performance.now();
            this._fpsFrames++;
            if (now - this._fpsLastAt >= 600) {
                this._currentFps = Math.round((this._fpsFrames * 1000) / (now - this._fpsLastAt));
                this._fpsFrames = 0;
                this._fpsLastAt = now;
            }

            if (this.haloRingMesh) {
                this.haloRingMesh.rotation.z += 0.003;
            }
            if (this.floorReticleGroup) {
                this.floorReticleGroup.rotation.y += 0.01;
            }

            this._updateCameraTransform();
            this.renderer.render(this.scene, this.camera);

            // Budget HUD update to ~12 Hz to eliminate layout reflow stutter
            if (now - this._lastHudEmitAt >= 85) {
                this._lastHudEmitAt = now;
                this.onHudUpdate({
                    fps: this._currentFps,
                    motionState: this.latestMotionState
                });
            }
        };
        this.animId = requestAnimationFrame(render);
    }

    dispose() {
        this.isDisposed = true;
        if (this.animId) cancelAnimationFrame(this.animId);
        if (this._resizeObserver) this._resizeObserver.disconnect();
        window.removeEventListener('resize', this._onWinResize);
        window.removeEventListener('pointermove', this._onPtrMove);
        window.removeEventListener('pointerup', this._onPtrUp);
        if (this.renderer) this.renderer.dispose();
    }
}
