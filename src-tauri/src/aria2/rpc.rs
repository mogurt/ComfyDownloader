use futures_util::{SinkExt, StreamExt};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::task::AbortHandle;
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Aria2Status {
    pub gid: String,
    pub status: String,
    #[serde(rename = "totalLength")]
    pub total_length: Option<String>,
    #[serde(rename = "completedLength")]
    pub completed_length: Option<String>,
    #[serde(rename = "downloadSpeed")]
    pub download_speed: Option<String>,
    #[serde(rename = "errorCode")]
    pub error_code: Option<String>,
    #[serde(rename = "errorMessage")]
    pub error_message: Option<String>,
    pub dir: Option<String>,
    pub files: Option<Vec<Aria2File>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Aria2File {
    pub path: Option<String>,
    pub length: Option<String>,
    pub uris: Option<Vec<Aria2Uri>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Aria2Uri {
    pub uri: Option<String>,
    pub status: Option<String>,
}

type PendingRequests = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;

/// One live websocket. `id` lets tasks of an old socket recognise that they
/// have been superseded, so they never tear down a newer connection.
struct Connection {
    id: u64,
    tx: mpsc::Sender<String>,
    tasks: Vec<AbortHandle>,
}

#[derive(Clone)]
pub struct Aria2Rpc {
    port: u16,
    secret: String,
    conn: Arc<Mutex<Option<Connection>>>,
    next_conn_id: Arc<AtomicU64>,
    pending: PendingRequests,
    request_id: Arc<Mutex<u64>>,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
    connect_lock: Arc<Mutex<()>>,
}

impl Aria2Rpc {
    pub fn new(port: u16, secret: String) -> Self {
        Self {
            port,
            secret,
            conn: Arc::new(Mutex::new(None)),
            next_conn_id: Arc::new(AtomicU64::new(1)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            request_id: Arc::new(Mutex::new(0)),
            app_handle: Arc::new(Mutex::new(None)),
            connect_lock: Arc::new(Mutex::new(())),
        }
    }

    pub async fn connect(&self, app_handle: AppHandle) -> Result<(), String> {
        {
            let mut guard = self.app_handle.lock().await;
            *guard = Some(app_handle.clone());
        }
        self.connect_socket(app_handle).await
    }

    async fn connect_socket(&self, app_handle: AppHandle) -> Result<(), String> {
        let _connect_guard = self.connect_lock.lock().await;
        if self.conn.lock().await.is_some() {
            return Ok(());
        }

        let url = format!("ws://127.0.0.1:{}/jsonrpc", self.port);
        info!("Connecting to aria2 RPC at {}", url);

        let (ws_stream, _) = connect_async(&url)
            .await
            .map_err(|e| format!("Failed to connect to aria2 RPC: {}", e))?;

        let (mut write, mut read) = ws_stream.split();
        let (tx, mut rx) = mpsc::channel::<String>(100);
        let conn_id = self.next_conn_id.fetch_add(1, Ordering::SeqCst);

        let rpc_for_writer = self.clone();
        let pending = self.pending.clone();
        let app = app_handle.clone();
        let rpc_for_reader = self.clone();

        let writer = tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if let Err(e) = write.send(Message::Text(msg.into())).await {
                    error!("Failed to send to aria2: {}", e);
                    rpc_for_writer.clear_connection(conn_id).await;
                    break;
                }
            }
            let _ = write.close().await;
        });

        let reader = tokio::spawn(async move {
            while let Some(Ok(msg)) = read.next().await {
                if let Message::Text(text) = msg {
                    let text_str: &str = text.as_ref();
                    if let Ok(value) = serde_json::from_str::<Value>(text_str) {
                        if let Some(id) = value.get("id").and_then(|v| v.as_str()) {
                            let mut guard = pending.lock().await;
                            if let Some(sender) = guard.remove(id) {
                                let _ = sender.send(value);
                            }
                        } else if let Some(method) = value.get("method").and_then(|v| v.as_str()) {
                            handle_notification(&app, method, &value);
                        }
                    }
                }
            }
            warn!("aria2 WebSocket connection {} closed", conn_id);
            rpc_for_reader.clear_connection(conn_id).await;
        });

        *self.conn.lock().await = Some(Connection {
            id: conn_id,
            tx,
            tasks: vec![writer.abort_handle(), reader.abort_handle()],
        });

        info!("Connected to aria2 RPC (connection {})", conn_id);
        Ok(())
    }

    /// Drops connection `conn_id` if it is still the current one. Stale callers
    /// (tasks of an already replaced socket) are ignored.
    async fn clear_connection(&self, conn_id: u64) {
        let conn = {
            let mut guard = self.conn.lock().await;
            match guard.as_ref() {
                Some(c) if c.id == conn_id => guard.take(),
                _ => return,
            }
        };

        // Fail in-flight requests fast instead of letting each one time out.
        self.pending.lock().await.clear();

        // May abort the calling task itself, so this must be the last step.
        if let Some(conn) = conn {
            for task in conn.tasks {
                task.abort();
            }
        }
    }

    async fn ensure_connected(&self) -> Result<(), String> {
        if self.conn.lock().await.is_some() {
            return Ok(());
        }

        let app_handle = {
            let guard = self.app_handle.lock().await;
            guard
                .as_ref()
                .cloned()
                .ok_or_else(|| "aria2 app handle is unavailable".to_string())?
        };

        self.connect_socket(app_handle).await
    }

    async fn next_id(&self) -> String {
        let mut id = self.request_id.lock().await;
        *id += 1;
        format!("req-{}", *id)
    }

    async fn call(&self, method: &str, params: Vec<Value>) -> Result<Value, String> {
        self.ensure_connected().await?;

        let id = self.next_id().await;
        let mut full_params = vec![json!(format!("token:{}", self.secret))];
        full_params.extend(params);

        let request = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": full_params,
        });

        let (resp_tx, resp_rx) = oneshot::channel();
        {
            let mut guard = self.pending.lock().await;
            guard.insert(id.clone(), resp_tx);
        }

        let sender = {
            let guard = self.conn.lock().await;
            guard.as_ref().map(|c| (c.id, c.tx.clone()))
        };
        let conn_id = if let Some((conn_id, tx)) = sender {
            if let Err(e) = tx.send(request.to_string()).await {
                self.pending.lock().await.remove(&id);
                self.clear_connection(conn_id).await;
                return Err(format!("Failed to send RPC request: {}", e));
            }
            conn_id
        } else {
            let mut guard = self.pending.lock().await;
            guard.remove(&id);
            return Err("Not connected to aria2".to_string());
        };

        let result = tokio::time::timeout(tokio::time::Duration::from_secs(15), resp_rx).await;

        match result {
            Ok(Ok(response)) => {
                if let Some(error) = response.get("error") {
                    return Err(format!("aria2 RPC error: {}", error));
                }
                Ok(response.get("result").cloned().unwrap_or(Value::Null))
            }
            // The connection was dropped (and pending cleared) while we waited.
            Ok(Err(_)) => Err("aria2 RPC connection lost".to_string()),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                // A silent socket is most likely dead; reconnect on next call.
                self.clear_connection(conn_id).await;
                Err("RPC request timed out".to_string())
            }
        }
    }

    pub async fn add_uri(
        &self,
        uris: Vec<String>,
        dir: &str,
        filename: &str,
        headers: Option<Vec<String>>,
    ) -> Result<String, String> {
        let mut options = json!({
            "dir": dir,
            "out": filename,
        });

        if let Some(h) = headers {
            options["header"] = json!(h);
        }

        let result = self
            .call("aria2.addUri", vec![json!(uris), options])
            .await?;

        result
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "Invalid GID response".to_string())
    }

    pub async fn tell_status(&self, gid: &str) -> Result<Aria2Status, String> {
        let result = self.call("aria2.tellStatus", vec![json!(gid)]).await?;

        serde_json::from_value(result).map_err(|e| format!("Failed to parse status: {}", e))
    }

    pub async fn tell_active(&self) -> Result<Vec<Aria2Status>, String> {
        let result = self.call("aria2.tellActive", vec![]).await?;
        serde_json::from_value(result).map_err(|e| format!("Failed to parse active list: {}", e))
    }

    pub async fn tell_waiting(&self, offset: i32, num: i32) -> Result<Vec<Aria2Status>, String> {
        let result = self
            .call("aria2.tellWaiting", vec![json!(offset), json!(num)])
            .await?;
        serde_json::from_value(result).map_err(|e| format!("Failed to parse waiting list: {}", e))
    }

    pub async fn pause(&self, gid: &str) -> Result<String, String> {
        let result = self.call("aria2.pause", vec![json!(gid)]).await?;
        result
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "Invalid pause response".to_string())
    }

    pub async fn unpause(&self, gid: &str) -> Result<String, String> {
        let result = self.call("aria2.unpause", vec![json!(gid)]).await?;
        result
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "Invalid unpause response".to_string())
    }

    pub async fn remove(&self, gid: &str) -> Result<String, String> {
        let result = self.call("aria2.remove", vec![json!(gid)]).await?;
        result
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "Invalid remove response".to_string())
    }

    pub async fn change_global_option(&self, options: Value) -> Result<(), String> {
        self.call("aria2.changeGlobalOption", vec![options]).await?;
        Ok(())
    }

    pub async fn shutdown(&self) -> Result<(), String> {
        let _ = self.call("aria2.shutdown", vec![]).await;
        Ok(())
    }

    pub async fn poll_all(&self) -> Result<Vec<Aria2Status>, String> {
        // Keep these RPC calls sequential on the same websocket connection.
        // Running them concurrently can leave polling stuck if one request
        // times out while another is still in flight.
        let mut active = self.tell_active().await?;
        let mut waiting = self.tell_waiting(0, 100).await?;

        active.append(&mut waiting);
        Ok(active)
    }
}

fn handle_notification(app: &AppHandle, method: &str, value: &Value) {
    let gid = value
        .get("params")
        .and_then(|p| p.as_array())
        .and_then(|arr| arr.first())
        .and_then(|obj| obj.get("gid"))
        .and_then(|g| g.as_str())
        .unwrap_or("")
        .to_string();

    if gid.is_empty() {
        return;
    }

    let event_name = match method {
        "aria2.onDownloadStart" => "aria2://download-started",
        "aria2.onDownloadComplete" => "aria2://download-complete",
        "aria2.onDownloadError" => "aria2://download-error",
        "aria2.onDownloadPause" => "aria2://download-paused",
        "aria2.onDownloadStop" => "aria2://download-stopped",
        _ => return,
    };

    info!("aria2 notification: {} for GID {}", method, gid);
    let _ = app.emit(event_name, json!({ "gid": gid }));
}
