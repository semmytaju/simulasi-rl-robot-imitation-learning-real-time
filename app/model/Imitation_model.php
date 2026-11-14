<?php

class Imitation_model {
    private Database $db;
    private ?PDO $pdo = null;
    private string $storageDir;

    private const MAX_BATCH_SIZE = 500;
    private const MAX_MODEL_BYTES = 10485760;

    public function __construct() {
        $this->db = new Database();
        $this->storageDir = BASEPATH . '/storage/bc_models';
        $this->ensureStorageDirectory();
        if ($this->db->isConnected()) {
            $this->pdo = $this->db->getPdo();
            $this->ensureImitationSchema();
        }
    }

    public function isReady(): bool {
        return $this->pdo instanceof PDO;
    }

    private function ensureStorageDirectory(): void {
        if (!is_dir($this->storageDir)) {
            @mkdir($this->storageDir, 0750, true);
        }
    }

    public function ensureImitationSchema(): void {
        if (!$this->pdo) return;
        $required = [
            'rl_demonstrations',
            'rl_demo_transitions',
            'rl_training_sessions',
            'rl_training_metrics',
            'rl_agent_models',
            'rl_demo_annotations'
        ];
        $existing = $this->db->getTables();
        $missing = array_diff($required, $existing);
        if (empty($missing)) {
            return;
        }

        $sqlFile = BASEPATH . '/database/migration_imitation_learning.sql';
        if (!file_exists($sqlFile)) return;

        $sql = file_get_contents($sqlFile);
        if (!$sql) return;

        $statements = array_filter(array_map('trim', explode(';', $sql)));
        foreach ($statements as $stmtSql) {
            if ($stmtSql === '' || strpos($stmtSql, '--') === 0) {
                $lines = array_filter(
                    explode("\n", $stmtSql),
                    static fn($l) => trim($l) !== '' && strpos(trim($l), '--') !== 0
                );
                $stmtSql = trim(implode("\n", $lines));
                if ($stmtSql === '') continue;
            }
            $this->pdo->exec($stmtSql);
        }
    }

    public function createDemonstration(array $payload): array {
        if (!$this->pdo) {
            return ['success' => false, 'message' => 'Koneksi PDO database tidak tersedia.'];
        }

        $demoCode = 'DEMO-' . strtoupper(bin2hex(random_bytes(4)));
        $sessionId = !empty($payload['session_id']) ? (int)$payload['session_id'] : null;
        $title = $this->cleanText($payload['title'] ?? 'Human Demonstration', 160);
        $demonstrator = $this->cleanText($payload['demonstrator_name'] ?? 'Mahasiswa Demonstrator', 100);
        $inputSource = strtolower(trim((string)($payload['input_source'] ?? 'webcam')));
        if (!in_array($inputSource, ['webcam', 'keyboard', 'hybrid'], true)) {
            $inputSource = 'webcam';
        }
        $corner = strtoupper(trim((string)($payload['flag_corner_code'] ?? 'NE')));
        if (!in_array($corner, ['NE', 'NW', 'SE', 'SW'], true)) {
            $corner = 'NE';
        }
        $stateDim = max(1, min(64, (int)($payload['state_dim'] ?? 12)));
        $actionDim = max(2, min(16, (int)($payload['action_dim'] ?? 5)));
        $sampleRate = max(1.0, min(60.0, (float)($payload['sample_rate_hz'] ?? 8.0)));
        $calibrationJson = isset($payload['calibration_json']) && $payload['calibration_json'] !== null
            ? json_encode($payload['calibration_json'], JSON_UNESCAPED_UNICODE)
            : null;

        if ($sessionId !== null) {
            $chk = $this->pdo->prepare("SELECT id FROM training_sessions WHERE id = :sid LIMIT 1");
            $chk->execute([':sid' => $sessionId]);
            if (!$chk->fetch()) {
                $sessionId = null;
            }
        }

        $stmt = $this->pdo->prepare(
            "INSERT INTO rl_demonstrations
            (demo_code, session_id, title, demonstrator_name, input_source, flag_corner_code,
             state_dim, action_dim, sample_rate_hz, calibration_json, action_distribution_json, status)
            VALUES
            (:code, :sid, :title, :demo_name, :src, :corner, :sdim, :adim, :hz, :calib, :dist, 'recording')"
        );
        $stmt->execute([
            ':code' => $demoCode,
            ':sid' => $sessionId,
            ':title' => $title,
            ':demo_name' => $demonstrator,
            ':src' => $inputSource,
            ':corner' => $corner,
            ':sdim' => $stateDim,
            ':adim' => $actionDim,
            ':hz' => $sampleRate,
            ':calib' => $calibrationJson,
            ':dist' => json_encode([0, 0, 0, 0, 0])
        ]);

        return [
            'success' => true,
            'demonstration_id' => (int)$this->pdo->lastInsertId(),
            'demo_code' => $demoCode
        ];
    }

    public function saveTransitionsBatch(int $demoId, array $transitions, ?array $summary = null): array {
        if (!$this->pdo) {
            return ['success' => false, 'message' => 'Koneksi PDO database tidak tersedia.'];
        }
        if ($demoId <= 0) {
            return ['success' => false, 'message' => 'demonstration_id tidak valid.'];
        }
        if (count($transitions) > self::MAX_BATCH_SIZE) {
            return ['success' => false, 'message' => 'Ukuran batch melebihi batas maksimum (' . self::MAX_BATCH_SIZE . ').'];
        }

        $demoStmt = $this->pdo->prepare("SELECT id, state_dim, action_dim FROM rl_demonstrations WHERE id = :id LIMIT 1");
        $demoStmt->execute([':id' => $demoId]);
        $demo = $demoStmt->fetch();
        if (!$demo) {
            return ['success' => false, 'message' => 'Dataset demonstrasi tidak ditemukan.'];
        }

        $expectedStateDim = (int)$demo['state_dim'];
        $maxActionId = ((int)$demo['action_dim']) - 1;

        $validated = [];
        foreach ($transitions as $idx => $row) {
            if (!is_array($row)) {
                return ['success' => false, 'message' => "Format transisi indeks $idx tidak valid."];
            }
            $action = filter_var($row['action'] ?? null, FILTER_VALIDATE_INT);
            if ($action === false || $action < 0 || $action > $maxActionId) {
                return ['success' => false, 'message' => "Action ID pada indeks $idx di luar rentang [0..$maxActionId]."];
            }
            $state = $row['state'] ?? null;
            $nextState = $row['next_state'] ?? null;
            if (!$this->isValidNumericVector($state, $expectedStateDim) || !$this->isValidNumericVector($nextState, $expectedStateDim)) {
                return ['success' => false, 'message' => "Dimensi vektor state pada indeks $idx harus $expectedStateDim angka valid."];
            }

            $episodeId = max(1, (int)($row['episode_id'] ?? 1));
            $stepNumber = max(1, (int)($row['step_number'] ?? ($idx + 1)));
            $tsMs = max(0, (int)($row['timestamp'] ?? (int)(microtime(true) * 1000)));
            $confidence = max(0.0, min(1.0, (float)($row['confidence'] ?? 1.0)));
            $reward = (float)($row['reward'] ?? 0.0);
            if (!is_finite($reward)) $reward = 0.0;
            $done = !empty($row['done']) ? 1 : 0;
            $corner = strtoupper(trim((string)($row['flag_corner'] ?? 'NE')));
            if (!in_array($corner, ['NE', 'NW', 'SE', 'SW'], true)) $corner = 'NE';

            $validated[] = [
                ':demo_id' => $demoId,
                ':ep_id' => $episodeId,
                ':step' => $stepNumber,
                ':ts' => $tsMs,
                ':state' => json_encode(array_map(static fn($v) => round((float)$v, 5), $state)),
                ':action' => (int)$action,
                ':conf' => round($confidence, 4),
                ':rew' => round($reward, 4),
                ':nstate' => json_encode(array_map(static fn($v) => round((float)$v, 5), $nextState)),
                ':done' => $done,
                ':corner' => $corner
            ];
        }

        try {
            $this->pdo->beginTransaction();

            if (!empty($validated)) {
                $ins = $this->pdo->prepare(
                    "INSERT INTO rl_demo_transitions
                    (demonstration_id, episode_id, step_number, timestamp_ms, state_json, action, confidence, reward, next_state_json, done, flag_corner)
                    VALUES
                    (:demo_id, :ep_id, :step, :ts, :state, :action, :conf, :rew, :nstate, :done, :corner)"
                );
                foreach ($validated as $params) {
                    $ins->execute($params);
                }
            }

            $this->recomputeDemonstrationStats($demoId, $summary);

            $this->pdo->commit();
            return [
                'success' => true,
                'inserted' => count($validated),
                'demonstration' => $this->getDemonstrationSummary($demoId)
            ];
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            return ['success' => false, 'message' => 'Gagal menyimpan batch transisi: ' . $e->getMessage()];
        }
    }

    private function recomputeDemonstrationStats(int $demoId, ?array $summary = null): void {
        $aggStmt = $this->pdo->prepare(
            "SELECT
                COUNT(*) AS total_steps,
                COALESCE(MAX(episode_id), 1) AS max_ep,
                COALESCE(SUM(reward), 0) AS total_reward,
                COALESCE(AVG(confidence), 0) AS avg_conf
            FROM rl_demo_transitions WHERE demonstration_id = :id"
        );
        $aggStmt->execute([':id' => $demoId]);
        $agg = $aggStmt->fetch() ?: ['total_steps' => 0, 'max_ep' => 1, 'total_reward' => 0, 'avg_conf' => 0];

        $dimStmt = $this->pdo->prepare("SELECT action_dim FROM rl_demonstrations WHERE id = :id LIMIT 1");
        $dimStmt->execute([':id' => $demoId]);
        $actionDim = max(5, min(16, (int)($dimStmt->fetchColumn() ?: 9)));

        $distStmt = $this->pdo->prepare(
            "SELECT action, COUNT(*) AS cnt FROM rl_demo_transitions WHERE demonstration_id = :id GROUP BY action"
        );
        $distStmt->execute([':id' => $demoId]);
        $dist = array_fill(0, $actionDim, 0);
        foreach ($distStmt->fetchAll() as $row) {
            $a = (int)$row['action'];
            if ($a >= 0 && $a < $actionDim) $dist[$a] = (int)$row['cnt'];
        }

        $epCount = max((int)$agg['max_ep'], (int)($summary['episode_count'] ?? 1));
        $succEp = isset($summary['success_episodes']) ? max(0, (int)$summary['success_episodes']) : 0;
        $succRate = $epCount > 0 ? round(($succEp / $epCount) * 100, 1) : 0.0;
        $status = ($summary && isset($summary['status']) && in_array($summary['status'], ['recording', 'saved', 'archived'], true))
            ? $summary['status']
            : 'saved';

        $upd = $this->pdo->prepare(
            "UPDATE rl_demonstrations SET
                episode_count = :ep_cnt,
                total_steps = :steps,
                total_reward = :rew,
                success_episodes = :succ_ep,
                success_rate = :succ_rate,
                avg_confidence = :conf,
                action_distribution_json = :dist,
                status = :status
            WHERE id = :id"
        );
        $upd->execute([
            ':ep_cnt' => $epCount,
            ':steps' => (int)$agg['total_steps'],
            ':rew' => round((float)$agg['total_reward'], 2),
            ':succ_ep' => $succEp,
            ':succ_rate' => $succRate,
            ':conf' => round((float)$agg['avg_conf'], 3),
            ':dist' => json_encode($dist),
            ':status' => $status,
            ':id' => $demoId
        ]);
    }

    public function listDemonstrations(int $limit = 50, int $offset = 0): array {
        if (!$this->pdo) return [];
        $limit = max(1, min(200, $limit));
        $offset = max(0, $offset);
        $stmt = $this->pdo->prepare(
            "SELECT id, demo_code, session_id, title, demonstrator_name, input_source, flag_corner_code,
                    episode_count, total_steps, total_reward, success_episodes, success_rate, avg_confidence,
                    state_dim, action_dim, sample_rate_hz, action_distribution_json, status, created_at
             FROM rl_demonstrations
             ORDER BY id DESC LIMIT :lim OFFSET :off"
        );
        $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
        $stmt->bindValue(':off', $offset, PDO::PARAM_INT);
        $stmt->execute();
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) {
            $r['action_distribution'] = json_decode((string)($r['action_distribution_json'] ?? '[0,0,0,0,0]'), true) ?: [0, 0, 0, 0, 0];
        }
        return $rows;
    }

    public function getDemonstrationSummary(int $demoId): ?array {
        if (!$this->pdo) return null;
        $stmt = $this->pdo->prepare("SELECT * FROM rl_demonstrations WHERE id = :id LIMIT 1");
        $stmt->execute([':id' => $demoId]);
        $row = $stmt->fetch();
        if (!$row) return null;
        $row['action_distribution'] = json_decode((string)($row['action_distribution_json'] ?? '[0,0,0,0,0]'), true) ?: [0, 0, 0, 0, 0];
        $row['calibration'] = json_decode((string)($row['calibration_json'] ?? 'null'), true);
        return $row;
    }

    public function getDemonstrationTransitions(int $demoId, int $limit = 500, int $offset = 0): array {
        if (!$this->pdo) return [];
        $limit = max(1, min(1000, $limit));
        $offset = max(0, $offset);
        $stmt = $this->pdo->prepare(
            "SELECT id, demonstration_id, episode_id, step_number, timestamp_ms,
                    state_json, action, confidence, reward, next_state_json, done, flag_corner
             FROM rl_demo_transitions
             WHERE demonstration_id = :id
             ORDER BY episode_id ASC, step_number ASC, id ASC
             LIMIT :lim OFFSET :off"
        );
        $stmt->bindValue(':id', $demoId, PDO::PARAM_INT);
        $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
        $stmt->bindValue(':off', $offset, PDO::PARAM_INT);
        $stmt->execute();
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) {
            $r['state'] = json_decode($r['state_json'], true);
            $r['next_state'] = json_decode($r['next_state_json'], true);
            $r['action'] = (int)$r['action'];
            $r['episode_id'] = (int)$r['episode_id'];
            $r['step_number'] = (int)$r['step_number'];
            $r['confidence'] = (float)$r['confidence'];
            $r['reward'] = (float)$r['reward'];
            $r['done'] = (int)$r['done'];
            unset($r['state_json'], $r['next_state_json']);
        }
        return $rows;
    }

    public function getAnnotations(int $demoId): array {
        if (!$this->pdo) return [];
        $stmt = $this->pdo->prepare("SELECT * FROM rl_demo_annotations WHERE demonstration_id = :id ORDER BY id DESC");
        $stmt->execute([':id' => $demoId]);
        return $stmt->fetchAll();
    }

    public function addAnnotation(array $payload): array {
        if (!$this->pdo) return ['success' => false, 'message' => 'Database tidak terhubung.'];
        $demoId = (int)($payload['demonstration_id'] ?? 0);
        if ($demoId <= 0) return ['success' => false, 'message' => 'demonstration_id tidak valid.'];

        $stmt = $this->pdo->prepare(
            "INSERT INTO rl_demo_annotations (demonstration_id, episode_id, step_start, step_end, label, notes)
             VALUES (:did, :ep, :s1, :s2, :lbl, :notes)"
        );
        $stmt->execute([
            ':did' => $demoId,
            ':ep' => max(1, (int)($payload['episode_id'] ?? 1)),
            ':s1' => max(0, (int)($payload['step_start'] ?? 0)),
            ':s2' => max(0, (int)($payload['step_end'] ?? 0)),
            ':lbl' => $this->cleanText($payload['label'] ?? 'Catatan Demonstrasi', 80),
            ':notes' => $this->cleanText($payload['notes'] ?? '', 500)
        ]);
        return ['success' => true, 'annotation_id' => (int)$this->pdo->lastInsertId()];
    }

    public function deleteDemonstration(int $demoId): array {
        if (!$this->pdo) return ['success' => false, 'message' => 'Database tidak terhubung.'];
        $stmt = $this->pdo->prepare("DELETE FROM rl_demonstrations WHERE id = :id");
        $stmt->execute([':id' => $demoId]);
        return ['success' => $stmt->rowCount() > 0];
    }

    public function createTrainingSession(array $payload): array {
        if (!$this->pdo) return ['success' => false, 'message' => 'Database tidak terhubung.'];

        $code = 'BCT-' . strtoupper(bin2hex(random_bytes(4)));
        $demoIds = is_array($payload['demonstration_ids'] ?? null) ? array_map('intval', $payload['demonstration_ids']) : [];
        $modelName = $this->cleanText($payload['model_name'] ?? 'BC-Robot-Navigator', 150);
        $arch = json_encode($payload['architecture'] ?? ['inputDim' => 12, 'hiddenLayers' => [128, 64], 'outputActions' => 5]);
        $hyper = json_encode($payload['hyperparams'] ?? ['epochs' => 50, 'batchSize' => 32, 'learningRate' => 0.001]);
        $norm = json_encode($payload['normalization'] ?? []);

        $stmt = $this->pdo->prepare(
            "INSERT INTO rl_training_sessions
            (training_code, demonstration_ids_json, model_name, architecture_json, hyperparams_json, normalization_json,
             total_samples, train_samples, val_samples, epochs_planned, class_distribution_json, status)
            VALUES
            (:code, :dids, :mname, :arch, :hyper, :norm, :tot, :trn, :val, :ep, :cdist, 'running')"
        );
        $stmt->execute([
            ':code' => $code,
            ':dids' => json_encode($demoIds),
            ':mname' => $modelName,
            ':arch' => $arch,
            ':hyper' => $hyper,
            ':norm' => $norm,
            ':tot' => max(0, (int)($payload['total_samples'] ?? 0)),
            ':trn' => max(0, (int)($payload['train_samples'] ?? 0)),
            ':val' => max(0, (int)($payload['val_samples'] ?? 0)),
            ':ep' => max(1, (int)($payload['epochs_planned'] ?? 50)),
            ':cdist' => json_encode($payload['class_distribution'] ?? [0, 0, 0, 0, 0])
        ]);

        return [
            'success' => true,
            'training_session_id' => (int)$this->pdo->lastInsertId(),
            'training_code' => $code
        ];
    }

    public function updateTrainingMetrics(array $payload): array {
        if (!$this->pdo) return ['success' => false, 'message' => 'Database tidak terhubung.'];
        $sid = (int)($payload['training_session_id'] ?? 0);
        if ($sid <= 0) return ['success' => false, 'message' => 'training_session_id tidak valid.'];

        $metrics = $payload['metrics'] ?? [$payload];
        if (!is_array($metrics)) $metrics = [];

        try {
            $this->pdo->beginTransaction();
            $ins = $this->pdo->prepare(
                "INSERT INTO rl_training_metrics (training_session_id, epoch, loss, accuracy, val_loss, val_accuracy, learning_rate)
                 VALUES (:sid, :ep, :loss, :acc, :vloss, :vacc, :lr)"
            );
            $maxEp = 0;
            foreach ($metrics as $m) {
                $ep = max(1, (int)($m['epoch'] ?? 1));
                $maxEp = max($maxEp, $ep);
                $ins->execute([
                    ':sid' => $sid,
                    ':ep' => $ep,
                    ':loss' => round((float)($m['loss'] ?? 0), 6),
                    ':acc' => round((float)($m['accuracy'] ?? 0), 6),
                    ':vloss' => isset($m['val_loss']) && $m['val_loss'] !== null ? round((float)$m['val_loss'], 6) : null,
                    ':vacc' => isset($m['val_accuracy']) && $m['val_accuracy'] !== null ? round((float)$m['val_accuracy'], 6) : null,
                    ':lr' => isset($m['learning_rate']) ? (float)$m['learning_rate'] : null
                ]);
            }

            if ($maxEp > 0) {
                $upd = $this->pdo->prepare("UPDATE rl_training_sessions SET epochs_completed = GREATEST(epochs_completed, :ep) WHERE id = :sid");
                $upd->execute([':ep' => $maxEp, ':sid' => $sid]);
            }
            $this->pdo->commit();
            return ['success' => true];
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            return ['success' => false, 'message' => $e->getMessage()];
        }
    }

    public function completeTrainingSession(array $payload): array {
        if (!$this->pdo) return ['success' => false, 'message' => 'Database tidak terhubung.'];
        $sid = (int)($payload['training_session_id'] ?? 0);
        if ($sid <= 0) return ['success' => false, 'message' => 'training_session_id tidak valid.'];

        $status = strtolower(trim((string)($payload['status'] ?? 'completed')));
        if (!in_array($status, ['completed', 'cancelled', 'failed'], true)) {
            $status = 'completed';
        }

        $stmt = $this->pdo->prepare(
            "UPDATE rl_training_sessions SET
                epochs_completed = :ep,
                final_loss = :loss,
                final_val_loss = :vloss,
                final_accuracy = :acc,
                final_val_accuracy = :vacc,
                confusion_matrix_json = :cm,
                status = :status,
                error_message = :err,
                completed_at = CURRENT_TIMESTAMP
             WHERE id = :id"
        );
        $stmt->execute([
            ':ep' => max(0, (int)($payload['epochs_completed'] ?? 0)),
            ':loss' => isset($payload['final_loss']) ? round((float)$payload['final_loss'], 6) : null,
            ':vloss' => isset($payload['final_val_loss']) && $payload['final_val_loss'] !== null ? round((float)$payload['final_val_loss'], 6) : null,
            ':acc' => isset($payload['final_accuracy']) ? round((float)$payload['final_accuracy'], 6) : null,
            ':vacc' => isset($payload['final_val_accuracy']) && $payload['final_val_accuracy'] !== null ? round((float)$payload['final_val_accuracy'], 6) : null,
            ':cm' => isset($payload['confusion_matrix']) ? json_encode($payload['confusion_matrix']) : null,
            ':status' => $status,
            ':err' => !empty($payload['error_message']) ? $this->cleanText($payload['error_message'], 500) : null,
            ':id' => $sid
        ]);

        return ['success' => true];
    }

    public function getTrainingHistory(int $limit = 30): array {
        if (!$this->pdo) return [];
        $limit = max(1, min(100, $limit));
        $stmt = $this->pdo->prepare("SELECT * FROM rl_training_sessions ORDER BY id DESC LIMIT :lim");
        $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll();
    }

    public function uploadModel(array $payload): array {
        if (!$this->pdo) return ['success' => false, 'message' => 'Database tidak terhubung.'];

        $modelArtifact = $payload['model_artifact'] ?? null;
        if (!is_array($modelArtifact) || empty($modelArtifact['weights']) || !is_array($modelArtifact['weights'])) {
            return ['success' => false, 'message' => 'Payload bobot model Behavior Cloning tidak valid.'];
        }

        foreach (['weights', 'poseWeights'] as $weightKey) {
            if ($weightKey === 'poseWeights' && empty($modelArtifact[$weightKey])) continue;
            if (!is_array($modelArtifact[$weightKey])) {
                return ['success' => false, 'message' => "Struktur $weightKey model tidak valid."];
            }
            foreach ($modelArtifact[$weightKey] as $wIdx => $tensor) {
                if (!is_array($tensor) || empty($tensor['shape']) || !is_array($tensor['data'])) {
                    return ['success' => false, 'message' => "Struktur tensor bobot $weightKey #$wIdx tidak valid."];
                }
                foreach ($tensor['data'] as $val) {
                    if (!is_numeric($val) || !is_finite((float)$val)) {
                        return ['success' => false, 'message' => "Nilai tensor $weightKey #$wIdx mengandung angka tidak valid."];
                    }
                }
            }
        }

        $serializedArtifact = json_encode($modelArtifact, JSON_UNESCAPED_UNICODE);
        if ($serializedArtifact === false || strlen($serializedArtifact) > self::MAX_MODEL_BYTES) {
            return ['success' => false, 'message' => 'Ukuran file model melebihi batas maksimum 10 MB.'];
        }

        $this->ensureStorageDirectory();
        $modelCode = 'BCMDL-' . strtoupper(bin2hex(random_bytes(4)));
        $safeFileName = preg_replace('/[^A-Za-z0-9_\-]/', '', $modelCode) . '.json';
        $fullPath = $this->storageDir . '/' . $safeFileName;

        if (file_put_contents($fullPath, $serializedArtifact, LOCK_EX) === false) {
            return ['success' => false, 'message' => 'Gagal menulis file model ke penyimpanan terproteksi.'];
        }

        $checksum = hash('sha256', $serializedArtifact);
        $fileSize = strlen($serializedArtifact);

        $trainSessionId = !empty($payload['training_session_id']) ? (int)$payload['training_session_id'] : null;
        if ($trainSessionId !== null) {
            $chk = $this->pdo->prepare("SELECT id FROM rl_training_sessions WHERE id = :tid LIMIT 1");
            $chk->execute([':tid' => $trainSessionId]);
            if (!$chk->fetch()) $trainSessionId = null;
        }

        $modelName = $this->cleanText($payload['model_name'] ?? 'BC Agent Model', 150);
        $version = $this->cleanText($payload['version'] ?? '1.0.0', 32);
        $stateDim = max(1, min(64, (int)($payload['state_dim'] ?? ($modelArtifact['architecture']['inputDim'] ?? 12))));
        $actionDim = max(2, min(16, (int)($payload['action_dim'] ?? ($modelArtifact['architecture']['outputActions'] ?? 5))));
        $archJson = json_encode($payload['architecture'] ?? ($modelArtifact['architecture'] ?? []));
        $normJson = json_encode($payload['normalization'] ?? ($modelArtifact['normalization'] ?? []));
        $metricsJson = json_encode($payload['metrics'] ?? []);
        $activateNow = !empty($payload['activate']);

        try {
            $this->pdo->beginTransaction();
            if ($activateNow) {
                $this->pdo->exec("UPDATE rl_agent_models SET is_active = 0");
            }
            $ins = $this->pdo->prepare(
                "INSERT INTO rl_agent_models
                (model_code, training_session_id, model_name, version, algorithm, state_dim, action_dim,
                 architecture_json, normalization_json, metrics_json, file_path, file_size_bytes, checksum_sha256, is_active)
                VALUES
                (:code, :tid, :mname, :ver, 'BEHAVIOR_CLONING', :sdim, :adim, :arch, :norm, :met, :fpath, :fsize, :sha, :act)"
            );
            $ins->execute([
                ':code' => $modelCode,
                ':tid' => $trainSessionId,
                ':mname' => $modelName,
                ':ver' => $version,
                ':sdim' => $stateDim,
                ':adim' => $actionDim,
                ':arch' => $archJson,
                ':norm' => $normJson,
                ':met' => $metricsJson,
                ':fpath' => 'storage/bc_models/' . $safeFileName,
                ':fsize' => $fileSize,
                ':sha' => $checksum,
                ':act' => $activateNow ? 1 : 0
            ]);
            $modelId = (int)$this->pdo->lastInsertId();
            $this->pdo->commit();

            return [
                'success' => true,
                'model_id' => $modelId,
                'model_code' => $modelCode,
                'models' => $this->listModels()
            ];
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            @unlink($fullPath);
            return ['success' => false, 'message' => 'Gagal mencatat metadata model: ' . $e->getMessage()];
        }
    }

    public function listModels(): array {
        if (!$this->pdo) return [];
        $stmt = $this->pdo->query(
            "SELECT id, model_code, training_session_id, model_name, version, algorithm,
                    state_dim, action_dim, architecture_json, normalization_json, metrics_json,
                    file_size_bytes, checksum_sha256, is_active, created_at
             FROM rl_agent_models
             ORDER BY is_active DESC, id DESC"
        );
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) {
            $r['architecture'] = json_decode((string)$r['architecture_json'], true) ?: [];
            $r['normalization'] = json_decode((string)$r['normalization_json'], true) ?: [];
            $r['metrics'] = json_decode((string)($r['metrics_json'] ?? '{}'), true) ?: [];
            $r['is_active'] = (int)$r['is_active'];
            unset($r['architecture_json'], $r['normalization_json'], $r['metrics_json']);
        }
        return $rows;
    }

    public function activateModel(int $modelId): array {
        if (!$this->pdo) return ['success' => false, 'message' => 'Database tidak terhubung.'];
        $chk = $this->pdo->prepare("SELECT id FROM rl_agent_models WHERE id = :id LIMIT 1");
        $chk->execute([':id' => $modelId]);
        if (!$chk->fetch()) {
            return ['success' => false, 'message' => 'Model Behavior Cloning tidak ditemukan.'];
        }

        try {
            $this->pdo->beginTransaction();
            $this->pdo->exec("UPDATE rl_agent_models SET is_active = 0");
            $upd = $this->pdo->prepare("UPDATE rl_agent_models SET is_active = 1 WHERE id = :id");
            $upd->execute([':id' => $modelId]);
            $this->pdo->commit();
            return ['success' => true, 'active_model_id' => $modelId, 'models' => $this->listModels()];
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            return ['success' => false, 'message' => $e->getMessage()];
        }
    }

    public function loadModelArtifact(int $modelId): ?array {
        if (!$this->pdo) return null;
        $stmt = $this->pdo->prepare("SELECT * FROM rl_agent_models WHERE id = :id LIMIT 1");
        $stmt->execute([':id' => $modelId]);
        $row = $stmt->fetch();
        if (!$row) return null;

        $baseReal = realpath($this->storageDir);
        $candidate = realpath(BASEPATH . '/' . ltrim($row['file_path'], '/'));
        if (!$baseReal || !$candidate || strpos($candidate, $baseReal) !== 0 || !file_exists($candidate)) {
            return null;
        }

        $raw = file_get_contents($candidate);
        $artifact = json_decode((string)$raw, true);
        if (!is_array($artifact)) return null;

        return [
            'id' => (int)$row['id'],
            'model_code' => $row['model_code'],
            'model_name' => $row['model_name'],
            'version' => $row['version'],
            'state_dim' => (int)$row['state_dim'],
            'action_dim' => (int)$row['action_dim'],
            'metrics' => json_decode((string)($row['metrics_json'] ?? '{}'), true) ?: [],
            'artifact' => $artifact
        ];
    }

    public function deleteModel(int $modelId): array {
        if (!$this->pdo) return ['success' => false, 'message' => 'Database tidak terhubung.'];
        $stmt = $this->pdo->prepare("SELECT id, file_path FROM rl_agent_models WHERE id = :id LIMIT 1");
        $stmt->execute([':id' => $modelId]);
        $row = $stmt->fetch();
        if (!$row) return ['success' => false, 'message' => 'Model tidak ditemukan.'];

        $del = $this->pdo->prepare("DELETE FROM rl_agent_models WHERE id = :id");
        $del->execute([':id' => $modelId]);

        $baseReal = realpath($this->storageDir);
        $candidate = realpath(BASEPATH . '/' . ltrim($row['file_path'], '/'));
        if ($baseReal && $candidate && strpos($candidate, $baseReal) === 0 && file_exists($candidate)) {
            @unlink($candidate);
        }

        return ['success' => true, 'models' => $this->listModels()];
    }

    private function isValidNumericVector($vec, int $expectedDim): bool {
        if (!is_array($vec) || count($vec) !== $expectedDim) {
            return false;
        }
        foreach ($vec as $v) {
            if (!is_numeric($v) || !is_finite((float)$v)) {
                return false;
            }
        }
        return true;
    }

    private function cleanText($input, int $maxLen = 160): string {
        $cleaned = Security::sanitize_string((string)$input);
        if (function_exists('mb_substr')) {
            return mb_substr($cleaned, 0, $maxLen, 'UTF-8');
        }
        return substr($cleaned, 0, $maxLen);
    }
}
