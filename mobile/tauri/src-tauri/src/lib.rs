#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .build(tauri::generate_context!())
        .expect("failed to build MiniStar mobile shell")
        .run(|_, _| {});
}
