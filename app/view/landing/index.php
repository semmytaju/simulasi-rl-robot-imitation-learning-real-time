<?php
$assetVer = '20261114';
$dbDiag = $data['db_diagnostics'] ?? [];
$isDbOk = !empty($dbDiag['is_connected']);
$savedModelsCount = is_array($data['saved_models'] ?? null) ? count($data['saved_models']) : 0;

$actionsMeta = [
    0 => ['code' => 'NEUTRAL', 'short' => 'Neutral', 'icon' => 'bi-pause-circle', 'btn' => 'btn-outline-secondary', 'key' => 'Space'],
    1 => ['code' => 'FORWARD', 'short' => 'Forward', 'icon' => 'bi-arrow-up-circle', 'btn' => 'btn-outline-success', 'key' => 'W / Up'],
    2 => ['code' => 'BACKWARD', 'short' => 'Backward', 'icon' => 'bi-arrow-down-circle', 'btn' => 'btn-outline-warning', 'key' => 'S / Down'],
    3 => ['code' => 'TURN_LEFT', 'short' => 'Turn Left', 'icon' => 'bi-arrow-counterclockwise', 'btn' => 'btn-outline-info', 'key' => 'A / Left'],
    4 => ['code' => 'TURN_RIGHT', 'short' => 'Turn Right', 'icon' => 'bi-arrow-clockwise', 'btn' => 'btn-outline-info', 'key' => 'D / Right'],
    5 => ['code' => 'WAVE_LEFT_ARM', 'short' => 'Left Arm', 'icon' => 'bi-hand-index-thumb', 'btn' => 'btn-outline-primary', 'key' => 'Q / 1'],
    6 => ['code' => 'WAVE_RIGHT_ARM', 'short' => 'Right Arm', 'icon' => 'bi-hand-index-thumb-fill', 'btn' => 'btn-outline-primary', 'key' => 'E / 2'],
    7 => ['code' => 'BOTH_ARMS_UP', 'short' => 'Both Arms', 'icon' => 'bi-person-arms-up', 'btn' => 'btn-outline-success', 'key' => 'R / 3'],
    8 => ['code' => 'SQUAT_CROUCH', 'short' => 'Squat', 'icon' => 'bi-arrow-bar-down', 'btn' => 'btn-outline-warning', 'key' => 'C / 4']
];
?>
<!DOCTYPE html>
<html lang="en" data-bs-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="<?php echo htmlspecialchars($data['app_desc'] ?? '', ENT_QUOTES, 'UTF-8'); ?>">
    <title><?php echo htmlspecialchars($data['title'] ?? 'Clone Agent AI — IMITATION LEARNING (LEARNING BY DEMONSTRATION)', ENT_QUOTES, 'UTF-8'); ?></title>
    <link rel="stylesheet" href="<?php echo APP_PATH; ?>/public/assets/vendor/bootstrap/css/bootstrap.min.css?v=<?php echo $assetVer; ?>">
    <link rel="stylesheet" href="<?php echo APP_PATH; ?>/public/assets/vendor/bootstrap-icons/bootstrap-icons.min.css?v=<?php echo $assetVer; ?>">
    <link rel="stylesheet" href="<?php echo APP_PATH; ?>/public/assets/css/studio.css?v=<?php echo $assetVer; ?>">
</head>
<body>
<nav class="navbar studio-navbar py-2">
    <div class="container-fluid px-3 px-lg-4">
        <div class="d-flex align-items-center gap-2">
            <span class="brand-mark">
                <i class="bi bi-robot fs-5"></i>
            </span>
            <div>
                <div class="fw-bold text-white lh-1 d-flex align-items-center gap-2 brand-title">
                    Clone Agent AI
                    <span class="badge rounded-pill text-bg-info text-dark fw-semibold brand-badge">IMITATION LEARNING</span>
                </div>
                <div class="text-secondary fs-70">Human Motion Capture &rarr; Dual-Head Behavior Cloning &rarr; Autonomous Humanoid</div>
            </div>
        </div>

<div class="d-flex align-items-center gap-2 flex-wrap justify-content-end">
            <span class="badge bg-dark border border-secondary text-light px-2 py-1 fs-72">
                <i class="bi bi-database-fill me-1 <?php echo $isDbOk ? 'text-emerald' : 'text-danger'; ?>"></i>
                MySQL: <?php echo $isDbOk ? htmlspecialchars($dbDiag['database'] ?? 'Connected', ENT_QUOTES, 'UTF-8') : 'Offline'; ?>
                (Models: <?php echo $savedModelsCount; ?>)
            </span>
            <span class="badge bg-dark border border-secondary text-cyan px-2 py-1 fs-72" id="hudFpsBadge">FPS: --</span>
            <button type="button" class="btn btn-sm btn-outline-light py-1 px-2 fs-75" id="btnResetRobotPose" title="Reset Humanoid Robot Pose">
                <i class="bi bi-arrow-repeat me-1"></i>Reset Pose
            </button>
            <button type="button" class="btn btn-sm btn-outline-info py-1 px-2 fs-75" id="btnOpenSettingsModal" data-bs-toggle="modal" data-bs-target="#studioSettingsModal">
                <i class="bi bi-sliders me-1"></i>Settings
            </button>
        </div>
    </div>
</nav>

<main class="container-fluid px-3 px-lg-4 py-3">
    <section class="workflow-stepper mb-3" id="workflowStepperBar">
        <button type="button" class="step-pill-btn active" data-step-mode="HUMAN_DEMO">
            <span class="step-circle">1</span>
            <div>
                <div class="fw-semibold fs-86">Human Demonstration</div>
                <div class="fs-71 opacity-75">Webcam MoveNet / Pad &amp; Record Dataset</div>
            </div>
        </button>
        <button type="button" class="step-pill-btn" data-step-mode="BC_TRAINING">
            <span class="step-circle">2</span>
            <div>
                <div class="fw-semibold fs-86">Train Behavior Cloning</div>
                <div class="fs-71 opacity-75">Dual-Head Neural Net in Web Worker</div>
            </div>
        </button>
        <button type="button" class="step-pill-btn" data-step-mode="BC_AUTONOMOUS">
            <span class="step-circle">3</span>
            <div>
                <div class="fw-semibold fs-86">Autonomous Agent</div>
                <div class="fs-71 opacity-75">Real-Time Imitation Without Webcam</div>
            </div>
        </button>
    </section>

<div class="row g-3 align-items-stretch">
        <div class="col-lg-8">
            <div class="stage-wrapper shadow" id="lab3dContainer">
                <canvas id="imitationLabCanvas"></canvas>

<div class="stage-hud-top">
                    <div class="hud-glass rounded-3 px-3 py-2 d-flex align-items-center gap-2 flex-wrap">
                        <span class="badge text-bg-info text-dark fw-semibold fs-72" id="hudActiveModePill">STEP 1: HUMAN DEMONSTRATION</span>
                        <span class="badge bg-primary fs-72" id="hudActionBadge">NEUTRAL</span>
                        <span class="badge bg-dark border border-secondary text-light fs-70" id="hudInputSourceBadge">Source: SYSTEM</span>
                        <span class="badge bg-dark border border-secondary text-secondary fs-70" id="hudConfidenceText">Conf: 100%</span>
                    </div>

<div class="hud-glass rounded-3 p-1 d-flex align-items-center gap-1 flex-wrap">
                        <button type="button" class="btn btn-sm btn-outline-info active cam-chip btn-cam-preset" data-preset="front">Front</button>
                        <button type="button" class="btn btn-sm btn-outline-info cam-chip btn-cam-preset" data-preset="iso">Iso</button>
                        <button type="button" class="btn btn-sm btn-outline-info cam-chip btn-cam-preset" data-preset="side">Side</button>
                        <button type="button" class="btn btn-sm btn-outline-info cam-chip btn-cam-preset" data-preset="top">Top</button>
                        <button type="button" class="btn btn-sm btn-outline-secondary cam-chip" id="btnToggleFollowRobot" title="Camera Follows Robot">
                            <i class="bi bi-crosshair"></i> Follow
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-light cam-chip" id="btnLabFullscreen" title="Fullscreen 3D Viewport">
                            <i class="bi bi-arrows-fullscreen"></i>
                        </button>
                    </div>
                </div>

<div class="stage-hud-bottom">
                    <div class="hud-glass rounded-3 px-3 py-2">
                        <div class="row g-2 align-items-center">
                            <div class="col-sm-4 col-md-3">
                                <div class="text-secondary fs-66">Podium Coordinates</div>
                                <div class="fw-semibold text-white fs-74" id="hudPosCoords">X: 0.00m &bull; Z: 0.00m</div>
                                <div class="text-cyan fs-67" id="hudYawText">Yaw: 0&deg;</div>
                            </div>
                            <div class="col-sm-8 col-md-9">
                                <div class="row g-2">
                                    <div class="col-6 col-xl-3">
                                        <div class="d-flex justify-content-between fs-67">
                                            <span class="text-secondary">Left Arm</span>
                                            <span class="text-white" id="hudValArmL">0%</span>
                                        </div>
                                        <div class="joint-mini-bar mt-1"><div id="hudBarArmL" class="bg-info"></div></div>
                                    </div>
                                    <div class="col-6 col-xl-3">
                                        <div class="d-flex justify-content-between fs-67">
                                            <span class="text-secondary">Right Arm</span>
                                            <span class="text-white" id="hudValArmR">0%</span>
                                        </div>
                                        <div class="joint-mini-bar mt-1"><div id="hudBarArmR" class="bg-info"></div></div>
                                    </div>
                                    <div class="col-6 col-xl-3">
                                        <div class="d-flex justify-content-between fs-67">
                                            <span class="text-secondary">Torso Lean</span>
                                            <span class="text-white" id="hudValTorso">0&deg;</span>
                                        </div>
                                        <div class="joint-mini-bar mt-1"><div id="hudBarTorso" class="bg-warning"></div></div>
                                    </div>
                                    <div class="col-6 col-xl-3">
                                        <div class="d-flex justify-content-between fs-67">
                                            <span class="text-secondary">Squat Depth</span>
                                            <span class="text-white" id="hudValSquat">0%</span>
                                        </div>
                                        <div class="joint-mini-bar mt-1"><div id="hudBarSquat" class="bg-success"></div></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

<div class="col-lg-4">
            <div class="lab-card p-3 h-100 control-dock-scroll">
                <div id="paneStepDemo">
                    <div class="d-flex align-items-center justify-content-between mb-2">
                        <h6 class="mb-0 fw-bold text-cyan fs-90">
                            <i class="bi bi-camera-video me-1"></i>Human Motion Capture
                        </h6>
                        <div class="d-flex align-items-center gap-1">
                            <span class="badge bg-secondary fs-65" id="ilPoseFpsBadge">MoveNet Idle</span>
                            <button type="button" class="btn btn-sm btn-info text-dark fw-semibold py-0 px-2 fs-72" id="btnIlCamToggle">
                                <i class="bi bi-camera-video-fill me-1"></i>Enable Webcam
                            </button>
                        </div>
                    </div>

<div class="webcam-frame-box mb-2">
                        <video id="ilWebcamVideo" autoplay playsinline muted class="mirror-flip"></video>
                        <canvas id="ilPoseCanvas" class="mirror-flip"></canvas>
                        <div id="ilWebcamPlaceholder" class="position-absolute inset-0 d-flex flex-column align-items-center justify-content-center text-center px-3 bg-dark bg-opacity-75">
                            <i class="bi bi-person-bounding-box fs-3 text-info mb-1"></i>
                            <div class="text-light fw-semibold fs-76">Webcam Is Off (Optional)</div>
                            <div class="text-secondary fs-67">Click Enable Webcam or use the Quick Pose Pad &amp; keyboard below.</div>
                        </div>
                        <div class="position-absolute bottom-0 start-0 end-0 px-2 py-1 d-flex justify-content-between align-items-center webcam-overlay-bar">
                            <span id="ilDetectedGestureBadge" class="badge bg-secondary">NEUTRAL</span>
                            <span id="ilCamStatusText" class="text-light text-truncate ms-2">Camera Off</span>
                        </div>
                    </div>

<div class="sub-card p-2 mb-2">
                        <div class="d-flex align-items-center justify-content-between gap-2 mb-1">
                            <button type="button" class="btn btn-sm btn-outline-warning py-0 px-2 fs-71" id="btnIlCalibrate">
                                <i class="bi bi-bullseye me-1"></i>Calibrate Neutral
                            </button>
                            <span id="ilCalibStatusText" class="text-secondary text-truncate fs-68">Stand upright in view of camera</span>
                        </div>
                        <div class="progress calib-progress">
                            <div id="ilCalibProgressBar" class="progress-bar bg-warning progress-zero"></div>
                        </div>
                    </div>

<div class="sub-card p-2 mb-2">
                        <div class="d-flex justify-content-between align-items-center mb-1">
                            <span class="fw-semibold text-light fs-74"><i class="bi bi-grid-3x3-gap me-1 text-info"></i>Quick Pose Pad (Hold / Keyboard)</span>
                            <span class="text-secondary fs-65">No webcam needed</span>
                        </div>
                        <div class="pose-pad-grid">
                            <?php foreach ($actionsMeta as $actId => $meta): ?>
                            <button type="button"
                                class="btn <?php echo $meta['btn']; ?> btn-pose-pad btn-il-manual"
                                data-il-action="<?php echo $actId; ?>">
                                <i class="bi <?php echo $meta['icon']; ?>"></i>
                                <span class="fw-semibold"><?php echo htmlspecialchars($meta['short'], ENT_QUOTES, 'UTF-8'); ?></span>
                                <span class="opacity-75 fs-60"><?php echo htmlspecialchars($meta['key'], ENT_QUOTES, 'UTF-8'); ?></span>
                            </button>
                            <?php endforeach; ?>
                        </div>
                    </div>

<div class="sub-card p-2 mb-2">
                        <div class="d-flex align-items-center justify-content-between mb-1">
                            <span class="fw-semibold text-light fs-75"><i class="bi bi-record-circle text-danger me-1"></i>Demonstration Recorder</span>
                            <span id="recStatusBadge" class="badge bg-secondary fs-65">Ready to Record</span>
                        </div>
                        <input type="text" id="inputDemoTitle" class="form-control form-control-sm bg-dark text-light border-secondary mb-2 fs-74" placeholder="Dataset name (e.g., Arms & Squat Demo)">
                        <div class="d-flex gap-1 mb-2">
                            <button type="button" id="btnDemoRecStart" class="btn btn-sm btn-danger flex-fill fs-73"><i class="bi bi-record-fill me-1"></i>Record</button>
                            <button type="button" id="btnDemoRecPause" class="btn btn-sm btn-warning text-dark fs-73" disabled><i class="bi bi-pause-fill me-1"></i>Pause</button>
                            <button type="button" id="btnDemoRecStop" class="btn btn-sm btn-success flex-fill fs-73" disabled><i class="bi bi-stop-fill me-1"></i>Save</button>
                        </div>
                        <div class="row g-1 text-center mb-2 fs-69">
                            <div class="col-4 bg-dark bg-opacity-50 rounded py-1">
                                <div class="text-secondary">Steps</div>
                                <div id="recStatsSteps" class="fw-bold text-white">0</div>
                            </div>
                            <div class="col-4 bg-dark bg-opacity-50 rounded py-1">
                                <div class="text-secondary">Episodes</div>
                                <div id="recStatsEpisodes" class="fw-bold text-info">0</div>
                            </div>
                            <div class="col-4 bg-dark bg-opacity-50 rounded py-1">
                                <div class="text-secondary">Avg Conf</div>
                                <div id="recStatsConfidence" class="fw-bold text-emerald">0%</div>
                            </div>
                        </div>
                        <div class="d-flex flex-wrap gap-1">
                            <?php foreach ($actionsMeta as $actId => $meta): ?>
                            <span class="badge bg-dark border border-secondary text-secondary fs-62" id="recActionChip_<?php echo $actId; ?>">
                                <?php echo htmlspecialchars($meta['short'], ENT_QUOTES, 'UTF-8'); ?>: 0
                            </span>
                            <?php endforeach; ?>
                        </div>
                    </div>

<div class="sub-card p-2">
                        <div class="d-flex align-items-center justify-content-between mb-1">
                            <span class="fw-semibold text-light fs-74">
                                <i class="bi bi-collection-play me-1 text-info"></i>Saved Demonstrations <span id="kpiDemosCountBadge" class="badge bg-info text-dark ms-1">0</span>
                            </span>
                            <button type="button" id="btnRefreshDemos" class="btn btn-xs btn-outline-light py-0 px-2 fs-68">
                                <i class="bi bi-arrow-clockwise"></i>
                            </button>
                        </div>
                        <div id="savedDemosListContainer" class="mb-2 demos-scroll-list">
                            <div class="text-secondary small text-center py-2">Loading datasets...</div>
                        </div>
                        <div class="border-top border-secondary pt-2">
                            <div class="d-flex justify-content-between align-items-center mb-1 fs-70">
                                <span id="replayLoadedTitle" class="text-info text-truncate">Select a demo to replay</span>
                                <span id="replayProgressText" class="text-secondary">0 / 0</span>
                            </div>
                            <div class="progress mb-2 replay-progress">
                                <div id="replayProgressBar" class="progress-bar bg-info progress-zero"></div>
                            </div>
                            <div class="d-flex gap-1 align-items-center">
                                <button type="button" id="btnReplayPlay" class="btn btn-sm btn-outline-info py-0 px-2 fs-72" disabled><i class="bi bi-play-fill"></i></button>
                                <button type="button" id="btnReplayPause" class="btn btn-sm btn-outline-warning py-0 px-2 fs-72" disabled><i class="bi bi-pause-fill"></i></button>
                                <button type="button" id="btnReplayStop" class="btn btn-sm btn-outline-danger py-0 px-2 fs-72" disabled><i class="bi bi-stop-fill"></i></button>
                                <select id="selectReplaySpeed" class="form-select form-select-sm bg-dark text-light border-secondary ms-auto py-0 replay-speed-select">
                                    <option value="0.5">0.5x Speed</option>
                                    <option value="1.0" selected>1.0x Speed</option>
                                    <option value="1.5">1.5x Speed</option>
                                    <option value="2.0">2.0x Speed</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

<div id="paneStepTrain" class="d-none">
                    <div class="d-flex align-items-center justify-content-between mb-2">
                        <h6 class="mb-0 fw-bold text-warning fs-90">
                            <i class="bi bi-cpu me-1"></i>2. Behavior Cloning Training
                        </h6>
                        <div class="d-flex gap-1">
                            <button type="button" id="btnBcRefreshDatasets" class="btn btn-sm btn-outline-light py-0 px-2 fs-71"><i class="bi bi-arrow-clockwise"></i></button>
                            <button type="button" id="btnBcInspectDatasets" class="btn btn-sm btn-outline-info py-0 px-2 fs-71">Inspect</button>
                        </div>
                    </div>

<div class="sub-card p-2 mb-2">
                        <div class="d-flex justify-content-between align-items-center mb-1">
                            <span class="fw-semibold text-light fs-74">Select Demonstration Datasets</span>
                            <span id="bcDatasetSummaryBadge" class="badge bg-dark border border-secondary text-light fs-66">Not inspected yet</span>
                        </div>
                        <div id="bcDatasetCheckboxes" class="mb-2 dataset-check-list"></div>
                        <div id="bcDatasetWarningAlert" class="alert alert-warning py-1 px-2 mb-2 d-none fs-69"></div>
                        <div class="chart-dist-box">
                            <canvas id="bcActionDistChart"></canvas>
                        </div>
                    </div>

<div class="sub-card p-2 mb-2">
                        <div class="fw-semibold text-light mb-2 fs-74"><i class="bi bi-sliders me-1 text-warning"></i>Dual-Head Neural Net Parameters</div>
                        <div class="row g-2 mb-2">
                            <div class="col-12">
                                <label class="form-label text-secondary mb-0 fs-68" for="inputBcModelName">Model Name</label>
                                <input type="text" id="inputBcModelName" class="form-control form-control-sm bg-dark text-light border-secondary fs-74" placeholder="ImitationNet-BC" value="ImitationNet-BC">
                            </div>
                            <div class="col-4">
                                <label class="form-label text-secondary mb-0 fs-68" for="inputBcEpochs">Epochs</label>
                                <input type="number" id="inputBcEpochs" class="form-control form-control-sm bg-dark text-light border-secondary fs-74" value="55" min="10" max="200" step="5">
                            </div>
                            <div class="col-4">
                                <label class="form-label text-secondary mb-0 fs-68" for="inputBcBatchSize">Batch</label>
                                <input type="number" id="inputBcBatchSize" class="form-control form-control-sm bg-dark text-light border-secondary fs-74" value="32" min="8" max="128" step="8">
                            </div>
                            <div class="col-4">
                                <label class="form-label text-secondary mb-0 fs-68" for="inputBcLearningRate">LR</label>
                                <select id="inputBcLearningRate" class="form-select form-select-sm bg-dark text-light border-secondary fs-74">
                                    <option value="0.0005">0.0005</option>
                                    <option value="0.001" selected>0.001</option>
                                    <option value="0.002">0.002</option>
                                    <option value="0.005">0.005</option>
                                </select>
                            </div>
                        </div>
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <div class="form-check form-switch mb-0">
                                <input class="form-check-input" type="checkbox" id="chkBcClassWeights" checked>
                                <label class="form-check-label text-light fs-71" for="chkBcClassWeights">Balance Class Weights</label>
                            </div>
                            <div class="d-flex align-items-center gap-1">
                                <span class="text-secondary fs-68">Val Split:</span>
                                <input type="number" id="inputBcValSplit" class="form-control form-control-sm bg-dark text-light border-secondary py-0 px-1 fs-71 val-split-input" value="0.20" min="0.10" max="0.40" step="0.05">
                            </div>
                        </div>
                        <div class="d-flex gap-1">
                            <button type="button" id="btnBcStartTrain" class="btn btn-sm btn-warning text-dark fw-semibold flex-fill fs-76">
                                <i class="bi bi-play-fill me-1"></i>Train Behavior Cloning
                            </button>
                            <button type="button" id="btnBcCancelTrain" class="btn btn-sm btn-outline-danger fs-76" disabled>
                                <i class="bi bi-x-lg"></i>
                            </button>
                        </div>
                    </div>

<div class="sub-card p-2 mb-2">
                        <div class="d-flex justify-content-between align-items-center mb-1">
                            <span id="bcTrainStatusText" class="text-light fs-71">Ready to train Behavior Cloning</span>
                        </div>
                        <div class="progress mb-2 train-progress">
                            <div id="bcTrainProgressBar" class="progress-bar bg-warning progress-zero"></div>
                        </div>
                        <div class="chart-train-box">
                            <canvas id="bcTrainingChart"></canvas>
                        </div>
                    </div>

<div id="bcEvaluationBox" class="sub-card p-2 d-none">
                        <div class="fw-semibold text-emerald mb-1 fs-76"><i class="bi bi-check2-circle me-1"></i>Evaluation Results</div>
                        <div id="bcEvalSummaryText" class="text-light mb-2 fs-72"></div>
                        <div id="bcPerClassF1Container" class="mb-2"></div>
                        <div id="bcConfusionMatrixContainer" class="mb-2"></div>
                        <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" id="chkBcActivateAfterSave" checked>
                            <label class="form-check-label text-light fs-72" for="chkBcActivateAfterSave">Activate model immediately after saving</label>
                        </div>
                        <div class="d-flex gap-2">
                            <button type="button" id="btnBcSaveModel" class="btn btn-sm btn-success flex-fill fs-74" disabled>
                                <i class="bi bi-cloud-upload me-1"></i>Save BC Model to MySQL
                            </button>
                            <button type="button" id="btnGoToStep3" class="btn btn-sm btn-outline-info fs-74">Step 3 &rarr;</button>
                        </div>
                    </div>
                </div>

<div id="paneStepAuto" class="d-none">
                    <div class="d-flex align-items-center justify-content-between mb-2">
                        <h6 class="mb-0 fw-bold text-emerald fs-90">
                            <i class="bi bi-stars me-1"></i>3. Autonomous Agent (Zero Webcam)
                        </h6>
                        <button type="button" id="btnAutoRefreshModels" class="btn btn-sm btn-outline-light py-0 px-2 fs-71">
                            <i class="bi bi-arrow-clockwise"></i>
                        </button>
                    </div>

<div class="sub-card p-2 mb-2">
                        <label class="form-label text-secondary mb-1 fs-70" for="autoModelSelect">Select Trained Behavior Cloning Model</label>
                        <select id="autoModelSelect" class="form-select form-select-sm bg-dark text-light border-secondary mb-2 fs-74">
                            <option value="">Loading BC models...</option>
                        </select>
                        <div class="d-flex gap-1 mb-2">
                            <button type="button" id="btnAutoLoadModel" class="btn btn-sm btn-info text-dark fw-semibold flex-fill fs-74">
                                <i class="bi bi-box-arrow-in-down me-1"></i>Load &amp; Activate
                            </button>
                            <button type="button" id="btnAutoDeleteModel" class="btn btn-sm btn-outline-danger fs-74" title="Delete Selected Model">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                        <div class="d-flex justify-content-between align-items-center bg-dark bg-opacity-50 rounded px-2 py-1">
                            <div class="text-truncate me-2">
                                <div id="autoLoadedModelName" class="text-white fw-semibold text-truncate fs-75">No model loaded</div>
                                <div id="autoLoadedModelMeta" class="text-secondary text-truncate fs-66">Load a trained model from Step 2</div>
                            </div>
                            <span id="autoAgentStatusBadge" class="badge bg-secondary fs-66">Idle</span>
                        </div>
                    </div>

<div class="sub-card p-2 mb-2">
                        <div class="d-flex gap-1 mb-2">
                            <button type="button" id="btnAutoStart" class="btn btn-sm btn-success flex-fill fw-semibold fs-74" disabled><i class="bi bi-play-fill me-1"></i>Start</button>
                            <button type="button" id="btnAutoPause" class="btn btn-sm btn-warning text-dark fs-74" disabled><i class="bi bi-pause-fill me-1"></i>Pause</button>
                            <button type="button" id="btnAutoStop" class="btn btn-sm btn-danger fs-74" disabled><i class="bi bi-stop-fill me-1"></i>Stop</button>
                            <button type="button" id="btnAutoResetStats" class="btn btn-sm btn-outline-light fs-74" title="Reset Statistics"><i class="bi bi-arrow-counterclockwise"></i></button>
                        </div>
                        <div class="d-flex justify-content-between align-items-center fs-70">
                            <span class="text-secondary">Confidence Threshold</span>
                            <strong id="valAutoConfThreshold" class="text-info">0.45</strong>
                        </div>
                        <input type="range" id="sliderAutoConfThreshold" class="form-range" min="0.20" max="0.90" step="0.05" value="0.45">
                    </div>

<div class="sub-card p-2 mb-2">
                        <div class="d-flex justify-content-between align-items-center mb-1">
                            <span class="fw-semibold text-light fs-74">Live Policy Predictions</span>
                            <span class="text-secondary fs-68">Latency: <strong id="autoLatencyMs" class="text-cyan">0 ms</strong></span>
                        </div>
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <span id="autoActiveActionBadge" class="badge bg-secondary fs-72">NEUTRAL</span>
                            <span class="text-light fs-72">Confidence: <strong id="autoConfidenceText">0%</strong></span>
                            <span id="autoFallbackBadge" class="badge bg-dark border border-warning text-warning d-none fs-65">Fallback SAFE</span>
                        </div>
                        <div class="d-flex flex-column gap-1">
                            <?php foreach ($actionsMeta as $actId => $meta): ?>
                            <div class="d-flex align-items-center gap-2 fs-66">
                                <span class="text-secondary text-truncate prob-code-label"><?php echo htmlspecialchars($meta['short'], ENT_QUOTES, 'UTF-8'); ?></span>
                                <div class="progress flex-grow-1 prob-progress">
                                    <div id="autoProbBar_<?php echo $actId; ?>" class="progress-bar bg-info progress-zero"></div>
                                </div>
                                <span id="autoProbVal_<?php echo $actId; ?>" class="text-end text-light prob-val-label">0%</span>
                            </div>
                            <?php endforeach; ?>
                        </div>
                    </div>

<div class="sub-card p-2">
                        <div class="row g-1 text-center fs-70">
                            <div class="col-3 bg-dark bg-opacity-50 rounded py-1">
                                <div class="text-secondary">Steps</div>
                                <div id="autoStatsSteps" class="fw-bold text-white">0</div>
                            </div>
                            <div class="col-3 bg-dark bg-opacity-50 rounded py-1">
                                <div class="text-secondary">Cycles</div>
                                <div id="autoStatsCycles" class="fw-bold text-info">0</div>
                            </div>
                            <div class="col-3 bg-dark bg-opacity-50 rounded py-1">
                                <div class="text-secondary">Stability</div>
                                <div id="autoStatsStabilityRate" class="fw-bold text-emerald">100%</div>
                            </div>
                            <div class="col-3 bg-dark bg-opacity-50 rounded py-1">
                                <div class="text-secondary">Avg Lat</div>
                                <div id="autoStatsAvgLatency" class="fw-bold text-warning">0 ms</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</main>

<div class="modal fade" id="studioSettingsModal" tabindex="-1" aria-labelledby="studioSettingsModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-lg modal-dialog-scrollable">
        <div class="modal-content bg-dark text-light border-secondary">
            <div class="modal-header border-secondary py-2">
                <h6 class="modal-title fw-bold" id="studioSettingsModalLabel">
                    <i class="bi bi-sliders text-info me-2"></i>Studio Settings, History &amp; Architecture
                </h6>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
                <ul class="nav nav-tabs border-secondary mb-3 fs-78" id="settingsTabs" role="tablist">
                    <li class="nav-item" role="presentation">
                        <button class="nav-link active" id="tab-cv-btn" data-bs-toggle="tab" data-bs-target="#tabCvPane" type="button" role="tab">CV &amp; Calibration</button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link" id="tab-history-btn" data-bs-toggle="tab" data-bs-target="#tabHistoryPane" type="button" role="tab">Training History</button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link" id="tab-arch-btn" data-bs-toggle="tab" data-bs-target="#tabArchPane" type="button" role="tab">Imitation Architecture</button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link" id="tab-guide-btn" data-bs-toggle="tab" data-bs-target="#tabGuidePane" type="button" role="tab">Guide</button>
                    </li>
                </ul>

<div class="tab-content">
                    <div class="tab-pane fade show active" id="tabCvPane" role="tabpanel">
                        <div class="form-check form-switch mb-3">
                            <input class="form-check-input" type="checkbox" id="chkIlMirror" checked>
                            <label class="form-check-label fs-78" for="chkIlMirror">Mirror Mode (Webcam horizontal flip)</label>
                        </div>
                        <div class="mb-3">
                            <div class="d-flex justify-content-between fs-75">
                                <span>Forward / Backward Lean Threshold</span>
                                <strong id="valIlFwdThresh" class="text-info">0.15</strong>
                            </div>
                            <input type="range" id="sliderIlFwdThresh" class="form-range" min="0.06" max="0.35" step="0.01" value="0.15">
                        </div>
                        <div class="mb-3">
                            <div class="d-flex justify-content-between fs-75">
                                <span>Left / Right Lateral Lean Threshold</span>
                                <strong id="valIlLatThresh" class="text-info">0.18</strong>
                            </div>
                            <input type="range" id="sliderIlLatThresh" class="form-range" min="0.06" max="0.35" step="0.01" value="0.18">
                        </div>
                        <div class="mb-1">
                            <div class="d-flex justify-content-between fs-75">
                                <span>Temporal Pose Smoothing (EMA Alpha)</span>
                                <strong id="valIlSmoothing" class="text-info">0.42</strong>
                            </div>
                            <input type="range" id="sliderIlSmoothing" class="form-range" min="0.15" max="0.80" step="0.05" value="0.42">
                        </div>
                    </div>

<div class="tab-pane fade" id="tabHistoryPane" role="tabpanel">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <span class="text-secondary fs-75">Synchronized with MySQL <code><?php echo htmlspecialchars($dbDiag['database'] ?? 'db_robot_agent', ENT_QUOTES, 'UTF-8'); ?></code></span>
                            <button type="button" id="btnSettingsRefreshHistory" class="btn btn-sm btn-outline-info py-0 px-2 fs-72">Refresh</button>
                        </div>
                        <div id="settingsHistoryContainer" class="fs-75">
                            <div class="text-secondary">Open this tab to load training history...</div>
                        </div>
                    </div>

<div class="tab-pane fade" id="tabArchPane" role="tabpanel">
                        <div class="row g-2 fs-75">
                            <div class="col-md-6">
                                <div class="sub-card p-2 h-100">
                                    <div class="fw-bold text-info mb-1">1. Observation Space (12D Kinematic State)</div>
                                    <ul class="mb-0 ps-3 text-light opacity-75">
                                        <li>Normalized X/Z podium coordinates &amp; heading sine/cosine</li>
                                        <li>Current continuous torso pitch, torso roll, and head yaw</li>
                                        <li>Left/right arm raise, abduction, elbow flexion, and squat depth</li>
                                        <li>Cyclic sequence phase sin(&phi;) &amp; cos(&phi;) for loop reproduction</li>
                                    </ul>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <div class="sub-card p-2 h-100">
                                    <div class="fw-bold text-warning mb-1">2. Dual-Head Behavior Cloning Output</div>
                                    <ul class="mb-0 ps-3 text-light opacity-75">
                                        <li><strong>Policy Head:</strong> 9 discrete human motion classes (Softmax)</li>
                                        <li><strong>Pose Regressor Head:</strong> 10 continuous joint targets (Tanh)</li>
                                        <li>Trained asynchronously in Web Worker via TensorFlow.js</li>
                                        <li><strong>Inference:</strong> Zero webcam required in Step 3 Autonomous mode</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>

<div class="tab-pane fade" id="tabGuidePane" role="tabpanel">
                        <ol class="mb-0 ps-3 text-light opacity-75 fs-76 guide-list">
                            <li><strong>Step 1 (Human Demonstration):</strong> Click <em>Enable Webcam</em> or use the <em>Quick Pose Pad</em> / Keyboard (<code>W/A/S/D/Q/E/R/C/Space</code>). Click <em>Calibrate Neutral</em> while standing upright, then click <em>Record</em> to capture human poses and <em>Save</em> to store into MySQL.</li>
                            <li><strong>Step 2 (Train Behavior Cloning):</strong> Select one or more recorded datasets, click <em>Inspect</em> to verify class balance, adjust epochs/learning rate if needed, click <em>Train Behavior Cloning</em>, and save the trained model to MySQL.</li>
                            <li><strong>Step 3 (Autonomous Agent):</strong> Turn off the webcam if desired, click <em>Load &amp; Activate</em> on your saved BC model, then click <em>Start</em>. The Clone Agent AI humanoid reproduces your demonstrated motion autonomously.</li>
                        </ol>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<div id="studioToastContainer" class="toast-container position-fixed bottom-0 end-0 p-3 studio-toast-container"></div>

<script>
window.BALANCE_AI_BOOT_DATA = <?php echo json_encode([
    'appPath' => APP_PATH,
    'csrfToken' => $data['csrf_token'] ?? '',
    'savedModels' => $data['saved_models'] ?? []
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
</script>
<script src="<?php echo APP_PATH; ?>/public/assets/vendor/bootstrap/js/bootstrap.bundle.min.js?v=<?php echo $assetVer; ?>"></script>
<script src="<?php echo APP_PATH; ?>/public/assets/vendor/three/three.min.js?v=<?php echo $assetVer; ?>"></script>
<script src="<?php echo APP_PATH; ?>/public/assets/vendor/chartjs/chart.umd.min.js?v=<?php echo $assetVer; ?>"></script>
<script src="<?php echo APP_PATH; ?>/public/assets/vendor/tfjs/tf.min.js?v=<?php echo $assetVer; ?>"></script>
<script src="<?php echo APP_PATH; ?>/public/assets/vendor/tfjs/pose-detection.min.js?v=<?php echo $assetVer; ?>"></script>
<script type="module" src="<?php echo APP_PATH; ?>/public/assets/js/imitation/ImitationStudioApp.js?v=<?php echo $assetVer; ?>"></script>
</body>
</html>