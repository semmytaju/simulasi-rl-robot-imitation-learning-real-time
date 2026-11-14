-- =====================================================================
-- MIGRATION: Imitation Learning (Behavior Cloning) Tables
-- Target Database: db_robot_agent (configured in app/config/config.php)
-- Safe execution: Does NOT delete or alter any existing DQN tables.
-- =====================================================================

CREATE TABLE IF NOT EXISTS `rl_demonstrations` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `demo_code` VARCHAR(64) NOT NULL UNIQUE,
  `session_id` INT NULL,
  `title` VARCHAR(160) NOT NULL,
  `demonstrator_name` VARCHAR(100) NOT NULL DEFAULT 'Mahasiswa Demonstrator',
  `input_source` ENUM('webcam', 'keyboard', 'hybrid') NOT NULL DEFAULT 'webcam',
  `flag_corner_code` VARCHAR(10) NOT NULL DEFAULT 'NE',
  `episode_count` INT NOT NULL DEFAULT 1,
  `total_steps` INT NOT NULL DEFAULT 0,
  `total_reward` DOUBLE NOT NULL DEFAULT 0.0,
  `success_episodes` INT NOT NULL DEFAULT 0,
  `success_rate` DOUBLE NOT NULL DEFAULT 0.0,
  `avg_confidence` DOUBLE NOT NULL DEFAULT 0.0,
  `state_dim` INT NOT NULL DEFAULT 12,
  `action_dim` INT NOT NULL DEFAULT 5,
  `sample_rate_hz` DOUBLE NOT NULL DEFAULT 8.0,
  `calibration_json` LONGTEXT NULL,
  `action_distribution_json` LONGTEXT NULL,
  `status` ENUM('recording', 'saved', 'archived') NOT NULL DEFAULT 'saved',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_demo_status_created` (`status`, `created_at`),
  CONSTRAINT `fk_rl_demo_session` FOREIGN KEY (`session_id`)
    REFERENCES `training_sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `rl_demo_transitions` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `demonstration_id` INT NOT NULL,
  `episode_id` INT NOT NULL DEFAULT 1,
  `step_number` INT NOT NULL,
  `timestamp_ms` BIGINT NOT NULL,
  `state_json` LONGTEXT NOT NULL,
  `action` TINYINT NOT NULL,
  `confidence` DOUBLE NOT NULL DEFAULT 1.0,
  `reward` DOUBLE NOT NULL DEFAULT 0.0,
  `next_state_json` LONGTEXT NOT NULL,
  `done` TINYINT(1) NOT NULL DEFAULT 0,
  `flag_corner` VARCHAR(10) NOT NULL DEFAULT 'NE',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_demo_ep_step` (`demonstration_id`, `episode_id`, `step_number`),
  INDEX `idx_demo_action` (`demonstration_id`, `action`),
  CONSTRAINT `fk_rl_trans_demo` FOREIGN KEY (`demonstration_id`)
    REFERENCES `rl_demonstrations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `rl_training_sessions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `training_code` VARCHAR(64) NOT NULL UNIQUE,
  `demonstration_ids_json` LONGTEXT NOT NULL,
  `model_name` VARCHAR(150) NOT NULL DEFAULT 'BC-Robot-Navigator',
  `architecture_json` LONGTEXT NOT NULL,
  `hyperparams_json` LONGTEXT NOT NULL,
  `normalization_json` LONGTEXT NOT NULL,
  `total_samples` INT NOT NULL DEFAULT 0,
  `train_samples` INT NOT NULL DEFAULT 0,
  `val_samples` INT NOT NULL DEFAULT 0,
  `epochs_planned` INT NOT NULL DEFAULT 50,
  `epochs_completed` INT NOT NULL DEFAULT 0,
  `final_loss` DOUBLE NULL,
  `final_val_loss` DOUBLE NULL,
  `final_accuracy` DOUBLE NULL,
  `final_val_accuracy` DOUBLE NULL,
  `confusion_matrix_json` LONGTEXT NULL,
  `class_distribution_json` LONGTEXT NULL,
  `status` ENUM('running', 'completed', 'cancelled', 'failed') NOT NULL DEFAULT 'running',
  `error_message` TEXT NULL,
  `started_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `completed_at` TIMESTAMP NULL DEFAULT NULL,
  INDEX `idx_bc_train_status` (`status`, `started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `rl_training_metrics` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `training_session_id` INT NOT NULL,
  `epoch` INT NOT NULL,
  `loss` DOUBLE NOT NULL,
  `accuracy` DOUBLE NOT NULL,
  `val_loss` DOUBLE NULL,
  `val_accuracy` DOUBLE NULL,
  `learning_rate` DOUBLE NULL,
  `recorded_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_bc_metrics_epoch` (`training_session_id`, `epoch`),
  CONSTRAINT `fk_rl_metric_session` FOREIGN KEY (`training_session_id`)
    REFERENCES `rl_training_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `rl_agent_models` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `model_code` VARCHAR(64) NOT NULL UNIQUE,
  `training_session_id` INT NULL,
  `model_name` VARCHAR(150) NOT NULL,
  `version` VARCHAR(32) NOT NULL DEFAULT '1.0.0',
  `algorithm` VARCHAR(40) NOT NULL DEFAULT 'BEHAVIOR_CLONING',
  `state_dim` INT NOT NULL DEFAULT 12,
  `action_dim` INT NOT NULL DEFAULT 5,
  `architecture_json` LONGTEXT NOT NULL,
  `normalization_json` LONGTEXT NOT NULL,
  `metrics_json` LONGTEXT NULL,
  `file_path` VARCHAR(255) NOT NULL,
  `file_size_bytes` INT NOT NULL DEFAULT 0,
  `checksum_sha256` VARCHAR(64) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_bc_model_active` (`is_active`, `created_at`),
  CONSTRAINT `fk_rl_model_train` FOREIGN KEY (`training_session_id`)
    REFERENCES `rl_training_sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `rl_demo_annotations` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `demonstration_id` INT NOT NULL,
  `episode_id` INT NOT NULL DEFAULT 1,
  `step_start` INT NOT NULL DEFAULT 0,
  `step_end` INT NOT NULL DEFAULT 0,
  `label` VARCHAR(80) NOT NULL,
  `notes` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_anno_demo_ep` (`demonstration_id`, `episode_id`),
  CONSTRAINT `fk_rl_anno_demo` FOREIGN KEY (`demonstration_id`)
    REFERENCES `rl_demonstrations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
