<?php
$assetVer = '20261114';
$code = isset($data['code']) ? (int)$data['code'] : 404;
$statusTitle = htmlspecialchars($data['status_title'] ?? 'Error', ENT_QUOTES, 'UTF-8');
$message = htmlspecialchars($data['message'] ?? 'An error occurred while processing your request.', ENT_QUOTES, 'UTF-8');
$referenceId = htmlspecialchars($data['reference_id'] ?? ('ERR-' . $code), ENT_QUOTES, 'UTF-8');
$uri = htmlspecialchars($data['uri'] ?? ($_SERVER['REQUEST_URI'] ?? '/'), ENT_QUOTES, 'UTF-8');
$timestamp = htmlspecialchars($data['timestamp'] ?? date('d M Y H:i:s'), ENT_QUOTES, 'UTF-8');
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo htmlspecialchars($data['title'] ?? "$code - $statusTitle", ENT_QUOTES, 'UTF-8'); ?></title>
    <link rel="stylesheet" href="<?php echo APP_PATH; ?>/public/assets/vendor/bootstrap/css/bootstrap.min.css?v=<?php echo $assetVer; ?>">
    <link rel="stylesheet" href="<?php echo APP_PATH; ?>/public/assets/vendor/bootstrap-icons/bootstrap-icons.min.css?v=<?php echo $assetVer; ?>">
    <link rel="stylesheet" href="<?php echo APP_PATH; ?>/public/assets/css/errors.css?v=<?php echo $assetVer; ?>">
</head>
<body class="p-3 p-md-4">
<div class="container">
    <div class="row justify-content-center">
        <div class="col-12 col-md-9 col-lg-7">
            <div class="error-card">
                <div class="d-flex align-items-center gap-3 mb-4">
                    <div class="rounded-circle bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center error-brand-icon">
                        <i class="bi bi-robot fs-4"></i>
                    </div>
                    <div>
                        <div class="fw-bold text-dark error-brand-title">Clone Agent AI</div>
                        <div class="text-secondary error-brand-subtitle">IMITATION LEARNING (LEARNING BY DEMONSTRATION)</div>
                    </div>
                </div>

<div class="text-center mb-4">
                    <div class="rounded-circle bg-danger bg-opacity-10 text-danger d-inline-flex align-items-center justify-content-center mb-3 error-hero-icon">
                        <i class="bi bi-exclamation-triangle-fill fs-2"></i>
                    </div>
                    <h1 class="display-5 fw-bold text-dark mb-1"><?php echo $code; ?></h1>
                    <h2 class="h5 fw-semibold text-secondary mb-3"><?php echo $statusTitle; ?></h2>
                    <p class="text-muted mb-0"><?php echo $message; ?></p>
                </div>

<div class="bg-light rounded-3 p-3 mb-4 small code-font">
                    <div class="d-flex justify-content-between py-1 border-bottom">
                        <span class="text-secondary">Reference ID</span>
                        <span class="fw-semibold text-dark"><?php echo $referenceId; ?></span>
                    </div>
                    <div class="d-flex justify-content-between py-1 border-bottom">
                        <span class="text-secondary">Request URI</span>
                        <span class="fw-semibold text-dark text-truncate ms-3"><?php echo $uri; ?></span>
                    </div>
                    <div class="d-flex justify-content-between py-1">
                        <span class="text-secondary">Timestamp</span>
                        <span class="fw-semibold text-dark"><?php echo $timestamp; ?></span>
                    </div>
                </div>

<div class="d-flex justify-content-center gap-2 flex-wrap">
                    <a href="<?php echo APP_PATH; ?>/" class="btn btn-primary px-4">
                        <i class="bi bi-house-door-fill me-1"></i>Back to Simulation Studio
                    </a>
                    <button type="button" class="btn btn-outline-secondary px-4" onclick="window.history.back()">
                        <i class="bi bi-arrow-left me-1"></i>Previous Page
                    </button>
                </div>
            </div>
        </div>
    </div>
</div>
</body>
</html>