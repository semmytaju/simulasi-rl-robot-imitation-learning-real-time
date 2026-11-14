<?php


if (!defined('APP_PATH')) {
    if (php_sapi_name() === 'cli' || empty($_SERVER['HTTP_HOST'])) {
        $folderName = basename(dirname(__DIR__, 2));
        define("APP_PATH", "http://localhost/" . $folderName);
    } else {
        $is_https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (isset($_SERVER['SERVER_PORT']) && $_SERVER['SERVER_PORT'] == 443);
        $protocol = $is_https ? 'https://' : 'http://';
        $host = $_SERVER['HTTP_HOST'];
        $scriptDir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/');
        $cleanDir = preg_replace('#/public$#', '', $scriptDir);
        define("APP_PATH", $protocol . $host . $cleanDir);
    }
}

if (!defined('BASEPATH')) {
    define('BASEPATH', dirname(__DIR__, 2));
}

define("HOST_DB", "localhost");
define("NAME_DB", "db_robot_agent");
define("USER_DB", "root");
define("PASS_DB", "");

define("APP_NAME", "Clone Agent AI — IMITATION LEARNING (LEARNING BY DEMONSTRATION)");
define("APP_SHORT_NAME", "Clone Agent AI");
define("APP_DESC", "Clone Agent AI — IMITATION LEARNING (LEARNING BY DEMONSTRATION): Real-Time Humanoid Motion Imitation Simulation with MoveNet Webcam & Dual-Head Behavior Cloning");
define("APP_VERSION", "3.0.0");
define("APP_AUTHOR", "Laboratorium Kecerdasan Buatan & Robotika");

define('APP_ENC_KEY', hash('sha256', 'ROBOFLAG_AI_RL_CTF_SECRET_KEY_2026', true));
define('APP_BIDX_KEY', hash('sha256', 'ROBOFLAG_AI_RL_CTF_BLIND_INDEX_2026', true));
