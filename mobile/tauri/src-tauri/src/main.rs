#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .build(tauri::generate_context!())
        .expect("failed to build MiniStar mobile shell")
        .run(|_, _| {});
}
