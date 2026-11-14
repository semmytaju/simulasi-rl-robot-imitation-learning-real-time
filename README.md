# Clone Agent AI — IMITATION LEARNING (LEARNING BY DEMONSTRATION)

Browser-based 3D humanoid motion imitation studio powered by **MoveNet Lightning** webcam pose capture, **Dual-Head Behavior Cloning** trained in HTML5 Web Workers, and **zero-webcam Autonomous Execution** backed by a custom **PHP 8+ MVC** API and **MySQL/MariaDB** — requiring **no Python** and **no Node.js**.

---

## Technologies Used

| Layer | Technology |
|---|---|
| **Backend & Architecture** | PHP 8+ (Custom MVC Framework), Apache HTTP Server (`mod_rewrite`) |
| **Database & Storage** | MySQL / MariaDB (`db_robot_agent` via `mysqli` & `PDO`), local JSON artifact storage |
| **3D Engine & Kinematics** | Three.js (WebGL) & 35 Hz pure-JavaScript kinematic engine (`MotionLabEngine`) |
| **Computer Vision** | TensorFlow.js Pose Detection (`MoveNet SinglePose Lightning`), HTML5 `MediaDevices` Webcam API & Canvas 2D |
| **Imitation Learning (AI)** | TensorFlow.js (WebGL backend) & HTML5 Web Workers (`Dual-Head Policy + Pose Regressor`) |
| **Frontend UI & Charts** | HTML5, CSS3, Vanilla ES6+ Modules, Bootstrap 5.3.3, Bootstrap Icons 1.11.3, Chart.js 4.4.1 |

---

## System Dependencies

### Server & Browser Requirements
- **Web Server**: Apache HTTP Server with `mod_rewrite` and `mod_headers` enabled (e.g., XAMPP)
- **PHP**: PHP 8.0 or higher with extensions: `mysqli`, `pdo_mysql`, `json`, and `session`
- **Database**: MySQL 5.7+ or MariaDB 10.4+
- **Browser**: Modern browser (Chrome, Edge, or Firefox) with WebGL and ES6 Modules enabled (webcam capture requires `localhost` or HTTPS)
- **No external runtime required**: Runs without Python or Node.js

### Bundled Frontend Libraries (`public/assets/vendor/`)
All client-side dependencies and AI weights are self-hosted locally for offline readiness:
- **Bootstrap**: `5.3.3` (`bootstrap.min.css`, `bootstrap.bundle.min.js`)
- **Bootstrap Icons**: `1.11.3` (`bootstrap-icons.min.css` & fonts)
- **Chart.js**: `4.4.1` (`chart.umd.min.js`)
- **Three.js**: `three.min.js`
- **TensorFlow.js**: `tf.min.js` & `pose-detection.min.js`
- **MoveNet Lightning Model**: `public/assets/vendor/models/movenet-lightning/` (`model.json` & binary shards)

---

## Project Directory Structure

```text
simulasi-rl-imitation-learning-real-time/
├── .htaccess                                 # Root Apache security & URL rewrite rules
├── index.php                                 # Root entry dispatcher
├── README.md
├── app/
│   ├── init.php                              # MVC bootstrap & autoloader
│   ├── config/
│   │   └── config.php                        # App constants & MySQL credentials (db_robot_agent)
│   ├── controller/
│   │   ├── api.php                           # REST endpoints (/api/demonstrations/*, /training/*, /models/*)
│   │   ├── errors.php                        # HTTP error handlers (400, 401, 403, 404, 405, 500, 503)
│   │   ├── landing.php                       # Main Simulation Studio view controller
│   │   └── setup.php                         # Database setup endpoint
│   ├── core/
│   │   ├── App.php                           # Front router & URL parser
│   │   ├── Controller.php                    # Base controller, CSRF & WAF request filtering
│   │   ├── Database.php                      # mysqli / PDO database wrapper & auto-seeder
│   │   └── Security.php                      # Input validation, CSRF tokens & security logging
│   ├── model/
│   │   ├── Imitation_model.php               # Demonstration datasets, training sessions & BC model persistence
│   │   └── Walker_model.php                  # Legacy schema bootstrap & diagnostics helper
│   └── view/
│       ├── errors/index.php                  # Error page template
│       └── landing/index.php                 # Main Imitation Learning Studio UI
├── database/
│   ├── db_robot_agent.sql                    # Base schema (reward_presets, training_sessions, etc.)
│   └── migration_imitation_learning.sql      # Imitation Learning tables (rl_demonstrations, rl_agent_models, etc.)
├── public/
│   ├── .htaccess                             # Public directory security headers & rewrite rules
│   ├── index.php                             # Public MVC entry point
│   └── assets/
│       ├── css/
│       │   ├── errors.css                    # External stylesheet for error pages
│       │   └── studio.css                    # External stylesheet for Simulation Studio
│       ├── js/imitation/
│       │   ├── AutonomousAgent.js            # Zero-webcam Dual-Head BC inference engine
│       │   ├── BehaviorCloningModel.js       # Dataset prep, worker training orchestration & model API sync
│       │   ├── CameraManager.js              # Webcam stream & permission manager
│       │   ├── DatasetManager.js             # REST API client for recorded human demonstrations
│       │   ├── DatasetPreprocessor.js        # Episode-grouped split, feature normalization & joint targets
│       │   ├── DemonstrationRecorder.js      # 8 Hz state-action capture & batch MySQL buffering
│       │   ├── DemonstrationReplay.js        # Timeline playback engine for saved demonstrations
│       │   ├── ImitationLab3DView.js         # Three.js studio scene & articulated 10-joint humanoid robot
│       │   ├── ImitationStudioApp.js         # Main UI coordinator (Steps 1–3, HUD, Quick Pose Pad, Charts)
│       │   ├── ModelEvaluator.js             # Confusion matrix, precision/recall/F1 & collapse diagnostics
│       │   ├── MotionInterpreter.js          # 9-class gesture classifier & continuous joint mapper
│       │   ├── MotionLabEngine.js            # 35 Hz kinematic interpolation & podium locomotion loop
│       │   ├── PoseCalibration.js            # Neutral stance calibration & body-scale normalization
│       │   ├── PoseDetector.js               # MoveNet Lightning WebGL pose loop
│       │   ├── PoseVisualizer.js             # Canvas 2D human skeleton overlay
│       │   ├── RobotActionController.js      # Single-source arbitration (Webcam, Keyboard, Replay, BC Agent)
│       │   ├── StateObserver.js              # 12D kinematic state vector builder
│       │   └── bc-training-worker.js         # Off-main-thread TensorFlow.js training Web Worker
│       └── vendor/                           # Self-hosted Bootstrap, Three.js, Chart.js, TF.js & MoveNet
└── storage/
    ├── .htaccess                             # Denies direct HTTP access to stored artifacts
    └── bc_models/                            # Server-side JSON weights for trained BC models
```

---

## Installation Guide (Local / XAMPP)

1. **Place Project Folder**
   Copy or clone this repository into your XAMPP `htdocs` folder, for example:
   ```text
   C:\xampp\htdocs\REINFORCEMENTLEARNING\simulasi-rl-imitation-learning-real-time
   ```

2. **Start Apache & MySQL**
   Open **XAMPP Control Panel** and start both **Apache** and **MySQL** (`mod_rewrite` is enabled by default in XAMPP Apache).

3. **Verify Database Configuration**
   Check `app/config/config.php` and update credentials if your local MySQL setup differs:
   ```php
   define("HOST_DB", "localhost");
   define("NAME_DB", "db_robot_agent");
   define("USER_DB", "root");
   define("PASS_DB", "");
   ```

4. **Database Initialization**
   - The application automatically creates `db_robot_agent` and imports `database/db_robot_agent.sql` and `database/migration_imitation_learning.sql` on first request when MySQL is running.
   - *(Optional manual import)* Create database `db_robot_agent` in phpMyAdmin and import `database/db_robot_agent.sql` followed by `database/migration_imitation_learning.sql`.
   - Ensure the directory `storage/bc_models/` is writable by Apache/PHP so trained models can be saved.

5. **Run the Application**
   Open your browser and visit:
   ```text
   http://localhost/REINFORCEMENTLEARNING/simulasi-rl-imitation-learning-real-time/
   ```
   *(Use `localhost` or HTTPS so your browser allows optional webcam access for Human Demonstration mode.)*
