<?php

class api extends Controller {

    private Imitation_model $imitation;

    public function __construct() {
        parent::__construct();
        $this->start_default_session_app();
        $this->imitation = $this->logic('Imitation_model');
    }

    public function index() {
        $this->json_response([
            'success' => true,
            'service' => 'Clone Agent AI — Imitation Learning REST API',
            'endpoints' => [
                'demonstrations' => ['create', 'save-batch', 'list', 'detail', 'replay', 'delete', 'annotate'],
                'training' => ['create', 'update-metrics', 'complete', 'history'],
                'models' => ['upload', 'list', 'activate', 'download', 'delete']
            ]
        ]);
    }

    public function demonstrations($subAction = 'list', $idParam = null) {
        $action = $this->normalizeAction($subAction);
        $this->enforceRateLimit('demonstrations', 240, 60);

        if (!$this->imitation->isReady()) {
            $this->json_response(['success' => false, 'message' => 'Database tidak terhubung.'], 503);
        }

        switch ($action) {
            case 'create': {
                $this->requireMethod('POST');
                $payload = $this->readJsonPayload();
                $this->requireCsrf($payload);
                $res = $this->imitation->createDemonstration($payload);
                $this->json_response($res, $res['success'] ? 201 : 400);
                break;
            }

            case 'save-batch':
            case 'save_batch': {
                $this->requireMethod('POST');
                $payload = $this->readJsonPayload();
                $this->requireCsrf($payload);
                $demoId = (int)($payload['demonstration_id'] ?? 0);
                $transitions = $payload['transitions'] ?? null;
                $summary = is_array($payload['summary'] ?? null) ? $payload['summary'] : null;
                if ($demoId <= 0 || !is_array($transitions)) {
                    $this->json_response(['success' => false, 'message' => 'Payload demonstration_id dan transitions wajib valid.'], 400);
                }
                $res = $this->imitation->saveTransitionsBatch($demoId, $transitions, $summary);
                $this->json_response($res, $res['success'] ? 200 : 400);
                break;
            }

            case 'list': {
                $limit = (int)($this->safe_get('limit', 50, 'int'));
                $offset = (int)($this->safe_get('offset', 0, 'int'));
                $list = $this->imitation->listDemonstrations($limit, $offset);
                $this->json_response(['success' => true, 'demonstrations' => $list]);
                break;
            }

            case 'detail': {
                $demoId = (int)($idParam ?? $this->safe_get('id', 0, 'int'));
                $demo = $this->imitation->getDemonstrationSummary($demoId);
                if (!$demo) {
                    $this->json_response(['success' => false, 'message' => 'Demonstrasi tidak ditemukan.'], 404);
                }
                $annotations = $this->imitation->getAnnotations($demoId);
                $this->json_response([
                    'success' => true,
                    'demonstration' => $demo,
                    'annotations' => $annotations
                ]);
                break;
            }

            case 'replay': {
                $demoId = (int)($idParam ?? $this->safe_get('id', 0, 'int'));
                $demo = $this->imitation->getDemonstrationSummary($demoId);
                if (!$demo) {
                    $this->json_response(['success' => false, 'message' => 'Demonstrasi tidak ditemukan.'], 404);
                }
                $limit = (int)($this->safe_get('limit', 500, 'int'));
                $offset = (int)($this->safe_get('offset', 0, 'int'));
                $transitions = $this->imitation->getDemonstrationTransitions($demoId, $limit, $offset);
                $this->json_response([
                    'success' => true,
                    'demonstration' => $demo,
                    'transitions' => $transitions
                ]);
                break;
            }

            case 'annotate': {
                $this->requireMethod('POST');
                $payload = $this->readJsonPayload();
                $this->requireCsrf($payload);
                $res = $this->imitation->addAnnotation($payload);
                $this->json_response($res, $res['success'] ? 201 : 400);
                break;
            }

            case 'delete': {
                $this->requireMethod('POST');
                $payload = $this->readJsonPayload();
                $this->requireCsrf($payload);
                $demoId = (int)($payload['demonstration_id'] ?? ($idParam ?? 0));
                $res = $this->imitation->deleteDemonstration($demoId);
                $this->json_response([
                    'success' => $res['success'],
                    'message' => $res['success'] ? 'Demonstrasi berhasil dihapus.' : 'Demonstrasi tidak ditemukan.'
                ], $res['success'] ? 200 : 404);
                break;
            }

            default:
                $this->json_response(['success' => false, 'message' => 'Endpoint demonstrasi tidak dikenali.'], 404);
        }
    }

    public function training($subAction = 'history', $idParam = null) {
        $action = $this->normalizeAction($subAction);
        $this->enforceRateLimit('training', 300, 60);

        if (!$this->imitation->isReady()) {
            $this->json_response(['success' => false, 'message' => 'Database tidak terhubung.'], 503);
        }

        switch ($action) {
            case 'create': {
                $this->requireMethod('POST');
                $payload = $this->readJsonPayload();
                $this->requireCsrf($payload);
                $res = $this->imitation->createTrainingSession($payload);
                $this->json_response($res, $res['success'] ? 201 : 400);
                break;
            }

            case 'update-metrics':
            case 'update_metrics': {
                $this->requireMethod('POST');
                $payload = $this->readJsonPayload();
                $this->requireCsrf($payload);
                $res = $this->imitation->updateTrainingMetrics($payload);
                $this->json_response($res, $res['success'] ? 200 : 400);
                break;
            }

            case 'complete': {
                $this->requireMethod('POST');
                $payload = $this->readJsonPayload();
                $this->requireCsrf($payload);
                $res = $this->imitation->completeTrainingSession($payload);
                $this->json_response($res, $res['success'] ? 200 : 400);
                break;
            }

            case 'history': {
                $limit = (int)($this->safe_get('limit', 30, 'int'));
                $history = $this->imitation->getTrainingHistory($limit);
                $this->json_response(['success' => true, 'training_sessions' => $history]);
                break;
            }

            default:
                $this->json_response(['success' => false, 'message' => 'Endpoint training tidak dikenali.'], 404);
        }
    }

    public function models($subAction = 'list', $idParam = null) {
        $action = $this->normalizeAction($subAction);
        $this->enforceRateLimit('models', 120, 60);

        if (!$this->imitation->isReady()) {
            $this->json_response(['success' => false, 'message' => 'Database tidak terhubung.'], 503);
        }

        switch ($action) {
            case 'upload': {
                $this->requireMethod('POST');
                $payload = $this->readJsonPayload();
                $this->requireCsrf($payload);
                $res = $this->imitation->uploadModel($payload);
                $this->json_response($res, $res['success'] ? 201 : 400);
                break;
            }

            case 'list': {
                $models = $this->imitation->listModels();
                $this->json_response(['success' => true, 'models' => $models]);
                break;
            }

            case 'activate': {
                $this->requireMethod('POST');
                $payload = $this->readJsonPayload();
                $this->requireCsrf($payload);
                $modelId = (int)($payload['model_id'] ?? ($idParam ?? 0));
                $res = $this->imitation->activateModel($modelId);
                $this->json_response($res, $res['success'] ? 200 : 404);
                break;
            }

            case 'download': {
                $modelId = (int)($idParam ?? $this->safe_get('id', 0, 'int'));
                $artifact = $this->imitation->loadModelArtifact($modelId);
                if (!$artifact) {
                    $this->json_response(['success' => false, 'message' => 'Model Behavior Cloning tidak ditemukan.'], 404);
                }
                $this->json_response(['success' => true, 'model' => $artifact]);
                break;
            }

            case 'delete': {
                $this->requireMethod('POST');
                $payload = $this->readJsonPayload();
                $this->requireCsrf($payload);
                $modelId = (int)($payload['model_id'] ?? ($idParam ?? 0));
                $res = $this->imitation->deleteModel($modelId);
                $this->json_response($res, $res['success'] ? 200 : 404);
                break;
            }

            default:
                $this->json_response(['success' => false, 'message' => 'Endpoint model tidak dikenali.'], 404);
        }
    }

    private function normalizeAction($subAction): string {
        $act = strtolower(trim((string)$subAction));
        if (substr($act, -4) === '.php') {
            $act = substr($act, 0, -4);
        }
        return $act;
    }

    private function requireMethod(string $method): void {
        if (strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET') !== strtoupper($method)) {
            $this->json_response(['success' => false, 'message' => "Metode HTTP harus $method."], 405);
        }
    }

    private function readJsonPayload(): array {
        $raw = file_get_contents('php://input');
        if ($raw === false || trim($raw) === '') {
            return $_POST;
        }
        $decoded = json_decode($raw, true);
        if (json_last_error() !== JSON_ERROR_NONE || !is_array($decoded)) {
            $this->json_response(['success' => false, 'message' => 'Format JSON request tidak valid.'], 400);
        }
        if (Security::detect_rce_payload($decoded)) {
            Security::log_incident('API_JSON_RCE_VECTOR', substr($raw, 0, 300), 'Blocked');
            $this->json_response(['success' => false, 'message' => 'Payload ditolak oleh filter keamanan.'], 400);
        }
        return $decoded;
    }

    private function requireCsrf(array $payload = []): void {
        $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($payload['csrf_token'] ?? ($_POST['csrf_token'] ?? ''));
        if (!$this->verify_csrf_token($token)) {
            $this->json_response(['success' => false, 'message' => 'Token CSRF tidak valid atau sesi telah berakhir. Muat ulang halaman.'], 403);
        }
    }

    private function enforceRateLimit(string $bucket, int $maxRequests, int $windowSec): void {
        $now = time();
        if (!isset($_SESSION['api_rate_limit']) || !is_array($_SESSION['api_rate_limit'])) {
            $_SESSION['api_rate_limit'] = [];
        }
        $records = $_SESSION['api_rate_limit'][$bucket] ?? [];
        $records = array_values(array_filter($records, static fn($ts) => ($now - (int)$ts) < $windowSec));
        if (count($records) >= $maxRequests) {
            $this->json_response(['success' => false, 'message' => 'Terlalu banyak permintaan API. Coba lagi sebentar.'], 429);
        }
        $records[] = $now;
        $_SESSION['api_rate_limit'][$bucket] = $records;
    }
}
