use tauri_plugin_sql::{Migration, MigrationKind};

pub fn get_migrations() -> Vec<Migration> {
    vec![
    Migration {
        version: 1,
        description: "initial schema",
        sql: r#"
            CREATE TABLE IF NOT EXISTS downloads (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                gid         TEXT,
                url         TEXT NOT NULL,
                filename    TEXT NOT NULL,
                source      TEXT,
                model_type  TEXT NOT NULL,
                target_dir  TEXT NOT NULL,
                file_size   INTEGER,
                status      TEXT NOT NULL DEFAULT 'pending',
                progress    REAL DEFAULT 0,
                speed       INTEGER DEFAULT 0,
                hash        TEXT,
                error_msg   TEXT,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME
            );

            CREATE TABLE IF NOT EXISTS dir_mappings (
                model_type  TEXT PRIMARY KEY,
                directory   TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS rules (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                rule_type   TEXT NOT NULL,
                keyword     TEXT NOT NULL,
                model_type  TEXT NOT NULL,
                priority    INTEGER DEFAULT 0,
                enabled     INTEGER DEFAULT 1,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            INSERT OR IGNORE INTO settings (key, value) VALUES
                ('comfyui_root', ''),
                ('comfyui_server', 'http://127.0.0.1:8188'),
                ('aria2_max_concurrent', '3'),
                ('aria2_max_connections', '16'),
                ('proxy', ''),
                ('civitai_api_token', ''),
                ('duplicate_strategy', 'skip'),
                ('download_speed_limit', '0'),
                ('auto_verify_comfyui', 'false');
        "#,
        kind: MigrationKind::Up,
    },
    Migration {
        version: 2,
        description: "add model_base_dir setting",
        sql: r#"
            INSERT OR IGNORE INTO settings (key, value) VALUES ('model_base_dir', '');
        "#,
        kind: MigrationKind::Up,
    },
    Migration {
        version: 3,
        description: "add theme setting",
        sql: r#"
            INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'system');
        "#,
        kind: MigrationKind::Up,
    },
    Migration {
        version: 4,
        description: "add language setting",
        sql: r#"
            INSERT OR IGNORE INTO settings (key, value) VALUES ('language', 'en');
        "#,
        kind: MigrationKind::Up,
    },
    ]
}
