<?php


class Database {

	private $server_name = HOST_DB;
	private $db_name     = NAME_DB;
	private $user_name   = USER_DB;
	private $password    = PASS_DB;

	private $con = null;
	private $pdo = null;
	private $stmt = null;
	private $query_sql = "";
	private $bind_params = [];
	private $last_result = null;

	private $is_connected = false;
	private $connection_error = "";
	private $active_password_used = "";

	public function __construct($customDbName = null){
		if ($customDbName !== null) {
			$this->db_name = $customDbName;
		}
		$this->init_connection();
	}

	public function init_connection(){
		$this->is_connected = false;
		$this->connection_error = "";

		$passwords_to_try = array_unique([$this->password, "", "12345", "root"]);
		$lastError = "";

		foreach ($passwords_to_try as $pwd) {
			try {

				$conn = @new mysqli($this->server_name, $this->user_name, $pwd, $this->db_name);
				if (!$conn->connect_error) {
					$this->con = $conn;
					$this->active_password_used = $pwd;
					$this->is_connected = true;
					$this->connection_error = "";
					break;
				} else {
					$lastError = $conn->connect_error;
				}

				$connServer = @new mysqli($this->server_name, $this->user_name, $pwd);
				if (!$connServer->connect_error) {

					$dbCheck = $connServer->select_db($this->db_name);
					if (!$dbCheck) {

						$createDb = @$connServer->query("CREATE DATABASE IF NOT EXISTS `" . $this->db_name . "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
						if ($createDb && @$connServer->select_db($this->db_name)) {
							$this->con = $connServer;
							$this->active_password_used = $pwd;
							$this->is_connected = true;
							$this->connection_error = "";
							break;
						} else {
							$lastError = "Database '" . $this->db_name . "' belum dibuat di server MySQL. Silakan buat melalui phpMyAdmin atau gunakan tombol Auto Setup.";
						}
					} else {
						$this->con = $connServer;
						$this->active_password_used = $pwd;
						$this->is_connected = true;
						$this->connection_error = "";
						break;
					}
				} else {
					$lastError = $connServer->connect_error;
				}
			} catch (Throwable $e) {
				$lastError = $e->getMessage();
			}
		}

		if ($this->is_connected && $this->con) {
			@$this->con->set_charset("utf8mb4");
		} else {
			$this->connection_error = !empty($lastError) ? $lastError : "Tidak dapat terhubung ke MySQL pada " . $this->server_name . ". Pastikan modul MySQL di XAMPP berstatus RUNNING.";
		}
	}

	public function ensure_connected(){
		try {
			if (!$this->con || !@$this->con->ping()) {
				$this->init_connection();
			}
		} catch (Throwable $e) {
			$this->init_connection();
		}
	}

	public function isConnected(){
		return $this->is_connected && ($this->con instanceof mysqli);
	}

	public function getConnectionError(){
		return $this->connection_error;
	}

	public function getDatabaseName(){
		return $this->db_name;
	}

	public function getConnection(){
		$this->ensure_connected();
		return $this->con;
	}

	public function getPdo(){
		if ($this->pdo instanceof PDO) {
			return $this->pdo;
		}

		$pwd = $this->active_password_used ?: $this->password;
		try {
			$dsn = "mysql:host=" . $this->server_name . ";dbname=" . $this->db_name . ";charset=utf8mb4";
			$this->pdo = new PDO($dsn, $this->user_name, $pwd, [
				PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
				PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
				PDO::ATTR_EMULATE_PREPARES => false
			]);
			return $this->pdo;
		} catch (PDOException $e) {
			return null;
		}
	}

	public function getTables(){
		if (!$this->isConnected()) return [];
		$tables = [];
		try {
			$res = $this->con->query("SHOW TABLES");
			if ($res) {
				while ($row = $res->fetch_row()) {
					$tables[] = $row[0];
				}
			}
		} catch (Throwable $e) {}
		return $tables;
	}

	public function hasTable($tableName){
		$tables = $this->getTables();
		return in_array($tableName, $tables);
	}

	public function getTableRowCount($tableName){
		if (!$this->isConnected() || !$this->hasTable($tableName)) return 0;
		try {
			$safeName = str_replace('`', '', $tableName);
			$res = $this->con->query("SELECT COUNT(*) AS total FROM `" . $safeName . "`");
			if ($res && ($row = $res->fetch_assoc())) {
				return (int)$row['total'];
			}
		} catch (Throwable $e) {}
		return 0;
	}

	public function getDiagnostics(){
		$tables = $this->getTables();
		$defaultTables = ['reward_presets', 'training_sessions', 'episode_logs', 'saved_models', 'competition_leaderboard'];
		$missingTables = array_diff($defaultTables, $tables);
		$serverVersion = ($this->con) ? @$this->con->server_info : null;

		return [
			'is_connected' => $this->isConnected(),
			'host' => $this->server_name,
			'database' => $this->db_name,
			'user' => $this->user_name,
			'error_message' => $this->connection_error,
			'server_version' => $serverVersion,
			'tables' => $tables,
			'total_tables' => count($tables),
			'default_tables' => $defaultTables,
			'missing_tables' => array_values($missingTables),
			'is_schema_ready' => empty($missingTables) && count($tables) > 0,
			'episodes_count' => $this->getTableRowCount('episode_logs'),
			'models_count' => $this->getTableRowCount('saved_models'),
			'leaderboard_count' => $this->getTableRowCount('competition_leaderboard')
		];
	}

	public function importSqlFile($sqlFilePath){
		if (!file_exists($sqlFilePath)) {
			return ['success' => false, 'message' => "Berkas SQL tidak ditemukan pada: " . htmlspecialchars($sqlFilePath)];
		}

		$sqlContent = file_get_contents($sqlFilePath);
		if (empty(trim($sqlContent))) {
			return ['success' => false, 'message' => "Berkas SQL kosong."];
		}

		$pwd = $this->active_password_used ?: $this->password;
		$passwords = array_unique([$pwd, "", "12345", "root"]);
		$conn = null;

		foreach ($passwords as $p) {
			try {
				$c = @new mysqli($this->server_name, $this->user_name, $p);
				if (!$c->connect_error) {
					$conn = $c;
					break;
				}
			} catch (Throwable $e) {}
		}

		if (!$conn) {
			return ['success' => false, 'message' => "Gagal terhubung ke MySQL server untuk proses import."];
		}

		$conn->set_charset("utf8mb4");

		if ($conn->multi_query($sqlContent)) {
			$statementCount = 0;
			do {
				if ($res = $conn->store_result()) {
					$res->free();
				}
				$statementCount++;
			} while ($conn->more_results() && $conn->next_result());

			$this->init_connection();
			return [
				'success' => true,
				'statements' => $statementCount,
				'message' => "Database dan tabel default berhasil diimpor ($statementCount blok pernyataan dieksekusi)."
			];
		} else {
			return ['success' => false, 'message' => "Error saat eksekusi SQL: " . $conn->error];
		}
	}

	public function query($sql){
		$this->query_sql = $sql;
		$this->bind_params = [];
		$this->stmt = null;

		if (preg_match('/:[a-zA-Z_][a-zA-Z0-9_]*/', $sql)) {
			return $this;
		}

		$this->ensure_connected();

		if ($this->con) {
			$this->last_result = $this->con->query($sql);
			return $this->last_result;
		}
		return false;
	}

	public function prepare($sql){
		$this->query_sql = $sql;
		$this->bind_params = [];
		return $this;
	}

	public function bind($param, $value, $type = null){
		$paramName = ltrim($param, ':');
		$this->bind_params[$paramName] = $value;
		return $this;
	}

	public function execute(){
		if (!$this->con) return false;

		$sql = $this->query_sql;

		if (!empty($this->bind_params)) {
			foreach ($this->bind_params as $key => $val) {
				if ($val === null) {
					$escaped = "NULL";
				} elseif (is_numeric($val) && !is_string($val)) {
					$escaped = $val;
				} else {
					$escaped = "'" . $this->con->real_escape_string((string)$val) . "'";
				}
				$sql = preg_replace_callback('/:' . preg_quote($key, '/') . '\b/', function() use ($escaped) {
					return $escaped;
				}, $sql);
			}
		}

		$this->last_result = $this->con->query($sql);
		return ($this->last_result !== false);
	}

	public function resultSet(){
		$this->execute();
		if ($this->last_result instanceof mysqli_result) {
			$rows = [];
			while ($row = $this->last_result->fetch_assoc()) {
				$rows[] = $row;
			}
			return $rows;
		}
		return [];
	}

	public function single(){
		$this->execute();
		if ($this->last_result instanceof mysqli_result) {
			$row = $this->last_result->fetch_assoc();
			return $row ?: null;
		}
		return null;
	}

	public function rowCount(){
		if ($this->last_result instanceof mysqli_result) {
			return $this->last_result->num_rows;
		}
		if ($this->con) {
			return $this->con->affected_rows;
		}
		return 0;
	}

	public function lastInsertId(){
		return $this->con ? $this->con->insert_id : 0;
	}

	public function db_close(){
		if ($this->con) {
			@$this->con->close();
			$this->con = null;
		}
		$this->is_connected = false;
	}

	public function my_real_escape_string($string){
		$this->ensure_connected();
		if ($this->con && $string !== null) {
			return $this->con->real_escape_string($string);
		}
		return addslashes((string)$string);
	}

	public function beginTransaction(){
		if ($this->con) $this->con->begin_transaction();
	}

	public function commit(){
		if ($this->con) $this->con->commit();
	}

	public function rollBack(){
		if ($this->con) $this->con->rollback();
	}
}
