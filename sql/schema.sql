CREATE TABLE IF NOT EXISTS profiles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  category ENUM('staff', 'vip', 'blocked', 'guest') NOT NULL DEFAULT 'guest',
  consent TINYINT(1) NOT NULL DEFAULT 1,
  embedding_json JSON NOT NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS detections (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  profile_id BIGINT UNSIGNED NULL,
  camera_label VARCHAR(120) NOT NULL DEFAULT 'entrada-principal',
  distance DOUBLE NULL,
  confidence DOUBLE NULL,
  matched TINYINT(1) NOT NULL DEFAULT 0,
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_detections_created_at (created_at),
  INDEX idx_detections_matched (matched),
  CONSTRAINT fk_detections_profile FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE SET NULL
);
